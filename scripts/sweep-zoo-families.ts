// Les familles de zoo, balayées au complet.
//
// POURQUOI UNE LISTE DE FAMILLES ET NON D'ESPÈCES
//
// La liste curée de `rank-catalog-candidates.ts` est écrite à la main, donc
// elle rate ce qu'on ne pense pas à nommer. Testée sur 50 espèces du zoo de
// Vincennes, elle en manquait 11 — et les onze appartenaient à des familles
// dont j'avais DÉJÀ un représentant : le flamant rose sans le flamant du
// Chili, l'autruche sans le pélican, le lémur catta sans le propithèque.
//
// Un zoo ne choisit pas ses pensionnaires au hasard : il prend un représentant
// par famille. Demander la FAMILLE entière garantit donc d'avoir celui qu'il a
// choisi, sans avoir à le deviner. GBIF sait quelles espèces existent ; c'est
// à lui de fournir la liste, pas à ma mémoire.
//
// CE QUE ÇA COÛTE
//
// Une requête de facette par famille. Le tri par nombre d'observations sert
// aussi de filtre à fossiles : la famille des flamants rend 18 espèces, dont
// douze éteintes à moins de 30 observations. `MIN_OCCURRENCES` les coupe.
//
// N'ÉCRIT RIEN EN BASE. Produit `.cache/zoo-family-keys.json`, que
// `expand-catalog.ts` lit comme une troisième source de candidates.

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const GBIF = 'https://api.gbif.org/v1';
const OUT = '.cache/zoo-family-keys.json';
const FAMILY_CACHE = '.cache/gbif-families.json';
const CONCURRENCY = 8;
/** Au-delà, on ramasse la famille entière plutôt que ses vedettes — 3 000
 *  coléoptères pour un zoo qui en montre trois.
 *
 *  30, et pas 12. Le premier essai plafonnait à douze et laissait dehors le
 *  babouin de Guinée (rang 30 chez les Cercopithecidae) et l'ibis rouge
 *  (rang 21 chez les Threskiornithidae), tous deux à Vincennes. Un zoo ne
 *  choisit pas l'espèce la plus observée de la famille : il choisit celle
 *  qu'il peut élever. */
const PER_FAMILY = 30;
/** Sous ce seuil, ce sont des espèces fossiles ou des synonymes morts.
 *
 *  100, et pas 1 000. Le premier essai coupait à mille et vidait deux familles
 *  entières : le fossa n'a que 417 observations à l'état sauvage, le panda roux
 *  799. Ce ne sont pas des fossiles — ce sont les animaux rares que le joueur
 *  aura le plus envie de trouver, et le seuil censé nettoyer les supprimait.
 *
 *  Mesuré sur Phoenicopteridae : les six flamants vivants sont tous au-dessus
 *  de 7 000, les douze fossiles à 28 observations ou moins. Le tri par nombre
 *  décroissant plus le plafond par famille font le reste du travail. */
const MIN_OCCURRENCES = 100;

