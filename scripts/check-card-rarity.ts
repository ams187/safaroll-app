// The card system has two halves, and this pins both:
//   1. rarity  — how *loud* a card is (rarer must never look calmer)
//   2. identity — what a card *looks like*, read off the real encounter
// Run: bun run check:cards
import {
  EFFECT_POOLS,
  HOLO_PALETTES,
  effectKeyFor,
  identityFor,
  latitudeBandFor,
  type CaptureTraits,
} from '../src/components/cards/card-identity';
import { hexToHsl, hueDelta, meanHue, rotatePalette } from '../src/components/cards/color';
import { AURA_LOUDNESS, METAL_TIERS } from '../src/components/cards/rarity-aura-scale';
import {
  MASTERY_DAY_THRESHOLDS,
  masteryLevelProgress,
  masteryProgressEvent,
  speciesMasteries,
  speciesMastery,
} from '../src/lib/animals/progression';
import {
  RARITY_ORDER,
  RARITY_TIERS,
  UNKNOWN_TIER,
  cardRarity,
  frameWidthFor,
  tierFor,
} from '../src/lib/animals/rarity';
import { setRarityForRank } from '../convex/model/rarity';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check-card-rarity: ${message}`);
}

const hex = /^#[0-9a-f]{6}$/i;

// ---------------------------------------------------------------- rarity ---

const accents = new Set<string>();
let previousGloss = -1;
let previousFrame = -1;
let previousSubjectHolo = -1;
let previousFoil = -1;

for (const rarity of RARITY_ORDER) {
  const tier = RARITY_TIERS[rarity];

  assert(tier.key === rarity, `${rarity} tier is filed under the wrong key`);
  assert(hex.test(tier.base) && hex.test(tier.accent), `${rarity} has a malformed base/accent color`);
  assert(
    tier.holo.every((color) => hex.test(color)),
    `${rarity} has a malformed fallback holo stop`,
  );
  assert(!accents.has(tier.accent), `${rarity} reuses the ${tier.accent} accent`);
  accents.add(tier.accent);

  assert(tier.gloss > previousGloss, `${rarity} is not glossier than the tier below it`);
  assert(
    tier.frameWeight > previousFrame,
    `${rarity} does not carry a heavier frame than the tier below it`,
  );
  assert(
    tier.subjectHolo > previousSubjectHolo,
    `${rarity} does not shimmer more on the animal than the tier below it`,
  );
  assert(tier.subjectHolo <= 1, `${rarity} would blow out the animal (subjectHolo > 1)`);
  assert(tier.foil > previousFoil && tier.foil <= 1, `${rarity} foil must rise and stay <= 1`);

  previousGloss = tier.gloss;
  previousFrame = tier.frameWeight;
  previousSubjectHolo = tier.subjectHolo;
  previousFoil = tier.foil;
}

assert(tierFor(undefined) === UNKNOWN_TIER, 'a capture without rarity must fall back to UNKNOWN');
assert(tierFor(null) === UNKNOWN_TIER, 'a null rarity must fall back to UNKNOWN');
assert(tierFor('legendary') === RARITY_TIERS.legendary, 'tierFor must resolve a known rarity');
assert(
  UNKNOWN_TIER.frameWeight < RARITY_TIERS.common.frameWeight,
  'an ungraded card must wear a lighter frame than a common',
);
// ------------------------------------------------------------- the frame ---

// Rarity's voice moved from stars to the frame, so the frame is now the thing
// that must stay ordered — at EVERY card width. A weight ordering alone is not
// enough: the width has a floor, and a floor that clamps two neighbouring tiers
// to the same hairline makes them the same card on a small tile.
for (const width of [64, 78, 96, 120, 160, 240, 340]) {
  let previousWidth = -1;
  for (const rarity of RARITY_ORDER) {
    const frame = frameWidthFor(RARITY_TIERS[rarity], width);
    assert(
      frame > previousWidth,
      `at ${width}pt a ${rarity} frame (${frame.toFixed(2)}) is not heavier than the tier below it`,
    );
    assert(frame < width * 0.09, `at ${width}pt a ${rarity} frame eats the card`);
    previousWidth = frame;
  }
}

// The star row is five slots wide because mastery has five levels. If any
// rarity ever gained a sixth threshold its top level would have no star to
// land in — the row is sized from `common` alone.
const SLOTS = MASTERY_DAY_THRESHOLDS.common.length;
assert(SLOTS === 5, `mastery must stay five levels deep, found ${SLOTS}`);
for (const [rarity, thresholds] of Object.entries(MASTERY_DAY_THRESHOLDS)) {
  assert(
    thresholds.length === SLOTS,
    `${rarity} has ${thresholds.length} mastery levels but the star row has ${SLOTS}`,
  );
}

// ------------------------------------------------------------ set rarity ---

// The card's rarity is a property of the SPECIES, the same for every player on
// earth; the encounter's rarity is personal and must never grade a card. The
// two were once the same field, which made a house sparrow common in Paris,
// uncommon in Marrakech and ungraded in Lagos.
assert(cardRarity({ rarity: 'legendary' }) === 'legendary', 'the species grades the card');
assert(
  cardRarity({ localEncounterRarity: 'legendary', rarity: 'common' }) === 'common',
  'a lucky encounter must never upgrade a common card',
);
assert(
  cardRarity({ localEncounterRarity: 'common', rarity: 'legendary' }) === 'legendary',
  'meeting a legendary in its stronghold must not downgrade it',
);
assert(cardRarity({ localEncounterRarity: 'rare' }) === 'rare', 'an off-atlas animal has only its encounter to go on');
assert(cardRarity({}) === undefined, 'no rarity at all stays undefined');
assert(cardRarity(undefined) === undefined, 'a missing capture grades nothing');

// The print run: quotas over a group's ranking, rarest first.
const SET_SIZE = 950;
const ranked = Array.from({ length: SET_SIZE }, (_, rank) => setRarityForRank(rank, SET_SIZE));
assert(ranked[0] === 'legendary', 'the least observed animal of a group leads');
assert(ranked[SET_SIZE - 1] === 'common', 'the most observed animal is a plain card');
const shares = ranked.reduce<Record<string, number>>((counts, r) => {
  counts[r] = (counts[r] ?? 0) + 1;
  return counts;
}, {});
// La pyramide, palier par palier : chaque cran doit être plus étroit que
// celui d'en dessous. Sur huit paliers c'est la seule façon de garantir qu'un
// « mythique » reste plus dur à obtenir qu'un « épique » — comparer seulement
// les extrêmes laisserait passer une inversion au milieu.
const SCARCEST_FIRST = [
  'legendary', 'mythic', 'epic', 'ultra_rare', 'very_rare', 'rare', 'uncommon', 'common',
];
for (let i = 1; i < SCARCEST_FIRST.length; i += 1) {
  const rarer = SCARCEST_FIRST[i - 1];
  const commoner = SCARCEST_FIRST[i];
  assert(
    (shares[rarer] ?? 0) < (shares[commoner] ?? 0),
    `${rarer} must be scarcer than ${commoner}`,
  );
}
// Monotonic: rarity may never improve as a species gets more observed.
const ORDER = SCARCEST_FIRST;
for (let i = 1; i < ranked.length; i += 1) {
  assert(ORDER.indexOf(ranked[i]) >= ORDER.indexOf(ranked[i - 1]), 'rarity must fall monotonically with observations');
}
// A group too small to fill a tier still crowns its rarest animal.
assert(setRarityForRank(0, 1) === 'legendary', 'a one-species group still has a top card');
assert(setRarityForRank(4, 5) === 'common', 'the last of a tiny group is still common');

// -------------------------------------------------------------- identity ---

// The holo treatments are the pixel-identical pokemon-cards-css effects; the
// pools may only name effects whose NO-MASK branch exists in fx/effects.
// `sticker-holo` is the one that is not from the SwSH set: it ports the 151
// ball-holo and tiles the capture's own die-cut where the Poke Ball goes.
for (const [rarity, pool] of Object.entries(EFFECT_POOLS)) {
  assert(pool.length > 0, `${rarity} has an empty effect pool`);
  // L'existence des effets est vérifiée par `check-full-art-glitter`, qui lit
  // le dossier : une liste de noms tenue à la main ici finissait par diverger
  // du registre — c'est elle qui a bloqué l'ajout de cinq effets déjà portés.
}
// UN PALIER, UN EFFET. C'est la règle qui a remplacé la hiérarchie TCG.
//
// Tant qu'un palier portait plusieurs traitements, l'animation ne pouvait pas
// dire la rareté : deux ultra rares ne se ressemblaient pas, et une rare
// pouvait paraître plus précieuse. Avec une correspondance stricte, voir la
// carte suffit à connaître son palier — la raison d'être des huit paliers.
for (const [rarity, pool] of Object.entries(EFFECT_POOLS)) {
  assert(pool.length === 1, `${rarity} must wear exactly one treatment, found ${pool.length}`);
}
// Et deux paliers ne peuvent pas partager le même : ce serait deux raretés
// indiscernables, donc une des deux qui ne veut plus rien dire.
{
  const used = Object.values(EFFECT_POOLS).flat();
  assert(
    new Set(used).size === used.length,
    'two rarities share a treatment — they would be indistinguishable',
  );
}
// La carte or reste à la forme Éclipse : si un palier la portait, la forme la
// plus rare du jeu n'aurait plus de signature à elle.
assert(
  !Object.values(EFFECT_POOLS).flat().includes('secret-rare'),
  'secret-rare belongs to the Eclipse form alone',
);

// Loudness rises with rarity: commons are plain print, and no pool above
// common may fall back to it.
// `basic` — la carte sans foil — ne peut habiller qu'UN palier, et seulement
// l'un des deux plus bas. Ailleurs, un palier entier serait du papier nu au
// milieu de cartes qui brillent.
{
  const plain = Object.entries(EFFECT_POOLS).filter(([, pool]) => pool.includes('basic'));
  assert(plain.length <= 1, 'only one rarity may be a plain printed card');
  for (const [rarity] of plain) {
    assert(
      rarity === 'common' || rarity === 'uncommon',
      `${rarity} is too high a tier to be a plain printed card`,
    );
  }
}

// The species — not the capture — picks the effect: deterministic, spread.
const key = (species: string, extra: Parameters<typeof effectKeyFor>[0] = { species }) =>
  effectKeyFor({ ...extra, species });
assert(
  key('Cyanistes caeruleus', { rarity: 'legendary', species: '' }) ===
    key('Cyanistes caeruleus', { rarity: 'legendary', species: '' }),
  'the same species must keep the same effect across calls',
);
assert(key('x', { species: 'x' }) === 'basic', 'no rarity means a plain card');
const legendarySpread = new Set(
  Array.from({ length: 60 }, (_, index) => effectKeyFor({ rarity: 'legendary', species: `Genus species${index}` })),
);
assert(legendarySpread.size === EFFECT_POOLS.legendary.length, 'every legendary treatment must be reachable');
assert(Object.keys(HOLO_PALETTES).length === 3, 'the geographic foil palettes were not fully imported');
for (const [key, palette] of Object.entries(HOLO_PALETTES)) {
  assert(palette.length >= 5, `palette ${key} needs at least 5 stops to sweep`);
  assert(
    palette.every((color) => hex.test(color)),
    `palette ${key} has a malformed stop`,
  );
}

const NOON = new Date('2026-06-15T13:00:00').getTime();
const MIDNIGHT = new Date('2026-06-15T23:30:00').getTime();

const capture = (traits: CaptureTraits) => identityFor(traits);
const bird = (extra: CaptureTraits = {}) =>
  capture({
    scientificName: 'Cyanistes caeruleus',
    taxonomy: {
      class: 'Aves',
      order: 'Passeriformes',
      family: 'Paridae',
      genus: 'Cyanistes',
    },
    capturedAt: NOON,
    latitude: 48.85,
    ...extra,
  });

assert(latitudeBandFor(3.1) === 'tropical', '3°N is tropical');
assert(latitudeBandFor(-70) === 'polar', '70°S is polar');
assert(latitudeBandFor(undefined) === 'unknown', 'no GPS means unknown latitude');

assert(bird({ latitude: 2 }).paletteKey === 'tropical', 'the tropics must saturate the foil');
assert(bird({ latitude: 68 }).paletteKey === 'polar', 'high latitudes must cool the foil');
assert(bird({ latitude: undefined }).paletteKey === 'daylight', 'no GPS falls back to daylight');

assert(
  JSON.stringify(bird({ capturedAt: MIDNIGHT })) === JSON.stringify(bird({ capturedAt: NOON })),
  'capture time must not change a card',
);

// LE LISERÉ A ÉTÉ RETIRÉ, ET SES GARDE-FOUS AVEC LUI.
//
// `RimLight` dilatait le détourage et remplissait l'anneau de `softHolo`. Trois
// assertions veillaient ici sur le contraste de cette couleur : un animal clair
// devait recevoir un liseré sombre, un animal sombre un liseré clair, et un
// animal sans couleur propre un liseré neutre. Elles gardaient un défaut réel
// — un cerne beige posé sur du blanc — mais elles gardaient une COUCHE, et la
// couche n'existe plus : l'anneau chargeait la carte, il a été supprimé.
//
// Le jour où un liseré revient, ces règles reviennent avec lui : elles sont
// dans l'historique de ce fichier, pas perdues.

// ------------------------------------------------------- colour harmony ---

// Round-tripping must not drift, or repeated rotations would bleach the foil.
for (const color of ['#ff3b30', '#00ff9c', '#5856d6', '#808080']) {
  const back = hexToHsl(color);
  assert(back.h >= 0 && back.h < 360, `${color} produced an out-of-range hue`);
  assert(back.s >= 0 && back.s <= 1 && back.l >= 0 && back.l <= 1, `${color} produced bad S/L`);
}
assert(Math.round(hexToHsl('#ff0000').h) === 0, 'red must sit at 0°');
assert(Math.round(hexToHsl('#00ff00').h) === 120, 'green must sit at 120°');
assert(Math.round(hexToHsl('#0000ff').h) === 240, 'blue must sit at 240°');
assert(hexToHsl('#808080').s === 0, 'grey has no saturation');
assert(Math.abs(hueDelta(350, 10)) === 20, 'hue distance must wrap around the wheel');

// Rotation preserves saturation and lightness — only the hue travels.
const rotated = rotatePalette(['#ff3b30', '#34aadc'], 90);
rotated.forEach((color, index) => {
  const before = hexToHsl(['#ff3b30', '#34aadc'][index]);
  const after = hexToHsl(color);
  assert(Math.abs(after.s - before.s) < 0.02, 'rotation must preserve saturation');
  assert(Math.abs(after.l - before.l) < 0.02, 'rotation must preserve lightness');
  assert(Math.abs(hueDelta(before.h + 90, after.h)) < 2, 'rotation must move the hue by 90°');
});

// A coloured animal pulls the foil to its complement; a grey one leaves it be.
const greenLizard = capture({
  scientificName: 'Lacerta viridis',
  taxonomy: { class: 'Reptilia' },
  capturedAt: NOON,
  latitude: 48.85,
  dominantColor: '#3fbf4f',
});
const greyHeron = capture({
  scientificName: 'Ardea cinerea',
  taxonomy: { class: 'Aves' },
  capturedAt: NOON,
  latitude: 48.85,
  dominantColor: '#8f9296',
});
assert(greyHeron.hueShift === 0, 'a grey animal must not rotate the foil');
assert(greenLizard.hueShift !== 0, 'a green animal must rotate the foil');
assert(
  Math.abs(hueDelta(meanHue(greenLizard.palette), (hexToHsl('#3fbf4f').h + 180) % 360)) < 3,
  'the foil must land opposite the animal',
);
assert(
  Math.abs(hueDelta(hexToHsl('#3fbf4f').h, meanHue(greenLizard.palette))) > 120,
  'the foil must never sit on the animal own hue',
);
// Same species, same colour — harmony must not make a card unstable.
assert(
  greenLizard.hueShift ===
    capture({
      scientificName: 'Lacerta viridis',
      taxonomy: { class: 'Reptilia' },
      capturedAt: NOON,
      latitude: 48.85,
      dominantColor: '#3fbf4f',
    }).hueShift,
  'the same animal must always get the same rotation',
);

// ------------------------------------------------------ per-animal body ---

// Every species owns a visibly different card, and it never changes.
assert(
  JSON.stringify(bird().body) === JSON.stringify(bird({ capturedAt: NOON + 3_600_000 }).body),
  'the same species must keep the same card body across daytime captures',
);
const greyBirdA = capture({
  scientificName: 'Passer domesticus',
  taxonomy: { class: 'Aves' },
  capturedAt: NOON,
});
const greyBirdB = capture({
  scientificName: 'Prunella modularis',
  taxonomy: { class: 'Aves' },
  capturedAt: NOON,
});
assert(
  JSON.stringify(greyBirdA.body) !== JSON.stringify(greyBirdB.body),
  'two colourless species of the same realm must still get different cards',
);
// A coloured animal dyes its own card.
const kingfisher = capture({
  scientificName: 'Alcedo atthis',
  taxonomy: { class: 'Aves' },
  capturedAt: NOON,
  dominantColor: '#1a9fd4',
});
assert(
  Math.abs(hueDelta(hexToHsl(kingfisher.body[1]).h, hexToHsl('#1a9fd4').h)) < 8,
  "a kingfisher's card must be kingfisher-blue",
);
// Legibility: the body must stay dark enough for white chrome.
for (const identity of [bird(), kingfisher, greyBirdA]) {
  for (const stop of identity.body) {
    assert(hexToHsl(stop).l <= 0.5, `body stop ${stop} too light for white text`);
  }
}
// Realms map to real TCG energy types the effects understand.
const KNOWN_ENERGY = new Set([
  'colorless',
  'fighting',
  'water',
  'dragon',
  'grass',
  'darkness',
  'psychic',
  'fire',
  'lightning',
  'metal',
  'fairy',
]);
for (const taxonClass of ['Aves', 'Mammalia', 'Actinopterygii', 'Insecta', 'Reptilia', 'Arachnida', '']) {
  const identity = capture({
    scientificName: 'X y',
    taxonomy: { class: taxonClass },
    capturedAt: NOON,
  });
  assert(KNOWN_ENERGY.has(identity.energyType), `unknown energy type "${identity.energyType}"`);
}
assert(
  capture({
    scientificName: 'Salmo trutta',
    taxonomy: { class: 'Actinopterygii' },
    capturedAt: NOON,
  }).energyType === 'water',
  'a fish is a water card',
);

// An unidentified capture must still produce a valid, resolvable look.
const unknown = identityFor(undefined);
assert(unknown.palette.length > 0, 'an unidentified capture still needs a palette');
assert(unknown.body.length === 3, 'an unidentified capture still needs a card body');

// ------------------------------------------------------------- maîtrise ---

const masteryCaptures = [
  {
    scientificName: 'Anas platyrhynchos',
    capturedAt: new Date('2026-06-15T08:00:00').getTime(),
    status: 'ready' as const,
  },
  {
    scientificName: 'Anas platyrhynchos',
    capturedAt: new Date('2026-06-15T18:00:00').getTime(),
    status: 'ready' as const,
  },
  {
    scientificName: 'Anas platyrhynchos',
    capturedAt: new Date('2026-06-16T08:00:00').getTime(),
    status: 'needs_review' as const,
  },
  {
    scientificName: 'Anas platyrhynchos',
    capturedAt: new Date('2026-06-17T08:00:00').getTime(),
    status: 'failed' as const,
  },
];
const duckMastery = speciesMastery(masteryCaptures, 'Anas platyrhynchos');
assert(duckMastery.observationDays === 2, 'same-day duplicates and failed captures do not add mastery');
assert(duckMastery.level === 2, 'two distinct observation days reach level 2');
assert(duckMastery.daysToNextLevel === 2, 'level 3 is reached after four distinct days');
assert(
  speciesMasteries(masteryCaptures).get('Anas platyrhynchos')?.observationDays === 2,
  'the collection-wide mastery pass matches the single-species result',
);
const mastered = speciesMastery(
  Array.from({ length: 12 }, (_, day) => ({
    scientificName: 'Phoenicopterus roseus',
    capturedAt: new Date(2026, 5, day + 1, 12).getTime(),
    status: 'ready' as const,
  })),
  'Phoenicopterus roseus',
);
assert(mastered.level === 5 && mastered.daysToNextLevel === 0, 'twelve distinct days master a species');
const masteryAt = (rarity: 'common' | 'uncommon' | 'rare' | 'ultra_rare' | 'legendary', days: number) =>
  speciesMastery(
    Array.from({ length: days }, (_, day) => ({
      scientificName: 'Panthera testus',
      capturedAt: new Date(2026, 5, day + 1, 12).getTime(),
      rarity,
      status: 'ready' as const,
    })),
    'Panthera testus',
  );
assert(masteryAt('common', 8).level === 4, 'a common species still needs twelve days for level 5');
assert(masteryAt('rare', 8).level === 5, 'a rare species reaches level 5 after eight days');
assert(masteryAt('legendary', 5).level === 5, 'a legendary species reaches level 5 after five days');
assert(
  MASTERY_DAY_THRESHOLDS.ultra_rare.join(',') === '1,2,3,4,6',
  'ultra-rare mastery thresholds must stay between rare and legendary',
);
assert(masteryLevelProgress(duckMastery) === 0, 'a newly reached level starts with an empty progress meter');
assert(masteryLevelProgress(mastered) === 1, 'a mastered species fills its progress meter');
assert(
  masteryProgressEvent(duckMastery, duckMastery) === 'same_day',
  'a repeat on the same day must not fake mastery progress',
);
assert(
  masteryProgressEvent(speciesMastery(masteryCaptures.slice(0, 1), 'Anas platyrhynchos'), duckMastery) ===
    'level_up',
  'crossing a mastery threshold must trigger the level-up reveal',
);
assert(
  masteryProgressEvent(
    duckMastery,
    speciesMastery(
      [
        ...masteryCaptures,
        {
          scientificName: 'Anas platyrhynchos',
          capturedAt: new Date('2026-06-18T08:00:00').getTime(),
          status: 'ready' as const,
        },
      ],
      'Anas platyrhynchos',
    ),
  ) === 'progress',
  'a new observation day between thresholds must use the lighter progress reveal',
);

const poolSize = Object.values(EFFECT_POOLS).reduce((total, pool) => total + pool.length, 0);
console.log(
  `check-card-rarity: ${RARITY_ORDER.length} tiers · ${poolSize} Pokémon holo treatments · ` +
    `${Object.keys(HOLO_PALETTES).length} palettes, all trait-driven`,
);

// ------------------------------------------------- le contour de la carte ---
//
// `RarityAura` dessine le contour DANS le rotateur de la carte, donc il tourne
// avec elle. Cinq paliers portent un néon, trois portent du métal liquide, et
// le changement de matière à l'entrée d'épique est la frontière que le joueur
// doit sentir.
//
// Un seul nombre pilote tout ce qui se voit — épaisseur, halo, vitesse. Il doit
// monter strictement, sinon une carte plus rare paraît plus calme : exactement
// le défaut que le foil a déjà connu.

{
  let previous = -1;
  for (const rarity of RARITY_ORDER) {
    const loudness = AURA_LOUDNESS[rarity];
    assert(
      typeof loudness === 'number' && loudness > previous,
      `${rarity} aura is not louder than the tier below it`,
    );
    assert(loudness <= 1, `${rarity} aura would blow out (loudness > 1)`);
    previous = loudness;
  }
}
assert(
  METAL_TIERS.length === 3 && ['epic', 'mythic', 'legendary'].every((k) => METAL_TIERS.includes(k as never)),
  'liquid metal belongs to epic, mythic and legendary — and to them alone',
);
for (const rarity of ['common', 'uncommon', 'rare', 'very_rare', 'ultra_rare'] as const) {
  assert(!METAL_TIERS.includes(rarity), `${rarity} must wear the neon edge, not metal`);
}
console.log('check-card-rarity: contour — néon en bas, métal en haut, escalade stricte.');
