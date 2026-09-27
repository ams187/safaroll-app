declare const Bun: {
  file(path: string): { json(): Promise<unknown>; text(): Promise<string> };
  sleep(ms: number): Promise<void>;
  write(path: string, data: string): Promise<number>;
};

const INPUT = 'docs/catalogue-propose.csv';
const OUTPUT = 'convex/data/catalog.json';
const CACHE = 'convex/data/catalog-taxa-cache.json';
const INAT = 'https://api.inaturalist.org/v1';

const refresh = process.argv.includes('--refresh');

/** Les huit paliers, du plus commun au plus rare. Le libellé français est ce
 *  que la feuille curée écrit ; la clé est ce que la base stocke. */
const RARITIES = {
  Commun: 'common',
  'Peu commun': 'uncommon',
  Rare: 'rare',
  'Très rare': 'very_rare',
  'Ultra rare': 'ultra_rare',
  Épique: 'epic',
  Mythique: 'mythic',
  Légendaire: 'legendary',
} as const;

const ICONIC_TAXA: Record<string, string[]> = {
  Mammifères: ['Mammalia'],
  Oiseaux: ['Aves'],
  Reptiles: ['Reptilia'],
  Amphibiens: ['Amphibia'],
  Poissons: ['Actinopterygii', 'Ray-finned Fishes', 'Animalia'],
  Insectes: ['Insecta'],
  Arachnides: ['Arachnida'],
  Mollusques: ['Mollusca'],
};
const NON_ANIMAL_ICONICS = new Set(['Plantae', 'Fungi', 'Protozoa', 'Chromista']);

// Friendly umbrella names intentionally used by the product need one real
// representative species. Everything else is resolved from iNaturalist.
const OVERRIDES: Record<string, string> = {
  'Hamster doré': 'Mesocricetus auratus',
  Alpaga: 'Lama pacos',
  'Antilope noire': 'Antilope cervicapra',
  Okapi: 'Okapia johnstoni',
  'Loriquet arc-en-ciel': 'Trichoglossus moluccanus',
  'Tortue étoilée': 'Astrochelys radiata',
  'Phasme feuille': 'Pulchriphyllium bioculatum',
  'Araignée-paon': 'Maratus volans',
  'Araignée banane': 'Phoneutria nigriventer',
  'Araignée ogre': 'Deinopis spinosa',
  "Araignée d'eau": 'Argyroneta aquatica',
  'Scorpion bleu': 'Javanimetrus cyaneus',
  'Corail bulle': 'Physogyra lichtensteini',
  'Escargot géant africain': 'Lissachatina fulica',
  Ormeau: 'Haliotis tuberculata',
  'Porcelaine tigrée': 'Cypraea tigris',
  'Pieuvre mimétique': 'Thaumoctopus mimicus',
  'Lièvre de mer': 'Aplysia depilans',
  'Crevette-mante': 'Odontodactylus scyllarus',
  'Étoile-coussin': 'Oreaster reticulatus',
  'Corail cerveau': 'Diploria labyrinthiformis',
  'Méduse à pois blancs': 'Phyllorhiza punctata',
  'Corail de feu': 'Millepora alcicornis',
  Perroquet: 'Psittacus erithacus',
  Poule: 'Gallus gallus domesticus',
  Dinde: 'Meleagris gallopavo',
  Ibis: 'Threskiornis aethiopicus',
  Grizzli: 'Ursus arctos horribilis',
  'Ours polaire': 'Ursus maritimus',
  'Baleine bleue': 'Balaenoptera musculus',
  'Lézard des murs': 'Podarcis muralis',
  'Crapaud accoucheur': 'Alytes obstetricans',
  'Dendrobate bleu': 'Dendrobates tinctorius',
  'Grenouille de verre': 'Hyalinobatrachium fleischmanni',
  Raie: 'Dasyatis pastinaca',
  'Raie manta': 'Mobula birostris',
  'Requin bleu': 'Prionace glauca',
  'Requin-marteau': 'Sphyrna mokarran',
  'Requin-tigre': 'Galeocerdo cuvier',
  'Grand requin blanc': 'Carcharodon carcharias',
  'Requin-baleine': 'Rhincodon typus',
  'Poisson-scie': 'Pristis pristis',
  'Raie aigle': 'Myliobatis aquila',
  'Requin-corail': 'Carcharhinus amblyrhynchos',
  'Raie pastenague à taches bleues': 'Taeniura lymma',
  'Requin-nourrice atlantique': 'Ginglymostoma cirratum',
  'Requin dormeur taureau': 'Heterodontus portusjacksoni',
  'Requin pointe noire': 'Carcharhinus melanopterus',
  'Raie guitare australienne': 'Aptychotrema rostrata',
  'Raie aigle tachetée': 'Aetobatus ocellatus',
  'Raie ronde de Haller': 'Urobatis halleri',
  'Requin léopard': 'Triakis semifasciata',
  'Raie léopard': 'Aetomylaeus bovinus',
  'Tortue marine': 'Caretta caretta',
  'Papillon blanc': 'Pieris rapae',
  'Scarabée cerf-volant': 'Lucanus cervus',
  'Papillon changeant': 'Apatura iris',
  'Libellule bleue': 'Orthetrum brunneum',
  'Libellule empereur': 'Anax imperator',
  'Demoiselle bleue': 'Calopteryx virgo',
  'Papillon monarque': 'Danaus plexippus',
  'Scarabée bleu': 'Hoplia coerulea',
  'Scarabée doré': 'Cetonia aurata',
  'Guêpe géante': 'Vespa mandarinia',
  'Abeille charpentière': 'Xylocopa violacea',
  'Papillon Isabelle': 'Graellsia isabellae',
  'Sauterelle magicienne': 'Saga pedo',
  'Cigale géante': 'Megapomponia imperatoria',
  'Papillon atlas': 'Attacus atlas',
  'Papillon morpho bleu': 'Morpho menelaus',
  'Scarabée girafe': 'Trachelophorus giraffa',
};

