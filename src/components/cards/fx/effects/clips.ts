// SkPath builders for the CSS custom clip-path values in
// pokemon-cards-css/public/css/cards.css:18-25 (`--clip`, `--clip-invert`,
// `--clip-stage`, `--clip-stage-invert`, `--clip-trainer`, `--clip-borders`).
//
// Imports @shopify/react-native-skia (native) so this file cannot be loaded
// under vitest — the underlying percentage geometry lives in the
// Skia-free, tested clipGeometry.ts and is only turned into SkPath objects
// here via Skia's own Rect/RRect/Polygon factories.

import { Skia, type SkPath } from "@shopify/react-native-skia";
import {
  CLIP_INSET,
  CLIP_INVERT_POLYGON,
  CLIP_STAGE_INVERT_POLYGON,
  CLIP_STAGE_POLYGON,
  CLIP_TRAINER_INSET,
  resolveInset,
  resolvePolygon,
  type InsetPct,
} from "./clipGeometry";

const insetPath = (inset: InsetPct, w: number, h: number): SkPath => {
  const { x, y, width, height } = resolveInset(inset, w, h);
  return Skia.Path.Rect(Skia.XYWHRect(x, y, width, height));
};

const polygonPath = (pointsPct: readonly (readonly [number, number])[], w: number, h: number): SkPath => {
  const points = resolvePolygon(pointsPct, w, h).map((p) => Skia.Point(p.x, p.y));
  return Skia.Path.Polygon(points, true);
};

/**
 * The whole card. What `--clip` means on a SafaRoll card.
 *
 * Every `--clip*` below describes part of a PRINTED Pokémon card: either its
 * art window — the rectangle between the name bar and the attack text — or an
 * inset printed border. `--clip` is literally
 * `inset(9.85% 8% 52.85% 8%)`: a box from 8%,9.85% to 92%,47.15%.
 *
 * A SafaRoll card has no such window. Its art is full-bleed and its chrome — the
 * name, the pill, the plate — is a React view stacked on top of the Skia
 * canvas, not a hole cut into it. Clipping an effect to a printed card's art
 * window therefore drew a hard-edged rectangle across the middle of the scene,
 * which is exactly what it looks like: a rectangle.
 *
 * So on this card the art window IS the card, and the inverse of the art
 * window is nothing. Both resolve here, once, instead of every effect module
 * having to know it.
 */
const cardPath = (w: number, h: number): SkPath => Skia.Path.Rect(Skia.XYWHRect(0, 0, w, h));

/** `(w, h) => SkPath` builders for every `--clip*` custom property in cards.css. */
export const CLIPS = {
  clip: cardPath,
  clipInvert: cardPath,
  clipStage: cardPath,
  clipStageInvert: cardPath,
  clipTrainer: cardPath,
  clipBorders: cardPath,
} as const;

/**
 * The printed-card geometry, kept because it is the source of truth this port
 * was transliterated from and the tests assert against it. Nothing renders
 * with it — see `CLIPS` above for why.
 */
export const PRINTED_CARD_CLIPS = {
  clip: (w: number, h: number): SkPath => insetPath(CLIP_INSET, w, h),
  clipInvert: (w: number, h: number): SkPath => polygonPath(CLIP_INVERT_POLYGON, w, h),
  clipStage: (w: number, h: number): SkPath => polygonPath(CLIP_STAGE_POLYGON, w, h),
  clipStageInvert: (w: number, h: number): SkPath => polygonPath(CLIP_STAGE_INVERT_POLYGON, w, h),
  clipTrainer: (w: number, h: number): SkPath => insetPath(CLIP_TRAINER_INSET, w, h),
} as const;
