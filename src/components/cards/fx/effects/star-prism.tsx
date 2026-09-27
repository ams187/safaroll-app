// `star-prism` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/star-prism.css
// (`[data-rarity="rare holo vstar"]`). Follows the locked ShineLayer pattern.
//
// .card__shine isolation group (color-dodge). Element bg + ::after share the
// four V-family layers (star-prism.css:45-71); painted bottom->top per
// `background-blend-mode: soft-light, hue, hard-light` (bottom radial normal):
//   dark pointer radial (normal) · diagonal streaks (hard-light) ·
//   sunpillar bands (hue) · foil (soft-light; NO-MASK: exclusion)
//   ::after  — same stack, sunpillar `after` rotation, blend exclusion
//   ::before — a pointer radial, blend hard-light, opacity .8; ALWAYS present
//     (z-index 2 -> drawn on top), foil-masked when masked.
//
// MASK: masked star-prism does not just use the foil mask — star-prism.css:8-30 adds a
// SECOND mask layer, a pointer radial fading alpha 0 -> .5, composited over the
// foil mask (mask-composite: add == source-over). We reproduce that by drawing
// the radial then the mask image into one alpha-mask group, applied to the
// element bg, ::after and ::before alike.
//
// .card__glare — a plain pointer radial, blend hard-light, opacity card*pfc*.75.

import { Fragment } from "react";
import type { ReactNode } from "react";
import { Group, Image, Mask, RadialGradient, Rect } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { EffectProps } from "./types";
import { ShineLayer } from "./base";
import { textureImages, useTexture } from "../lib/assets";
import {
  brightnessMatrix,
  concatColorMatrices,
  contrastMatrix,
  farthestCornerRadius,
  hsl,
  pct,
  saturateMatrix,
} from "../lib/css";
import { interpolateStopColor } from "./cssBackground";
import {
  DiagonalStreaks,
  SunpillarBands,
  useBoxedRadial,
  vFoil,
  VDARK_RADIAL_COLORS,
  VDARK_RADIAL_POS,
} from "./prismShared";

// ::before radial (star-prism.css:96) — 120% stop re-anchored (t=55/75).
const BEFORE_COLORS = [
  hsl(190, 7, 80, 0.75),
  hsl(260, 7, 50, 0.25),
  interpolateStopColor(hsl(260, 7, 50, 0.25), hsl(310, 7, 50), 55 / 75),
];
const BEFORE_POS = [0, 0.45, 1.0];

// Glare radial (star-prism.css:119-125) — 150% stop re-anchored (t=40/90).
const GLARE_COLORS = [hsl(195, 90, 90), hsl(300, 3, 60), interpolateStopColor(hsl(300, 3, 60), hsl(350, 0, 15), 40 / 90)];
const GLARE_POS = [0.05, 0.6, 1.0];

// Second mask layer (star-prism.css:12-19): white radial alpha 0 -> .5 @120%,
// re-anchored to 1.0 (t=100/120). Only alpha matters for the alpha-mask.
const MASK_RADIAL_COLORS = [hsl(0, 0, 100, 0), interpolateStopColor(hsl(0, 0, 100, 0), hsl(0, 0, 100, 0.5), 100 / 120)];
const MASK_RADIAL_POS = [0, 1.0];

export function StarPrism({ u, foil, mask }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;
  const ancient = useTexture(textureImages.ancient);

  const radial = useBoxedRadial(u, 2, 1, true); // element + ::after dark radial

  // Plain 100%-box pointer radial — used by ::before, the glare and the second
  // mask layer.
  const pointerCenter = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const pointerRadius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );

  const dPosElem = useDerivedValue(() => u.backgroundX.value);
  const dPosAfter = useDerivedValue(() => -u.backgroundX.value);

  // Filters (star-prism.css:77 / 156 element; :88 ::after; :117 / 169 glare).
  const elemFilter = useDerivedValue(() => {
    const pfc = u.pointerFromCenter.value;
    return masked
      ? concatColorMatrices(brightnessMatrix(pfc * 0.75 + 0.25), contrastMatrix(2), saturateMatrix(1.25))
      : concatColorMatrices(brightnessMatrix(pfc * 0.25 + 0.35), contrastMatrix(1.8), saturateMatrix(1.75));
  });
  const afterFilter = useDerivedValue(() => {
    const pfc = u.pointerFromCenter.value;
    return concatColorMatrices(brightnessMatrix(pfc * 0.75 + 0.5), contrastMatrix(1.5), saturateMatrix(1.5));
  });
  const glareOpacity = useDerivedValue(() => u.cardOpacity.value * (u.pointerFromCenter.value * 0.75));
  const GLARE_M = masked
    ? concatColorMatrices(brightnessMatrix(0.7), contrastMatrix(2))
    : concatColorMatrices(brightnessMatrix(0.55), contrastMatrix(2));

  // Foil: masked -> per-card foil cover, soft-light; NO-MASK -> ancient.png
  // @18%x15%, exclusion (same image/blend on element + ::after).
  const foilImg = masked ? foil : ancient;
  const foilNode = (
    <Group blendMode={masked ? "softLight" : "exclusion"}>{vFoil(foilImg, masked, w, h, 18, 15)}</Group>
  );

  const darkRadial = (
    <Rect x={0} y={0} width={w} height={h}>
      <RadialGradient c={radial.center} r={radial.radius} colors={VDARK_RADIAL_COLORS} positions={VDARK_RADIAL_POS} />
    </Rect>
  );

  // Composite alpha-mask: radial (drawn first) then the foil mask over it
  // (source-over == mask-composite add).
  const maskNode = mask ? (
    <Group>
      <Rect x={0} y={0} width={w} height={h}>
        <RadialGradient c={pointerCenter} r={pointerRadius} colors={MASK_RADIAL_COLORS} positions={MASK_RADIAL_POS} />
      </Rect>
      <Image image={mask} x={0} y={0} width={w} height={h} fit="cover" />
    </Group>
  ) : null;
  const withMask = (node: ReactNode): ReactNode =>
    masked && maskNode ? (
      <Mask mode="alpha" mask={maskNode}>
        {node}
      </Mask>
    ) : (
      node
    );

  const bands = (rot: "identity" | "after", dPos: typeof dPosElem, diagWmul: number, sunHmul: number) => (
    <Fragment>
      {darkRadial}
      <Group blendMode="hardLight">
        <DiagonalStreaks u={u} posX={dPos} tileWmul={diagWmul} />
      </Group>
      <Group blendMode="hue">
        <SunpillarBands u={u} rot={rot} space={5} tileHmul={sunHmul} />
      </Group>
      {foilNode}
    </Fragment>
  );

  return (
    <Fragment>
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={elemFilter} blendMode="colorDodge">
        {withMask(bands("identity", dPosElem, 3, 7))}

        {/* ::after — exclusion, sunpillar `after` rotation, composite-masked */}
        <ShineLayer w={w} h={h} matrix={afterFilter} blendMode="exclusion">
          {withMask(bands("after", dPosAfter, 1.95, 4))}
        </ShineLayer>

        {/* ::before — pointer radial, hard-light, opacity .8, drawn on top */}
        <ShineLayer w={w} h={h} opacity={0.8} matrix={brightnessMatrix(1)} blendMode="hardLight">
          {withMask(
            <Rect x={0} y={0} width={w} height={h}>
              <RadialGradient c={pointerCenter} r={pointerRadius} colors={BEFORE_COLORS} positions={BEFORE_POS} />
            </Rect>,
          )}
        </ShineLayer>
      </ShineLayer>

      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="hardLight">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={pointerCenter} r={pointerRadius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
