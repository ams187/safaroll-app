// Sort du catalogue ce qu'aucun joueur ne pourra jamais photographier.
//
// DEUX DÉFAUTS, MÊME SYMPTÔME
//
// Les deux produisent un compteur d'observations bas, donc une carte au palier
// le plus convoité du jeu — celui qu'on ne peut pas obtenir.
//
// 1. LES SOUS-ESPÈCES. `Ovis aries aries` compte zéro observation, non parce
//    que le mouton domestique est introuvable, mais parce que GBIF enregistre
//    au niveau de l'espèce et pas du trinôme. Le mouton était la carte la plus
//    rare du jeu. Elles fusionnent dans leur espèce parente, qui est déjà au
//    catalogue avec son vrai compteur.
//
// 2. LES FOSSILES. `Allopleuron hofmanni` est une tortue marine du Crétacé,
//    `Adcrocuta eximia` une hyène du Miocène. Elles ont de vraies observations
//    — des spécimens de musée — donc aucun seuil numérique ne les distingue
//    d'un animal rare mais vivant. Le test qui les sépare est temporel : une
//    espèce sans AUCUNE observation depuis 1990 n'est pas photographiable.
//
// Mesuré sur un échantillon de 80 espèces sous 1 000 observations : 12 % sont
// dans ce cas.
//
// N'ÉCRIT RIEN EN BASE. Produit `.cache/purge.sql`, à relire puis à appliquer.

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const OUT = '.cache/purge.sql';
const RECENT_CACHE = '.cache/gbif-recent.json';
const CONCURRENCY = 6;
/** Au-dessus, l'espèce est massivement observée : elle est vivante, et la
 *  vérifier coûterait des milliers de requêtes pour zéro trouvaille. */
const CHECK_BELOW = 50_000;
/** Les fossiles n'ont pas d'observation moderne. 1990 laisse trente-cinq ans
 *  de marge à une espèce rare mais suivie. */
const SINCE = 1990;

async function gbif(path: string): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`https://api.gbif.org/v1/${path}`, {
      headers: { 'user-agent': 'SafaRoll/1.0 (catalog purge)' },
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (response?.ok) return response.json();
    if (response && response.status >= 400 && response.status < 500 && response.status !== 429) {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(400 * 2 ** attempt, 8_000)));
  }
  return null;
}

async function pool<T, R>(items: T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        out[index] = await work(items[index]);
      }
    }),
  );
  return out;
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

// --- Le catalogue ------------------------------------------------------------

const dump = await new Response(
  Bun.spawn(
    ['supabase', 'db', 'query', '--linked', '-o', 'csv',
      "select scientific_name as name, coalesce(gbif_key::text,'') as key, coalesce(occurrences->>'GLOBAL','') as obs from public.species_catalog"],
    { stdout: 'pipe' },
  ).stdout,
).text();

type Row = { count: number; key: number; name: string };
const rows: Row[] = dump
  .split('\n')
  .slice(1)
  .map((line) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '')))
  .filter((cells) => cells.length >= 3 && cells[0])
  .map(([name, key, count]) => ({ count: Number(count), key: Number(key), name }));
if (rows.length === 0) throw new Error('Catalogue vide — `supabase link` est-il fait ?');
console.log(`Catalogue : ${rows.length} espèces.`);

// --- 1. Les sous-espèces -----------------------------------------------------

const catalog = new Set(rows.map((row) => row.name));
const subspecies = rows
  .filter((row) => row.name.split(' ').length >= 3)
  .map((row) => ({ ...row, parent: row.name.split(' ').slice(0, 2).join(' ') }))
  .filter((row) => catalog.has(row.parent));

console.log(`\nSous-espèces à fusionner : ${subspecies.length}`);
for (const row of subspecies.slice(0, 5)) console.log(`  ${row.name} → ${row.parent}`);

// --- 2. Les fossiles ---------------------------------------------------------

const recent: Record<string, number> = await readFile(RECENT_CACHE, 'utf8')
  .then((text) => JSON.parse(text) as Record<string, number>)
  .catch(() => ({}));

const suspects = rows.filter(
  (row) => Number.isFinite(row.count) && row.count < CHECK_BELOW && row.key > 0
    && !subspecies.some((sub) => sub.name === row.name),
);
console.log(`\nEspèces à vérifier (sous ${CHECK_BELOW.toLocaleString('fr-FR')} obs) : ${suspects.length}`);

let done = 0;
const checked = await pool(suspects, async (row) => {
  let count = recent[row.name];
  if (count === undefined) {
    const data = await gbif(`occurrence/search?limit=0&taxonKey=${row.key}&year=${SINCE},2026`);
    // Une requête ratée n'est PAS zéro : sans réponse on garde l'espèce.
    // Supprimer sur une panne réseau effacerait un animal bien vivant.
    if (typeof data?.count !== 'number') return { ...row, recent: -1 };
    count = data.count;
    recent[row.name] = count;
  }
  done += 1;
  if (done % 250 === 0) {
    await writeFile(RECENT_CACHE, JSON.stringify(recent));
    console.log(`  ${done}/${suspects.length}…`);
  }
  return { ...row, recent: count };
});
await mkdir('.cache', { recursive: true });
await writeFile(RECENT_CACHE, JSON.stringify(recent));

const fossils = checked.filter((row) => row.recent === 0);
const unreachable = checked.filter((row) => row.recent === -1);

console.log(`\nAucune observation depuis ${SINCE} : ${fossils.length}`);
for (const row of fossils.slice(0, 10)) console.log(`  ${row.name}  (${row.count} obs au total)`);
if (unreachable.length > 0) console.log(`\nNon vérifiées (GBIF muet, conservées) : ${unreachable.length}`);

// --- Le SQL ------------------------------------------------------------------

const sql = [
  `-- Purge du catalogue : ${subspecies.length} sous-espèces fusionnées, ${fossils.length} espèces non photographiables.`,
  '--',
  '-- Généré par scripts/purge-unphotographable.ts. Ne pas éditer à la main.',
  '',
  '-- 1. Les captures qui pointaient sur une sous-espèce suivent leur espèce',
  '--    parente. Fait AVANT la suppression, sinon elles perdent leur atlas.',
  ...subspecies.map(
    (row) => `update public.animal_captures set scientific_name = ${sqlText(row.parent)}`
      + ` where scientific_name = ${sqlText(row.name)};`,
  ),
  '',
  '-- 2. Les sous-espèces quittent le catalogue : leur parente y est déjà, avec',
  '--    le compteur que GBIF tient vraiment.',
  ...subspecies.map((row) => `delete from public.species_catalog where scientific_name = ${sqlText(row.name)};`),
  '',
  `-- 3. Les espèces sans observation depuis ${SINCE}. Une carte qu'aucun joueur`,
  "--    ne peut obtenir n'a rien à faire au sommet de l'échelle.",
  ...fossils.map((row) => `delete from public.species_catalog where scientific_name = ${sqlText(row.name)};`),
  '',
].join('\n');

await writeFile(OUT, sql);
console.log(`\nÉcrit dans ${OUT} — ${subspecies.length + fossils.length} espèces retirées. Rien n'a été modifié en base.`);
