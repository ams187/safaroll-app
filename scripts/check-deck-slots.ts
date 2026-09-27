import { cardLeft, collectionGrid } from '../src/components/animals/collection-grid';
import {
  BIN_APPROACH_RANGE,
  DECK_COLUMNS,
  DECK_GAP,
  DECK_SLOT_COUNT,
  DECK_TAB_COUNT,
  DECK_TAB_GAP,
  DECK_TAB_HEIGHT,
  binApproach,
  binLayout,
  compactDeckSlotsAfterRemoval,
  deckCaptureSetKey,
  deckSlotAt,
  deckSlotKey,
  deckTabAt,
} from '../src/components/decks/deck-slot-geometry';

function equal(actual: number, expected: number, message: string) {
  if (actual !== expected) {
    throw new Error(`check-deck-slots: ${message} — got ${actual}, expected ${expected}`);
  }
}

// A deck grid the size of the one on an iPhone 15: 341pt wide, four columns.
const slot = { height: 111, width: 79.75 };
const origin = { x: 24, y: 300 };
const stepX = slot.width + DECK_GAP;
const stepY = slot.height + DECK_GAP;

const physicalKeys = Array.from({ length: DECK_SLOT_COUNT }, (_, index) => deckSlotKey(index));
if (new Set(physicalKeys).size !== DECK_SLOT_COUNT) {
  throw new Error('check-deck-slots: chaque emplacement doit avoir une identité unique');
}
if (deckCaptureSetKey(['capture-b', 'capture-a']) !== deckCaptureSetKey(['capture-a', 'capture-b'])) {
  throw new Error("check-deck-slots: l'ordre optimiste ne doit pas changer l'ensemble des cartes");
}
const compacted = compactDeckSlotsAfterRemoval(
  [
    { id: 'slot-1', kind: 'card' as const },
    { id: 'slot-0', kind: 'card' as const },
    { id: 'slot-2', kind: 'empty' as const },
  ],
  'slot-1',
  { id: 'slot-1', kind: 'empty' as const },
);
if (compacted.map((item) => item.id).join(':') !== 'slot-0:slot-2:slot-1') {
  throw new Error('check-deck-slots: retirer une carte doit compacter sans perdre une clé');
}

const centre = (index: number) => ({
  x: origin.x + (index % DECK_COLUMNS) * stepX + slot.width / 2,
  y: origin.y + Math.floor(index / DECK_COLUMNS) * stepY + slot.height / 2,
});

// Every slot answers for its own centre — the row-major order the deck stores.
for (let index = 0; index < DECK_SLOT_COUNT; index += 1) {
  const point = centre(index);
  equal(deckSlotAt(point.x, point.y, origin, slot), index, `centre of slot ${index}`);
}

// Corners belong to their slot, not the neighbour.
equal(deckSlotAt(origin.x + 0.5, origin.y + 0.5, origin, slot), 0, 'top-left corner');
equal(
  deckSlotAt(origin.x + stepX * 3 + slot.width - 0.5, origin.y + 0.5, origin, slot),
  3,
  'top-right corner',
);

// Outside in every direction is a miss, so releasing off the deck drops nothing.
equal(deckSlotAt(origin.x - 1, centre(0).y, origin, slot), -1, 'left of the grid');
equal(deckSlotAt(centre(0).x, origin.y - 1, origin, slot), -1, 'above the grid');
equal(
  deckSlotAt(origin.x + stepX * DECK_COLUMNS + 1, centre(0).y, origin, slot),
  -1,
  'right of the grid',
);
equal(
  deckSlotAt(centre(0).x, origin.y + stepY * 2 + 1, origin, slot),
  -1,
  'below the last row',
);

