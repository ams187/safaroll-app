// Quelles espèces ajouter au catalogue, et dans quel ordre.
//
// Il n'écrit rien : il produit une liste priorisée et un état des lieux. Le
// seuil se décide en regardant les noms, pas en devinant un nombre.
//
// LE CLASSEMENT
//
// GBIF classe les espèces par nombre d'observations mondiales, ce qui est le
// meilleur indicateur disponible de « ce que les gens croisent et notent ». Il
// a deux angles morts, et le script les corrige :
//
//   LES PREMIUMS   GBIF, ce sont des ornithologues et des entomologistes.
//                      Un joueur lambda photographie un chat, un chien, un
//                      pigeon, un écureuil. Le chat domestique est sous-
//                      représenté alors qu'il est en tête du réel.
//   LES ZOOS           un lion à Vincennes ne génère aucune observation GBIF.
//                      Les espèces charismatiques de captivité sont donc
//                      ajoutées à la main, en tête de liste.
//
// LA COUVERTURE, MESURÉE
//
//   top    500 espèces → 65,4 % des observations mondiales
//   top  3 000         → 85,3 %
//   top 50 000         → 95,3 %
//
// Les 99 % n'existent pas : la queue est faite d'insectes et de mollusques par
// dizaines de milliers. Ce n'est pas au catalogue de les absorber, c'est à
// `world_species` — une espèce hors catalogue devient une découverte sauvage,
// puis rejoint le catalogue commun si elle est validée.
//
// Usage :
//   bun scripts/rank-catalog-candidates.ts            # 3000 candidats
//   bun scripts/rank-catalog-candidates.ts 5000

import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { vernacularsByConsensus } from '../supabase/functions/_shared/vernacular-consensus';

/**
 * Combien d'espèces par classe, et pourquoi pas un simple top 3 000.
 *
 * Les oiseaux font 79 % de toutes les observations animales de GBIF — les
 * ornithologues saisissent, les autres beaucoup moins. Un classement mondial à
 * plat donnerait donc un catalogue aux deux tiers composé d'oiseaux, sans les
 * mammifères qu'on photographie au zoo et dans la rue.
 *
 * La répartition est mesurée : combien d'espèces il faut, dans chaque classe,
 * pour couvrir l'essentiel de CETTE classe.
 *
 *   Oiseaux     2 334 M obs   top 3000 → 97,4 %   (1 894 suffisent pour 95 %)
 *   Insectes      317 M obs   top 3000 → 64,1 %   toute la queue est là
 *   Mammifères     49 M obs   top 3000 → 93,9 %
 *   Amphibiens     12 M obs   top 3000 → 92,6 %
 *
 * Les insectes ne montent pas plus haut sans exploser le catalogue : leur queue
 * est faite de coléoptères que seuls des entomologistes notent. C'est
 * exactement ce que `world_species` absorbe.
 */
const CLASS_QUOTAS: { key: number; label: string; quota: number }[] = [
  { key: 212, label: 'Oiseaux', quota: 1200 },
  { key: 359, label: 'Mammifères', quota: 600 },
  { key: 216, label: 'Insectes', quota: 700 },
  { key: 131, label: 'Amphibiens', quota: 150 },
  { key: 358, label: 'Reptiles', quota: 150 },
  { key: 367, label: 'Arachnides', quota: 100 },
  { key: 204, label: 'Poissons', quota: 100 },
];

const WANTED = Number(process.argv[2] ?? 3000);
const OUT = '.cache/catalog-candidates.csv';
/**
 * Les noms français, en cache sur disque.
 *
 * Sans eux la liste est illisible : personne ne trie trois mille binômes
 * latins, et chercher « tigre » dans un fichier qui ne connaît que
 * `Panthera tigris` ne rend rien. Le cache existe parce qu'ils ne bougent pas
 * et qu'ils coûtent une requête chacun.
 */
const NAME_CACHE = '.cache/gbif-vernaculars.json';
const COUNT_CACHE = '.cache/gbif-occurrences.json';
const GBIF = 'https://api.gbif.org/v1';
/** Le plafond de la facette. Au-delà, GBIF ralentit sans rien apprendre. */
const FACET_LIMIT = 20_000;
const CONCURRENCY = 4;

