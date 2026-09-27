// `shiny-rare` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/shiny-rare.css
// (`[data-rarity="rare shiny"]`, the "Shiny Rare (Holo)"). Follows the locked
// ShineLayer pattern of regular-holo.tsx / prism-full-art.tsx.
//
// The `.card__shine` element + ::after are byte-identical to prism-full-art's
// (same --space 5% / --angle 133deg, same four layers, sizes, positions,
// blends and masked filters), so this reuses the same prismShared helpers. Painted
// bottom->top per `background-blend-mode: soft-light, hue, hard-light` (bottom
// radial normal):
//   dark pointer radial (normal) · diagonal streaks (hard-light) ·
//   sunpillar bands (hue) · foil (soft-light; NO-MASK: exclusion)
//   ::after — same stack, sunpillar `after` rotation, blend exclusion (masked)
//     / difference (NO-MASK, shiny-rare.css:172 `[data-rarity*="rare shiny"]`).
//   ::before — a white pointer radial, overlay, opacity .75; ALWAYS rendered
//     (unlike prism-full-art it is NOT opted out for NO-MASK), itself unmasked
//     (shiny-rare.css:93 mask-image:none beats base.css:322 at equal specificity
//     by load order).
// Masked cards alpha-mask the element bg + ::after to the foil (::before
// escapes); NO-MASK swaps the foil for illusion.png @33% and shifts filters.
//
// Shine clip-path (shiny-rare.css:19-24): `--clip`, or `--clip-stage` for
// `[data-subtypes^="stage"]` — the ONLY shiny file with a shine clip. There is
// no trainer clip here, so a non-stage subtype always uses `--clip`.
//
// .card__glare — a full-box pointer radial (150% stop re-anchored), blend
// multiply, opacity card*pointer-from-center.

import { Fragment, useMemo } from "react";
import { Group, Image, Mask, RadialGradient, Rect } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { EffectProps } from "./types";
import { ShineLayer } from "./base";
import { CLIPS } from "./clips";
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

// ::before white radial (shiny-rare.css:98-101): white 0% -> transparent 40%.
const BEFORE_COLORS = [hsl(0, 0, 100), "rgba(0, 0, 0, 0)"];
const BEFORE_POS = [0, 0.4];

// Glare radial (shiny-rare.css:128-131): white 0% -> hsl(320,5%,15%) 150%.
// 150% stop re-anchored to 1.0 at t = (100-0)/(150-0) = 2/3.
const GLARE_COLORS = [hsl(0, 0, 100), interpolateStopColor(hsl(0, 0, 100), hsl(320, 5, 15), 2 / 3)];
const GLARE_POS = [0, 1.0];
const GLARE_M = concatColorMatrices(brightnessMatrix(1.2), contrastMatrix(1), saturateMatrix(0.7)); // :137

export function ShinyRare({ u, foil, mask, clipVariant = "base" }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;
  const illusion = useTexture(textureImages.illusion);

  // Shine clip-path: stage subtype -> clip-stage, else clip (shiny-rare.css:19-24).
  const shineClip = useMemo(
    () => (clipVariant === "stage" ? CLIPS.clipStage(w, h) : CLIPS.clip(w, h)),
    [clipVariant, w, h],
  );

  const radial = useBoxedRadial(u, 2, 1, true); // element + ::after dark radial (200% 100%)

  // Diagonal streak position calc(bg-x + bg-y*0.2), negated on ::after.
  const dPosElem = useDerivedValue(() => u.backgroundX.value + u.backgroundY.value * 0.2);
  const dPosAfter = useDerivedValue(() => -(u.backgroundX.value + u.backgroundY.value * 0.2));

  // ::before + glare share a plain 100%-box pointer radial.
  const pointerCenter = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const pointerRadius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );
  const glareOpacity = useDerivedValue(() => u.cardOpacity.value * u.pointerFromCenter.value);

  // Animated filters — masked (shiny-rare.css:70, 86) vs NO-MASK (:168, :174).
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
      : concatColorMatrices(brightnessMatrix(pfc * 0.4 + 0.5), contrastMatrix(1.4), saturateMatrix(1.2));
  });
  // ::after blend: exclusion (masked, :87) / difference (NO-MASK, :175).
  const afterBlend = masked ? "exclusion" : "difference";

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
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={elemFilter} blendMode="colorDodge" clip={shineClip}>
        {masked && mask ? (
          <Mask mode="alpha" mask={<Image image={mask} x={0} y={0} width={w} height={h} fit="cover" />}>
            {elementBg}
          </Mask>
        ) : (
          elementBg
        )}

        {/* ::after — exclusion/difference, foil-masked when masked */}
        <ShineLayer w={w} h={h} matrix={afterFilter} blendMode={afterBlend} mask={masked ? mask : undefined}>
          {afterBg}
        </ShineLayer>

        {/* ::before — white pointer radial, overlay, opacity .75; always rendered,
            itself unmasked. z-index 1 -> paints above ::after. */}
        <ShineLayer w={w} h={h} opacity={0.75} matrix={brightnessMatrix(1)} blendMode="overlay">
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient c={pointerCenter} r={pointerRadius} colors={BEFORE_COLORS} positions={BEFORE_POS} />
          </Rect>
        </ShineLayer>
      </ShineLayer>

      {/* .card__glare — full-box pointer radial, multiply, opacity card*from-center */}
      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="multiply">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={pointerCenter} r={pointerRadius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