const FAMILIES = [
  // Carnivores et apparentés
  'Felidae', 'Canidae', 'Ursidae', 'Mustelidae', 'Procyonidae', 'Viverridae',
  'Herpestidae', 'Hyaenidae', 'Eupleridae', 'Ailuridae', 'Mephitidae',
  'Otariidae', 'Phocidae', 'Odobenidae',
  // Primates
  'Cercopithecidae', 'Hominidae', 'Hylobatidae', 'Callitrichidae', 'Cebidae',
  'Atelidae', 'Pitheciidae', 'Lemuridae', 'Indriidae', 'Cheirogaleidae',
  'Lorisidae', 'Galagidae', 'Daubentoniidae',
  // Grands herbivores
  'Elephantidae', 'Rhinocerotidae', 'Tapiridae', 'Equidae', 'Suidae',
  'Tayassuidae', 'Hippopotamidae', 'Camelidae', 'Giraffidae', 'Cervidae',
  'Bovidae', 'Antilocapridae', 'Tragulidae',
  // Marsupiaux, xénarthres, monotrèmes
  'Macropodidae', 'Phascolarctidae', 'Vombatidae', 'Didelphidae', 'Dasyuridae',
  'Petauridae', 'Phalangeridae', 'Myrmecophagidae', 'Bradypodidae',
  'Choloepodidae', 'Dasypodidae', 'Ornithorhynchidae', 'Tachyglossidae',
  // Rongeurs, insectivores, chauves-souris
  'Hystricidae', 'Erethizontidae', 'Caviidae', 'Chinchillidae', 'Sciuridae',
  'Castoridae', 'Cricetidae', 'Muridae', 'Pteropodidae', 'Erinaceidae',
  'Manidae', 'Orycteropodidae',
  // Mammifères marins
  'Delphinidae', 'Trichechidae', 'Dugongidae',
  // Oiseaux
  'Phoenicopteridae', 'Pelecanidae', 'Ciconiidae', 'Threskiornithidae',
  'Ardeidae', 'Gruidae', 'Spheniscidae', 'Struthionidae', 'Rheidae',
  'Casuariidae', 'Psittacidae', 'Cacatuidae', 'Psittaculidae', 'Ramphastidae',
  'Bucerotidae', 'Accipitridae', 'Falconidae', 'Strigidae', 'Tytonidae',
  'Cathartidae', 'Sagittariidae', 'Anatidae', 'Phasianidae', 'Numididae',
  'Cracidae', 'Musophagidae', 'Sturnidae', 'Corvidae', 'Fringillidae',
  'Estrildidae', 'Columbidae', 'Trochilidae', 'Alcedinidae', 'Cariamidae',
  'Otididae', 'Balaenicipitidae', 'Podicipedidae', 'Laridae', 'Sulidae',
  'Fregatidae', 'Phalacrocoracidae',
  // Reptiles
  'Crocodylidae', 'Alligatoridae', 'Gavialidae', 'Testudinidae', 'Emydidae',
  'Geoemydidae', 'Chelydridae', 'Cheloniidae', 'Trionychidae', 'Pythonidae',
  'Boidae', 'Colubridae', 'Elapidae', 'Viperidae', 'Varanidae', 'Iguanidae',
  'Agamidae', 'Chamaeleonidae', 'Gekkonidae', 'Eublepharidae', 'Scincidae',
  'Teiidae', 'Helodermatidae', 'Sphenodontidae',
  // Amphibiens
  'Dendrobatidae', 'Bufonidae', 'Ranidae', 'Hylidae', 'Ambystomatidae',
  'Salamandridae', 'Pipidae', 'Ceratophryidae',
  // Poissons d'aquarium et requins
  'Serrasalmidae', 'Cichlidae', 'Osteoglossidae', 'Potamotrygonidae',
  'Carcharhinidae', 'Lamnidae', 'Rhincodontidae', 'Sphyrnidae', 'Myliobatidae',
  'Dasyatidae', 'Syngnathidae', 'Pomacanthidae', 'Chaetodontidae',
  'Acanthuridae', 'Balistidae', 'Muraenidae', 'Cyprinidae', 'Characidae',
  'Loricariidae', 'Poeciliidae', 'Osphronemidae', 'Labridae',
  // Invertébrés de vivarium
  'Theraphosidae', 'Scorpionidae', 'Buthidae', 'Phasmatidae', 'Blaberidae',
  'Formicidae', 'Apidae', 'Papilionidae', 'Nymphalidae', 'Octopodidae',
];

