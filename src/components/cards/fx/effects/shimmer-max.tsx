// `shimmer-max` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/shimmer-max.css
// (`[data-rarity="rare shiny vmax"]`, the "Shiny Rare (VMAX)"). Follows the
// locked ShineLayer pattern of regular-holo.tsx / secret-rare.tsx.
//
// .card__shine group (color-dodge, opacity card, filter saturate .85):
//   element bg (blend soft-light, overlay, color-burn — the 3-value list cycles
//     over 4 layers so the bottom radial is normal; painted bottom -> top):
//     dark->light pointer radial (normal) · -30deg dark-rainbow band (color-burn)
//     · glitter@55%55% (overlay) · glitter@40%45% (soft-light).
//   ::before (lighten, opacity .35, filter saturate .4; UNMASKED): pointer
//     radial (normal) · --foil (color-burn) — foil is cover-fit (--imgsize).
//   ::after  (hue, filter brightness(.75 - from-center*.5); UNMASKED): a -30deg
//     sunpillar `after` band, size 400%x800%, position 50%+(50%-bg)*3.
// Only the element bg is foil-masked when masked (base.css:321); ::before /
// ::after force mask-image:none !important, so they render across the whole card.
// shimmer-max defines no NO-MASK --foil override, so a (dataset-absent) non-masked
// card simply drops the ::before foil.
//
// .card__glare — an isolation group like regular-holo's: element radial (overlay,
// opacity card) with a nested ::after radial (overlay, opacity 1) that IS
// foil-masked (shimmer-max.css:134 mask-image:var(--mask)). Both brightness1
// contrast1.25.

import { Fragment } from "react";
import { Group, Image, Mask, RadialGradient, Rect } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { EffectProps } from "./types";
import { ShineLayer, TiledTexture } from "./base";
import { textureImages, useTexture } from "../lib/assets";
import {
  brightnessMatrix,
  contrastMatrix,
  farthestCornerRadius,
  hsl,
  pct,
  saturateMatrix,
} from "../lib/css";
import { interpolateStopColor } from "./cssBackground";
import { RepeatingBands, vFoil } from "./prismShared";
import { SUN_STOPS, sunpillarColors } from "./sunpillar";

const GLITTER_SIZE = 25; // --glittersize (cards.css:6)

// --- element -30deg dark rainbow (shimmer-max.css:24-40, --r-clr-1..7) --------
// Identical palette to glitter-foil / rainbow-alt. 22 stops (r1..r7 ×3, r1),
// evenly spread 0..1; both endpoints r1 so mode="repeat" tiles seamlessly.
const R1 = hsl(0, 57, 37);
const R2 = hsl(40, 53, 39);
const R3 = hsl(90, 60, 35);
const R4 = hsl(180, 60, 35);
const R5 = hsl(180, 60, 35); // identical to R4 in the CSS
const R6 = hsl(210, 57, 39);
const R7 = hsl(280, 55, 31);
const RAINBOW = [R1, R2, R3, R4, R5, R6, R7, R1, R2, R3, R4, R5, R6, R7, R1, R2, R3, R4, R5, R6, R7, R1];
const RAINBOW_POS = RAINBOW.map((_, i) => i / (RAINBOW.length - 1));

// --- element pointer radial (shimmer-max.css:41-46) ---------------------------
const ELEM_RADIAL_COLORS = [hsl(248, 5, 10, 1), hsl(206, 5, 80, 0.1), hsl(0, 0, 95, 0.98)];
const ELEM_RADIAL_POS = [0.1, 0.5, 0.9];

// --- ::before pointer radial (shimmer-max.css:63-68) --------------------------
// 120% stop re-anchored to 1.0 at t = (100-50)/(120-50) = 5/7.
const BEFORE_RADIAL_COLORS = [
  hsl(248, 5, 91, 0.95),
  hsl(206, 5, 68, 0.5),
  interpolateStopColor(hsl(206, 5, 68, 0.5), hsl(0, 0, 0), 5 / 7),
];
const BEFORE_RADIAL_POS = [0.1, 0.5, 1.0];

// --- glare element radial (shimmer-max.css:118-125) ---------------------------
// 120% stop re-anchored to 1.0 at t = (100-45)/(120-45) = 11/15.
const GLARE_COLORS = [
  hsl(248, 5, 90, 0.45),
  hsl(206, 5, 30, 0.45),
  interpolateStopColor(hsl(206, 5, 30, 0.45), hsl(0, 0, 0, 0.33), 11 / 15),
];
const GLARE_POS = [0, 0.45, 1.0];

// --- glare ::after radial (shimmer-max.css:139-146) ---------------------------
const GLARE_AFTER_COLORS = [hsl(248, 5, 90, 0.75), hsl(206, 5, 30, 0.65), hsl(0, 0, 0, 0.75)];
const GLARE_AFTER_POS = [0, 0.45, 1.0];

