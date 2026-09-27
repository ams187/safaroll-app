// Recoud un compte sur un autre : tout ce que l'ancien possède passe au neuf.
//
// POURQUOI CE N'EST PAS UN SIMPLE `update ... set user_id`
//
// Les fichiers d'une capture sont rangés sous un dossier au nom du
// propriétaire — `user_XXX/photo.jpeg` — et la politique RLS de Storage lit ce
// dossier :
//
//   (storage.foldername(name))[1] = current_user_id()
//
// Déplacer la LIGNE sans déplacer le FICHIER donnerait 138 cartes dont aucune
// image ne s'affiche : la ligne appartiendrait au nouveau compte, le fichier
// resterait derrière la porte de l'ancien. Les objets sont donc déplacés
// d'abord, puis les chemins réécrits, puis seulement les propriétaires.
//
// L'ORDRE EST PORTEUR
//
//   1. fichiers      un échec ici laisse la base intacte, on relance
//   2. chemins       la ligne pointe alors sur le fichier déjà déplacé
//   3. propriétaires en dernier, quand tout ce qui pend est déjà en place
//
// Chaque étape est idempotente : un fichier déjà déplacé est compté comme fait,
// une ligne déjà réattribuée n'est plus vue. Relancer après une coupure
// reprend où ça s'était arrêté.
//
//   bun scripts/migrate-account.ts --from <ancien> --to <neuf>
//   bun scripts/migrate-account.ts --from <ancien> --to <neuf> --write

import { createClient } from '@supabase/supabase-js';

const arg = (nom: string) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const vieux = arg('from');
const neuf = arg('to');
const ecrire = process.argv.includes('--write');
if (!vieux || !neuf) throw new Error('usage: --from <ancien_user_id> --to <nouveau_user_id> [--write]');
if (vieux === neuf) throw new Error('les deux comptes sont identiques');

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const cle = process.env.SUPABASE_SECRET_KEY;
if (!url || !cle) throw new Error('EXPO_PUBLIC_SUPABASE_URL et SUPABASE_SECRET_KEY requis');
const db = createClient(url, cle, { auth: { persistSession: false } });

const BUCKETS = ['capture-originals', 'capture-stickers', 'items'];
// Les tables qui portent le propriétaire dans une colonne simple. `profiles`
// n'y est PAS : deux profils ne fusionnent pas, l'ancien se supprime à la fin.
// `animal_captures` n'est PAS ici : ses chemins doivent bouger dans la même
// écriture que son propriétaire (voir l'étape 2). Cette boucle-ci ne fait que
// changer `user_id`, ce qui casserait ses contraintes de chemin.
const TABLES = [
  'decks', 'deck_cards', 'deck_likes', 'expeditions',
  'guide_conversations', 'guide_usage', 'identification_reports', 'notification_budget',
] as const;

console.log(`${vieux}\n  → ${neuf}\n${ecrire ? '' : '\n(essai à blanc — rien ne sera écrit)\n'}`);

// ─── 1. LES FICHIERS ───────────────────────────────────────────────────────
let deplaces = 0;
let rates = 0;
for (const bucket of BUCKETS) {
  const { data: fichiers, error } = await db.storage.from(bucket).list(vieux, { limit: 1000 });
  if (error) { console.log(`  ${bucket} : ${error.message}`); continue; }
  if (!fichiers?.length) continue;
  console.log(`  ${bucket} : ${fichiers.length} fichier(s)`);
  for (const fichier of fichiers) {
    if (!ecrire) { deplaces += 1; continue; }
    const { error: erreur } = await db.storage.from(bucket)
      .move(`${vieux}/${fichier.name}`, `${neuf}/${fichier.name}`);
    // « déjà là » n'est pas un échec : c'est une reprise après coupure.
    if (erreur && !/exists|not found/i.test(erreur.message)) { rates += 1; console.log(`    ✗ ${fichier.name} — ${erreur.message}`); }
    else deplaces += 1;
  }
}
console.log(`  ${deplaces} fichier(s) ${ecrire ? 'déplacés' : 'à déplacer'}${rates ? `, ${rates} en échec` : ''}\n`);
if (rates) throw new Error('des fichiers ont échoué — la base reste intacte, relance après correction');