type CsvRow = { category: string; rarity: keyof typeof RARITIES; name: string };
type Taxon = {
  id: number;
  name: string;
  rank: string;
  iconic_taxon_name?: string;
  preferred_common_name?: string;
  english_common_name?: string;
  observations_count?: number;
  ancestry?: string;
};

const normalize = (value: string) =>
  value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const words = (value: string) =>
  value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().match(/[a-z0-9]+/g)
    ?.filter((word) => !['a', 'au', 'aux', 'd', 'de', 'des', 'du', 'l', 'la', 'le', 'les'].includes(word)) ?? [];

function nameScore(row: CsvRow, taxon: Taxon) {
  const common = taxon.preferred_common_name ?? '';
  if (normalize(common) === normalize(row.name)) return 1_000;
  const wanted = words(row.name);
  const offered = new Set(words(common));
  const overlap = wanted.filter((word) => offered.has(word)).length;
  if (!overlap) return 0;
  return (overlap === wanted.length ? 500 : 0) + Math.round(100 * overlap / wanted.length);
}

function rankCandidates(row: CsvRow, candidates: Taxon[]) {
  const override = OVERRIDES[row.name];
  return candidates
    .filter((taxon) => compatible(row, taxon))
    .filter((taxon) => override ? taxon.name === override : nameScore(row, taxon) > 0)
    .sort((a, b) => {
      if (override) return Number(b.name === override) - Number(a.name === override);
      return nameScore(row, b) - nameScore(row, a) ||
        (b.observations_count ?? 0) - (a.observations_count ?? 0);
    });
}

function parseCsv(source: string): CsvRow[] {
  return source.trim().split('\n').slice(1).map((line) => {
    const [category, rarity, ...name] = line.split(',');
    if (!(rarity in RARITIES)) throw new Error(`Rareté inconnue: ${rarity}`);
    return { category, rarity: rarity as keyof typeof RARITIES, name: name.join(',') };
  });
}

function compatible(row: CsvRow, taxon: Taxon) {
  if (!['species', 'subspecies', 'variety', 'form'].includes(taxon.rank)) return false;
  const expected = ICONIC_TAXA[row.category];
  return expected
    ? expected.includes(taxon.iconic_taxon_name ?? '')
    : !NON_ANIMAL_ICONICS.has(taxon.iconic_taxon_name ?? '');
}

