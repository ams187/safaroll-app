// `prism-foil` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/prism-foil.css
// (`[data-rarity="rare holo v"]`, and the identical `[data-subtypes="v-union"]`
// selectors — the registry routes both to this key, so one component serves
// both). Follows the locked ShineLayer pattern of regular-holo.tsx.
//
// .card__shine isolation group (color-dodge). Element bg + ::after share the
// same four background layers (prism-foil.css:35-61) — only their sizes,
// positions, filters, blend and sunpillar rotation differ. Painted bottom->top
// per `background-blend-mode: screen, hue, hard-light` (the bottom radial is
// normal; grain is the top screen layer):
//   dark pointer radial (normal) · diagonal streaks (hard-light) ·
//   sunpillar bands (hue) · grain (screen)
//   ::after — same stack, sunpillar `after` rotation, blend soft-light
// base.css masks the shine + ::after to the foil (no per-file opt-out here),
// so both are alpha-masked when the card is masked; the non-masked branch only
// changes the element filter (prism-foil.css:19-24).
//
// .card__glare — a single pointer radial, blend hard-light, opacity card*.5.

import { Fragment } from "react";
import { Group, Image, Mask, RadialGradient, Rect } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { EffectProps } from "./types";
import { ShineLayer, TiledTexture } from "./base";
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
  VDARK_RADIAL_COLORS,
  VDARK_RADIAL_POS,
} from "./prismShared";

// --- filters (prism-foil.css:22, 67, 79, 115) ------------------------------
const SHINE_MASKED_M = concatColorMatrices(brightnessMatrix(0.8), contrastMatrix(2.95), saturateMatrix(0.65)); // :67
const SHINE_PLAIN_M = concatColorMatrices(brightnessMatrix(0.7), contrastMatrix(2), saturateMatrix(0.5)); // :22 (:not(.masked))
const AFTER_M = concatColorMatrices(brightnessMatrix(1), contrastMatrix(2.5), saturateMatrix(1.75)); // :79
const GLARE_M = concatColorMatrices(brightnessMatrix(0.9), contrastMatrix(1.75)); // :115

// --- glare radial (prism-foil.css:104-110) — 130% stop re-anchored to 1.0 ---
const GLARE_COLORS = [
  hsl(0, 0, 100),
  hsl(210, 3, 54, 0.33),
  interpolateStopColor(hsl(210, 3, 54, 0.33), hsl(0, 0, 20, 0.9), 55 / 85),
];
const GLARE_POS = [0, 0.45, 1.0];

export function PrismFoil({ u, mask }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;
  const grain = useTexture(textureImages.grain);

  // Element + ::after dark radial share geometry (size 200% 100%, pos bg-x/-y).
  const radial = useBoxedRadial(u, 2, 1, true);

  // Diagonal streak background-position: element bg-x, ::after -bg-x.
  const dPosElem = useDerivedValue(() => u.backgroundX.value);
  const dPosAfter = useDerivedValue(() => -u.backgroundX.value);

  // --grain (cards.css:4): background-size 500px 100% — an ABSOLUTE 500px tile
  // width (as sizeX% of the box) x full height, centred, tiled, blended screen.
  const grainNode = grain ? (
    <Group blendMode="screen">
      <TiledTexture img={grain} w={w} h={h} sizeX={(500 / w) * 100} sizeY={100} posX={50} posY={50} />
    </Group>
  ) : null;

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
      {grainNode}
    </Fragment>
  );

  // Glare: plain farthest-corner pointer radial (default 100% box).
  const glareCenter = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const glareRadius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );
  const glareOpacity = useDerivedValue(() => u.cardOpacity.value * 0.5);

  return (
    <Fragment>
      <ShineLayer
        w={w}
        h={h}
        opacity={u.cardOpacity}
        matrix={masked ? SHINE_MASKED_M : SHINE_PLAIN_M}
        blendMode="colorDodge"
      >
        {masked && mask ? (
          <Mask mode="alpha" mask={<Image image={mask} x={0} y={0} width={w} height={h} fit="cover" />}>
            {elementBg}
          </Mask>
        ) : (
          elementBg
        )}

        {/* ::after — soft-light, sunpillar `after` rotation, foil-masked when masked */}
        <ShineLayer w={w} h={h} matrix={AFTER_M} blendMode="softLight" mask={masked ? mask : undefined}>
          {darkRadial}
          <Group blendMode="hardLight">
            <DiagonalStreaks u={u} posX={dPosAfter} tileWmul={1.95} />
          </Group>
          <Group blendMode="hue">
            <SunpillarBands u={u} rot="after" space={5} tileHmul={4} />
          </Group>
          {grainNode}
        </ShineLayer>
      </ShineLayer>

      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="hardLight">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={glareCenter} r={glareRadius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
