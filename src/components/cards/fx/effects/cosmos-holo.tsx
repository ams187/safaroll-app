// `cosmos-holo` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/cosmos-holo.css
// (`[data-rarity="rare holo cosmos"]`). Follows the locked ShineLayer pattern
// of regular-holo.tsx.
//
// .card__shine isolation group (color-dodge) with two pseudo-elements, drawn
// bottom -> top:
//   .card__shine        — pointer radial (bottom) · rainbow bands (multiply) ·
//                         cosmos-bottom texture (color-burn, top)
//   .card__shine:before — rainbow bands (bottom) · cosmos-middle-trans (lighten);
//                         group blend overlay
//   .card__shine:after  — rainbow bands (bottom) · cosmos-top-trans (multiply);
//                         group blend multiply
// The three band layers share one 82deg repeating gradient (period = 4%..48%
// of the 400% x 900% tile, 12 palindromic stops) at different animated offsets.
//
// The cosmos textures are cover-scaled, offset by the per-card `--cosmosbg`
// pixel seed (u.cosmosX/Y) and tiled (background-repeat: repeat). Note: the CSS
// uses cosmos-middle-trans.png (static) — cosmos-middle.gif is never referenced,
// so nothing is animated on web either.
//
// .card__glare isolation group (overlay) + a soft-light :after; the :after
// keeps its own CSS opacity (1 - from-top*.75, distinct from the group's), so
// unlike a default pseudo it does carry an opacity here.

import { Fragment, useMemo } from "react";
import { Group, ImageShader, LinearGradient, RadialGradient, Rect } from "@shopify/react-native-skia";
import type { SkImage } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { EffectProps } from "./types";
import type { ClipVariant } from "./clipGeometry";
import { ShineLayer } from "./base";
import { CLIPS } from "./clips";
import { textureImages, useTexture } from "../lib/assets";
import {
  brightnessMatrix,
  concatColorMatrices,
  contrastMatrix,
  farthestCornerRadius,
  hsl,
  linearGradientPoints,
  pct,
  saturateMatrix,
} from "../lib/css";
import { bgPosTranslate, interpolateStopColor, normalizeRepeatingStops } from "./cssBackground";

// --- rainbow bands (repeating-linear-gradient 82deg, --space 4%) ----------
// 12 palindromic stops at space*1..12 (cosmos-holo.css:36-48). The stops are
// evenly spaced, so the normalized period is 12 equal steps.
const BAND_COLORS = [
  hsl(53, 65, 60), hsl(93, 56, 50), hsl(176, 54, 49), hsl(228, 59, 55), hsl(283, 60, 55), hsl(326, 59, 51),
  hsl(326, 59, 51), hsl(283, 60, 55), hsl(228, 59, 55), hsl(176, 54, 49), hsl(93, 56, 50), hsl(53, 65, 60),
];
const BAND = normalizeRepeatingStops([4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48]);

// --- shine / glare radial colours ----------------------------------------
// .card__shine radial (cosmos-holo.css:50-56). 130% stop re-anchored to 1.0
// (colour CSS shows at 100%, t=(100-40)/(130-40)).
const SHINE_RADIAL_COLORS = [
  hsl(180, 100, 89, 0.5),
  hsl(180, 14, 57, 0.3),
  interpolateStopColor(hsl(180, 14, 57, 0.3), hsl(0, 0, 0), 60 / 90),
];
const SHINE_RADIAL_POS = [0.05, 0.4, 1.0];

// .card__glare radial (cosmos-holo.css:167-172). 150% stop re-anchored to 1.0.
const GLARE_COLORS = [
  hsl(204, 100, 95, 0.8),
  interpolateStopColor(hsl(204, 100, 95, 0.8), hsl(250, 15, 20), 95 / 145),
];
const GLARE_POS = [0.05, 1.0];

// .card__glare:after radial (cosmos-holo.css:183-188).
const GLARE_AFTER_COLORS = [hsl(280, 100, 96), hsl(0, 0, 10)];
const GLARE_AFTER_POS = [0.05, 0.6];

