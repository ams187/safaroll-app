// `shimmer-prism` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/shimmer-prism.css
// (`[data-rarity="rare shiny v"]`, the "Shiny V (Ultra Rare)"). Follows the
// locked ShineLayer pattern of regular-holo.tsx / prism-full-art.tsx.
//
// The `.card__shine` element + ::after + ::before are byte-identical to
// prism-full-art's shine (same layers/sizes/positions/blends/filters, masked AND
// NO-MASK — including ::before being MASKED-ONLY and the NO-MASK ::after
// brightness(from-center*.5+.8) contrast1.6 saturate1.4). Painted bottom->top
// per `background-blend-mode: soft-light, hue, hard-light` (bottom radial normal):
//   dark pointer radial (normal) · diagonal streaks (hard-light) ·
//   sunpillar bands (hue) · foil (soft-light; NO-MASK: exclusion)
//   ::after — same stack, sunpillar `after` rotation, blend exclusion
//   ::before — white pointer radial, overlay, opacity .75; MASKED ONLY
//     (shimmer-prism.css:169-172 opts it out for NO-MASK), itself unmasked.
// Masked cards alpha-mask element bg + ::after to the foil (::before escapes);
// NO-MASK swaps the foil for illusion.png @33% and shifts filters. No shine
// clip-path (only shiny-rare has one).
//
// .card__glare — a pointer radial in a 120%x140% box (shimmer-prism.css:117-134),
// blend darken, opacity card*from-center*.75 (150% stop re-anchored).

import { Fragment } from "react";
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

// ::before white radial (shimmer-prism.css:92-95): white 0% -> transparent 40%.
const BEFORE_COLORS = [hsl(0, 0, 100), "rgba(0, 0, 0, 0)"];
const BEFORE_POS = [0, 0.4];

// Glare radial (shimmer-prism.css:120-124): hsl(0,0%,90%) 5% · hsl(200,5%,45%) 80% ·
// hsl(320,40%,10%) 150%. 150% stop re-anchored to 1.0 at t=(100-80)/(150-80)=2/7.
const GLARE_COLORS = [
  hsl(0, 0, 90),
  hsl(200, 5, 45),
  interpolateStopColor(hsl(200, 5, 45), hsl(320, 40, 10), 2 / 7),
];
const GLARE_POS = [0.05, 0.8, 1.0];
const GLARE_M = concatColorMatrices(brightnessMatrix(0.88), contrastMatrix(2.25), saturateMatrix(0.7)); // :130

export function ShimmerPrism({ u, foil, mask }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;
  const illusion = useTexture(textureImages.illusion);

  const radial = useBoxedRadial(u, 2, 1, true); // element + ::after dark radial (200% 100%)
  const glare = useBoxedRadial(u, 1.2, 1.4, false); // glare box 120%x140%, centred

  // Diagonal streak position calc(bg-x + bg-y*0.2), negated on ::after.
  const dPosElem = useDerivedValue(() => u.backgroundX.value + u.backgroundY.value * 0.2);
  const dPosAfter = useDerivedValue(() => -(u.backgroundX.value + u.backgroundY.value * 0.2));

  // ::before plain 100%-box pointer radial.
  const pointerCenter = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const pointerRadius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );
  const glareOpacity = useDerivedValue(() => u.cardOpacity.value * u.pointerFromCenter.value * 0.75);

  // Animated filters — masked (shimmer-prism.css:63, 79) vs NO-MASK (:165, :175).
  const elemFilter = useDerivedValue(() => {
    const pfc = u.pointerFromCenter.value;
    return masked
      ? concatColorMatrices(brightnessMatrix(pfc * 0.4 + 0.4), contrastMatrix(1.4), saturateMatrix(2.25))
      : concatColorMatrices(brightnessMatrix(pfc * 0.3 + 0.35), contrastMatrix(2), saturateMatrix(1.5));
  });
  const afterFilter = useDerivedValue(() => {
    const pfc = u.pointerFromCenter.value;
    return masked
      ? concatColorMatrices(brightnessMatrix(pfc * 0.4 + 0.8), contrastMatrix(1.5), saturateMatrix(1.25))
      : concatColorMatrices(brightnessMatrix(pfc * 0.5 + 0.8), contrastMatrix(1.6), saturateMatrix(1.4));
  });

  // Foil: masked -> per-card cover, soft-light; NO-MASK -> illusion @33%, exclusion.
  const foilImg = masked ? foil : illusion;
  const foilNode = (
    <Group blendMode={masked ? "softLight" : "exclusion"}>{vFoil(foilImg, masked, w, h, 33, null)}</Group>
  );

  const darkRadial = (
    <Rect x={0} y={0} width={w} height={h}>
      <RadialGradient c={radial.center} r={radial.radius} colors={VDARK_RADIAL_COLORS} positions={VDARK_RADIAL_POS} />
    </Rect>
  );

  const elementBg = (
    <Fragment>
      {darkRadial}
      <Group blendMode="hardLight">
        <DiagonalStreaks u={u} posX={dPosElem} tileWmul={3} />
      </Group>
      <Group blendMode="hue">
        <SunpillarBands u={u} rot="identity" space={5} tileHmul={7} />
      </Group>
      {foilNode}
    </Fragment>
  );

  const afterBg = (
    <Fragment>
      {darkRadial}
      <Group blendMode="hardLight">
        <DiagonalStreaks u={u} posX={dPosAfter} tileWmul={1.95} />
      </Group>
      <Group blendMode="hue">
        <SunpillarBands u={u} rot="after" space={5} tileHmul={4} />
      </Group>
      {foilNode}
    </Fragment>
  );

  return (
    <Fragment>
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={elemFilter} blendMode="colorDodge">
        {masked && mask ? (
          <Mask mode="alpha" mask={<Image image={mask} x={0} y={0} width={w} height={h} fit="cover" />}>
            {elementBg}
          </Mask>
        ) : (
          elementBg
        )}

        {/* ::after — exclusion, foil-masked when masked */}
        <ShineLayer w={w} h={h} matrix={afterFilter} blendMode="exclusion" mask={masked ? mask : undefined}>
          {afterBg}
        </ShineLayer>

        {/* ::before — white pointer radial, overlay, opacity .75; masked only,
            itself unmasked. Drawn last (z-index 1 > ::after). */}
        {masked ? (
          <ShineLayer w={w} h={h} opacity={0.75} matrix={brightnessMatrix(1)} blendMode="overlay">
            <Rect x={0} y={0} width={w} height={h}>
              <RadialGradient c={pointerCenter} r={pointerRadius} colors={BEFORE_COLORS} positions={BEFORE_POS} />
            </Rect>
          </ShineLayer>
        ) : null}
      </ShineLayer>

      {/* .card__glare — 120%x140% boxed pointer radial, darken, opacity card*fc*.75 */}
      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="darken">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={glare.center} r={glare.radius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
