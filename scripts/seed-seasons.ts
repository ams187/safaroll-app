// Construit `species_seasons` par pays, depuis GBIF.
//
// Le problème qu'il règle : la table ne contenait qu'une région, `FR`, avec 76
// espèces sur les 884 du catalogue — et le backend la servait à la planète.
// Un joueur à Johannesburg recevait la saisonnalité française.
//
// Une découverte en chemin : `species_catalog.gbif_key` ne contient PAS des
// clés du référentiel GBIF. La 3017 rangée en face de `Columba livia` est une
// famille de mille-pattes, et la 41964 de `Panthera leo` ne résout rien. Le
// script résout donc chaque nom par `species/match` — exact, gratuit, une
// requête par espèce — et le SQL produit corrige la colonne au passage.
//
// Deux appels par espèce et par pays seraient 884 × 28 = 24 752 requêtes. La
// stratégie est inverse : on demande d'abord à GBIF QUELLES espèces vivent dans
// le pays (une facette `speciesKey`), on croise avec le catalogue, et on ne
// demande la répartition mensuelle que pour ce qui a survécu au croisement.
// Un pays coûte alors 1 + N appels, avec N de l'ordre de la centaine.
//
// `GLOBAL` est construit aussi, et il n'est pas décoratif : c'est le repli de
// quelqu'un dont on ne connaît pas le pays. Sans lui, `region ?? 'GLOBAL'`
// renvoie une liste vide et l'écran Défis est mort.
//
// Il n'écrit pas en base : il produit un fichier SQL, appliqué ensuite par la
// CLI. Aucune clé de service n'a donc à exister sur la machine ni à traverser
// un terminal — le seul secret en jeu reste celui, déjà établi, du lien
// `supabase link`.
//
// Usage :
//   bun scripts/seed-seasons.ts                      # monde + tous les pays
//   bun scripts/seed-seasons.ts ZA KE                # quelques pays
//   bun scripts/seed-seasons.ts --global             # le repli seul
//   supabase db query --linked --file .cache/seasons.sql

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

import { SEASON_REGIONS, WORLD_REGION } from '../src/lib/animals/region';

/**
 * Un fichier SQL PAR RÉGION, et non un seul à la fin.
 *
 * Le script tient plusieurs dizaines de minutes ; écrire au dernier moment
 * signifiait que toute interruption — un 429 fatal, une limite de temps —
 * rendait inutiles les vingt minutes déjà passées. Une région terminée est
 * désormais une région acquise, et relancer reprend là où ça s'est arrêté.
 */
const OUT_DIR = '.cache/seasons';
/**
 * Les clés GBIF, mises en cache sur disque.
 *
 * Elles ne dépendent d'aucun pays et ne bougent qu'au rythme du référentiel
 * GBIF — les recalculer à chaque lancement, c'est 856 requêtes de perdues
 * avant d'atteindre le premier pays. C'est ce qui faisait dépasser le budget de
 * temps d'un run par lots. Supprimer le fichier force la reconstruction.
 */
const KEY_CACHE = '.cache/gbif-keys.json';

const GBIF = 'https://api.gbif.org/v1/occurrence/search';
const GBIF_MATCH = 'https://api.gbif.org/v1/species/match';
/**
 * Le plafond de la facette des espèces, et il ne se devine pas.
 *
 * GBIF rend les N espèces les plus observées du pays, pas les N premières de
 * notre catalogue. À 1200, la France coupe à 4 517 observations — et la
 * coccinelle à deux points, qui en a 4 178, disparaissait alors qu'elle est
 * évidemment française. Le pays a plus de 1 200 espèces mieux recensées qu'une
 * coccinelle, voilà tout.
 *
 * À 50 000, le seuil tombe à 3 observations : plus bas que notre propre plancher
 * de `MIN_OCCURRENCES`, donc plus rien de retenable ne passe à travers. Le coût
 * est d'environ cinq secondes et une réponse volumineuse — une fois par pays.
 */