// --- filters -------------------------------------------------------------
const SHINE_M = concatColorMatrices(brightnessMatrix(1), contrastMatrix(1), saturateMatrix(0.8)); // :69
const PSEUDO_M = concatColorMatrices(brightnessMatrix(1.25), contrastMatrix(1.75), saturateMatrix(0.8)); // :110,:150
const GLARE_M = concatColorMatrices(brightnessMatrix(0.75), contrastMatrix(2), saturateMatrix(2)); // :173
const GLARE_AFTER_M = concatColorMatrices(brightnessMatrix(0.75), contrastMatrix(2.5), saturateMatrix(2)); // :190

const clipPathFor = (variant: ClipVariant, w: number, h: number) =>
  (variant === "stage" ? CLIPS.clipStage : variant === "trainer" ? CLIPS.clipTrainer : CLIPS.clip)(w, h);

/** One cosmos texture: cover-scaled, offset by the `--cosmosbg` px seed, tiled. */
function CosmosTexture({
  img,
  w,
  h,
  cosmosX,
  cosmosY,
}: {
  img: SkImage;
  w: number;
  h: number;
  cosmosX: number;
  cosmosY: number;
}) {
  const scale = Math.max(w / img.width(), h / img.height());
  return (
    <Rect x={0} y={0} width={w} height={h}>
      <ImageShader
        image={img}
        fit="none"
        tx="repeat"
        ty="repeat"
        transform={[{ translateX: cosmosX }, { translateY: cosmosY }, { scale }]}
      />
    </Rect>
  );
}

