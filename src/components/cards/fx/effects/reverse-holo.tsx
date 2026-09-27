// `reverse-holo` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/reverse-holo.css (matches any
// `[data-rarity$="reverse holo"]` card). Follows the locked ShineLayer pattern
// of regular-holo.tsx.
//
// Two isolation groups:
//   .card__shine  (color-dodge) — 3 background layers: pointer radial (top,
//     soft-light) over a -45deg linear (difference) over the per-card foil
//     texture (bottom). CSS `background-blend-mode: soft-light, difference`.
//   .card__glare  (overlay) — white pointer radial + a second radial :after
//     (normal blend).
//
// Masked vs non-masked split (reverse-holo.css "NO MASK" section):
//   masked    (card has a mask): shine draws the foil texture and is alpha-
//             masked (base.css:321); no shine clip; glare:after clips to the
//             normal --clip / --clip-stage / --clip-trainer (base.css:335-351).
//   non-masked: `--foil: none` (foil layer dropped) and the shine clips to
//             --clip-invert; glare:after clips to --clip (base), --clip-stage-
//             invert (stage) or nothing (trainer — `--clip-trainer-invert` is
//             an undefined custom property, so CSS resolves it to `none`).

import { Fragment, useMemo } from "react";
import { Group, Image, LinearGradient, RadialGradient, Rect } from "@shopify/react-native-skia";
import type { SkPath } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { EffectProps } from "./types";
import type { ClipVariant } from "./clipGeometry";
import { ShineLayer } from "./base";
import { CLIPS } from "./clips";
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
import { bgPosTranslate, interpolateStopColor } from "./cssBackground";

// --- shine backgrounds ---------------------------------------------------

// radial(circle at pointer, #fff 5%, #000 50%, #fff 80%) — reverse-holo.css:25-29.
const SHINE_RADIAL_COLORS = ["#ffffff", "#000000", "#ffffff"];
const SHINE_RADIAL_POS = [0.05, 0.5, 0.8];
// linear(-45deg, #000 15%, #fff, #000 85%) — reverse-holo.css:31-36.
const SHINE_LINEAR_COLORS = ["#000000", "#ffffff", "#000000"];
const SHINE_LINEAR_POS = [0.15, 0.5, 0.85];

// --- glare backgrounds ---------------------------------------------------

// .card__glare radial (reverse-holo.css:72-78).
const GLARE_COLORS = [hsl(0, 0, 100, 0.8), hsl(0, 0, 100, 0.5), hsl(0, 0, 0, 0.75)];
const GLARE_POS = [0.1, 0.2, 0.9];
// .card__glare:after radial (reverse-holo.css:89-95). Last stop is at 120%;
// re-anchor to 1.0 (the colour CSS shows at 100%, t=(100-20)/(120-20)=0.8).
const GLARE_AFTER_COLORS = [
  hsl(0, 0, 100),
  hsl(0, 0, 100, 0.5),
  interpolateStopColor(hsl(0, 0, 100, 0.5), hsl(0, 0, 0, 0.5), 0.8),
];
const GLARE_AFTER_POS = [0.1, 0.2, 1.0];

// --- filters -------------------------------------------------------------

const GLARE_M = concatColorMatrices(brightnessMatrix(0.7), contrastMatrix(1.5)); // reverse-holo.css:80
const GLARE_AFTER_M = contrastMatrix(1.5); // reverse-holo.css:97 (brightness(1) is identity)

// .card.lightning/darkness/metal override --foil-brightness (reverse-holo.css:50-52);
// default 0.55 (:19). Later rule wins if a card somehow has several.
const FOIL_BRIGHTNESS: Record<string, number> = { lightning: 0.7, darkness: 0.8, metal: 0.6 };
const foilBrightnessForTypes = (types: string[] = []): number => {
  let b = 0.55;
  for (const t of types) {
    const key = t.toLowerCase();
    if (key in FOIL_BRIGHTNESS) b = FOIL_BRIGHTNESS[key];
  }
  return b;
};

// .card__glare:after clip (base.css:335-351 + reverse-holo.css:121-127 NO MASK).
const glareAfterClip = (variant: ClipVariant, masked: boolean, w: number, h: number): SkPath | undefined => {
  if (variant === "stage") return masked ? CLIPS.clipStage(w, h) : CLIPS.clipStageInvert(w, h);
  if (variant === "trainer") return masked ? CLIPS.clipTrainer(w, h) : undefined; // --clip-trainer-invert === none
  return CLIPS.clip(w, h); // base subtype: --clip for both masked and non-masked
};

