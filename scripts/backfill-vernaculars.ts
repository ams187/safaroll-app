// Donne un nom courant aux espèces du catalogue qui n'en ont pas.
//
// LE TROU QUE ÇA FERME
//
// `identify-animal` traduit toute espèce que GBIF connaît — plus de 200 000,
// dans les vingt langues de `LANGUAGE_CODES`. Mais il SAUTE l'appel quand
// l'espèce est au catalogue, au motif que le catalogue porte déjà des noms
// relus à la main. 945 de ses 5 576 lignes n'en portent aucun. Ces espèces-là
// finissaient donc en latin sur la carte, alors qu'une espèce ABSENTE du
// catalogue, elle, était traduite. L'edge function refuse maintenant de sauter
// une ligne incomplète ; ce script ferme le trou à la source, pour que la
// question ne se pose plus au moment de la capture.
//
// LE MÊME CONSENSUS QUE LE SERVEUR, PAS UNE APPROXIMATION
//
// `vernacularsByConsensus` et `LANGUAGE_CODES` sont importés du module que
// l'edge function utilise. Réécrire le choix du nom ici le ferait diverger, et
// le catalogue afficherait « Mélopsitte ondulé » là où la capture dit
// « Perruche ondulée ».
//
// GBIF MUET NE VAUT PAS « PAS DE NOM »
//
// Une ligne sans réponse reste intacte. Beaucoup de ces 945 sont des espèces
// fossiles ou des coléoptères obscurs qui n'ONT pas de nom français : elles
// resteront en latin, et c'est correct. Relancer le script plus tard ne coûte
// rien et rattrape ce que GBIF aura appris entre-temps.
//
//   bun scripts/backfill-vernaculars.ts           liste ce qui serait fait
//   bun scripts/backfill-vernaculars.ts --write   écrit

import { LANGUAGE_CODES, vernacularsByConsensus } from '../supabase/functions/_shared/vernacular-consensus.ts';

const ecrire = process.argv.includes('--write');

async function sql(query: string) {
  const proc = Bun.spawn(['bunx', 'supabase', 'db', 'query', '--linked', query], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const sortie = await new Response(proc.stdout).text();
  const debut = sortie.indexOf('{');
  if (debut < 0) throw new Error(sortie);
  return JSON.parse(sortie.slice(debut)).rows as Record<string, unknown>[];
}

const litteral = (valeur: string) => `'${valeur.replace(/'/g, "''")}'`;

async function nomsGbif(nom: string): Promise<Record<string, string> | null> {
  const match = await fetch(
    `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(nom)}`,
    { signal: AbortSignal.timeout(10_000) },
  ).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  // Le même seuil que l'edge function : sous 90 de confiance, GBIF rend
  // volontiers le genre voisin, et on collerait le nom d'une autre bête.
  if (
    !match?.usageKey
    || match.matchType === 'NONE'
    || !['SPECIES', 'SUBSPECIES'].includes(match.rank ?? '')
    || (match.confidence ?? 0) < 90
  ) return null;

  const reponse = await fetch(
    `https://api.gbif.org/v1/species/${match.usageKey}/vernacularNames?limit=200`,
    { signal: AbortSignal.timeout(10_000) },
  ).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const noms = (reponse?.results ?? []) as { language?: string; vernacularName?: string }[];
  const vernaculaires = vernacularsByConsensus(noms, LANGUAGE_CODES);
  return Object.keys(vernaculaires).length ? vernaculaires : null;
}

const lignes = await sql(`
  select scientific_name, vernacular_name, vernacular_name_en
  from public.species_catalog
  where vernacular_name is null or vernacular_name_en is null
  order by scientific_name
`);

console.log(`${lignes.length} espèce(s) du catalogue sans nom courant complet.\n`);

let remplies = 0;
let muettes = 0;

// UNE ÉCRITURE PAR LIGNE COÛTE PLUS CHER QUE LA REQUÊTE GBIF
//
// `sql()` lance un `bunx supabase db query`, soit un processus complet par
// appel : ~2 s à vide. Sur 994 lignes ça faisait cinquante minutes de spawn
// pour trois minutes de travail réel. Les mises à jour partent donc par lots,
// dans une seule transaction implicite chacun.
const LOT = 100;
const enAttente: string[] = [];

async function vider() {
  if (!enAttente.length) return;
  await sql(enAttente.join('\n'));
  console.log(`    → ${enAttente.length} ligne(s) écrite(s)`);
  enAttente.length = 0;
}

for (const ligne of lignes) {
  const nom = String(ligne.scientific_name);
  const vernaculaires = await nomsGbif(nom);
  if (!vernaculaires) {
    muettes += 1;
    console.log(`  ~ ${nom} — GBIF muet, laissée en latin`);
    continue;
  }

  // Le catalogue relu à la main garde toujours le dessus : on ne remplit que
  // les colonnes VIDES. Un nom déjà présent n'est jamais remplacé par GBIF.
  const fr = (ligne.vernacular_name as string | null) ?? vernaculaires.fr ?? null;
  const en = (ligne.vernacular_name_en as string | null) ?? vernaculaires.en ?? null;
  if (!fr && !en) {
    muettes += 1;
    console.log(`  ~ ${nom} — aucun nom fr ni en chez GBIF`);
    continue;
  }

  remplies += 1;
  console.log(`  ${ecrire ? '✓' : '·'} ${nom} — fr: ${fr ?? '—'} / en: ${en ?? '—'} (${Object.keys(vernaculaires).length} langues)`);
  if (!ecrire) continue;

  // `vernaculars` fusionne par-dessus l'existant plutôt que d'écraser : la
  // colonne peut déjà porter des langues venues d'un passage précédent.
  enAttente.push(
    `update public.species_catalog set `
    + `vernacular_name = ${fr ? litteral(fr) : 'vernacular_name'}, `
    + `vernacular_name_en = ${en ? litteral(en) : 'vernacular_name_en'}, `
    + `vernaculars = vernaculars || ${litteral(JSON.stringify(vernaculaires))}::jsonb `
    + `where scientific_name = ${litteral(nom)};`,
  );
  if (enAttente.length >= LOT) await vider();
}

if (ecrire) await vider();
console.log(`\n${remplies} remplie(s), ${muettes} sans nom connu.`);
if (!ecrire) console.log('Rien écrit. Relance avec --write.');
