// Skia-free geometry for the CSS custom clip-path values in
// pokemon-cards-css/public/css/cards.css:18-25 (`--clip`, `--clip-invert`,
// `--clip-stage`, `--clip-stage-invert`, `--clip-trainer`, `--clip-borders`).
// Kept in its own module (no @shopify/react-native-skia import) so the
// percentage math is testable under vitest — src/effects/clips.ts imports
// this plus Skia to turn it into actual SkPath builders.

import { pct } from "../lib/css";

export interface InsetPct {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** CSS `inset(top right bottom left)` -> pixel rect for a w x h box. */
export const resolveInset = (
  inset: InsetPct,
  w: number,
  h: number
): { x: number; y: number; width: number; height: number } => ({
  x: pct(inset.left, w),
  y: pct(inset.top, h),
  width: pct(100 - inset.left - inset.right, w),
  height: pct(100 - inset.top - inset.bottom, h),
});

/** CSS `polygon(x% y%, ...)` -> pixel points for a w x h box. */
export const resolvePolygon = (
  pointsPct: readonly (readonly [number, number])[],
  w: number,
  h: number
): { x: number; y: number }[] => pointsPct.map(([x, y]) => ({ x: pct(x, w), y: pct(y, h) }));

// -- cards.css:18-25 exact values ----------------------------------------

export const CLIP_INSET: InsetPct = { top: 9.85, right: 8, bottom: 52.85, left: 8 };
export const CLIP_TRAINER_INSET: InsetPct = { top: 14.5, right: 8.5, bottom: 48.2, left: 8.5 };
// inset(2.8% 4% round 2.55%/1.5%) — 2-value shorthand: top/bottom=2.8%, left/right=4%.
export const CLIP_BORDERS_INSET: InsetPct = { top: 2.8, right: 4, bottom: 2.8, left: 4 };
// border-radius percentages: x-radius resolves against width, y-radius against height.
export const CLIP_BORDERS_RADIUS: { rx: number; ry: number } = { rx: 2.55, ry: 1.5 };

export const CLIP_INVERT_POLYGON: readonly (readonly [number, number])[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
  [0, 47.15],
  [91.5, 47.15],
  [91.5, 9.85],
  [8, 9.85],
  [8, 47.15],
  [0, 50],
];

export const CLIP_STAGE_POLYGON: readonly (readonly [number, number])[] = [
  [91.5, 9.85],
  [57, 9.85],
  [54, 12],
  [17, 12],
  [16, 14],
  [12, 16],
  [8, 16],
  [8, 47.15],
  [92, 47.15],
];

/**
 * Which `--clip*` a `rare holo` card's shine + glare:after use, per the subtype
 * selectors in regular-holo.css:7-16 (`[data-subtypes^="stage"]` -> clip-stage;
 * `^="supporter"`/`^="item"` -> clip-trainer; otherwise the default `--clip`).
 * `data-subtypes` is the space-joined, lowercased subtype list (Card.svelte:306).
 */
export type ClipVariant = "base" | "stage" | "trainer";

export const clipVariantForSubtypes = (subtypes: string[]): ClipVariant => {
  const joined = subtypes.join(" ").toLowerCase();
  if (joined.startsWith("stage")) return "stage";
  if (joined.startsWith("supporter") || joined.startsWith("item")) return "trainer";
  return "base";
};

/**
 * `.card__glare:after` clip variant. Same subtype rules as the shine, PLUS
 * base.css:347-351 `[data-supertype="trainer"] .card__glare:after` -> clip-trainer
 * for every trainer regardless of subtype (a rule the shine does NOT get). So a
 * card's shine and glare:after can use different clips.
 */
export const glareClipVariant = (subtypes: string[], supertype: string): ClipVariant => {
  const v = clipVariantForSubtypes(subtypes);
  if (v !== "base") return v;
  return supertype.toLowerCase() === "trainer" ? "trainer" : "base";
};

export const CLIP_STAGE_INVERT_POLYGON: readonly (readonly [number, number])[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
  [0, 47.15],
  [91.5, 47.15],
  [91.5, 9.85],
  [57, 9.85],
  [54, 12],
  [17, 12],
  [16, 14],
  [12, 16],
  [8, 16],
  [8, 47.15],
  [0, 50],
];
