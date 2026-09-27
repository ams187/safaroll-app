// Shared PURE builders for the V-family (prism-foil / prism-full-art / max-prism /
// star-prism) "sunpillar" 6-colour system plus the cyan diagonal-streak gradient
// those four files all layer under their shine. No Skia/reanimated imports, so
// this runs headless under vitest; the Skia render components that consume this
// data live in prismShared.tsx.
//
// The sunpillar palette (base.css:27-32) is read through the indirection vars
// --sunpillar-clr-1..6, which base.css remaps per pseudo-element:
//   .card__shine        (base.css:34-39) — identity  clr-N = sunpillar-N
//   .card__shine:before (base.css:266-271) — clr = [5,6,1,2,3,4]
//   .card__shine:after  (base.css:281-286) — clr = [6,1,2,3,4,5]
// so the SAME `clr-1 .. clr-6, clr-1` stop list paints a different rotation of
// the palette on the element vs its ::after (only identity + after are used by
// these four files; `before` is defined for completeness).

import { hsl } from "../lib/css";
import { normalizeRepeatingStops } from "./cssBackground";

/** base.css:27-32 --sunpillar-1 .. --sunpillar-6 (0-indexed). */
export const SUNPILLAR = [
  hsl(2, 100, 73), // --sunpillar-1
  hsl(53, 100, 69), // --sunpillar-2
  hsl(93, 100, 69), // --sunpillar-3
  hsl(176, 100, 76), // --sunpillar-4
  hsl(228, 100, 74), // --sunpillar-5
  hsl(283, 100, 73), // --sunpillar-6
];

export type SunRotation = "identity" | "before" | "after";

// clr-1..6 -> 0-indexed source palette entry, per the base.css remaps above.
const ROTATION: Record<SunRotation, number[]> = {
  identity: [0, 1, 2, 3, 4, 5],
  before: [4, 5, 0, 1, 2, 3],
  after: [5, 0, 1, 2, 3, 4],
};

/**
 * The 7-stop colour list for `clr-1 .. clr-6, clr-1` under a given rotation
 * (the trailing repeat of clr-1 closes the period seamlessly).
 */
export const sunpillarColors = (rot: SunRotation): string[] => {
  const idx = ROTATION[rot];
  return [...idx.map((i) => SUNPILLAR[i]), SUNPILLAR[idx[0]]];
};

/**
 * Stops sit at `--space * [1..7]`; evenly spaced, so once normalized onto a
 * single repeat period they are `[0, 1/6, 2/6, 3/6, 4/6, 5/6, 1]` regardless of
 * `--space` (the raw first/last percentages still drive where the period lands
 * along the gradient line — handled in prismShared.tsx).
 */
export const SUN_STOPS = normalizeRepeatingStops([1, 2, 3, 4, 5, 6, 7]).positions;

// The 133deg cyan "diagonal streak" repeating gradient shared by prism-foil /
// prism-full-art / star-prism (element + ::after) and max-prism (::after). One period spans
// 0%..12% of the gradient line (prism-foil.css:46-54 et al).
export const DIAGONAL_COLORS = [
  "#0e152e",
  hsl(180, 10, 60),
  hsl(180, 29, 66),
  hsl(180, 10, 60),
  "#0e152e",
  "#0e152e",
];
const DIAGONAL = normalizeRepeatingStops([0, 3.8, 4.5, 5.2, 10, 12]);
export const DIAGONAL_STOPS = DIAGONAL.positions;
/** Fraction of the gradient line one diagonal period spans (last stop = 12%). */
export const DIAGONAL_PERIOD = DIAGONAL.last / 100;
