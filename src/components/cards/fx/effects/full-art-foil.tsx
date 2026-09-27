// `full-art-foil` effect — the "rare ultra" full-art *supporter* (trainer)
// card. Its SHINE geometry is NOT in full-art-foil.css: that card matches
// prism-full-art.css's `[data-subtypes*="supporter"][data-rarity="rare ultra"]`
// selectors (prism-full-art.css:19-143), which supply the whole background stack,
// ::after, ::before and glare radial. full-art-foil.css (loaded AFTER
// prism-full-art.css, index.html:45 vs :48) only OVERRIDES filters, the ::before
// gradient/blend/opacity, the glare box/blend/filter, and the NO-MASK foil
// (foilbg.png @20%, blend color-burn). So this module = prism-full-art.tsx's
// shared building blocks (prismShared) with those trainer overrides applied.
//
// Cascade winners (dataset card swsh6-196 is MASKED; NO-MASK branch modeled for
// completeness / async-load transient):
//   element bg  — prism-full-art.css:19-69 stack (foil · sunpillar hue · streaks
//                 hard-light · dark radial); blend soft-light,hue,hard-light
//                 (MASKED) / color-burn,hue,hard-light + foilbg@20% (NO-MASK,
//                 full-art-foil.css:83-93)
//   ::after     — same stack, `after` sunpillar rotation, blend exclusion
//   ::before    — white pointer radial 0%→transparent 80%, blend SCREEN,
//                 opacity .5 (full-art-foil.css:30-42); z-index 1 (on top);
//                 unmasked (prism-full-art.css:95); shown in BOTH branches (no
//                 supporter display:none rule, unlike the pokémon ::before)
//   glare       — prism-full-art.css:127-133 radial in a 170%×170% box, blend
//                 MULTIPLY, filter brightness1.5 contrast1.4 (full-art-foil.css:59-66)
// Filters (full-art-foil.css:18-28 MASKED; :83-91 NO-MASK, higher specificity):
//   element MASKED  brightness(pfc*.05+.8) contrast1.75 saturate1.2
//   element NO-MASK brightness(pfc*.05+.6) contrast1.5  saturate1.2
//   ::after MASKED  brightness(pfc*.4 +.85) contrast2    saturate.5
//   ::after NO-MASK brightness(pfc*.05+.6) contrast1.5  saturate1.2  (:83 hits ::after too)

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

// ::before white radial (full-art-foil.css:32-37): white 0% -> transparent 80%.
const BEFORE_COLORS = [hsl(0, 0, 100), hsl(0, 0, 0, 0)];
const BEFORE_POS = [0, 0.8];

// Glare radial (prism-full-art.css:127-133) — 150% stop re-anchored (t=40/90).
const GLARE_COLORS = [hsl(0, 0, 75), hsl(200, 5, 35), interpolateStopColor(hsl(200, 5, 35), hsl(320, 40, 10), 40 / 90)];
const GLARE_POS = [0.05, 0.6, 1.0];
// Glare filter (full-art-foil.css:63): brightness1.5 contrast1.4 saturate1.
const GLARE_M = concatColorMatrices(brightnessMatrix(1.5), contrastMatrix(1.4), saturateMatrix(1));

export function FullArtFoil({ u, foil, mask }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;
  const foilbg = useTexture(textureImages.foilbg);

  const radial = useBoxedRadial(u, 2, 1, true); // element + ::after dark radial
  const glare = useBoxedRadial(u, 1.7, 1.7, false); // 170%×170% box, centred

  // ::before plain 100%-box pointer radial; glare opacity is card-opacity*.75.
  const pointerCenter = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const pointerRadius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );
  const glareOpacity = useDerivedValue(() => u.cardOpacity.value * 0.75);

  // Diagonal streak position calc(bg-x + bg-y*0.2), negated on ::after.
  const dPosElem = useDerivedValue(() => u.backgroundX.value + u.backgroundY.value * 0.2);
  const dPosAfter = useDerivedValue(() => -(u.backgroundX.value + u.backgroundY.value * 0.2));

  const elemFilter = useDerivedValue(() => {
    const pfc = u.pointerFromCenter.value;
    return masked
      ? concatColorMatrices(brightnessMatrix(pfc * 0.05 + 0.8), contrastMatrix(1.75), saturateMatrix(1.2))
      : concatColorMatrices(brightnessMatrix(pfc * 0.05 + 0.6), contrastMatrix(1.5), saturateMatrix(1.2));
  });
  const afterFilter = useDerivedValue(() => {
    const pfc = u.pointerFromCenter.value;
    return masked
      ? concatColorMatrices(brightnessMatrix(pfc * 0.4 + 0.85), contrastMatrix(2), saturateMatrix(0.5))
      : concatColorMatrices(brightnessMatrix(pfc * 0.05 + 0.6), contrastMatrix(1.5), saturateMatrix(1.2));
  });

  // Foil: masked -> per-card foil cover, soft-light; NO-MASK -> foilbg @20%,
  // color-burn (full-art-foil.css:90; same image/blend on element + ::after).
  const foilImg = masked ? foil : foilbg;
  const foilNode = (
    <Group blendMode={masked ? "softLight" : "colorBurn"}>{vFoil(foilImg, masked, w, h, 20, null)}</Group>
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

        {/* ::before — white pointer radial, SCREEN, opacity .5; unmasked, z-index 1
            (drawn last, on top). Shown in both masked and non-masked. */}
        <ShineLayer w={w} h={h} opacity={0.5} matrix={brightnessMatrix(1)} blendMode="screen">
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient c={pointerCenter} r={pointerRadius} colors={BEFORE_COLORS} positions={BEFORE_POS} />
          </Rect>
        </ShineLayer>
      </ShineLayer>

      {/* .card__glare — prism-full-art radial in a 170%×170% box, blend MULTIPLY */}
      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="multiply">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={glare.center} r={glare.radius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
