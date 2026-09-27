// Recalcule la rareté du catalogue depuis les compteurs mondiaux GBIF.
//
// Il n'écrit pas : il produit le SQL et un rapport de ce qui change. La rareté
// décide de l'apparence de chaque carte déjà collectée par chaque joueur — ça
// se regarde avant de s'appliquer.
//
// Usage :
//   bun scripts/recompute-rarity.ts
//   supabase db query --linked --file .cache/rarity.sql

import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { rarityFromOccurrences } from '../src/lib/animals/species-rarity';

const OUT = '.cache/rarity.sql';
/** Les compteurs, en cache : ils bougent lentement et coûtent une requête. */
const CACHE = '.cache/gbif-occurrences.json';
const CONCURRENCY = 4;

async function gbif(url: string): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, {
      headers: { 'user-agent': 'SafaRoll/1.0 (rarity)' },
      signal: AbortSignal.timeout(45_000),
    }).catch(() => null);
    if (response?.ok) return response.json();
    await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
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

const dump = await new Response(
  Bun.spawn(
    ['supabase', 'db', 'query', '--linked', '-o', 'csv',
     "select scientific_name || '|' || coalesce(vernacular_name,'') || '|' || coalesce(rarity,'') || '|' || coalesce(gbif_key::text,'') || '|' || coalesce(occurrences->>'GLOBAL','') from public.species_catalog order by scientific_name"],
    { stdout: 'pipe' },
  ).stdout,
).text();

type Row = { key: number; name: string; rarity: string; stored: number; vernacular: string };
const rows: Row[] = dump
  .split('\n').slice(1)
  .map((line) => line.trim().replace(/^"|"$/g, '').split('|'))
  .filter((parts) => parts.length === 5 && parts[0])
  .map(([name, vernacular, rarity, key, stored]) => ({
    key: Number(key),
    name,
    rarity,
    // Les espèces ajoutées par `expand-catalog.ts` arrivent avec leur compteur
    // mondial déjà stocké : le redemander à GBIF serait trois mille requêtes
    // pour un chiffre qu'on a déjà sous la main.
    stored: stored ? Number(stored) : Number.NaN,
    vernacular,
  }));
if (rows.length === 0) throw new Error('Catalogue vide — `supabase link` est-il fait ?');
console.log(`Catalogue : ${rows.length} espèces.`);

const cache: Record<string, number> = await readFile(CACHE, 'utf8')
  .then((text) => JSON.parse(text) as Record<string, number>)
  .catch(() => ({}));

/** Les compteurs récoltés par `expand-catalog.ts`, indexés par clé GBIF. Même
 *  définition que ceux du cache par nom : le total de `occurrence/search`. */
const details: Record<string, number> = await readFile('.cache/species-details.json', 'utf8')
  .then((text) => Object.fromEntries(
    Object.entries(JSON.parse(text) as Record<string, { occurrences?: number }>)
      .map(([key, row]) => [key, row.occurrences])
      .filter(([, count]) => typeof count === 'number'),
  ) as Record<string, number>)
  .catch(() => ({}));

console.log('\nCompteurs mondiaux GBIF…');
const counts = await pool(rows, async (row) => {
  // La valeur stockée en base n'est PAS une source : la colonne a deux
  // provenances. Les 884 d'origine tiennent un compteur de facette écrit par
  // `seed-seasons` — le moineau y figure à 550 243 quand il en a 25 841 840 —
  // et les espèces ajoutées tiennent le vrai total. Calibrer sur le mélange
  // range le moineau au même rang qu'un papillon régional.
  const detailed = details[String(row.key)];
  if (typeof detailed === 'number') return detailed;
  const cached = cache[row.name];
  if (cached !== undefined) return cached;
  // La clé du catalogue a été corrigée par `seed-seasons`, mais on ne s'y fie
  // pas : un compteur tiré d'une mauvaise clé donnerait une rareté fausse sans
  // rien signaler. Le nom est résolu à chaque fois qu'il manque.
  let key = row.key;
  if (!key || !Number.isFinite(key)) {
    const match = await gbif(
      `https://api.gbif.org/v1/species/match?kingdom=Animalia&name=${encodeURIComponent(row.name)}`,
    );
    if (match?.matchType !== 'EXACT' || !match?.usageKey) return -1;
    key = match.usageKey;
  }
  const data = await gbif(`https://api.gbif.org/v1/occurrence/search?limit=0&taxonKey=${key}`);
  const count = typeof data?.count === 'number' ? data.count : -1;
  if (count >= 0) cache[row.name] = count;
  return count;
});
await mkdir('.cache', { recursive: true });
await writeFile(CACHE, JSON.stringify(cache));

