// Le catalogue passe de 884 à ~3000 espèces.
//
// DEUX SOURCES, UN SEUL FICHIER SQL
//
// 1. Les ORPHELINES — 771 illustrations déjà dans `card-scenes` dont l'espèce
//    n'est jamais entrée au catalogue. L'art est payé, il ne manque qu'une
//    ligne. C'est le gain le plus rentable du lot.
// 2. Les CANDIDATES — le classement de `rank-catalog-candidates.ts`, les
//    espèces les plus observées de chaque classe plus la liste curée.
//
// CE QUI EST RÉCUPÉRÉ POUR CHACUNE
//
// La taxonomie complète (les 884 actuelles l'ont laissée à NULL, on ne répète
// pas l'erreur), le compteur mondial d'observations — celui qui décidera de la
// rareté à l'étape suivante — et les noms courants dans les 19 langues de
// l'app. Un joueur japonais lit « ライオン », pas `Panthera leo`.
//
// REPRISE
//
// Chaque espèce résolue est écrite dans le cache avant de passer à la suivante.
// Une coupure ne perd que la requête en cours : relancer reprend où ça s'est
// arrêté. Leçon de `seed-seasons.ts`, tué à dix minutes après avoir tout gardé
// en mémoire.
//
// N'ÉCRIT RIEN EN BASE. Produit un fichier de migration, à relire puis à
// appliquer avec `supabase db push`.

import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { vernacularsByConsensus } from '../supabase/functions/_shared/vernacular-consensus';

const GBIF = 'https://api.gbif.org/v1';
const CANDIDATES = '.cache/catalog-candidates.csv';
const DETAILS_CACHE = '.cache/species-details.json';
// Douze, et pas quatre. Mesuré : `occurrence/search?limit=0` coûte 1,6 s à lui
// seul — c'est la latence de GBIF, pas un débit limité. Douze de ces requêtes
// lancées ensemble reviennent en 2,3 s, toutes en 200. Le facteur limitant
// était l'attente, pas le serveur.
const CONCURRENCY = 12;

/** Les langues de l'app, et les codes GBIF qui y mènent.
 *  Copie de `supabase/functions/identify-animal/index.ts` — même table, deux
 *  runtimes (Deno et Bun) qui ne partagent pas de module. */
const LANGUAGE_CODES: Record<string, string> = {
  ar: 'ar', ara: 'ar',
  de: 'de', deu: 'de', ger: 'de',
  en: 'en', eng: 'en',
  es: 'es', spa: 'es',
  fr: 'fr', fra: 'fr', fre: 'fr',
  hi: 'hi', hin: 'hi',
  id: 'id', ind: 'id',
  it: 'it', ita: 'it',
  ja: 'ja', jpn: 'ja',
  ko: 'ko', kor: 'ko',
  nl: 'nl', nld: 'nl', dut: 'nl',
  pl: 'pl', pol: 'pl',
  pt: 'pt', por: 'pt',
  ru: 'ru', rus: 'ru',
  sv: 'sv', swe: 'sv',
  tr: 'tr', tur: 'tr',
  vi: 'vi', vie: 'vi',
  zh: 'zh', zho: 'zh', chi: 'zh',
};

type Details = {
  canonicalName: string;
  class?: string;
  family?: string;
  genus?: string;
  key: number;
  kingdom?: string;
  occurrences: number;
  order?: string;
  phylum?: string;
  scientificName: string;
  vernaculars: Record<string, string>;
};

// --- GBIF --------------------------------------------------------------------

/** Les requêtes qu'il a fallu recommencer. Un compteur muet est ce qui a caché
 *  l'effondrement de débit la première fois. */
let stalls = 0;
/** Les clés que GBIF ne connaît plus. Comptées, pas retentées. */
let dead = 0;

