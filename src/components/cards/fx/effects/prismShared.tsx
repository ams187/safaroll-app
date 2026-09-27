// Skia render helpers shared by the four V-family effect modules
// (prism-foil / prism-full-art / max-prism / star-prism). The pure colour/stop data comes
// from sunpillar.ts; the geometry helpers from cssBackground.ts + lib/css.ts.
// Kept separate from sunpillar.ts because these import Skia/reanimated and so
// cannot be loaded under vitest.

import type { ReactNode } from "react";
import { Image, ImageShader, LinearGradient, Rect } from "@shopify/react-native-skia";
import type { SkImage } from "@shopify/react-native-skia";
import type { SharedValue } from "react-native-reanimated";
import { useDerivedValue } from "react-native-reanimated";

import type { CardUniforms } from "./types";
import { hsl, linearGradientPoints } from "../lib/css";
import { bgPosTranslate, boxedRadialGeometry, interpolateStopColor } from "./cssBackground";
import {
  DIAGONAL_COLORS,
  DIAGONAL_PERIOD,
  DIAGONAL_STOPS,
  SUN_STOPS,
  sunpillarColors,
  type SunRotation,
} from "./sunpillar";

/**
 * A `repeating-linear-gradient(angleDeg, ...)` layer tiled at
 * `background-size: tileWmul*100% tileHmul*100%` and shifted by
 * `background-position: posX% posY%`. `firstPct`/`lastPct` are the raw first
 * and last CSS stop percentages (they place one repeat period along the
 * gradient line); `stops` are those same stops normalized 0..1. Skia
 * `mode="repeat"` tiles the period. Only used for the V-family bands.
 */
export function RepeatingBands({
  u,
  angleDeg,
  colors,
  stops,
  firstPct,
  lastPct,
  tileWmul,
  tileHmul,
  posX,
  posY,
}: {
  u: CardUniforms;
  angleDeg: number;
  colors: string[];
  stops: number[];
  firstPct: number;
  lastPct: number;
  tileWmul: number;
  tileHmul: number;
  posX: SharedValue<number>;
  posY: SharedValue<number>;
}) {
  const { w, h } = u;
  const tileW = tileWmul * w;
  const tileH = tileHmul * h;
  const base = linearGradientPoints(angleDeg, tileW, tileH);
  const dx = base.end.x - base.start.x;
  const dy = base.end.y - base.start.y;
  const p0 = { x: base.start.x + (firstPct / 100) * dx, y: base.start.y + (firstPct / 100) * dy };
  const p1 = { x: base.start.x + (lastPct / 100) * dx, y: base.start.y + (lastPct / 100) * dy };
  const start = useDerivedValue(() => ({
    x: p0.x + bgPosTranslate(posX.value, tileW, w),
    y: p0.y + bgPosTranslate(posY.value, tileH, h),
  }));
  const end = useDerivedValue(() => ({
    x: p1.x + bgPosTranslate(posX.value, tileW, w),
    y: p1.y + bgPosTranslate(posY.value, tileH, h),
  }));
  return (
    <Rect x={0} y={0} width={w} height={h}>
      <LinearGradient start={start} end={end} colors={colors} positions={stops} mode="repeat" />
    </Rect>
  );
}

/**
 * The sunpillar bands: a 0deg (vertical, "to top") repeating gradient, size
 * `200% (tileHmul*100%)`, position `0% var(--background-y)`. Only Y shifts (X is
 * a no-op for a vertical gradient), so this is a thin specialization of the
 * general geometry rather than a RepeatingBands call (which would need a zero
 * posX SharedValue).
 */
export function SunpillarBands({
  u,
  rot,
  space,
  tileHmul,
}: {
  u: CardUniforms;
  rot: SunRotation;
  space: number;
  tileHmul: number;
}) {
  const { w, h } = u;
  const tileH = tileHmul * h;
  const base = linearGradientPoints(0, 2 * w, tileH);
  const dy = base.end.y - base.start.y;
  const p0y = base.start.y + (space / 100) * dy;
  const p1y = base.start.y + ((space * 7) / 100) * dy;
  const start = useDerivedValue(() => ({ x: base.start.x, y: p0y + bgPosTranslate(u.backgroundY.value, tileH, h) }));
  const end = useDerivedValue(() => ({ x: base.start.x, y: p1y + bgPosTranslate(u.backgroundY.value, tileH, h) }));
  return (
    <Rect x={0} y={0} width={w} height={h}>
      <LinearGradient start={start} end={end} colors={sunpillarColors(rot)} positions={SUN_STOPS} mode="repeat" />
    </Rect>
  );
}