// Just past the right edge of the last card is a miss, not slot 3 — the
// trailing gutter has no cell after it. Regression: the first version divided
// the point into the last column and reported a target under nobody's finger.
equal(
  deckSlotAt(origin.x + stepX * 3 + slot.width + 1, centre(0).y, origin, slot),
  -1,
  'just right of the last column',
);
equal(
  deckSlotAt(centre(0).x, origin.y + stepY + slot.height + 1, origin, slot),
  -1,
  'just below the last row',
);

// The gutter is not a hole: it reads as the slot that follows it, so a drop
// between two cards still lands somewhere.
equal(
  deckSlotAt(origin.x + slot.width + DECK_GAP / 2, centre(0).y, origin, slot),
  0,
  'vertical gutter after slot 0',
);
equal(
  deckSlotAt(centre(0).x, origin.y + slot.height + DECK_GAP / 2, origin, slot),
  0,
  'horizontal gutter under slot 0',
);

// The deck numbers, the second drop target: crossing one opens that deck, so a
// card can be carried into a deck that is not the one on screen.
const rowWidth = 341;
const tabOrigin = { x: 24, y: 180 };
const tabWidth = (rowWidth - (DECK_TAB_COUNT - 1) * DECK_TAB_GAP) / DECK_TAB_COUNT;

for (let index = 0; index < DECK_TAB_COUNT; index += 1) {
  const x = tabOrigin.x + index * (tabWidth + DECK_TAB_GAP) + tabWidth / 2;
  const y = tabOrigin.y + DECK_TAB_HEIGHT / 2;
  equal(deckTabAt(x, y, tabOrigin, rowWidth), index, `centre of tab ${index}`);
}

equal(deckTabAt(tabOrigin.x - 1, tabOrigin.y + 5, tabOrigin, rowWidth), -1, 'left of the tabs');
equal(deckTabAt(tabOrigin.x + 5, tabOrigin.y - 1, tabOrigin, rowWidth), -1, 'above the tabs');
equal(
  deckTabAt(tabOrigin.x + rowWidth + 1, tabOrigin.y + 5, tabOrigin, rowWidth),
  -1,
  'right of the tabs',
);
// One row only: the deck grid sits below and must never be read as a sixth tab.
equal(
  deckTabAt(tabOrigin.x + 5, tabOrigin.y + DECK_TAB_HEIGHT + DECK_TAB_GAP + 1, tabOrigin, rowWidth),
  -1,
  'below the tab row',
);

console.log(
  `check-deck-slots: ${DECK_SLOT_COUNT} slots · ${DECK_COLUMNS} columns · ${DECK_TAB_COUNT} tabs · centres, corners, gutters and misses all hold`,
);


// --- La grille de collection s'aligne sur le plateau -------------------------
//
// L'invariant que l'œil réclame : les bords extérieurs des cartes tombent sur
// les bords du deck, et l'écart horizontal vaut l'écart vertical. Les deux
// tiennent à une seule valeur, la marge du plateau.

const DECK_MARGIN = 12;
const COLUMNS = 3;

for (const width of [375, 393, 430, 440]) {
  const grid = collectionGrid(width, COLUMNS, DECK_MARGIN);

  equal(cardLeft(grid, 0), DECK_MARGIN, `bord gauche à ${width}pt`);
  equal(
    Number((width - (cardLeft(grid, COLUMNS - 1) + grid.cardWidth)).toFixed(6)),
    DECK_MARGIN,
    `bord droit à ${width}pt`,
  );

  // Chaque écart entre deux cartes vaut exactement une marge — donc autant que
  // l'écart vertical, qui est `paddingBottom: DECK_SECTION_MARGIN`.
  for (let column = 1; column < COLUMNS; column += 1) {
    const gap = cardLeft(grid, column) - (cardLeft(grid, column - 1) + grid.cardWidth);
    equal(Number(gap.toFixed(6)), DECK_MARGIN, `écart ${column - 1}→${column} à ${width}pt`);
  }

  // Les cellules couvrent l'écran sans reste : sinon la dernière colonne
  // déborderait ou la liste laisserait une bande morte.
  equal(grid.cellWidth * COLUMNS, width, `cellules couvrant ${width}pt`);
}