async function gbif(path: string, params: Record<string, string | number> = {}): Promise<any> {
  const query = new URLSearchParams(
    Object.entries(params).map(([name, value]) => [name, String(value)]),
  );
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${GBIF}/${path}?${query}`, {
      headers: { 'user-agent': 'SafaRoll/1.0 (catalog expansion)' },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (response?.ok) return response.json();
    // Un 4xx est une RÉPONSE, pas un incident : la clé n'existe plus (GBIF en
    // fusionne et en supprime), et la redemander cinq fois avec attente ne la
    // fera pas réapparaître. C'est ce qui immobilisait les workers — 119
    // reprises pour 50 espèces résolues, toutes sur des 404.
    // Le 429 fait exception : lui, il demande explicitement de réessayer.
    if (response && response.status >= 400 && response.status < 500 && response.status !== 429) {
      dead += 1;
      return null;
    }
    stalls += 1;
    // Plafond à 10 s, et cinq essais. La version d'avant montait à 60 s huit
    // fois : un seul item récalcitrant immobilisait son worker trois minutes,
    // et douze workers immobilisés font tomber le débit de 340/min à 25 sans
    // qu'une seule ligne apparaisse dans le log. Un item perdu se rattrape à
    // la relance — pas une course entière.
    const retryAfter = Number(response?.headers.get('retry-after') ?? 0);
    const wait = retryAfter > 0
      ? Math.min(retryAfter * 1_000, 10_000)
      : Math.min(500 * 2 ** attempt, 10_000);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  return null;
}

async function pool<T, R>(items: T[], work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;
        out[index] = await work(items[index], index);
      }
    }),
  );
  return out;
}

// --- Ce qu'on a déjà ---------------------------------------------------------

async function cliRows(sql: string): Promise<string[]> {
  const text = await new Response(
    Bun.spawn(['supabase', 'db', 'query', '--linked', '-o', 'csv', sql], { stdout: 'pipe' }).stdout,
  ).text();
  return text.split('\n').slice(1).map((line) => line.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

const catalog = new Set(
  (await cliRows('select lower(scientific_name) from public.species_catalog')).map((n) => n),
);
if (catalog.size === 0) throw new Error('Catalogue vide — `supabase link` est-il fait ?');

const scenesText = await new Response(
  Bun.spawn(['supabase', 'storage', 'ls', 'ss:///card-scenes/', '--experimental'], {
    stdout: 'pipe',
  }).stdout,
).text();
const orphans = scenesText
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /^[a-z-]+\.webp$/.test(line))
  .map((line) => line.replace('.webp', '').replaceAll('-', ' '))
  .filter((name) => !catalog.has(name));

// --- Les candidates ----------------------------------------------------------

const csv = await readFile(CANDIDATES, 'utf8').catch(() => '');
if (!csv) throw new Error(`${CANDIDATES} absent — lancer d'abord rank-catalog-candidates.ts`);
const candidateKeys = csv
  .split('\n')
  .slice(1)
  .map((line) => line.split(','))
  .filter((cells) => cells.length >= 8 && cells[6] === 'non')
  .map((cells) => Number(cells[3]))
  .filter((key) => Number.isFinite(key) && key > 0);

// Troisième source : les familles de zoo balayées au complet. Le classement
// par classe ne les voit pas — il prend les espèces les plus observées à
// l'état SAUVAGE, et un fossa n'a que 417 observations. Voir
// `scripts/sweep-zoo-families.ts`.
const familyKeys: number[] = await readFile('.cache/zoo-family-keys.json', 'utf8')
  .then((text) => JSON.parse(text) as number[])
  .catch(() => []);

console.log(`Catalogue actuel : ${catalog.size} espèces.`);
console.log(`Orphelines       : ${orphans.length} (illustration déjà payée)`);
console.log(`Candidates       : ${candidateKeys.length}`);
console.log(`Familles de zoo  : ${familyKeys.length}`);

// --- Résolution --------------------------------------------------------------

const cache: Record<string, Details> = await readFile(DETAILS_CACHE, 'utf8')
  .then((text) => JSON.parse(text) as Record<string, Details>)
  .catch(() => ({}));
let resolved = 0;
let flushed = 0;

async function detailsFor(key: number): Promise<Details | null> {
  const cached = cache[String(key)];
  if (cached) return cached;

  const species = await gbif(`species/${key}`);
  const canonicalName = species?.canonicalName ?? species?.scientificName;
  // Seulement des ESPÈCES : un genre ou une famille ne fait pas une carte, et
  // « Corvus » comme nom de carte n'aurait aucun sens pour un joueur.
  if (!canonicalName || species?.rank !== 'SPECIES') return null;

  const names = await gbif(`species/${key}/vernacularNames`, { limit: 200 });
  const vernaculars = vernacularsByConsensus(names?.results ?? [], LANGUAGE_CODES);

  const search = await gbif('occurrence/search', { limit: 0, taxonKey: key });
  // Une requête ratée ne vaut PAS zéro. `?? 0` avait fait entrer 148 espèces
  // au compteur nul — dont `Ernoporicus fagi`, qui en a 13 996 — et un zéro
  // stocké se relit plus tard comme un fait : espèce ultra rare, carte fausse.
  // On ne met rien en cache : la relance la reprendra.
  if (typeof search?.count !== 'number') return null;

  const details: Details = {
    canonicalName,
    class: species.class,
    family: species.family,
    genus: species.genus,
    key,
    kingdom: species.kingdom,
    occurrences: search.count,
    order: species.order,
    phylum: species.phylum,
    scientificName: canonicalName,
    vernaculars,
  };
  cache[String(key)] = details;

  // Écrit par paquets de 50 : une écriture par espèce ferait 3000 réécritures
  // d'un fichier qui grossit, une seule à la fin perdrait tout sur une coupure.
  resolved += 1;
  if (resolved - flushed >= 50) {
    flushed = resolved;
    await writeFile(DETAILS_CACHE, JSON.stringify(cache));
    console.log(`  ${resolved} résolues…  (${stalls} reprises, ${dead} clés mortes)`);
  }
  return details;
}

// Les orphelines n'ont qu'un nom : il faut d'abord leur clé GBIF.
console.log('\nClés des orphelines…');
const orphanKeys = (
  await pool(orphans, async (name) => {
    const match = await gbif('species/match', { kingdom: 'Animalia', name });
    if (!match?.usageKey || match.matchType === 'NONE') return null;
    return Number(match.usageKey);
  })
).filter((key): key is number => key !== null);
console.log(`  ${orphanKeys.length}/${orphans.length} résolues`);

console.log('\nDétails, noms multilingues et compteurs…');
const targets = [...new Set([...orphanKeys, ...candidateKeys, ...familyKeys])];
const details = (await pool(targets, detailsFor)).filter((row): row is Details => row !== null);
await mkdir('.cache', { recursive: true });
await writeFile(DETAILS_CACHE, JSON.stringify(cache));

// Une espèce déjà au catalogue sous un autre nom scientifique ressortirait ici
// en doublon : le `on conflict` du SQL l'absorbe, mais autant ne pas l'écrire.
const fresh = details.filter((row) => !catalog.has(row.scientificName.toLowerCase()));

console.log(`\n${fresh.length} espèces à ajouter.`);
console.log(`  avec noms multilingues  ${fresh.filter((r) => Object.keys(r.vernaculars).length > 1).length}`);
console.log(`  sans nom français       ${fresh.filter((r) => !r.vernaculars.fr).length}`);

// --- La migration ------------------------------------------------------------

function sqlText(value: string | undefined): string {
  return value ? `'${value.replaceAll("'", "''")}'` : 'null';
}

const values = fresh
  .map((row) => {
    const vernaculars = JSON.stringify(row.vernaculars).replaceAll("'", "''");
    return `  (${sqlText(row.scientificName)}, ${row.key}, ${sqlText(row.canonicalName)}, `
      + `${sqlText(row.vernaculars.fr)}, ${sqlText(row.vernaculars.en)}, `
      + `${sqlText(row.kingdom)}, ${sqlText(row.phylum)}, ${sqlText(row.class)}, `
      + `${sqlText(row.order)}, ${sqlText(row.family)}, ${sqlText(row.genus)}, `
      + `'${vernaculars}'::jsonb, ${row.occurrences})`;
  })
  .join(',\n');

const migration = `-- Le catalogue passe de ${catalog.size} à ${catalog.size + fresh.length} espèces.
--
-- Deux apports : les illustrations déjà en stockage dont l'espèce manquait au
-- catalogue, et les espèces les plus observées de chaque classe du monde.
--
-- \`animal_group\` n'est pas recopié à la main : il sort de la même fonction que
-- le trigger de promotion, pour qu'une espèce promue par un joueur et une
-- espèce du catalogue tombent toujours dans le même groupe.
--
-- La rareté reste NULL. Elle sera calculée une fois sur l'ensemble final, à
-- partir de \`occurrences->>'GLOBAL'\`, puis figée.

create or replace function private.animal_group_for(taxon_class text, taxon_phylum text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when taxon_class = 'Mammalia' then 'mammiferes'
    when taxon_class = 'Aves' then 'oiseaux'
    when taxon_class in ('Reptilia', 'Squamata', 'Testudines', 'Crocodylia') then 'reptiles'
    when taxon_class = 'Amphibia' then 'amphibiens'
    when taxon_class in ('Actinopterygii', 'Chondrichthyes', 'Elasmobranchii', 'Sarcopterygii') then 'poissons'
    when taxon_class = 'Insecta' then 'insectes'
    when taxon_class = 'Arachnida' then 'arachnides'
    when taxon_phylum = 'Mollusca' then 'mollusques'
    when taxon_class in ('Malacostraca', 'Branchiopoda', 'Maxillopoda', 'Ostracoda') then 'crustaces'
    else 'invertebres'
  end;
$$;

insert into public.species_catalog (
  scientific_name, gbif_key, canonical_name,
  vernacular_name, vernacular_name_en,
  kingdom, phylum, class, "order", family, genus,
  animal_group, vernaculars, occurrences
)
select
  v.scientific_name, v.gbif_key, v.canonical_name,
  v.vernacular_name, v.vernacular_name_en,
  v.kingdom, v.phylum, v.class, v."order", v.family, v.genus,
  private.animal_group_for(v.class, v.phylum),
  v.vernaculars,
  -- \`occurrences\` est indexé par RÉGION, et 'GLOBAL' est la clé du monde
  -- entier — la même que \`resolveRegion\` rend quand aucune région n'est
  -- déclarée. C'est cette valeur que la rareté lira.
  jsonb_build_object('GLOBAL', v.global_occurrences)
from (values
${values}
) as v (
  scientific_name, gbif_key, canonical_name,
  vernacular_name, vernacular_name_en,
  kingdom, phylum, class, "order", family, genus,
  vernaculars, global_occurrences
)
on conflict (scientific_name) do nothing;
`;

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const path = `supabase/migrations/${stamp}_expand_catalog.sql`;
await writeFile(path, migration);
console.log(`\nÉcrit dans ${path}. Rien n'a été modifié en base.`);