// ─── 2. LES CAPTURES : PROPRIÉTAIRE ET CHEMINS D'UN SEUL GESTE ─────────────
//
// Deux contraintes lient les deux :
//
//   check (original_path like user_id || '/%')
//   check (sticker_path is null or sticker_path like user_id || '/%')
//
// Elles se vérifient à chaque ligne écrite, pas en fin de transaction. Écrire
// le chemin d'abord le fait donc pointer sur le nouveau dossier alors que la
// ligne appartient encore à l'ancien compte, et Postgres refuse — c'est la
// tentative précédente. Écrire le propriétaire d'abord échoue symétriquement.
// Les trois colonnes partent ensemble, et la ligne est cohérente à tout moment.
const { data: captures, error: erreurCaptures } = await db.from('animal_captures')
  .select('id, original_path, sticker_path').eq('user_id', vieux);
if (erreurCaptures) throw erreurCaptures;
console.log(`  animal_captures : ${captures?.length ?? 0} ligne(s) ${ecrire ? 'réattribuées (propriétaire + chemins)' : 'à réattribuer (propriétaire + chemins)'}`);
if (ecrire) {
  const recoud = (chemin: string | null) => (chemin ? chemin.replace(`${vieux}/`, `${neuf}/`) : chemin);
  for (const capture of captures ?? []) {
    const { error } = await db.from('animal_captures').update({
      original_path: recoud(capture.original_path),
      sticker_path: recoud(capture.sticker_path),
      user_id: neuf,
    }).eq('id', capture.id);
    if (error) throw error;
  }
}

// ─── 3. LES PROPRIÉTAIRES ──────────────────────────────────────────────────
// Les decks vides du nouveau compte partent d'abord : ce sont les cinq decks
// par défaut, jamais remplis, et les garder ferait dix decks là où la liste
// n'en montre que cinq — les vrais, ceux qui portent les cartes, seraient
// coupés.
const { data: vides } = await db.from('decks').select('id, name').eq('user_id', neuf);
const videsIds: string[] = [];
for (const deck of vides ?? []) {
  const { count } = await db.from('deck_cards').select('*', { count: 'exact', head: true }).eq('deck_id', deck.id);
  if (!count) videsIds.push(deck.id);
}
console.log(`  ${videsIds.length} deck(s) vide(s) du nouveau compte ${ecrire ? 'supprimés' : 'à supprimer'}`);
if (ecrire && videsIds.length) {
  const { error } = await db.from('decks').delete().in('id', videsIds);
  if (error) throw error;
}

for (const table of TABLES) {
  const { count } = await db.from(table).select('*', { count: 'exact', head: true }).eq('user_id', vieux);
  if (!count) continue;
  console.log(`  ${table} : ${count} ligne(s) ${ecrire ? 'réattribuées' : 'à réattribuer'}`);
  if (!ecrire) continue;
  const { error } = await db.from(table).update({ user_id: neuf }).eq('user_id', vieux);
  if (error) throw error;
}

// `friendships` porte deux colonnes ordonnées (`user_low` < `user_high`), donc
// pas un simple update : l'ordre peut s'inverser. Peu de lignes, on les relit.
const { data: liens } = await db.from('friendships').select('*')
  .or(`user_low.eq.${vieux},user_high.eq.${vieux}`);
console.log(`  friendships : ${liens?.length ?? 0} lien(s) ${ecrire ? 'recousus' : 'à recoudre'}`);
if (ecrire) {
  for (const lien of liens ?? []) {
    const autre = lien.user_low === vieux ? lien.user_high : lien.user_low;
    if (autre === neuf) {
      // Une « amitié » entre les deux comptes de la même personne n'a plus
      // d'objet une fois fusionnés.
      await db.from('friendships').delete().eq('user_low', lien.user_low).eq('user_high', lien.user_high);
      continue;
    }
    const [bas, haut] = [neuf, autre].sort();
    await db.from('friendships').delete().eq('user_low', lien.user_low).eq('user_high', lien.user_high);
    await db.from('friendships').insert({
      created_at: lien.created_at, requested_by: lien.requested_by === vieux ? neuf : lien.requested_by,
      responded_at: lien.responded_at, status: lien.status, user_high: haut, user_low: bas,
    });
  }
}

// ─── 4. LE PROFIL VIDÉ ─────────────────────────────────────────────────────
// Supprimé en dernier : tant qu'une ligne pend encore dessus, la clé étrangère
// le retient — et c'est exactement le filet qu'on veut.
console.log(`  profil de l'ancien compte ${ecrire ? 'supprimé' : 'à supprimer'}`);
if (ecrire) {
  const { error } = await db.from('profiles').delete().eq('user_id', vieux);
  if (error) throw error;
}

console.log(ecrire ? '\nFusion terminée.' : '\nRien écrit. Relance avec --write.');
