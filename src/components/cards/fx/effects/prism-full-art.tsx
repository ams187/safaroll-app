// `prism-full-art` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/prism-full-art.css. Follows the locked
// ShineLayer pattern of regular-holo.tsx.
//
// SCOPE: this component renders ONLY the `[data-supertype="pokémon"]` branch
// (registry routes rare-ultra pokémon here). prism-full-art.css also carries
// `[data-subtypes*="supporter"]` selectors (those cards route to
// full-art-foil — Task 16) and `[data-rarity="rare holo v"]
// [data-trainer-gallery="true"]` selectors (those route to gallery-prism —
// Task 20); both are intentionally skipped here.
//
// .card__shine isolation group (color-dodge). Element bg + ::after share four
// layers (prism-full-art.css:30-56); painted bottom->top per
// `background-blend-mode: soft-light, hue, hard-light` (bottom radial normal):
//   dark pointer radial (normal) · diagonal streaks (hard-light) ·
//   sunpillar bands (hue) · foil (soft-light; NO-MASK: exclusion)
//   ::after — same stack, sunpillar `after` rotation, blend exclusion
//   ::before — a white pointer radial, blend overlay, opacity .75; MASKED ONLY
//     (NO-MASK opts it out, prism-full-art.css:180-184) and itself NOT foil-masked
//     (mask-image:none, prism-full-art.css:95-96), so it renders across the card.
// Masked cards alpha-mask the element bg and ::after to the foil (::before is
// excluded); NO-MASK swaps the foil for illusion.png @33% and shifts filters.
//
// .card__glare — a pointer radial in a 120%x150% box (prism-full-art.css:124-143).

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

// ::before white radial (prism-full-art.css:98-102): white 0% -> transparent 40%.
const BEFORE_COLORS = [hsl(0, 0, 100), "rgba(0, 0, 0, 0)"];
const BEFORE_POS = [0, 0.4];

// Glare radial (prism-full-art.css:127-133) — 150% stop re-anchored (t=40/90).
const GLARE_COLORS = [hsl(0, 0, 75), hsl(200, 5, 35), interpolateStopColor(hsl(200, 5, 35), hsl(320, 40, 10), 40 / 90)];
const GLARE_POS = [0.05, 0.6, 1.0];
const GLARE_M = concatColorMatrices(brightnessMatrix(1), contrastMatrix(1.2), saturateMatrix(1)); // :139

/**
 * The `.card__shine` isolation group (element bg + ::after + optional ::before)
 * shared by prism-full-art's `[data-supertype="pokémon"][data-rarity="rare ultra"]`
 * branch and, via CSS cascade, gallery-prism
 * (`[data-rarity="rare holo v"][data-trainer-gallery="true"]` — prism-full-art.css
 * groups those selectors on every shine + NO-MASK rule; prism-foil.css only leaks
 * the base-blend/`--space`, both already matching). The ONLY difference: the
 * `::before` white pointer radial is a `rare ultra`-only rule (prism-full-art.css:91),
 * absent for gallery-prism, so `showBefore` gates it. The glare differs entirely
 * and is rendered by each caller.
 */
export function PrismFullArtShine({
  u,
  foil,
  mask,
  showBefore = true,
}: Pick<EffectProps, "u" | "foil" | "mask"> & { showBefore?: boolean }) {
  const { w, h } = u;
  const masked = !!mask;
  const illusion = useTexture(textureImages.illusion);

  const radial = useBoxedRadial(u, 2, 1, true); // element + ::after dark radial

  // ::before uses a plain 100%-box pointer radial (background-size:cover,
  // position center).
  const pointerCenter = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const pointerRadius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );

  // Diagonal streak position calc(bg-x + bg-y*0.2), negated on ::after.
  const dPosElem = useDerivedValue(() => u.backgroundX.value + u.backgroundY.value * 0.2);
  const dPosAfter = useDerivedValue(() => -(u.backgroundX.value + u.backgroundY.value * 0.2));

  // Animated filters (prism-full-art.css:67, 85 masked; :176, :188 non-masked).
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

  // Foil: masked -> per-card foil cover, soft-light; NO-MASK -> illusion @33%,
  // exclusion (same image/blend on element + ::after).
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
          itself unmasked (mask-image:none). Drawn last (z-index 1 > ::after).
          rare-ultra-only rule, so gated off for gallery-prism via showBefore. */}
      {showBefore && masked ? (
        <ShineLayer w={w} h={h} opacity={0.75} matrix={brightnessMatrix(1)} blendMode="overlay">
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient c={pointerCenter} r={pointerRadius} colors={BEFORE_COLORS} positions={BEFORE_POS} />
          </Rect>
        </ShineLayer>
      ) : null}
    </ShineLayer>
  );
}

export function PrismFullArt({ u, foil, mask }: EffectProps) {
  const { w, h } = u;
  const glare = useBoxedRadial(u, 1.2, 1.5, false); // glare box, centred
  const glareOpacity = useDerivedValue(() => u.cardOpacity.value * 0.75);

  return (
    <Fragment>
      <PrismFullArtShine u={u} foil={foil} mask={mask} />

      {/* .card__glare — pointer radial in a 120%x150% box, hard-light. */}
      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="hardLight">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={glare.center} r={glare.radius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
