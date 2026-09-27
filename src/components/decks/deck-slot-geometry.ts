/**
 * Where the deck's drop targets are: its eight slots, and the five deck tabs
 * above them. Pure arithmetic, no React and no react-native imports, so a
 * script can check it — this is what decides which slot a dragged card lands
 * in, and getting it wrong overwrites the wrong card.
 */

export const DECK_SLOT_COUNT = 8;
export const DECK_COLUMNS = 4;
export const DECK_GAP = 8;

/** Stable identity of a slot, independent from the card inside it. */
export function deckSlotKey(index: number): string {
  return `slot-${index}`;
}

/** Same capture set regardless of its current drag order. */
export function deckCaptureSetKey(captureIds: readonly string[]): string {
  return [...captureIds].sort().join(':');
}

/** Pack remaining cards first, preserve empty identities, free the removed key last. */
export function compactDeckSlotsAfterRemoval<T extends { id: string; kind: 'card' | 'empty' }>(
  items: readonly T[],
  removedId: string,
  empty: T,
): T[] {
  return [
    ...items.filter((item) => item.kind === 'card' && item.id !== removedId),
    ...items.filter((item) => item.kind === 'empty'),
    empty,
  ];
}

/** The row of deck numbers. Same width as the grid, so it shares the origin. */
export const DECK_TAB_COUNT = 5;
export const DECK_TAB_GAP = 7;
export const DECK_TAB_HEIGHT = 42;

/**
 * Which cell of a fixed grid lies under a point, both expressed in the same
 * space (window coordinates, in practice). -1 when the point is outside.
 *
 * Gutters count as the cell that precedes them: a few pixels of dead zone
 * between cards would make a drop feel broken, and the grid has nothing else
 * to hit.
 */
function cellAt(
  pointX: number,
  pointY: number,
  origin: { x: number; y: number },
  cell: { height: number; width: number },
  gap: number,
  columns: number,
  count: number,
): number {
  'worklet';
  const rows = Math.ceil(count / columns);
  // Bound the whole rect first. Without this a point past the right edge still
  // divided into the last column — the trailing gap has no cell after it, so
  // the arithmetic alone would hand back a target that is not under the finger.
  if (pointX < origin.x || pointX > origin.x + columns * cell.width + (columns - 1) * gap) {
    return -1;
  }
  if (pointY < origin.y || pointY > origin.y + rows * cell.height + (rows - 1) * gap) {
    return -1;
  }

  const column = Math.min(columns - 1, Math.floor((pointX - origin.x) / (cell.width + gap)));
  const row = Math.min(rows - 1, Math.floor((pointY - origin.y) / (cell.height + gap)));
  const index = row * columns + column;
  return index < count ? index : -1;
}

/** Which of the eight deck slots lies under a point. -1 outside the grid. */
export function deckSlotAt(
  pointX: number,
  pointY: number,
  origin: { x: number; y: number },
  slot: { height: number; width: number },
): number {
  'worklet';
  return cellAt(pointX, pointY, origin, slot, DECK_GAP, DECK_COLUMNS, DECK_SLOT_COUNT);
}

/**
 * Which deck number lies under a point. -1 off the row. Dragging a card over a
 * tab opens that deck, so a card can be carried from the collection into a deck
 * that is not the one on screen.
 */
export function deckTabAt(
  pointX: number,
  pointY: number,
  origin: { x: number; y: number },
  width: number,
): number {
  'worklet';
  const tabWidth = (width - (DECK_TAB_COUNT - 1) * DECK_TAB_GAP) / DECK_TAB_COUNT;
  return cellAt(
    pointX,
    pointY,
    origin,
    { height: DECK_TAB_HEIGHT, width: tabWidth },
    DECK_TAB_GAP,
    DECK_TAB_COUNT,
    DECK_TAB_COUNT,
  );
}

/**
 * À quel point le doigt approche la poubelle, pendant qu'une carte du deck est
 * portée.
 *
 * Deux réponses, pas une : `inside` décide (lâcher ici retire la carte), et
 * `proximity` anime (le couvercle s'entrouvre à mesure qu'on approche, AVANT
 * d'être dessus — c'est ce qui rend la cible lisible sans un mot). 1 dans le
 * rectangle, 0 à `range` points de distance, linéaire entre les deux.
 */
export const BIN_APPROACH_RANGE = 200;

export function binApproach(
  x: number,
  y: number,
  rect: { height: number; width: number; x: number; y: number },
  range?: number,
): { inside: boolean; proximity: number } {
  'worklet';
  // Le repli est dans le CORPS, pas en paramètre par défaut : le plugin
  // worklets capture les identifiants du corps dans la closure UI, mais pas
  // ceux des valeurs par défaut — `range = BIN_APPROACH_RANGE` jette
  // « Property doesn't exist » à la première frame de drag sur l'appareil.
  const limit = range ?? BIN_APPROACH_RANGE;
  // Distance au RECTANGLE, pas à son centre : une poubelle large aurait un
  // couvercle qui retombe quand le doigt glisse d'un bord à l'autre.
  const dx = Math.max(rect.x - x, 0, x - (rect.x + rect.width));
  const dy = Math.max(rect.y - y, 0, y - (rect.y + rect.height));
  const distance = Math.sqrt(dx * dx + dy * dy);
  return { inside: distance === 0, proximity: 1 - Math.min(distance / limit, 1) };
}

/**
 * Le rectangle de la poubelle : là où elle est DESSINÉE, donc là où on peut la
 * viser. Les deux sortent d'ici, et c'est le fond de l'affaire.
 *
 * La version d'avant mesurait la vue avec `measureInWindow`, dans le même tick
 * que la mesure du plateau dont sa position dépend. Au premier portage le
 * plateau valait encore 0, la poubelle était donc mesurée garée en haut de
 * l'écran, et le doigt ne la touchait jamais : elle ne s'ouvrait qu'à la
 * deuxième tentative, quand la mesure de la fois d'avant servait de cache.
 *
 * Une position déduite ne peut pas arriver en retard. Et la faire calculer ici
 * pour le style ET pour la cible rend la divergence impossible : ce ne sont
 * plus deux expressions à garder d'accord, c'est la même.
 */
export const BIN_OFFSET = 56;

export function binLayout(
  gridBottom: number,
  screenWidth: number,
  size: { height: number; width: number },
) {
  'worklet';
  return {
    height: size.height,
    width: size.width,
    // La couche est pleine largeur et centre son contenu : x n'a jamais eu
    // besoin d'être mesuré.
    x: (screenWidth - size.width) / 2,
    y: gridBottom + BIN_OFFSET,
  };
}
