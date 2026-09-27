export type LocalEncounterRarity = "common" | "uncommon" | "rare" | "legendary";
/**
 * Huit paliers, la même échelle que `src/lib/animals/progression.ts`.
 *
 * Déclarée en double parce que Convex ne voit pas `src/` — mais les deux sont
 * comparées par `check-card-rarity.ts`, qui importe les deux et échouerait si
 * l'une gagnait un palier que l'autre n'a pas.
 */
export type CardRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "very_rare"
  | "ultra_rare"
  | "epic"
  | "mythic"
  | "legendary";

/**
 * A capture wears TWO independent measures, and conflating them was a bug:
 *
 *   `rarity`               — the card's rarity. A property of the SPECIES,
 *                            identical for every player on earth. Printed on
 *                            the card, comparable, tradeable. `setRarityForRank`.
 *   `localEncounterRarity` — how unlikely this animal was HERE, this month.
 *                            A property of the encounter, personal, never
 *                            comparable between two players.
 *                            `localEncounterRarityFromOccurrences`.
 *
 * The local number cannot grade a card. GBIF counts observers, not animals:
 * the house sparrow — the most banal bird alive — returns 4890 records in
 * Paris, 87 in Marrakech and 0 in Lagos. Grading the card on that hands a
 * Parisian a common, a Moroccan an uncommon and a Nigerian a card with no
 * rarity at all, for the same bird. It also pays better for a tortoise
 * photographed in a cage outside its range than for a wild one inside it.
 */

export function localEncounterRarityFromOccurrences(
  count: number,
): LocalEncounterRarity | undefined {
  if (!Number.isFinite(count) || count < 1) return undefined;
  // ponytail: temporary cross-taxa encounter labels; calibrate per taxonomic
  // class once the multi-animal benchmark contains enough local observations.
  if (count < 5) return "legendary";
  if (count < 25) return "rare";
  if (count < 100) return "uncommon";
  return "common";
}

/** @deprecated Compatibility alias for existing capture rows and clients. */
export const rarityFromOccurrences = localEncounterRarityFromOccurrences;

/**
 * The set's print run, as fractions of one group's species.
 *
 * Quotas, not thresholds on the raw count: recording effort differs by orders
 * of magnitude between taxa (a tit is observed a thousand times more often
 * than a ground beetle), so an absolute cut-off would make every insect
 * legendary and every bird common. Ranking inside a group cancels that.
 *
 * The shape is a real booster's: mostly commons, a thin top. 3% of a
 * ~950-species atlas is about 28 legendary animals — few enough that meeting
 * one is an event, many enough that the pool is not a shortlist.
 */
/** Slices off the rare end, in order. Common is whatever is left. */
// Les quotas, du plus rare au plus commun — l'ordre du tirage, pas celui de
// l'échelle. Ils reproduisent la forme mesurée sur le catalogue mondial :
// chaque palier est plus étroit que celui d'en dessous, et le reste tombe en
// commun.
export const SET_RARITY_QUOTAS: { rarity: CardRarity; share: number }[] = [
  { rarity: "legendary", share: 0.03 },
  { rarity: "mythic", share: 0.05 },
  { rarity: "epic", share: 0.07 },
  { rarity: "ultra_rare", share: 0.10 },
  { rarity: "very_rare", share: 0.15 },
  { rarity: "rare", share: 0.18 },
  { rarity: "uncommon", share: 0.20 },
];

/**
 * The card's rarity, from a species' rank inside its own group.
 *
 * `rank` is 0 for the LEAST observed species of the group — the rarest animal
 * leads, so rank 0 is the legendary end. `size` is how many species that group
 * holds. Same species, same rank, same card, everywhere.
 */
export function setRarityForRank(rank: number, size: number): CardRarity {
  if (!Number.isFinite(rank) || !Number.isFinite(size) || size < 1) return "common";
  const position = Math.min(Math.max(rank, 0), size - 1);
  if (size > 1 && position === size - 1) return "common";
  // A group too small to fill a tier still awards its rarest animal the top
  // one: `ceil` keeps every quota at least one species wide.
  let ceiling = 0;
  for (const { rarity, share } of SET_RARITY_QUOTAS) {
    ceiling += Math.ceil(share * size);
    if (position < ceiling) return rarity;
  }
  return "common";
}