async function taxa(path: string, query: string): Promise<Taxon[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`${INAT}${path}?q=${encodeURIComponent(query)}&locale=fr&per_page=30`);
    if (response.ok) {
      const body = await response.json();
      return (body.results ?? []).map((taxon: Taxon) => ({
        id: taxon.id,
        name: taxon.name,
        rank: taxon.rank,
        iconic_taxon_name: taxon.iconic_taxon_name,
        preferred_common_name: taxon.preferred_common_name,
        english_common_name: taxon.english_common_name,
        observations_count: taxon.observations_count,
      }));
    }
    if (response.status !== 429) throw new Error(`iNaturalist ${response.status}: ${query}`);
    await Bun.sleep(10_000 * (attempt + 1));
  }
  throw new Error(`iNaturalist rate limit: ${query}`);
}

async function resolve(row: CsvRow): Promise<Taxon[]> {
  const override = OVERRIDES[row.name];
  const results = override
    ? await taxa('/taxa', override)
    : await taxa('/taxa/autocomplete', row.name);
  return rankCandidates(row, results);
}

const rows = parseCsv(await Bun.file(INPUT).text());
if (rows.length !== 884) throw new Error(`Catalogue attendu: 884; reçu: ${rows.length}`);

const cached = await Bun.file(CACHE).json().catch(() => ({})) as Record<string, Taxon[]>;
const candidates: Taxon[][] = [];
for (const [index, row] of rows.entries()) {
  const key = `${row.category}:${row.name}`;
  const override = OVERRIDES[row.name];
  if (!cached[key] || refresh || (override && !cached[key].some((taxon) => taxon.name === override))) {
    cached[key] = await resolve(row);
    await Bun.write(CACHE, JSON.stringify(cached, null, 2) + '\n');
    await Bun.sleep(700);
  }
  candidates.push(cached[key]);
  if ((index + 1) % 50 === 0) console.log(`taxonomie ${index + 1}/${rows.length}`);
}
const used = new Set<number>();
const selected = new Array<Taxon | undefined>(rows.length);
const allocationOrder = rows.map((_, index) => index).sort((a, b) => {
  const overrideA = OVERRIDES[rows[a].name] ? 1 : 0;
  const overrideB = OVERRIDES[rows[b].name] ? 1 : 0;
  return overrideB - overrideA || words(rows[b].name).length - words(rows[a].name).length;
});
for (const index of allocationOrder) {
  const taxon = rankCandidates(rows[index], candidates[index]).find((candidate) => !used.has(candidate.id));
  if (!taxon) continue;
  selected[index] = taxon;
  used.add(taxon.id);
}

const unresolved = rows.flatMap((row, index) => selected[index] ? [] : [`${row.category}: ${row.name}`]);
const species = rows.flatMap((row, index) => {
  const taxon = selected[index];
  return taxon ? [{
    key: taxon.id,
    scientificName: taxon.name,
    canonicalName: taxon.name,
    vernacularName: row.name,
    ...(taxon.english_common_name ? { vernacularNameEn: taxon.english_common_name } : {}),
    group: normalize(row.category),
    occurrences: { GLOBAL: taxon.observations_count ?? 0 },
    rarity: RARITIES[row.rarity],
  }] : [];
});

if (unresolved.length) {
  throw new Error(`${unresolved.length} animaux non résolus:\n${unresolved.join('\n')}`);
}

const groups = Object.entries(rows.reduce<Record<string, number>>((counts, row) => {
  counts[row.category] = (counts[row.category] ?? 0) + 1;
  return counts;
}, {})).map(([label, quota]) => ({ key: normalize(label), label, quota }));

await Bun.write(OUTPUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'SafaRoll curated catalogue + iNaturalist taxonomy',
  regions: [{ key: 'GLOBAL', label: 'Monde' }],
  groups,
  species,
}, null, 2) + '\n');

console.log(`${species.length} espèces uniques → ${OUTPUT}`);