export function CosmosHolo({ u, mask, clipVariant = "base", glareClipVariant = "base" }: EffectProps) {
  const { w, h } = u;

  const cosmosBottom = useTexture(textureImages["cosmos-bottom"]);
  const cosmosMiddle = useTexture(textureImages["cosmos-middle-trans"]);
  const cosmosTop = useTexture(textureImages["cosmos-top-trans"]);

  const shineClip = useMemo(() => clipPathFor(clipVariant, w, h), [clipVariant, w, h]);
  const glareClip = useMemo(() => clipPathFor(glareClipVariant, w, h), [glareClipVariant, w, h]);

  // Band gradient: 82deg line across the 4w x 9h tile; the repeating period runs
  // from the 4% stop to the 48% stop of that line, then TileMode.Repeat tiles it.
  const bandBase = useMemo(() => linearGradientPoints(82, 4 * w, 9 * h), [w, h]);
  const bandFirst = useMemo(
    () => ({
      x: bandBase.start.x + (BAND.first / 100) * (bandBase.end.x - bandBase.start.x),
      y: bandBase.start.y + (BAND.first / 100) * (bandBase.end.y - bandBase.start.y),
    }),
    [bandBase],
  );
  const bandLast = useMemo(
    () => ({
      x: bandBase.start.x + (BAND.last / 100) * (bandBase.end.x - bandBase.start.x),
      y: bandBase.start.y + (BAND.last / 100) * (bandBase.end.y - bandBase.start.y),
    }),
    [bandBase],
  );

  // Per-layer animated band offsets (cosmos-holo.css:63-65, 104-106, 143-146):
  // shine 10%+80%, :before 15%+70%, :after 20%+60% of from-left / from-top.
  const shineBandStart = useDerivedValue(() => ({
    x: bandFirst.x + bgPosTranslate(10 + u.pointerFromLeft.value * 80, 4 * w, w),
    y: bandFirst.y + bgPosTranslate(10 + u.pointerFromTop.value * 80, 9 * h, h),
  }));
  const shineBandEnd = useDerivedValue(() => ({
    x: bandLast.x + bgPosTranslate(10 + u.pointerFromLeft.value * 80, 4 * w, w),
    y: bandLast.y + bgPosTranslate(10 + u.pointerFromTop.value * 80, 9 * h, h),
  }));
  const beforeBandStart = useDerivedValue(() => ({
    x: bandFirst.x + bgPosTranslate(15 + u.pointerFromLeft.value * 70, 4 * w, w),
    y: bandFirst.y + bgPosTranslate(15 + u.pointerFromTop.value * 70, 9 * h, h),
  }));
  const beforeBandEnd = useDerivedValue(() => ({
    x: bandLast.x + bgPosTranslate(15 + u.pointerFromLeft.value * 70, 4 * w, w),
    y: bandLast.y + bgPosTranslate(15 + u.pointerFromTop.value * 70, 9 * h, h),
  }));
  const afterBandStart = useDerivedValue(() => ({
    x: bandFirst.x + bgPosTranslate(20 + u.pointerFromLeft.value * 60, 4 * w, w),
    y: bandFirst.y + bgPosTranslate(20 + u.pointerFromTop.value * 60, 9 * h, h),
  }));
  const afterBandEnd = useDerivedValue(() => ({
    x: bandLast.x + bgPosTranslate(20 + u.pointerFromLeft.value * 60, 4 * w, w),
    y: bandLast.y + bgPosTranslate(20 + u.pointerFromTop.value * 60, 9 * h, h),
  }));

  // All cosmos radials are farthest-corner circles at the pointer.
  const center = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const radius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );

  // .card__glare opacity card*(0.25+from-center); :after opacity 1-from-top*.75.
  // opacity is clamped to [0,1] by CSS; cardOpacity*(0.25+from-center) reaches
  // 1.25 at a fully-lit corner pointer, so clamp it here too.
  const glareOpacity = useDerivedValue(() =>
    Math.max(0, Math.min(1, u.cardOpacity.value * (0.25 + u.pointerFromCenter.value))),
  );
  const glareAfterOpacity = useDerivedValue(() => Math.max(0, Math.min(1, 1 - u.pointerFromTop.value * 0.75)));

  const texProps = { w, h, cosmosX: u.cosmosX, cosmosY: u.cosmosY };

  return (
    <Fragment>
      {/* .card__shine group (color-dodge), alpha-masked (card is masked). */}
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={SHINE_M} blendMode="colorDodge" clip={shineClip} mask={mask}>
        {/* element bg: radial (bottom) · bands (multiply) · cosmos-bottom (color-burn) */}
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={center} r={radius} colors={SHINE_RADIAL_COLORS} positions={SHINE_RADIAL_POS} />
        </Rect>
        <Group blendMode="multiply">
          <Rect x={0} y={0} width={w} height={h}>
            <LinearGradient start={shineBandStart} end={shineBandEnd} colors={BAND_COLORS} positions={BAND.positions} mode="repeat" />
          </Rect>
        </Group>
        {cosmosBottom ? (
          <Group blendMode="colorBurn">
            <CosmosTexture img={cosmosBottom} {...texProps} />
          </Group>
        ) : null}

        {/* :before (overlay): bands (bottom) · cosmos-middle (lighten) */}
        <ShineLayer w={w} h={h} matrix={PSEUDO_M} blendMode="overlay">
          <Rect x={0} y={0} width={w} height={h}>
            <LinearGradient start={beforeBandStart} end={beforeBandEnd} colors={BAND_COLORS} positions={BAND.positions} mode="repeat" />
          </Rect>
          {cosmosMiddle ? (
            <Group blendMode="lighten">
              <CosmosTexture img={cosmosMiddle} {...texProps} />
            </Group>
          ) : null}
        </ShineLayer>

        {/* :after (multiply): bands (bottom) · cosmos-top (multiply) */}
        <ShineLayer w={w} h={h} matrix={PSEUDO_M} blendMode="multiply">
          <Rect x={0} y={0} width={w} height={h}>
            <LinearGradient start={afterBandStart} end={afterBandEnd} colors={BAND_COLORS} positions={BAND.positions} mode="repeat" />
          </Rect>
          {cosmosTop ? (
            <Group blendMode="multiply">
              <CosmosTexture img={cosmosTop} {...texProps} />
            </Group>
          ) : null}
        </ShineLayer>
      </ShineLayer>

      {/* .card__glare group (overlay) + soft-light :after (own opacity), clipped. */}
      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="overlay">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={center} r={radius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
        <ShineLayer w={w} h={h} opacity={glareAfterOpacity} matrix={GLARE_AFTER_M} blendMode="softLight" clip={glareClip}>
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient c={center} r={radius} colors={GLARE_AFTER_COLORS} positions={GLARE_AFTER_POS} />
          </Rect>
        </ShineLayer>
      </ShineLayer>
    </Fragment>
  );
}