const changes: { from: string; name: string; to: string; count: number; vernacular: string }[] = [];
const unresolved: string[] = [];
const updates: string[] = [];

rows.forEach((row, index) => {
  const count = counts[index];
  if (count < 0) { unresolved.push(row.name); return; }
  const next = rarityFromOccurrences(count);
  if (!next) { unresolved.push(row.name); return; }
  updates.push(`  ('${row.name.replaceAll("'", "''")}', '${next}', ${count})`);
  if (next !== row.rarity) {
    changes.push({ count, from: row.rarity || '(vide)', name: row.name, to: next, vernacular: row.vernacular });
  }
});

await writeFile(
  OUT,
  [
    '-- Généré par scripts/recompute-rarity.ts. Ne pas éditer à la main.',
    '-- Rareté dérivée du compteur mondial GBIF — voir src/lib/animals/species-rarity.ts.',
    'update public.species_catalog as c',
    "set rarity = v.rarity, occurrences = jsonb_build_object('GLOBAL', v.count)",
    'from (values',
    updates.join(',\n'),
    ') as v(name, rarity, count) where c.scientific_name = v.name;',
    '',
  ].join('\n'),
);

const byMove = new Map<string, number>();
for (const change of changes) {
  const move = `${change.from} → ${change.to}`;
  byMove.set(move, (byMove.get(move) ?? 0) + 1);
}

// La pyramide, avant de décider quoi que ce soit.
//
// La dernière calibration a été faite sur seize espèces choisies à la main et a
// produit 54 % de cartes ultra rares ou légendaires. Un seuil ne se juge pas
// sur des exemples : il se juge sur la forme qu'il donne au catalogue entier.
const ORDER = [
  'common', 'uncommon', 'rare', 'very_rare', 'ultra_rare', 'epic', 'mythic', 'legendary',
];
const LABEL: Record<string, string> = {
  common: 'commun', epic: 'épique', legendary: 'légendaire', mythic: 'mythique',
  rare: 'rare', ultra_rare: 'ultra rare', uncommon: 'peu commun', very_rare: 'très rare',
};
const resolved = counts.filter((count) => count >= 0);
const pyramid = new Map<string, number>();
const before = new Map<string, number>();
rows.forEach((row, index) => {
  const next = counts[index] >= 0 ? rarityFromOccurrences(counts[index]) : undefined;
  if (next) pyramid.set(next, (pyramid.get(next) ?? 0) + 1);
  if (row.rarity) before.set(row.rarity, (before.get(row.rarity) ?? 0) + 1);
});

console.log('\n--- La pyramide ---');
console.log('                  proposé     aujourd’hui');
for (const rarity of ORDER) {
  const proposed = (100 * (pyramid.get(rarity) ?? 0)) / Math.max(resolved.length, 1);
  const current = (100 * (before.get(rarity) ?? 0)) / Math.max(rows.length, 1);
  console.log(
    `  ${LABEL[rarity].padEnd(12)} ${proposed.toFixed(1).padStart(8)} %  ${current.toFixed(1).padStart(10)} %`,
  );
}

const sorted = [...resolved].sort((a, b) => b - a);
console.log('\nDistribution des observations mondiales :');
for (const percentile of [0, 10, 25, 50, 75, 90, 99]) {
  const value = sorted[Math.min(Math.floor((percentile / 100) * sorted.length), sorted.length - 1)];
  console.log(`  ${String(percentile).padStart(3)}ᵉ centile  ${value.toLocaleString('fr-FR').padStart(12)}`);
}

console.log(`\n--- Ce qui change ---`);
console.log(`inchangées   ${rows.length - changes.length - unresolved.length}`);
console.log(`modifiées    ${changes.length}`);
console.log(`non résolues ${unresolved.length}  (rareté actuelle conservée)`);
console.log('\nMouvements les plus fréquents :');
for (const [move, count] of [...byMove.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(count).padStart(4)}  ${move}`);
}
console.log('\nQuelques promotions et rétrogradations notables :');
for (const change of changes.filter((c) => c.vernacular).slice(0, 12)) {
  console.log(`  ${change.vernacular.padEnd(26)} ${change.from} → ${change.to}  (${change.count.toLocaleString('fr-FR')} obs)`);
}
console.log(`\nÉcrit dans ${OUT}. Rien n'a été modifié en base.`);
