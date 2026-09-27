// Où couper entre commun, rare et légendaire.
//
// LE PROBLÈME QUE CE SCRIPT RÈGLE
//
// Le compteur GBIF est le bon signal — objectif, une source, disponible pour
// toute espèce du monde. Mais des seuils choisis à l'intuition sur quelques
// espèces connues donnent une pyramide inversée : mesuré sur le catalogue de
// 3 558 espèces, 39 % de rares, 32 % d'ultra rares, 1,3 % de communes.
//
// Ce n'est pas une erreur de mesure, c'est la forme de la distribution. La
// médiane du catalogue est à 59 470 observations mondiales : la moitié des
// espèces qu'un joueur peut collectionner sont déjà rares à l'échelle de la
// planète. Un seuil « 50 000 = rare » range donc la moitié du jeu en rare.
//
// CE QU'ON CHERCHE À LA PLACE
//
// La rareté doit répondre à « à quel point est-ce dur à croiser, parmi ce qui
// est collectionnable » — pas « combien reste-t-il d'individus sur Terre ». On
// vise donc une FORME, et on lit dans la distribution les valeurs qui la
// donnent. Une fois lues, elles deviennent des nombres fixes : la rareté d'une
// carte ne doit plus jamais bouger parce que le catalogue a grandi.
//
// N'ÉCRIT RIEN. Propose des seuils et montre ce qu'ils font.

const shares = (process.argv[2] ?? '45,27,18,8,2').split(',').map(Number);
const TARGET: { rarity: string; share: number }[] = [
  { rarity: 'common', share: shares[0] / 100 },
  { rarity: 'uncommon', share: shares[1] / 100 },
  { rarity: 'rare', share: shares[2] / 100 },
  { rarity: 'ultra_rare', share: shares[3] / 100 },
  { rarity: 'legendary', share: shares[4] / 100 },
];

/** Des repères qu'un joueur reconnaît : c'est sur eux qu'on juge le résultat. */
const LANDMARKS = [
  'Passer domesticus', 'Columba livia', 'Cygnus olor', 'Vulpes vulpes',
  'Phoenicopterus roseus', 'Aquila chrysaetos', 'Melopsittacus undulatus',
  'Phascolarctos cinereus', 'Aptenodytes forsteri', 'Panthera leo',
  'Acinonyx jubatus', 'Panthera tigris', 'Giraffa camelopardalis',
  'Ambystoma mexicanum', 'Panthera uncia', 'Ailuropoda melanoleuca',
];

const LABEL: Record<string, string> = {
  common: 'commun', epic: 'épique', legendary: 'légendaire', mythic: 'mythique',
  rare: 'rare', ultra_rare: 'ultra rare', uncommon: 'peu commun', very_rare: 'très rare',
};

const csv = await new Response(
  Bun.spawn(
    ['supabase', 'db', 'query', '--linked', '-o', 'csv',
      "select scientific_name, coalesce(vernacular_name, '') as nom from public.species_catalog"],
    { stdout: 'pipe' },
  ).stdout,
).text();

// Le compteur vient du cache, JAMAIS de la colonne `occurrences`. Celle-ci a
// deux provenances — un compteur de facette pour les 884 d'origine, le vrai
// total pour les espèces ajoutées — et calibrer sur le mélange donnait au
// moineau domestique 550 243 observations au lieu de 25 841 840.
const cache: Record<string, number> = await Bun.file('.cache/gbif-occurrences.json')
  .json()
  .catch(() => ({}));

type Species = { count: number; name: string; vernacular: string };
const species: Species[] = [];
for (const line of csv.split('\n').slice(1)) {
  const cells = line.split(',');
  if (cells.length < 2) continue;
  const name = cells[0].replace(/^"|"$/g, '').trim();
  if (!name) continue;
  const count = cache[name];
  if (typeof count !== 'number' || !Number.isFinite(count)) continue;
  species.push({ count, name, vernacular: cells[1].replace(/^"|"$/g, '').trim() });
}

console.log(`${species.length} espèces avec un compteur mondial.\n`);

// Trié du plus observé au plus rare : la position dans cette liste EST la
// rareté, et les seuils ne font que la traduire en nombres.
const sorted = [...species].sort((a, b) => b.count - a.count);

const cuts: { at: number; rarity: string }[] = [];
let cursor = 0;
for (const tier of TARGET.slice(0, -1)) {
  cursor += tier.share;
  cuts.push({ at: sorted[Math.floor(cursor * sorted.length)].count, rarity: tier.rarity });
}

console.log('--- Seuils bruts, lus dans la distribution ---');
TARGET.forEach((tier, index) => {
  const floor = index < cuts.length ? cuts[index].at : 0;
  console.log(`  ${LABEL[tier.rarity].padEnd(12)} ≥ ${floor.toLocaleString('fr-FR').padStart(12)}   (${(tier.share * 100).toFixed(0)} %)`);
});

// Arrondis à une puissance lisible : un seuil à 1 247 883 se défend moins bien
// qu'un seuil à 1 000 000, et la différence porte sur une poignée d'espèces.
function round(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

const rounded = cuts.map((cut) => ({ ...cut, at: round(cut.at) }));
console.log('\n--- Seuils arrondis, ceux qu\'on figerait ---');
rounded.forEach((cut, index) => {
  console.log(`  ${LABEL[TARGET[index].rarity].padEnd(12)} ≥ ${cut.at.toLocaleString('fr-FR').padStart(12)}`);
});
console.log(`  ${LABEL['legendary'].padEnd(12)}   en dessous`);

function rarityFor(count: number): string {
  for (let index = 0; index < rounded.length; index += 1) {
    if (count >= rounded[index].at) return TARGET[index].rarity;
  }
  return 'legendary';
}

const pyramid = new Map<string, number>();
for (const row of species) {
  const rarity = rarityFor(row.count);
  pyramid.set(rarity, (pyramid.get(rarity) ?? 0) + 1);
}

console.log('\n--- La pyramide obtenue ---');
for (const tier of TARGET) {
  const count = pyramid.get(tier.rarity) ?? 0;
  const share = (100 * count) / species.length;
  const bar = '█'.repeat(Math.round(share / 2));
  console.log(
    `  ${LABEL[tier.rarity].padEnd(12)} ${share.toFixed(1).padStart(5)} %  ${String(count).padStart(5)}  ${bar}`,
  );
}

console.log('\n--- Ce que ça donne sur des espèces qu\'on reconnaît ---');
for (const name of LANDMARKS) {
  const row = species.find((entry) => entry.name === name);
  if (!row) { console.log(`  ${name.padEnd(26)} absente du catalogue`); continue; }
  console.log(
    `  ${(row.vernacular || row.name).padEnd(26)} ${row.count.toLocaleString('fr-FR').padStart(12)}  ${LABEL[rarityFor(row.count)]}`,
  );
}