/**
 * The shared 133deg cyan streaks. Size `tileWmul*100% 100%` — height 100% means
 * background-position Y is always a no-op, so only `posX` (background-x, or its
 * negation on ::after) shifts the pattern.
 */
export function DiagonalStreaks({
  u,
  posX,
  tileWmul,
}: {
  u: CardUniforms;
  posX: SharedValue<number>;
  tileWmul: number;
}) {
  const { w, h } = u;
  const tileW = tileWmul * w;
  const base = linearGradientPoints(133, tileW, h);
  const p1 = {
    x: base.start.x + DIAGONAL_PERIOD * (base.end.x - base.start.x),
    y: base.start.y + DIAGONAL_PERIOD * (base.end.y - base.start.y),
  };
  const start = useDerivedValue(() => ({ x: base.start.x + bgPosTranslate(posX.value, tileW, w), y: base.start.y }));
  const end = useDerivedValue(() => ({ x: p1.x + bgPosTranslate(posX.value, tileW, w), y: p1.y }));
  return (
    <Rect x={0} y={0} width={w} height={h}>
      <LinearGradient start={start} end={end} colors={DIAGONAL_COLORS} positions={DIAGONAL_STOPS} mode="repeat" />
    </Rect>
  );
}

/**
 * A `radial-gradient(farthest-corner circle at pointer)` painted in a scaled
 * `sx*100% sy*100%` box. `followBg` positions the box at `background-x/-y`
 * (the shine radials); otherwise it is centred (`background-position: center`,
 * used by prism-full-art's glare).
 */
export function useBoxedRadial(u: CardUniforms, sx: number, sy: number, followBg: boolean) {
  const geom = useDerivedValue(() =>
    boxedRadialGeometry(
      u.pointerX.value,
      u.pointerY.value,
      followBg ? u.backgroundX.value : 50,
      followBg ? u.backgroundY.value : 50,
      sx,
      sy,
      u.w,
      u.h,
    ),
  );
  const center = useDerivedValue(() => ({ x: geom.value.cx, y: geom.value.cy }));
  const radius = useDerivedValue(() => geom.value.r);
  return { center, radius };
}

/**
 * The `--foil` background layer. Masked cards cover-fit the per-card foil
 * (`background-size: cover`); non-masked cards tile a `--foil` texture at a
 * percentage size (`sizeY == null` = single-value `background-size: sizeX%`,
 * i.e. auto height preserving aspect), always centred.
 */
export function vFoil(
  img: SkImage | null | undefined,
  masked: boolean,
  w: number,
  h: number,
  sizeX: number,
  sizeY: number | null,
): ReactNode {
  if (!img) return null;
  if (masked) return <Image image={img} x={0} y={0} width={w} height={h} fit="cover" />;
  const tileW = (sizeX / 100) * w;
  const scaleX = tileW / img.width();
  const tileH = sizeY == null ? img.height() * scaleX : (sizeY / 100) * h;
  const scaleY = sizeY == null ? scaleX : tileH / img.height();
  return (
    <Rect x={0} y={0} width={w} height={h}>
      <ImageShader
        image={img}
        fit="none"
        tx="repeat"
        ty="repeat"
        transform={[
          { translateX: bgPosTranslate(50, tileW, w) },
          { translateY: bgPosTranslate(50, tileH, h) },
          { scaleX },
          { scaleY },
        ]}
      />
    </Rect>
  );
}

// The dark pointer radial shared by prism-foil / prism-full-art / star-prism element +
// ::after (prism-foil.css:55-61 etc): hsla(0,0%,0%,.1) 12%, .15 20%, .25 120%.
// 120% stop re-anchored to 1.0 at t = (100-20)/(120-20) = 0.8.
export const VDARK_RADIAL_COLORS = [
  hsl(0, 0, 0, 0.1),
  hsl(0, 0, 0, 0.15),
  interpolateStopColor(hsl(0, 0, 0, 0.15), hsl(0, 0, 0, 0.25), 0.8),
];
export const VDARK_RADIAL_POS = [0.12, 0.2, 1.0];