const ELEM_M = saturateMatrix(0.85); // brightness1 contrast1 saturate.85 — :51
const BEFORE_M = saturateMatrix(0.4); // brightness1 contrast1 saturate.4 — :75
const GLARE_M = contrastMatrix(1.25); // brightness1 contrast1.25 — :127, :148

export function ShimmerMax({ u, foil, mask }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;
  const glitter = useTexture(textureImages.glitter);

  // Every radial here is a full-box (cover) pointer radial; shared center/radius.
  const center = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const radius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );

  // element -30deg rainbow position calc(bg * 1.5), size 400%x400%.
  const rainbowX = useDerivedValue(() => 1.5 * u.backgroundX.value);
  const rainbowY = useDerivedValue(() => 1.5 * u.backgroundY.value);
  // ::after sunpillar band position calc(50% + (50% - bg)*3) = 200 - 3*bg.
  const afterX = useDerivedValue(() => 200 - 3 * u.backgroundX.value);
  const afterY = useDerivedValue(() => 200 - 3 * u.backgroundY.value);
  // ::after filter brightness(0.75 - from-center*0.5).
  const afterFilter = useDerivedValue(() => brightnessMatrix(0.75 - u.pointerFromCenter.value * 0.5));

  // element bg painted bottom -> top (radial normal, band color-burn, two glitters).
  const elementBg = (
    <Fragment>
      <Rect x={0} y={0} width={w} height={h}>
        <RadialGradient c={center} r={radius} colors={ELEM_RADIAL_COLORS} positions={ELEM_RADIAL_POS} />
      </Rect>
      <Group blendMode="colorBurn">
        <RepeatingBands
          u={u}
          angleDeg={-30}
          colors={RAINBOW}
          stops={RAINBOW_POS}
          firstPct={0}
          lastPct={100}
          tileWmul={4}
          tileHmul={4}
          posX={rainbowX}
          posY={rainbowY}
        />
      </Group>
      {glitter ? (
        <Group blendMode="overlay">
          <TiledTexture img={glitter} w={w} h={h} sizeX={GLITTER_SIZE} sizeY={GLITTER_SIZE} posX={55} posY={55} />
        </Group>
      ) : null}
      {glitter ? (
        <Group blendMode="softLight">
          <TiledTexture img={glitter} w={w} h={h} sizeX={GLITTER_SIZE} sizeY={GLITTER_SIZE} posX={40} posY={45} />
        </Group>
      ) : null}
    </Fragment>
  );

  // ::before bg painted bottom -> top (radial normal, foil color-burn). --foil is
  // cover-fit (--imgsize:cover) and only exists for masked cards.
  const beforeBg = (
    <Fragment>
      <Rect x={0} y={0} width={w} height={h}>
        <RadialGradient c={center} r={radius} colors={BEFORE_RADIAL_COLORS} positions={BEFORE_RADIAL_POS} />
      </Rect>
      <Group blendMode="colorBurn">{vFoil(masked ? foil : undefined, masked, w, h, 33, null)}</Group>
    </Fragment>
  );

  return (
    <Fragment>
      {/* .card__shine group: color-dodge, saturate.85, opacity card. */}
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={ELEM_M} blendMode="colorDodge">
        {masked && mask ? (
          <Mask mode="alpha" mask={<Image image={mask} x={0} y={0} width={w} height={h} fit="cover" />}>
            {elementBg}
          </Mask>
        ) : (
          elementBg
        )}

        {/* ::before — lighten, opacity .35, unmasked. */}
        <ShineLayer w={w} h={h} opacity={0.35} matrix={BEFORE_M} blendMode="lighten">
          {beforeBg}
        </ShineLayer>

        {/* ::after — hue, -30deg sunpillar `after` band 400%x800%, unmasked. */}
        <ShineLayer w={w} h={h} matrix={afterFilter} blendMode="hue">
          <RepeatingBands
            u={u}
            angleDeg={-30}
            colors={sunpillarColors("after")}
            stops={SUN_STOPS}
            firstPct={5}
            lastPct={35}
            tileWmul={4}
            tileHmul={8}
            posX={afterX}
            posY={afterY}
          />
        </ShineLayer>
      </ShineLayer>

      {/* .card__glare isolation group: element radial (overlay, opacity card) +
          nested ::after radial (overlay, opacity 1), foil-masked. */}
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={GLARE_M} blendMode="overlay">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={center} r={radius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>

        {/* ::after — overlay, opacity 1 (nested), masked with the per-card mask. */}
        <ShineLayer w={w} h={h} matrix={GLARE_M} blendMode="overlay" mask={masked ? mask : undefined}>
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient c={center} r={radius} colors={GLARE_AFTER_COLORS} positions={GLARE_AFTER_POS} />
          </Rect>
        </ShineLayer>
      </ShineLayer>
    </Fragment>
  );
}
