/**
 * Builds the species catalog — the finite list of animals the game is about.
 *
 * Source: GBIF occurrence facets. The raw ranking is unusable as a game
 * catalogue for three reasons, and this script fixes each one:
 *
 *   1. GBIF reflects what people *report*, so birds drown everything else.
 *      → hard quotas per group, so this stays a wildlife game and not an
 *        ornithology app.
 *   2. Many observed taxa cannot be photographed or told apart by a human
 *      (mites, cryptic species pairs separable only by song or dissection).
 *      → an exclusion list; a slot nobody can fill is worse than no slot.
 *   3. Long-tail species seen twice in a decade are dead weight.
 *      → a minimum occurrence floor per group.
 *
 * One facet query per (group, region) yields the per-region counts directly,
 * so no extra request is needed per species for its regional presence.
 *
 * Run: bun run build:catalog     → convex/data/catalog.json
 */

import { setRarityForRank, type CardRarity } from '../convex/model/rarity';

const GBIF = 'https://api.gbif.org/v1';
const UA = 'SafaRoll/1.0 (support@birdy.app)';
/** GBIF facets get very slow past a few hundred buckets. */
const FACET_LIMIT = 300;
const CONCURRENCY = 8;

const REGIONS = [
  { key: 'FR', label: 'France', country: 'FR' },
  { key: 'BE', label: 'Belgique', country: 'BE' },
  { key: 'CH', label: 'Suisse', country: 'CH' },
] as const;

type Group = {
  key: string;
  label: string;
  classes?: string[];
  orders?: string[];
  quota: number;
  minOccurrences: number;
};

/** The shape of the collection is a game-design decision, not a data one. */
const GROUPS: Group[] = [
  { key: 'birds', label: 'Oiseaux', classes: ['Aves'], quota: 260, minOccurrences: 400 },
  { key: 'butterflies', label: 'Papillons', orders: ['Lepidoptera'], quota: 190, minOccurrences: 150 },
  { key: 'mammals', label: 'Mammifères', classes: ['Mammalia'], quota: 90, minOccurrences: 200 },
  { key: 'dragonflies', label: 'Libellules', orders: ['Odonata'], quota: 90, minOccurrences: 120 },
  { key: 'beetles', label: 'Coléoptères', orders: ['Coleoptera'], quota: 110, minOccurrences: 120 },
  { key: 'bees', label: 'Abeilles et guêpes', orders: ['Hymenoptera'], quota: 70, minOccurrences: 120 },
  { key: 'herps', label: 'Reptiles et amphibiens', classes: ['Squamata', 'Testudines', 'Amphibia'], quota: 60, minOccurrences: 100 },
  { key: 'spiders', label: 'Araignées', classes: ['Arachnida'], quota: 50, minOccurrences: 100 },
  { key: 'molluscs', label: 'Mollusques', classes: ['Gastropoda'], quota: 40, minOccurrences: 120 },
];

/**
 * Genera a camera cannot settle. Shipping a pair that needs a song recording
 * or a dissection makes the app look broken when it is the biology that is
 * ambiguous — so the catalogue simply never asks the question.
 */
const EXCLUDED_GENERA = new Set([
  'Phylloscopus', 'Hippolais', 'Acrocephalus', // fauvettes/pouillots — chant
  'Bombus', 'Andrena', 'Lasioglossum', 'Halictus', // abeilles cryptiques
  'Lasius', 'Formica', 'Myrmica', 'Tetramorium', // fourmis — loupe
  'Pipistrellus', 'Myotis', 'Plecotus', 'Eptesicus', // chauves-souris — ultrasons
  'Chorthippus', 'Tetrix', // criquets — chant
  'Sorex', 'Crocidura', 'Neomys', // musaraignes — dentition
  'Microtus', 'Apodemus', // campagnols/mulots — crâne
]);

const EXCLUDED_TERMS = [' sp.', ' cf. ', 'complex', 'aggregate', ' x ', 'hybrid', 'incertae'];

/** French vernacular names GBIF got wrong or never had. */
const VERNACULAR_FIXES: Record<string, string> = await (async () => {
  try {
    return (await import('../convex/data/vernacular-fr.json', { with: { type: 'json' } })).default
      .names;
  } catch {
    return {};
  }
})();

type Candidate = {
  key: number;
  group: string;
  occurrences: Record<string, number>;
  total: number;
};

type Species = Candidate & {
  scientificName: string;
  canonicalName: string;
  vernacularName?: string;
  vernacularNameEn?: string;
  /** One factual sentence from Wikipedia FR: "what to look for next time". */
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  /**
   * The card's rarity — a property of the species, the same for every player
   * on earth. Assigned by rank inside the group, never from a raw count.
   */
  rarity?: CardRarity;
};

