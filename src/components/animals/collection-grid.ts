// La géométrie de la grille de collection. Pure, donc vérifiable par script —
// c'est elle qui décide si les bords des cartes tombent sur ceux du plateau.
//
// Le problème qu'elle résout : une cellule qui centre sa carte impose
// `gouttière = 2 × marge extérieure`. En calant la marge sur celle du deck, on
// obtient l'alignement mais un écart horizontal double de l'écart vertical, et
// l'œil le lit comme une erreur sans savoir la nommer.
//
// Donc la carte n'est plus centrée : chaque colonne reçoit son propre décalage,
// et une seule valeur — `gap` — sert à la fois de marge extérieure, d'écart
// horizontal et d'écart vertical. La grille respire pareil dans les deux sens.
//
//   |←12→|carte|←12→|carte|←12→|carte|←12→|
//
// Le décalage se déduit : la cellule k commence à `k × cellWidth`, la carte k
// doit commencer à `gap + k × (cardWidth + gap)`. La différence se simplifie en
// `gap × (colonnes − k) / colonnes`.

export type CollectionGrid = {
  /** Largeur d'une carte. */
  cardWidth: number;
  /** Largeur d'une cellule de la liste — c'est `width / colonnes`, inchangé. */
  cellWidth: number;
  /** Marge à gauche de la carte DANS sa cellule, par colonne. */
  offsetFor: (column: number) => number;
};

export function collectionGrid(width: number, columns: number, gap: number): CollectionGrid {
  // Une gouttière de plus que de colonnes : une à chaque bord, une entre
  // chaque paire.
  const cardWidth = (width - (columns + 1) * gap) / columns;
  return {
    cardWidth,
    cellWidth: width / columns,
    offsetFor: (column) => (gap * (columns - column)) / columns,
  };
}

/** Bord gauche de la carte d'une colonne, en coordonnées écran. Sert aux tests
 *  et rend l'invariant lisible : `cardLeft(0) === gap`. */
export function cardLeft(grid: CollectionGrid, column: number): number {
  return column * grid.cellWidth + grid.offsetFor(column);
}