console.log('check-deck-slots: grille de collection alignée sur le plateau, écarts égaux.');

// --- L'approche de la poubelle ----------------------------------------------
//
// `binApproach` décide quand lâcher une carte la retire du deck (`inside`) et
// pilote l'ouverture du couvercle (`proximity`). Un faux `inside` détruit une
// carte que le joueur reclassait ; une proximité fausse rend la cible illisible.

const bin = { height: 92, width: 341, x: 24, y: 700 };

function approxEqual(actual: number, expected: number, message: string) {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`check-deck-slots: ${message} — got ${actual}, expected ${expected}`);
  }
}

// Dedans, où qu'on soit dans le rectangle : décidé, et couvercle grand ouvert.
for (const [x, y] of [[24, 700], [24 + 341, 700 + 92], [190, 745]] as const) {
  const r = binApproach(x, y, bin);
  if (!r.inside) throw new Error(`check-deck-slots: (${x},${y}) devrait être dans la poubelle`);
  approxEqual(r.proximity, 1, `proximité dedans en (${x},${y})`);
}

// Juste au-dessus du couvercle : dehors, mais presque ouvert — l'ouverture
// anticipe le survol, elle ne l'attend pas.
{
  const r = binApproach(190, 700 - 50, bin);
  if (r.inside) throw new Error('check-deck-slots: 50pt au-dessus ne doit pas être "dedans"');
  approxEqual(r.proximity, 1 - 50 / BIN_APPROACH_RANGE, 'proximité à 50pt');
}

// À la portée exacte et au-delà : zéro, pas négatif.
approxEqual(binApproach(190, 700 - BIN_APPROACH_RANGE, bin).proximity, 0, 'proximité à la portée');
approxEqual(binApproach(190, 700 - BIN_APPROACH_RANGE * 3, bin).proximity, 0, 'proximité au-delà');

// En diagonale, la distance est euclidienne au COIN — pas au centre, pas en
// Manhattan : 30² + 40² = 50².
{
  const r = binApproach(24 - 30, 700 - 40, bin);
  approxEqual(r.proximity, 1 - 50 / BIN_APPROACH_RANGE, 'proximité diagonale 3-4-5');
}

console.log('check-deck-slots: approche de la poubelle — dedans, gradient et diagonale tiennent.');

// --- la poubelle est là où on la voit ---------------------------------------
//
// Le bug : sa position était MESURÉE au même instant que celle du plateau dont
// elle dépend, donc au premier portage elle était mesurée garée en haut de
// l'écran et le doigt ne la touchait jamais. Elle ne s'ouvrait qu'à la
// deuxième tentative.
{
  const must = (condition: boolean, message: string) => {
    if (!condition) throw new Error(`check-deck-slots: ${message}`);
  };
  const size = { height: 100, width: 180 };
  const screen = 390;

  // Déduite, donc jamais en retard : à plateau connu, la cible tombe sous le
  // plateau et non en haut de l'écran.
  const settled = binLayout(600, screen, size);
  must(settled.y > 600, 'la poubelle doit être SOUS le plateau');
  must(settled.x + settled.width / 2 === screen / 2,
    'la poubelle est centrée : la couche est pleine largeur',
  );

  // Le doigt au centre de la cible est dedans ; le même doigt jugé contre un
  // plateau encore à zéro ne l'est pas — c'est exactement l'écart que le bug
  // produisait.
  const centre = { x: screen / 2, y: settled.y + size.height / 2 };
  must(binApproach(centre.x, centre.y, settled).inside, 'le centre de la cible doit être dedans');
  must(!binApproach(centre.x, centre.y, binLayout(0, screen, size)).inside,
    'une poubelle jugée sur un plateau non mesuré ne doit PAS attraper le doigt',
  );

  console.log('check-deck-slots: poubelle déduite du plateau, jamais mesurée en retard.');
}
