// CSS `background-image` -> Skia translation helpers shared by every holo
// effect module (Tasks 10-20). Pure TS, no RN imports, so this runs headless
// under vitest. Three reusable pieces of the CSS background model:
//
//  - bgPosTranslate: `background-position: P%` on a `background-size`-scaled
//    layer -> the pixel shift of that layer.
//  - normalizeRepeatingStops: a `repeating-linear-gradient` repeats the span
//    between its first and last color-stop; this maps CSS stop positions onto a
//    single TileMode.Repeat period (0..1).
//  - interpolateStopColor: re-anchors a color-stop placed past 100% (Skia
//    clamps gradient positions to 1) by interpolating the color that CSS would
//    show at exactly 100%.
//  - boxedRadialGeometry: a `radial-gradient(farthest-corner circle at P%)`
//    painted as a scaled+positioned background layer -> its world center/radius.

import { farthestCornerRadius } from "../lib/css";

/**
 * CSS `background-position: P%` -> pixel translate of the (scaled) layer.
 * With `background-size` making the image `scaledSize` px, a P% position aligns
 * the P% point of the image with the P% point of the box, i.e.
 * `offset = -(P/100) * (scaledSize - box)` (0% pins the left/top edges, 100%
 * pins the right/bottom edges; values outside [0,100] slide further and rely on
 * `background-repeat: repeat`, matched by TileMode.Repeat on the shader).
 */
export const bgPosTranslate = (posPct: number, scaledSize: number, box: number): number => {
  "worklet";
  return -(posPct / 100) * (scaledSize - box);
};

/**
 * `repeating-linear-gradient` period math. A CSS repeating gradient repeats the
 * interval between its first and last specified color-stop (period =
 * last - first). Returns the stop positions normalized 0..1 across that period
 * (so a Skia LinearGradient with `mode="repeat"`, `start` at the first stop and
 * `end` at the last stop reproduces the CSS tiling) plus the raw first/last
 * positions (needed to place `start`/`end` in pixels).
 */
export const normalizeRepeatingStops = (
  positions: number[],
): { positions: number[]; first: number; last: number } => {
  const first = positions[0];
  const last = positions[positions.length - 1];
  const span = last - first;
  return { positions: positions.map((p) => (p - first) / span), first, last };
};

const parseRgba = (color: string): [number, number, number, number] => {
  const c = color.trim();
  if (c[0] === "#") {
    let hex = c.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex
        .split("")
        .map((ch) => ch + ch)
        .join("");
    }
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), a];
  }
  const m = c.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(",").map((x) => parseFloat(x.trim()));
    return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
  }
  return [0, 0, 0, 1];
};

/**
 * Linear interpolation between two `rgb()/rgba()/#hex` colors at t in [0,1],
 * returned as `rgba(r, g, b, a)`. Used to re-anchor a CSS gradient stop placed
 * beyond 100% onto Skia's clamped 0..1 domain: interpolate between the last
 * in-range stop and the >100% stop at `t = (100 - inRangePct)/(overPct - inRangePct)`
 * to get the color CSS renders at exactly 100%, then place it at position 1.0.
 */
export const interpolateStopColor = (a: string, b: string, t: number): string => {
  const pa = parseRgba(a);
  const pb = parseRgba(b);
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const r = Math.round(lerp(pa[0], pb[0]));
  const g = Math.round(lerp(pa[1], pb[1]));
  const bch = Math.round(lerp(pa[2], pb[2]));
  const al = Math.round(lerp(pa[3], pb[3]) * 1000) / 1000;
  return `rgba(${r}, ${g}, ${bch}, ${al})`;
};

/**
 * A CSS `radial-gradient(farthest-corner circle at Px% Py%)` painted as a
 * `background-size: sx*100% sy*100%` layer at `background-position: bgX% bgY%`,
 * resolved to the equivalent Skia circular radial in world (card-box) space.
 * The gradient is computed inside its own `(sx*w) x (sy*h)` tile — center at
 * `(Px% , Py%)` of the tile, radius = distance to the tile's farthest corner —
 * then the tile is offset by `background-position` (bgPosTranslate). Skia's
 * default Clamp tile-mode extends the outer color, matching the CSS repeat of a
 * gradient whose edges are already the outer color. (All args in 0..100 for the
 * percentage inputs.)
 */
export const boxedRadialGeometry = (
  Px: number,
  Py: number,
  bgX: number,
  bgY: number,
  sx: number,
  sy: number,
  w: number,
  h: number,
): { cx: number; cy: number; r: number } => {
  "worklet";
  const tileW = sx * w;
  const tileH = sy * h;
  const cbx = (Px / 100) * tileW;
  const cby = (Py / 100) * tileH;
  return {
    cx: bgPosTranslate(bgX, tileW, w) + cbx,
    cy: bgPosTranslate(bgY, tileH, h) + cby,
    r: farthestCornerRadius(cbx, cby, tileW, tileH),
  };
};

/**
 * Same setup as `boxedRadialGeometry` but for a `radial-gradient(farthest-corner
 * ellipse at Px% Py%)` (gallery-holo's `.card__shine:after`). CSS sizes a
 * farthest-corner ellipse so its edge passes through the tile's farthest corner
 * while keeping the farthest-side aspect ratio: with farthest-side distances
 * `(fsx, fsy)` the radii are `(√2·fsx, √2·fsy)` (solving (fsx/rx)²+(fsy/ry)²=1
 * with rx/ry = fsx/fsy). Render as a circle of radius `rx` scaled by `ry/rx`
 * about the center. `r` returns `rx` (the 100% horizontal radius).
 */
export const boxedEllipseGeometry = (
  Px: number,
  Py: number,
  bgX: number,
  bgY: number,
  sx: number,
  sy: number,
  w: number,
  h: number,
): { cx: number; cy: number; rx: number; ry: number } => {
  "worklet";
  const tileW = sx * w;
  const tileH = sy * h;
  const cbx = (Px / 100) * tileW;
  const cby = (Py / 100) * tileH;
  const fsx = Math.max(cbx, tileW - cbx);
  const fsy = Math.max(cby, tileH - cby);
  return {
    cx: bgPosTranslate(bgX, tileW, w) + cbx,
    cy: bgPosTranslate(bgY, tileH, h) + cby,
    rx: Math.SQRT2 * fsx,
    ry: Math.SQRT2 * fsy,
  };
};