export function ReverseHolo({ u, foil, mask, glareClipVariant = "base", types }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;

  const shineFilter = useMemo(
    () =>
      concatColorMatrices(
        brightnessMatrix(foilBrightnessForTypes(types)),
        contrastMatrix(1.5),
        saturateMatrix(1),
      ),
    [types],
  );
  // shine clip: --clip-invert (non-masked, all subtypes) or none (masked — the
  // alpha mask does the shaping instead). reverse-holo.css:116-118.
  const shineClip = useMemo(() => (masked ? undefined : CLIPS.clipInvert(w, h)), [masked, w, h]);
  const glareClip = useMemo(
    () => glareAfterClip(glareClipVariant, masked, w, h),
    [glareClipVariant, masked, w, h],
  );

  // shine radial: `circle at pointer`, background-size 120% 120%, position
  // center. The gradient box is a 1.2w x 1.2h tile centred on the card
  // (top-left at -0.1w,-0.1h); the pointer% centres the circle inside it and
  // the radius is the farthest tile corner.
  const shineRadialCenter = useDerivedValue(() => ({
    x: 1.2 * pct(u.pointerX.value, w) - 0.1 * w,
    y: 1.2 * pct(u.pointerY.value, h) - 0.1 * h,
  }));
  const shineRadialRadius = useDerivedValue(() => {
    const cx = 1.2 * pct(u.pointerX.value, w) - 0.1 * w;
    const cy = 1.2 * pct(u.pointerY.value, h) - 0.1 * h;
    const dx = Math.max(cx + 0.1 * w, 1.1 * w - cx);
    const dy = Math.max(cy + 0.1 * h, 1.1 * h - cy);
    return Math.hypot(dx, dy);
  });

  // shine linear: -45deg over a 200% tile, animated position
  // calc(100%*from-left) calc(100%*from-top) (reverse-holo.css:41).
  const linBase = useMemo(() => linearGradientPoints(-45, 2 * w, 2 * h), [w, h]);
  const linStart = useDerivedValue(() => ({
    x: linBase.start.x + bgPosTranslate(100 * u.pointerFromLeft.value, 2 * w, w),
    y: linBase.start.y + bgPosTranslate(100 * u.pointerFromTop.value, 2 * h, h),
  }));
  const linEnd = useDerivedValue(() => ({
    x: linBase.end.x + bgPosTranslate(100 * u.pointerFromLeft.value, 2 * w, w),
    y: linBase.end.y + bgPosTranslate(100 * u.pointerFromTop.value, 2 * h, h),
  }));

  // opacity: calc(1.5*card-opacity - pointer-from-center) (reverse-holo.css:46), clamped.
  const shineOpacity = useDerivedValue(() =>
    Math.max(0, Math.min(1, 1.5 * u.cardOpacity.value - u.pointerFromCenter.value)),
  );

  // glare radials — farthest-corner circle at the pointer (shared geometry).
  const glareCenter = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const glareRadius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );

  return (
    <Fragment>
      {/* .card__shine isolation group (color-dodge). Masked cards alpha-mask
          the whole group and draw the foil as the bottom background layer. */}
      <ShineLayer
        w={w}
        h={h}
        opacity={shineOpacity}
        matrix={shineFilter}
        blendMode="colorDodge"
        clip={shineClip}
        mask={mask}
      >
        {masked && foil ? (
          <Fragment>
            {/* foil (bottom, normal) */}
            <Image image={foil} x={0} y={0} width={w} height={h} fit="cover" />
            {/* linear (difference over foil) */}
            <Group blendMode="difference">
              <Rect x={0} y={0} width={w} height={h}>
                <LinearGradient start={linStart} end={linEnd} colors={SHINE_LINEAR_COLORS} positions={SHINE_LINEAR_POS} />
              </Rect>
            </Group>
          </Fragment>
        ) : (
          // non-masked: --foil none, so the linear is the bottom layer (normal).
          <Rect x={0} y={0} width={w} height={h}>
            <LinearGradient start={linStart} end={linEnd} colors={SHINE_LINEAR_COLORS} positions={SHINE_LINEAR_POS} />
          </Rect>
        )}
        {/* radial (soft-light, top) */}
        <Group blendMode="softLight">
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient c={shineRadialCenter} r={shineRadialRadius} colors={SHINE_RADIAL_COLORS} positions={SHINE_RADIAL_POS} />
          </Rect>
        </Group>
      </ShineLayer>

      {/* .card__glare isolation group (overlay) at card-opacity + its normal-blend
          :after, clipped to the (non-inverted) glare clip. */}
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={GLARE_M} blendMode="overlay">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={glareCenter} r={glareRadius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
        <ShineLayer w={w} h={h} matrix={GLARE_AFTER_M} blendMode="srcOver" clip={glareClip}>
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient c={glareCenter} r={glareRadius} colors={GLARE_AFTER_COLORS} positions={GLARE_AFTER_POS} />
          </Rect>
        </ShineLayer>
      </ShineLayer>
    </Fragment>
  );
}