/**
 * Ce que GBIF ne voit pas.
 *
 * Des animaux que tout le monde photographie et qui ne produisent pas
 * d'observation naturaliste : la ménagerie de zoo, et le vivant domestique.
 * Placés en tête parce qu'ils sont plus probables qu'à peu près n'importe quel
 * passereau, malgré un compteur GBIF ridicule.
 */
const ALWAYS: string[] = [
  // Zoo — les incontournables de n'importe quel parc du monde.
  'Panthera leo', 'Panthera tigris', 'Panthera onca', 'Panthera pardus',
  'Acinonyx jubatus', 'Puma concolor', 'Lynx lynx',
  'Loxodonta africana', 'Elephas maximus', 'Giraffa camelopardalis',
  'Hippopotamus amphibius', 'Ceratotherium simum', 'Diceros bicornis',
  'Ursus arctos', 'Ursus maritimus', 'Ailuropoda melanoleuca', 'Ailurus fulgens',
  'Gorilla gorilla', 'Pan troglodytes', 'Pongo pygmaeus', 'Papio anubis',
  'Lemur catta', 'Macaca fuscata', 'Suricata suricatta',
  'Phascolarctos cinereus', 'Macropus rufus', 'Osphranter rufus',
  'Vombatus ursinus', 'Ornithorhynchus anatinus',
  'Aptenodytes forsteri', 'Spheniscus demersus', 'Pygoscelis papua',
  'Panthera uncia', 'Canis lupus', 'Vulpes vulpes', 'Vulpes lagopus',
  'Crocodylus niloticus', 'Alligator mississippiensis', 'Python regius',
  'Chelonoidis niger', 'Iguana iguana', 'Varanus komodoensis',
  'Ambystoma mexicanum', 'Phoenicopterus roseus', 'Struthio camelus',
  'Bison bison', 'Bos grunniens', 'Camelus dromedarius', 'Lama glama',
  'Equus quagga', 'Equus grevyi', 'Oryx dammah', 'Connochaetes taurinus',
  'Orcinus orca', 'Tursiops truncatus', 'Zalophus californianus',
  'Phoca vitulina', 'Odobenus rosmarus',
  // Domestique et périurbain — le premier animal photographié par n'importe qui.
  'Felis catus', 'Canis familiaris', 'Equus caballus', 'Bos taurus',
  'Ovis aries', 'Capra hircus', 'Sus scrofa', 'Gallus gallus',
  'Anas platyrhynchos', 'Columba livia', 'Passer domesticus',
  'Sciurus vulgaris', 'Sciurus carolinensis', 'Oryctolagus cuniculus',
  'Erinaceus europaeus', 'Cavia porcellus', 'Mesocricetus auratus',
  // Animalerie — le trou que GBIF ne peut pas voir.
  //
  // GBIF compte des observations SAUVAGES. Un animal qui vit en cage n'y
  // apparaît quasiment pas : la perruche ondulée plafonne à 118 000 alors
  // qu'elle est dans des millions de foyers. Sans cette liste, l'animal de
  // compagnie le plus photographié du monde manque au catalogue.
  'Melopsittacus undulatus', 'Nymphicus hollandicus', 'Serinus canaria',
  'Agapornis roseicollis', 'Psittacus erithacus', 'Taeniopygia guttata',
  'Ara ararauna', 'Ara macao', 'Ara chloropterus', 'Cacatua galerita',
  'Carassius auratus', 'Betta splendens', 'Poecilia reticulata',
  'Paracheirodon innesi', 'Pterophyllum scalare', 'Amphiprion ocellaris',
  'Hippocampus kuda', 'Octopus vulgaris',
  'Pogona vitticeps', 'Eublepharis macularius', 'Pantherophis guttatus',
  'Chamaeleo calyptratus', 'Testudo hermanni', 'Trachemys scripta',
  'Boa constrictor', 'Naja naja', 'Crotalus atrox', 'Eunectes murinus',
  'Rattus norvegicus', 'Mus musculus', 'Meriones unguiculatus',
  'Chinchilla lanigera', 'Mustela putorius',
  // Ferme — le deuxième contact le plus courant après l'animal de compagnie.
  'Equus asinus', 'Anser anser', 'Meleagris gallopavo', 'Numida meleagris',
  'Cairina moschata', 'Bubalus bubalis', 'Vicugna pacos', 'Camelus bactrianus',
  // Zoo — ce que la première liste avait laissé passer.
  'Crocuta crocuta', 'Hyaena hyaena', 'Lycaon pictus', 'Chrysocyon brachyurus',
  'Vulpes zerda', 'Caracal caracal', 'Leptailurus serval', 'Lynx rufus',
  'Neofelis nebulosa', 'Ursus americanus', 'Ursus thibetanus',
  'Tremarctos ornatus', 'Helarctos malayanus', 'Melursus ursinus',
  'Hydrochoerus hydrochaeris', 'Myrmecophaga tridactyla', 'Bradypus variegatus',
  'Choloepus didactylus', 'Tapirus terrestris', 'Tapirus indicus',
  'Rhinoceros unicornis', 'Choeropsis liberiensis', 'Okapia johnstoni',
  'Phacochoerus africanus', 'Aepyceros melampus', 'Addax nasomaculatus',
  'Oryx gazella', 'Bison bonasus', 'Ovibos moschatus', 'Capra ibex',
  'Rupicapra rupicapra', 'Alces alces', 'Rangifer tarandus',
  'Mandrillus sphinx', 'Hylobates lar', 'Saimiri sciureus', 'Callithrix jacchus',
  'Varecia variegata', 'Pan paniscus', 'Gorilla beringei',
  'Nasua nasua', 'Procyon lotor', 'Mephitis mephitis', 'Lutra lutra',
  'Enhydra lutris', 'Castor fiber', 'Pteropus vampyrus',
  'Ramphastos toco', 'Balearica regulorum', 'Phoeniconaias minor',
  'Rhea americana', 'Dromaius novaehollandiae', 'Casuarius casuarius',
  'Spheniscus humboldti', 'Eudyptes chrysocome',
  'Sphenodon punctatus', 'Chelonia mydas', 'Caretta caretta',
  'Rhincodon typus', 'Carcharodon carcharias', 'Mobula birostris',
  'Physeter macrocephalus', 'Megaptera novaeangliae', 'Balaenoptera musculus',
  'Trichechus manatus', 'Dugong dugon',
];