const SPECIES_FACET_LIMIT = 50_000;
/**
 * GBIF ne publie pas de quota, mais il en applique un — et il répond 429 quand
 * on le dépasse. Six déclenchaient des abandons de socket ; trois tenaient
 * jusqu'à ce que les facettes à 50 000 alourdissent les requêtes et le fassent
 * craquer en Suisse. Deux, avec une pause entre chaque appel, passent.
 */
const CONCURRENCY = 2;
/** Une respiration entre deux requêtes d'un même worker. */
const PAUSE_MS = 120;
/** En dessous, la répartition mensuelle est du bruit statistique, pas une saison. */
const MIN_OCCURRENCES = 12;

type CatalogRow = { gbif_key: number; scientific_name: string };

async function gbif(params: Record<string, string | number>): Promise<any> {
  const query = new URLSearchParams(
    Object.entries(params).map(([name, value]) => [name, String(value)]),
  );
  let last: unknown;
  let wait = 1_000;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await fetch(`${GBIF}?${query}`, {
        headers: { 'user-agent': 'SafaRoll/1.0 (seasons seed)' },
        signal: AbortSignal.timeout(60_000),
      });
      if (response.ok) {
        await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
        return await response.json();
      }
      // Un 429 dit souvent COMBIEN attendre. Le deviner par doublement partait
      // de 800 ms quand le serveur en demandait trente — d'où l'abandon après
      // cinq essais alors qu'il suffisait de patienter.
      if (response.status === 429) {
        const after = Number(response.headers.get('retry-after'));
        wait = Number.isFinite(after) && after > 0 ? after * 1_000 : Math.max(wait, 5_000);
      }
      // Une 4xx autre que 429 ne s'améliorera jamais : la relancer quatre fois
      // ne fait que masquer la vraie cause derrière un « injoignable ». Ce
      // `Object.assign` la marque non retryable au lieu de la laisser tomber
      // dans le `catch` qui suit — c'était le bug : toute erreur, y compris une
      // requête malformée, ressortait en « GBIF unreachable ».
      const fatal = response.status < 500 && response.status !== 429;
      throw Object.assign(new Error(`GBIF ${response.status} — ${query}`), { fatal });
    } catch (error) {
      if ((error as { fatal?: boolean }).fatal) throw error;
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
    // Plafonné à une minute : au-delà, ce n'est plus de la patience, c'est un
    // script qui ne finira jamais.
    wait = Math.min(wait * 2, 60_000);
  }
  throw new Error(`GBIF injoignable après 8 essais — ${query}`, { cause: last });
}

/** Exécute `work` sur chaque élément, `CONCURRENCY` à la fois. */
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

/**
 * La clé du référentiel GBIF pour un nom scientifique.
 *
 * `null` quand le nom ne tombe pas exactement sur une espèce : un rapprochement
 * flou donnerait la saisonnalité d'un cousin, ce qui est pire qu'aucune
 * saisonnalité.
 */
