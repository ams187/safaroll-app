// LE FILTRE DE BLOCAGE EST FACILE À OUBLIER, ET SON OUBLI NE SE VOIT PAS.
//
// Les fonctions qui alimentent la communauté sont `security definer` : elles
// s'exécutent avec les droits du propriétaire et IGNORENT toute policy RLS.
// Une nouvelle RPC de ce genre, écrite sans `is_blocked`, rend un joueur bloqué
// de nouveau visible — sans erreur, sans avertissement, sans rien à l'écran qui
// le signale. Ça ne se découvre qu'au rejet App Store, ou pire, par la personne
// qui avait bloqué.
//
// Ce contrôle relit la DERNIÈRE définition de chacune de ces fonctions dans les
// migrations et exige le filtre. Il vérifie aussi que les deux gestes exigés par
// la directive Apple 1.2 restent atteignables depuis l'interface.
// Run: bun run check:ugc
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check-ugc-moderation: ${message}`);
}

const RACINE = join(import.meta.dir, '..');
const DOSSIER = join(RACINE, 'supabase/migrations');

/** Les migrations s'appliquent dans l'ordre des noms : la dernière définition
 *  d'une fonction est celle qui vit en base. */
const migrations = readdirSync(DOSSIER)
  .filter((nom) => nom.endsWith('.sql'))
  .sort()
  .map((nom) => readFileSync(join(DOSSIER, nom), 'utf8'));

/** Extrait le corps de la dernière définition de `nom`, ou null. */
function derniereDefinition(nom: string): string | null {
  let trouvee: string | null = null;
  for (const sql of migrations) {
    // `create [or replace] function public.<nom>(` ... jusqu'au `$$;` qui ferme.
    const debut = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${nom}\\s*\\(`, 'g');
    let match: RegExpExecArray | null;
    while ((match = debut.exec(sql))) {
      const fin = sql.indexOf('$$;', match.index);
      if (fin > -1) trouvee = sql.slice(match.index, fin);
    }
  }
  return trouvee;
}

// --- Les RPC qui exposent quelqu'un ---------------------------------------

const EXPOSANTES = [
  'community_leaderboard',
  'register_board',
  'find_explorer',
  'community_profile',
  'list_friends',
  'request_friend',
];

for (const nom of EXPOSANTES) {
  const corps = derniereDefinition(nom);
  assert(corps, `la fonction ${nom} est introuvable dans les migrations`);
  assert(
    corps.includes('is_blocked'),
    `${nom} est security definer et ne filtre pas les blocages : un joueur bloqué y reste visible`,
  );
}

// --- Le blocage doit couper dans les DEUX sens ----------------------------

const isBlocked = derniereDefinition('is_blocked');
assert(isBlocked, 'is_blocked est introuvable');
assert(
  isBlocked.includes('security definer'),
  'is_blocked doit être security definer, sinon la RLS de user_blocks cache le sens « il m’a bloqué »',
);
assert(
  /blocker_id\s*=\s*public\.current_user_id\(\)/.test(isBlocked)
    && /blocked_id\s*=\s*public\.current_user_id\(\)/.test(isBlocked),
  'is_blocked ne teste qu’un sens : bloquer quelqu’un qui vous voit encore ne protège personne',
);

// --- La liste des bloqués doit traverser la RLS ---------------------------

const listBlocked = derniereDefinition('list_blocked');
assert(listBlocked, 'list_blocked est introuvable : sans elle, un blocage est irréversible');
assert(
  listBlocked.includes('security definer'),
  'list_blocked doit traverser la RLS — la policy de profiles masque justement les bloqués',
);

// --- Les deux gestes doivent rester atteignables --------------------------

const hook = readFileSync(join(RACINE, 'src/components/moderation/use-moderation.ts'), 'utf8');
// On vérifie les CLÉS, pas les libellés : ceux-ci vivent maintenant dans
// `src/locales`. Chercher « Signaler » en dur ferait échouer ce contrôle à la
// prochaine traduction, alors que la fonctionnalité serait intacte.
assert(hook.includes("t('mod_report')"), 'l’action « Signaler » a disparu du menu de modération');
assert(hook.includes("t('mod_block')"), 'l’action « Bloquer » a disparu du menu de modération');
for (const cle of ['mod_report', 'mod_block', 'mod_block_body', 'mod_report_sent']) {
  for (const langue of ['fr', 'en']) {
    const dico = JSON.parse(readFileSync(join(RACINE, `src/locales/${langue}.json`), 'utf8'));
    assert(dico[cle], `la clé ${cle} manque dans ${langue}.json — le menu afficherait son identifiant`);
  }
}
assert(
  hook.includes('present'),
  'useModeration doit exposer `present` : un appui long seul est un geste caché, qu’Apple compte comme absent',
);

const joueur = readFileSync(join(RACINE, 'src/app/(app)/player/[id].tsx'), 'utf8');
assert(
  joueur.includes('moderation.present'),
  'la fiche d’un joueur doit porter un bouton VISIBLE de signalement (directive Apple 1.2)',
);

const galerie = readFileSync(join(RACINE, 'src/components/community/public-decks-screen.tsx'), 'utf8');
assert(
  galerie.includes('useModeration'),
  'la galerie de decks publics montre le contenu d’autrui et doit pouvoir le signaler',
);

// --- Les conditions doivent poser la tolérance zéro -----------------------

const conditions = readFileSync(join(RACINE, 'src/components/legal/terms-sheet.tsx'), 'utf8');
assert(
  /[Tt]olérance zéro/.test(conditions),
  'les conditions doivent énoncer la tolérance zéro exigée pour le contenu publié par les utilisateurs',
);

const connexion = readFileSync(join(RACINE, 'src/app/(auth)/sign-in.tsx'), 'utf8');
assert(
  connexion.includes('TermsSheet'),
  'l’écran de connexion doit rendre les conditions LISIBLES : une acceptation sans texte n’en est pas une',
);

console.log('check-ugc-moderation: ok');