async function gbif(path: string, params: Record<string, string | number> = {}): Promise<any> {
  const query = new URLSearchParams(
    Object.entries(params).map(([name, value]) => [name, String(value)]),
  );
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${GBIF}/${path}?${query}`, {
      headers: { 'user-agent': 'SafaRoll/1.0 (zoo families)' },
      signal: AbortSignal.timeout(90_000),
    }).catch(() => null);
    if (response?.ok) return response.json();
    // Un 4xx est une réponse : la famille n'existe pas sous ce nom, insister
    // ne la fera pas apparaître.
    if (response && response.status >= 400 && response.status < 500 && response.status !== 429) {
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** attempt, 10_000)));
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

const familyKeys: Record<string, number> = await readFile(FAMILY_CACHE, 'utf8')
  .then((text) => JSON.parse(text) as Record<string, number>)
  .catch(() => ({}));

console.log(`${FAMILIES.length} familles à balayer.\n`);

type Sweep = { family: string; keys: number[]; kept: number; total: number };

const sweeps = await pool(FAMILIES, async (family): Promise<Sweep> => {
  let key = familyKeys[family];
  if (key === undefined) {
    const match = await gbif('species/match', { kingdom: 'Animalia', name: family, rank: 'FAMILY' });
    if (!match?.usageKey || match.matchType === 'NONE') return { family, keys: [], kept: 0, total: 0 };
    key = Number(match.usageKey);
    familyKeys[family] = key;
  }

  const facet = await gbif('occurrence/search', {
    facet: 'speciesKey',
    // 50 et non 200 : on n'en garde que douze, et une facette large sur une
    // famille énorme (Accipitridae compte des millions d'enregistrements)
    // dépassait le délai et rendait la famille vide — sans le dire.
    facetLimit: 50,
    familyKey: key,
    limit: 0,
  });
  const counts: { count: number; key: number }[] = (
    facet?.facets?.find((entry: any) => entry.field === 'SPECIES_KEY')?.counts ?? []
  ).map((entry: any) => ({ count: Number(entry.count), key: Number(entry.name) }));

  const kept = counts.filter((row) => row.count >= MIN_OCCURRENCES).slice(0, PER_FAMILY);
  return { family, keys: kept.map((row) => row.key), kept: kept.length, total: counts.length };
});

await mkdir('.cache', { recursive: true });
await writeFile(FAMILY_CACHE, JSON.stringify(familyKeys));

// Une seconde passe sur les familles vides : la première fournée en perd une
// dizaine par simple expiration de requête, et lesquelles change à chaque
// exécution. Les vraies familles vides, elles, le restent.
const retried = await pool(
  sweeps.filter((sweep) => sweep.kept === 0).map((sweep) => sweep.family),
  async (family) => {
    const facet = await gbif('occurrence/search', {
      facet: 'speciesKey',
      facetLimit: 50,
      familyKey: familyKeys[family],
      limit: 0,
    });
    const counts: { count: number; key: number }[] = (
      facet?.facets?.find((entry: any) => entry.field === 'SPECIES_KEY')?.counts ?? []
    ).map((entry: any) => ({ count: Number(entry.count), key: Number(entry.name) }));
    const kept = counts.filter((row) => row.count >= MIN_OCCURRENCES).slice(0, PER_FAMILY);
    return { family, keys: kept.map((row) => row.key), kept: kept.length, total: counts.length };
  },
);
for (const attempt of retried) {
  const index = sweeps.findIndex((sweep) => sweep.family === attempt.family);
  if (index >= 0 && attempt.kept > 0) sweeps[index] = attempt;
}

const empty = sweeps.filter((sweep) => sweep.kept === 0);
const keys = [...new Set(sweeps.flatMap((sweep) => sweep.keys))];

console.log('--- Les plus fournies ---');
for (const sweep of [...sweeps].sort((a, b) => b.kept - a.kept).slice(0, 10)) {
  console.log(`  ${sweep.family.padEnd(22)} ${String(sweep.kept).padStart(3)} retenues / ${sweep.total} connues`);
}
if (empty.length > 0) {
  // Une famille vide est un nom que GBIF n'a pas reconnu, pas une famille sans
  // espèces : elle se corrige à la main, elle ne se devine pas.
  console.log(`\n${empty.length} familles sans résultat : ${empty.map((s) => s.family).join(', ')}`);
}

await writeFile(OUT, JSON.stringify(keys));
console.log(`\n${keys.length} espèces candidates écrites dans ${OUT}.`);