async function resolveKey(name: string): Promise<number | null> {
  const query = new URLSearchParams({ kingdom: 'Animalia', name });
  const response = await fetch(`${GBIF_MATCH}?${query}`, {
    headers: { 'user-agent': 'SafaRoll/1.0 (seasons seed)' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) return null;
  const data = (await response.json()) as {
    confidence?: number;
    matchType?: string;
    rank?: string;
    usageKey?: number;
  };
  if (data.matchType !== 'EXACT' || data.rank !== 'SPECIES' || !data.usageKey) return null;
  return data.usageKey;
}

/** Les clés d'espèces réellement observées dans ce pays, en une requête. */
async function speciesInCountry(country: string): Promise<Set<number>> {
  const data = await gbif({
    country,
    facet: 'speciesKey',
    facetLimit: SPECIES_FACET_LIMIT,
    kingdomKey: 1, // Animalia
    limit: 0,
  });
  const counts = data.facets?.find((facet: any) => facet.field === 'SPECIES_KEY')?.counts ?? [];
  return new Set(counts.map((entry: any) => Number(entry.name)));
}

/**
 * Les douze compteurs mensuels d'une espèce, dans un pays ou dans le monde.
 *
 * `null` quand le total est trop faible : une espèce vue trois fois dans
 * l'année donnerait une « saison » qui est en réalité le hasard des trois
 * sorties de trois observateurs.
 */
async function monthlyCounts(taxonKey: number, country?: string): Promise<number[] | null> {
  const data = await gbif({
    facet: 'month',
    facetLimit: 12,
    limit: 0,
    taxonKey,
    ...(country ? { country } : {}),
  });
  const counts = data.facets?.find((facet: any) => facet.field === 'MONTH')?.counts ?? [];
  const months = new Array(12).fill(0);
  for (const entry of counts) {
    const month = Number(entry.name);
    if (month >= 1 && month <= 12) months[month - 1] = Number(entry.count);
  }
  const total = months.reduce((sum, value) => sum + value, 0);
  return total >= MIN_OCCURRENCES ? months : null;
}

/**
 * Le SQL d'une région. Un `insert ... on conflict do update` plutôt qu'un
 * `delete` puis `insert` : la table est lue par l'app pendant qu'on la met à
 * jour, et un trou de quelques secondes viderait l'écran Défis de tout le
 * monde. Les espèces disparues d'une région restent — elles seront simplement
 * hors saison tous les mois.
 */
function regionSql(region: string, rows: { counts: number[]; name: string }[]): string {
  if (rows.length === 0) return `-- ${region}: aucune donnée\n`;
  const values = rows
    .map(
      (row) =>
        `  (${quote(region)}, ${quote(row.name)}, ARRAY[${row.counts.join(',')}]::bigint[], now())`,
    )
    .join(',\n');
  return [
    `-- ${region}: ${rows.length} espèces`,
    'insert into public.species_seasons (region, scientific_name, monthly_counts, computed_at)',
    'values',
    values,
    'on conflict (region, scientific_name) do update set',
    '  monthly_counts = excluded.monthly_counts,',
    '  computed_at = excluded.computed_at;',
    '',
  ].join('\n');
}

/** Les noms scientifiques viennent de GBIF, pas de nous. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

// --- Programme --------------------------------------------------------------

const args: string[] = process.argv.slice(2);
const globalOnly = args.includes('--global');
const wanted = args.filter((arg) => !arg.startsWith('--')).map((arg) => arg.toUpperCase());

// Le catalogue est lu par la CLI, pour la même raison : pas de clé à manipuler.
const dump = await new Response(
  Bun.spawn(
    [
      'supabase', 'db', 'query', '--linked', '-o', 'csv',
      'select gbif_key, scientific_name from public.species_catalog where gbif_key is not null order by scientific_name',
    ],
    { stdout: 'pipe' },
  ).stdout,
).text();
const species: CatalogRow[] = dump
  .split('\n')
  .slice(1)
  .filter((line) => line.includes(','))
  .map((line) => {
    const comma = line.indexOf(',');
    return {
      gbif_key: Number(line.slice(0, comma)),
      scientific_name: line.slice(comma + 1).replace(/^"|"$/g, '').replace(/""/g, '"').trim(),
    };
  })
  .filter((row) => Number.isFinite(row.gbif_key) && row.scientific_name.length > 0);
if (species.length === 0) throw new Error('Catalogue vide — `supabase link` est-il fait ?');
console.log(`Catalogue : ${species.length} espèces.`);

await mkdir(OUT_DIR, { recursive: true });

/** Écrit une région sur disque, tout de suite. */
async function persist(region: string, body: string) {
  await writeFile(
    `${OUT_DIR}/${region}.sql`,
    `-- Généré par scripts/seed-seasons.ts. Ne pas éditer à la main.\n${body}`,
  );
  console.log(`  → ${OUT_DIR}/${region}.sql`);
}

/** Une région déjà produite ne se refait pas : c'est ce qui rend le script
 *  résumable après une interruption. `--force` la reconstruit. */
const force = args.includes('--force');
async function done(region: string): Promise<boolean> {
  if (force) return false;
  return await readFile(`${OUT_DIR}/${region}.sql`, 'utf8').then(() => true, () => false);
}

// Résolution des clés, avant tout le reste : sans elles, aucune requête
// d'occurrences ne veut dire quoi que ce soit.
const cached: Record<string, number> = await readFile(KEY_CACHE, 'utf8')
  .then((text) => JSON.parse(text) as Record<string, number>)
  .catch(() => ({}));
const missing = species.filter((item) => cached[item.scientific_name] === undefined);

if (missing.length > 0) {
  console.log(`\nRésolution des clés GBIF — ${missing.length} manquantes…`);
  const found = await pool(missing, async (item) => {
    const key = await resolveKey(item.scientific_name);
    return key ? { key, name: item.scientific_name } : null;
  });
  // Les non-résolues sont mémorisées à 0 : sans ça, chaque lancement
  // réinterrogerait GBIF pour les mêmes vingt-huit noms sans réponse.
  for (const item of missing) cached[item.scientific_name] = 0;
  for (const row of found) if (row) cached[row.name] = row.key;
  await mkdir('.cache', { recursive: true });
  await writeFile(KEY_CACHE, JSON.stringify(cached));
} else {
  console.log(`\nClés GBIF : ${Object.keys(cached).length} en cache.`);
}

const keyed = species
  .map((item) => ({ gbif_key: cached[item.scientific_name] ?? 0, scientific_name: item.scientific_name }))
  .filter((row) => row.gbif_key > 0);
console.log(`  ${keyed.length}/${species.length} résolues`);

// La colonne est fausse en base : un fichier à part la corrige. Nommé `00-` pour
// passer en premier dans l'ordre alphabétique du `for f in *.sql` — les saisons
// référencent le catalogue, autant qu'il soit juste d'abord.
await persist(
  '00-catalog-keys',
  [
    '-- Correction de species_catalog.gbif_key (les valeurs en place ne sont pas',
    '-- des clés du référentiel GBIF : 3017 = une famille de mille-pattes).',
    'update public.species_catalog as c set gbif_key = v.key from (values',
    keyed.map((row) => `  (${quote(row.scientific_name)}, ${row.gbif_key})`).join(',\n'),
    ') as v(name, key) where c.scientific_name = v.name;',
    '',
  ].join('\n'),
);

// Le repli mondial d'abord : c'est lui qui garantit qu'aucun écran n'est vide,
// quel que soit le pays du joueur.
if ((!wanted.length || globalOnly) && !(await done(WORLD_REGION))) {
  console.log(`\n${WORLD_REGION} — répartition mondiale`);
  const rows = await pool(keyed, async (item) => {
    const counts = await monthlyCounts(item.gbif_key);
    return counts ? { counts, name: item.scientific_name } : null;
  });
  const kept = rows.filter((row) => row !== null);
  console.log(`  ${kept.length} espèces retenues`);
  await persist(WORLD_REGION, regionSql(WORLD_REGION, kept));
}

if (!globalOnly) {
  const regions = SEASON_REGIONS.filter(
    (region) => wanted.length === 0 || wanted.includes(region.code),
  );
  for (const region of regions) {
    if (await done(region.code)) {
      console.log(`\n${region.code} — ${region.label} : déjà fait, passé`);
      continue;
    }
    console.log(`\n${region.code} — ${region.label}`);
    const present = await speciesInCountry(region.code);
    const local = keyed.filter((item) => present.has(item.gbif_key));
    console.log(`  ${local.length} espèces du catalogue observées sur place`);
    const rows = await pool(local, async (item) => {
      const counts = await monthlyCounts(item.gbif_key, region.code);
      return counts ? { counts, name: item.scientific_name } : null;
    });
    const kept = rows.filter((row) => row !== null);
    console.log(`  ${kept.length} espèces retenues`);
    await persist(region.code, regionSql(region.code, kept));
  }
}

const written = (await readdir(OUT_DIR).catch(() => [])).filter((name) => name.endsWith('.sql'));
console.log(`\n${written.length} région(s) dans ${OUT_DIR}/.`);
console.log(`Appliquer avec :  for f in ${OUT_DIR}/*.sql; do supabase db query --linked --file "$f"; done`);