type Candidate = {
  key: number;
  name: string;
  occurrences: number;
  source: 'gbif' | 'curated';
  /** Le nom courant français. Vide quand GBIF n'en connaît pas. */
  vernacular?: string;
};

async function gbif(path: string, params: Record<string, string | number>): Promise<any> {
  const query = new URLSearchParams(
    Object.entries(params).map(([name, value]) => [name, String(value)]),
  );
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${GBIF}/${path}?${query}`, {
      headers: { 'user-agent': 'SafaRoll/1.0 (catalog ranking)' },
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (response?.ok) return response.json();
    await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
  }
  throw new Error(`GBIF injoignable — ${path}?${query}`);
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

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

// --- Ce qu'on a déjà ---------------------------------------------------------

async function cliRows(sql: string): Promise<string[]> {
  const text = await new Response(
    Bun.spawn(['supabase', 'db', 'query', '--linked', '-o', 'csv', sql], { stdout: 'pipe' }).stdout,
  ).text();
  return text.split('\n').slice(1).map((line) => line.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

// Le catalogue, avec ses noms français : ils sont vérifiés à la main et
// priment sur ce que GBIF rendra plus bas.
const catalogRows = await cliRows(
  "select scientific_name || '|' || coalesce(vernacular_name,'') from public.species_catalog",
);
const catalogNames = new Map<string, string>();
for (const row of catalogRows) {
  const [name, vernacular] = row.split('|');
  if (name) catalogNames.set(name.toLowerCase(), vernacular ?? '');
}
const catalog = new Set(catalogNames.keys());
if (catalog.size === 0) throw new Error('Catalogue vide — `supabase link` est-il fait ?');

const scenesText = await new Response(
  Bun.spawn(['supabase', 'storage', 'ls', 'ss:///card-scenes/', '--experimental'], {
    stdout: 'pipe',
  }).stdout,
).text();
const scenes = new Set(
  scenesText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[a-z-]+\.webp$/.test(line))
    .map((line) => line.replace('.webp', '').replaceAll('-', ' ')),
);

console.log(`Catalogue : ${catalog.size} espèces.`);
console.log(`Scènes    : ${scenes.size} illustrations.`);
const orphans = [...scenes].filter((name) => !catalog.has(name));
console.log(`Orphelines: ${orphans.length} illustrations sans espèce au catalogue — déjà payées.`);

// --- Le classement mondial ---------------------------------------------------

console.log(`\nFacettes GBIF, une par classe…`);
const ranked: { count: number; key: number }[] = [];
// Le quota est proportionnel à la taille demandée : `WANTED` de 1500 réduit
// chaque classe de moitié plutôt que de couper la fin de la liste, ce qui
// supprimerait les poissons et les arachnides avant tout le reste.
const scale = WANTED / CLASS_QUOTAS.reduce((sum, row) => sum + row.quota, 0);
for (const group of CLASS_QUOTAS) {
  const facet = await gbif('occurrence/search', {
    classKey: group.key,
    facet: 'speciesKey',
    facetLimit: FACET_LIMIT,
    hasCoordinate: true,
    limit: 0,
  });
  const counts: { count: number; key: number }[] = (
    facet.facets?.find((f: any) => f.field === 'SPECIES_KEY')?.counts ?? []
  ).map((entry: any) => ({ count: Number(entry.count), key: Number(entry.name) }));
  const take = Math.max(1, Math.round(group.quota * scale));
  const kept = counts.slice(0, take);
  const covered = facet.count > 0
    ? (100 * kept.reduce((sum, row) => sum + row.count, 0)) / facet.count
    : 0;
  console.log(
    `  ${group.label.padEnd(12)} ${String(kept.length).padStart(5)} espèces → ${covered.toFixed(1)} % de sa classe`,
  );
  ranked.push(...kept);
}
// Trié pour que la liste finale reste lisible du plus courant au plus rare,
// toutes classes confondues.
ranked.sort((a, b) => b.count - a.count);
console.log(`  ${ranked.length} au total`);

// Les noms, par lots : la facette ne rend que des clés.
console.log('\nRésolution des noms…');
// Les quotas ont déjà fait la sélection : plus de sur-échantillonnage à
// résoudre, chaque clé retenue mérite son nom.
const top = ranked;
const named = await pool(top, async (row) => {
  const species = await gbif(`species/${row.key}`, {}).catch(() => null);
  const name = species?.canonicalName ?? species?.scientificName;
  // Seulement des ESPÈCES : un genre ou une famille ne fait pas une carte.
  if (!name || species?.rank !== 'SPECIES') return null;
  return { key: row.key, name, occurrences: row.count, source: 'gbif' as const };
});

const candidates: Candidate[] = [];
const seen = new Set<string>();
for (const row of named) {
  if (!row) continue;
  const lower = row.name.toLowerCase();
  if (seen.has(lower)) continue;
  seen.add(lower);
  candidates.push(row);
}
console.log(`  ${candidates.length} espèces nommées`);

// Les curées passent devant : GBIF ne les voit pas, le public si.
console.log('\nListe curée (zoo et domestique)…');
// Leur compteur réel, pas zéro : le CSV est un document de décision, et un
// lion affiché à « 0 observation » à côté d'un moineau à 25 millions se lit
// comme une donnée manquante. Le même cache sert au calcul de rareté.
const countCache: Record<string, number> = await readFile(COUNT_CACHE, 'utf8')
  .then((text) => JSON.parse(text) as Record<string, number>)
  .catch(() => ({}));

const curated = await pool(ALWAYS, async (name) => {
  const match = await gbif('species/match', { kingdom: 'Animalia', name }).catch(() => null);
  if (match?.matchType !== 'EXACT' || !match?.usageKey) return null;
  let occurrences = countCache[name];
  if (occurrences === undefined) {
    const search = await gbif('occurrence/search', { limit: 0, taxonKey: match.usageKey })
      .catch(() => null);
    occurrences = Number(search?.count ?? 0);
    countCache[name] = occurrences;
  }
  return { key: match.usageKey, name, occurrences, source: 'curated' as const };
});
await mkdir('.cache', { recursive: true });
await writeFile(COUNT_CACHE, JSON.stringify(countCache));
const curatedRows = curated.filter((row): row is Candidate => row !== null);
console.log(`  ${curatedRows.length}/${ALWAYS.length} résolues`);

// --- Les noms français -------------------------------------------------------
//
// GBIF les tient dans une ressource à part, une par espèce. On préfère `fra`,
// et à défaut l'anglais : « Bald Eagle » reste plus lisible que
// `Haliaeetus leucocephalus`.

const vernacularCache: Record<string, string> = await readFile(NAME_CACHE, 'utf8')
  .then((text) => JSON.parse(text) as Record<string, string>)
  .catch(() => ({}));

async function vernacularFor(key: number): Promise<string> {
  const cached = vernacularCache[String(key)];
  if (cached !== undefined) return cached;
  const data = await gbif(`species/${key}/vernacularNames`, { limit: 200 }).catch(() => null);
  // Consensus des sources et non premier rendu : GBIF classe par autorité
  // taxonomique, ce qui remonte « Mélopsitte ondulé » avant « Perruche ondulée ».
  const names = vernacularsByConsensus(data?.results ?? [], { eng: 'en', fra: 'fr', fre: 'fr' });
  const found = names.fr ?? names.en ?? '';
  vernacularCache[String(key)] = found;
  return found;
}

// --- La liste ----------------------------------------------------------------

const ordered: Candidate[] = [
  ...curatedRows,
  ...candidates.filter((row) => !curatedRows.some((c) => c.name.toLowerCase() === row.name.toLowerCase())),
];

console.log('\nNoms courants…');
const vernaculars = await pool(ordered, (row) => vernacularFor(row.key));
await mkdir('.cache', { recursive: true });
await writeFile(NAME_CACHE, JSON.stringify(vernacularCache));
console.log(`  ${vernaculars.filter(Boolean).length}/${ordered.length} nommées`);

const rows = ordered.map((row, index) => {
  const lower = row.name.toLowerCase();
  return {
    ...row,
    // Le nom du catalogue prime : il est en français et vérifié à la main,
    // là où GBIF rend parfois un nom régional ou anglais.
    vernacular: catalogNames.get(lower) ?? vernaculars[index] ?? '',
    inCatalog: catalog.has(lower),
    hasScene: scenes.has(lower),
  };
});

const missing = rows.filter((row) => !row.inCatalog);
const needArt = rows.filter((row) => !row.hasScene);

await mkdir('.cache', { recursive: true });
await writeFile(
  OUT,
  [
    'rang,nom,nom_scientifique,gbif_key,observations,source,deja_au_catalogue,a_une_scene',
    ...rows.map((row, index) =>
      [
        index + 1,
        csvCell(row.vernacular),
        csvCell(row.name),
        row.key,
        row.occurrences,
        row.source,
        row.inCatalog ? 'oui' : 'non',
        row.hasScene ? 'oui' : 'non',
      ].join(','),
    ),
    // Les orphelines en fin de fichier : elles ne sont pas des candidates
    // classées, ce sont des illustrations qui attendent qu'on les rebranche.
    '',
    '# illustrations orphelines — espèces absentes du catalogue mais déjà dessinées',
    ...orphans.map((name) => `,,${csvCell(name)},,,orpheline,non,oui`),
  ].join('\n'),
);

console.log(`\n--- État des lieux ---`);
console.log(`Candidates retenues      ${rows.length}`);
console.log(`  déjà au catalogue      ${rows.length - missing.length}`);
console.log(`  à ajouter              ${missing.length}`);
console.log(`  sans illustration      ${needArt.length}`);
console.log(`Orphelines à rebrancher  ${orphans.length}  (illustration déjà en stockage)`);
console.log(`\nÉcrit dans ${OUT}.`);