async function gbif(path: string, params: Record<string, string | number> = {}) {
  const url = new URL(`${GBIF}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.append(key, String(value));
  const response = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!response.ok) throw new Error(`GBIF ${response.status} ${url.pathname}`);
  return await response.json();
}

/**
 * Resolves a taxon name to its GBIF key. A fuzzy match that lands on a broader
 * taxon would silently turn a "Reptilia" filter into "every chordate", so the
 * match must be exact and the returned taxon must actually carry the name.
 * GBIF's backbone does not always rank a group where you expect it (Squamata
 * is a class there, not an order), so the caller's expectation is not imposed.
 */
async function taxonKey(name: string): Promise<{ key: number; rank: string } | undefined> {
  const body = await gbif('/species/match', { name, kingdom: 'Animalia', strict: 'false' });
  const carriesName = [body.class, body.order, body.phylum].includes(name);
  if (body.matchType !== 'EXACT' || !carriesName || !body.usageKey) {
    console.warn(`  ⚠︎ taxon ${name} non résolu (${body.matchType}) — filtre ignoré`);
    return undefined;
  }
  return { key: body.usageKey as number, rank: String(body.rank ?? '') };
}

/** Runs `worker` over `items` with a bounded number of in-flight requests. */
async function pooled<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

function photographable(name: string, genus?: string) {
  if (genus && EXCLUDED_GENERA.has(genus)) return false;
  const lower = ` ${name.toLowerCase()} `;
  return !EXCLUDED_TERMS.some((term) => lower.includes(term));
}

/**
 * French common name from the fr.wikipedia page title.
 *
 * Field notes are NOT taken from here: Wikipedia's lead sentence is a
 * taxonomic definition ("X est une espèce de la famille des Y"), which the
 * card already displays. They live hand-written in convex/data/field-notes.json.
 */
async function wikipedia(scientificName: string) {
  try {
    const response = await fetch(
      `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(scientificName.replace(/ /g, '_'))}`,
      { headers: { 'User-Agent': UA } },
    );
    if (!response.ok) return {};
    const body = await response.json();
    if (body.type === 'disambiguation') return {};

    const title = String(body.title ?? '');
    const named =
      title && title.toLowerCase() !== scientificName.toLowerCase()
        ? title.replace(/\s*\([^)]*\)\s*$/, '').trim() || undefined
        : undefined;

    return { vernacularName: named };
  } catch {
    return {};
  }
}

/** Preferred public-facing names, one per shipped language. */
async function iNaturalist(scientificName: string) {
  try {
    const response = await fetch(
      `https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(scientificName)}&per_page=10&locale=fr`,
      { headers: { 'User-Agent': UA } },
    );
    if (!response.ok) return {};
    const body = await response.json();
    const exact = (body.results ?? []).find(
      (item: { name?: string }) => item.name?.toLowerCase() === scientificName.toLowerCase(),
    );
    return {
      vernacularName: exact?.preferred_common_name as string | undefined,
      vernacularNameEn: exact?.english_common_name as string | undefined,
    };
  } catch {
    return {};
  }
}

async function build() {
  const catalogue: Species[] = [];

  for (const group of GROUPS) {
    const filters: Record<string, number>[] = [];
    for (const name of [...(group.classes ?? []), ...(group.orders ?? [])]) {
      const taxon = await taxonKey(name);
      if (!taxon) continue;
      filters.push(taxon.rank === 'ORDER' ? { orderKey: taxon.key } : { classKey: taxon.key });
    }

    // One facet per (filter, region): gives the per-region counts in a single
    // request, so no per-species presence lookup is needed later.
    const pool = new Map<number, Candidate>();
    for (const region of REGIONS) {
      for (const filter of filters) {
        const body = await gbif('/occurrence/search', {
          country: region.country,
          ...filter,
          hasCoordinate: 'true',
          hasGeospatialIssue: 'false',
          occurrenceStatus: 'PRESENT',
          facet: 'speciesKey',
          facetLimit: FACET_LIMIT,
          limit: 0,
        });
        const facet = (body.facets ?? []).find(
          (item: { field: string }) => item.field === 'SPECIES_KEY',
        );
        for (const { name, count } of (facet?.counts ?? []) as { name: string; count: number }[]) {
          const key = Number(name);
          if (!Number.isFinite(key) || count < group.minOccurrences) continue;
          const existing = pool.get(key) ?? { key, group: group.key, occurrences: {}, total: 0 };
          existing.occurrences[region.key] = count;
          existing.total += count;
          pool.set(key, existing);
        }
      }
    }

    // Enrich generously above quota — filtering will reject a good share.
    const candidates = [...pool.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, group.quota * 2);

    const enriched = await pooled(candidates, async (candidate) => {
      try {
        const [detail, names] = await Promise.all([
          gbif(`/species/${candidate.key}`),
          gbif(`/species/${candidate.key}/vernacularNames`, { limit: 60 }).catch(() => ({ results: [] })),
        ]);
        if (detail.rank !== 'SPECIES' || detail.kingdom !== 'Animalia') return null;
        const canonical: string = detail.canonicalName ?? detail.scientificName;
        if (!canonical || !photographable(canonical, detail.genus)) return null;
        // The species must really sit in this group's classes/orders.
        const wanted = [...(group.classes ?? []), ...(group.orders ?? [])];
        const inGroup = [detail.class, detail.order].some((value) => wanted.includes(value));
        if (!inGroup) return null;

        const [wiki, publicNames] = await Promise.all([
          wikipedia(canonical),
          iNaturalist(canonical),
        ]);
        const vernaculars = (names.results ?? []) as { vernacularName: string; language?: string }[];
        const usable = (value?: string) =>
          value !== undefined &&
          value.length >= 4 &&
          !/\d/.test(value) &&
          // "GRTI", "BLABI" — bird-ringing codes stored as vernacular names.
          !(value === value.toUpperCase() && value.length <= 6);
        const french = vernaculars.find(
          (item) => item.language === 'fra' && usable(item.vernacularName),
        );
        const english = vernaculars.find(
          (item) => item.language === 'eng' && usable(item.vernacularName),
        );
        return {
          ...candidate,
          scientificName: detail.scientificName,
          canonicalName: canonical,
          // Hand-checked names win: GBIF returns ringing codes, English names
          // and outright wrong French for a long tail of species.
          vernacularName:
            VERNACULAR_FIXES[canonical] ??
            publicNames.vernacularName ??
            french?.vernacularName ??
            wiki.vernacularName,
          vernacularNameEn: publicNames.vernacularNameEn ?? english?.vernacularName,
          kingdom: detail.kingdom,
          phylum: detail.phylum,
          class: detail.class,
          order: detail.order,
          family: detail.family,
          genus: detail.genus,
        } satisfies Species;
      } catch {
        return null;
      }
    });

    const kept = enriched.filter((item): item is Species => item !== null).slice(0, group.quota);

    // The set's print run. Ranked ascending by observations across the whole
    // atlas — the least seen animal of the group is rank 0, the legendary end
    // — then sliced by quota. Ranking *inside* the group is what makes the
    // measure fair: a beetle is recorded a thousand times less than a tit, so
    // any absolute cut-off would hand every insect a legendary card.
    const byScarcity = [...kept].sort((a, b) => a.total - b.total);
    byScarcity.forEach((item, rank) => {
      item.rarity = setRarityForRank(rank, byScarcity.length);
    });

    catalogue.push(...kept);
    const tally = byScarcity.reduce<Record<string, number>>((counts, item) => {
      counts[item.rarity ?? 'common'] = (counts[item.rarity ?? 'common'] ?? 0) + 1;
      return counts;
    }, {});
    console.log(
      `${group.label.padEnd(24)} ${kept.length}/${group.quota}` +
        `  (${['legendary', 'rare', 'uncommon', 'common'].map((r) => `${r[0].toUpperCase()}${tally[r] ?? 0}`).join(' ')})`,
    );
  }

  // A species can surface under two groups; the first to claim it wins.
  const seen = new Map<string, Species>();
  for (const item of catalogue) if (!seen.has(item.canonicalName)) seen.set(item.canonicalName, item);
  const unique = [...seen.values()].sort(
    (a, b) => a.canonicalName.localeCompare(b.canonicalName),
  );

  await Bun.write(
    'convex/data/catalog.json',
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'GBIF occurrence facets',
        regions: REGIONS.map(({ key, label }) => ({ key, label })),
        groups: GROUPS.map(({ key, label }) => ({ key, label })),
        species: unique,
      },
      null,
      2,
    ),
  );

  console.log(`\n${unique.length} espèces → convex/data/catalog.json`);
  for (const region of REGIONS) {
    console.log(
      `  ${region.label}: ${unique.filter((item) => item.occurrences[region.key]).length}`,
    );
  }
  const unnamed = unique.filter((item) => !item.vernacularName).length;
  if (unnamed) console.log(`\n⚠︎ ${unnamed} sans nom vernaculaire — passe manuelle à prévoir.`);
}

await build();
