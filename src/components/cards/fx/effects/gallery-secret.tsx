// `gallery-secret` effect — trainer-gallery secret rare, gold & black
// (`[data-rarity="rare secret"][data-trainer-gallery="true"]`) from
// pokemon-cards-css/public/css/cards/trainer-gallery-secret-rare.css.
//
// CASCADE: the card's effective rarity is "rare secret", so secret-rare.css's
// `[data-rarity="rare secret"]` rules also match — but every
// trainer-gallery-secret-rare.css selector adds `[data-trainer-gallery="true"]`
// (0,4,0/0,4,1 > secret-rare's 0,3,0/0,3,1) and OVERRIDES every property that
// matters, so no meaningful leak. What differs is only the masked/NO-MASK split:
//   masked   -> shine filter identity, ::before foil = per-card foil (cover),
//               glare filter identity (the `:not(.masked)` rules opt out).
//   NO-MASK  -> shine filter brightness(pfc*.3+.2) contrast2 saturate.75,
//               ::before foil = geometric.png @33%, glare filter brightness(.5).
// CRITICAL: trainer-gallery-secret-rare.css:40-47 forces `mask-image:none
// !important` on shine + ::before + ::after, so NOTHING is alpha-masked even for
// a masked card — the whole effect renders across the full card box.
//
// .card__shine group (color-dodge, opacity card):
//   element bg (blend soft-light,darken,color; bottom->top): linear(45deg gold)
//     · radial(pointer) · glitter@55/55 · glitter@40/45
//   ::before (exclusion, opacity 1): radial(pointer) · --foil (color-burn)
//   ::after  (soft-light): conic(sunpillar ::after rotation) · glitter (luminosity)
// .card__glare — a full-box pointer radial (180% re-anchored), hard-light.

import { Fragment } from "react";
import { Group, LinearGradient, RadialGradient, Rect, SweepGradient } from "@shopify/react-native-skia";
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
  linearGradientPoints,
  pct,
  saturateMatrix,
} from "../lib/css";
import { interpolateStopColor } from "./cssBackground";
import { SUNPILLAR } from "./sunpillar";
import { vFoil } from "./prismShared";

const GLITTER_SIZE = 25; // --glittersize (cards.css:6)

// element radial (trainer-gallery-secret-rare.css:56-59): hsl(152.7,21.6%,10%)
// 10% · hsla(177,22%,80%,.1) 50% · hsla(0,0%,95%,.98) 90%.
const ELEM_RADIAL_COLORS = [hsl(152.7, 21.6, 10), hsl(177, 22, 80, 0.1), hsl(0, 0, 95, 0.98)];
const ELEM_RADIAL_POS = [0.1, 0.5, 0.9];
// element gold linear (45deg): hsl(46,95%,50%) -> hsl(52,100%,69%).
const GOLD_COLORS = [hsl(46, 95, 50), hsl(52, 100, 69)];
const GOLD_POS = [0, 1];

// ::before radial (trainer-gallery-secret-rare.css:88-91): hsla(50,20%,90%,.95)
// 10% · hsla(324,22%,63%,.5) 50% · hsl(0,0%,0%) 90%.
const BEFORE_RADIAL_COLORS = [hsl(50, 20, 90, 0.95), hsl(324, 22, 63, 0.5), hsl(0, 0, 0)];
const BEFORE_RADIAL_POS = [0.1, 0.5, 0.9];

// ::after conic (trainer-gallery-secret-rare.css:109-117): clr-4,5,6,1,2,3,4
// under base.css:279-286's ::after sunpillar rotation = SUNPILLAR[2,3,4,5,0,1,2].
const CONIC_COLORS = [
  SUNPILLAR[2],
  SUNPILLAR[3],
  SUNPILLAR[4],
  SUNPILLAR[5],
  SUNPILLAR[0],
  SUNPILLAR[1],
  SUNPILLAR[2],
];
const CONIC_POS = [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1];

// glare radial (trainer-gallery-secret-rare.css:141-143): hsla(40,100%,95%,.2)
// 10% · hsla(40,20%,5%,1) 180%; 180% re-anchored to 1.0 at t=(100-10)/(180-10).
const GLARE_COLORS = [hsl(40, 100, 95, 0.2), interpolateStopColor(hsl(40, 100, 95, 0.2), hsl(40, 20, 5), 90 / 170)];
const GLARE_POS = [0.1, 1.0];

// static filters
const BEFORE_M = concatColorMatrices(brightnessMatrix(1), contrastMatrix(1), saturateMatrix(1)); // identity (:98)
const IDENTITY_M = brightnessMatrix(1);

export function GallerySecret({ u, foil, mask }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;
  const glitter = useTexture(textureImages.glitter);
  const geometric = useTexture(textureImages.geometric);

  // Full-box pointer radial (element bg, ::before, glare share this).
  const center = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const radius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );
  const conicCenter = { x: w / 2, y: h / 2 };
  const gold45 = linearGradientPoints(45, w, h);

  // element filter — masked: identity (:76); NO-MASK: brightness(pfc*.3+.2)
  // contrast2 saturate.75 (trainer-gallery-secret-rare.css:22).
  const elemFilter = useDerivedValue(() =>
    masked
      ? concatColorMatrices(brightnessMatrix(1), contrastMatrix(1), saturateMatrix(1))
      : concatColorMatrices(
          brightnessMatrix(u.pointerFromCenter.value * 0.3 + 0.2),
          contrastMatrix(2),
          saturateMatrix(0.75),
        ),
  );
  // ::after filter: brightness(pfc*.5+.6) contrast2 saturate3 (:121).
  const afterFilter = useDerivedValue(() =>
    concatColorMatrices(brightnessMatrix(u.pointerFromCenter.value * 0.5 + 0.6), contrastMatrix(2), saturateMatrix(3)),
  );
  // glare filter — masked: identity (:145); NO-MASK: brightness(.5) contrast1 (:28).
  const glareFilter = masked ? IDENTITY_M : brightnessMatrix(0.5);

  // element bg painted bottom -> top per background-blend-mode soft-light,
  // darken, color (bottom gold linear = normal; the `color` blend applies to the
  // pointer radial, `darken`/`soft-light` to the two glitter layers).
  const elementBg = (
    <Fragment>
      <Rect x={0} y={0} width={w} height={h}>
        <LinearGradient start={gold45.start} end={gold45.end} colors={GOLD_COLORS} positions={GOLD_POS} />
      </Rect>
      <Group blendMode="color">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={center} r={radius} colors={ELEM_RADIAL_COLORS} positions={ELEM_RADIAL_POS} />
        </Rect>
      </Group>
      {glitter ? (
        <Group blendMode="darken">
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

  // ::before painted bottom -> top (blend color-burn; bottom radial = normal).
  // --foil: masked -> per-card foil (cover); NO-MASK -> geometric.png @33%.
  // Never alpha-masked (mask-image:none !important).
  const beforeFoilImg = masked ? foil : geometric;
  const beforeBg = (
    <Fragment>
      <Rect x={0} y={0} width={w} height={h}>
        <RadialGradient c={center} r={radius} colors={BEFORE_RADIAL_COLORS} positions={BEFORE_RADIAL_POS} />
      </Rect>
      {beforeFoilImg ? <Group blendMode="colorBurn">{vFoil(beforeFoilImg, masked, w, h, 33, null)}</Group> : null}
    </Fragment>
  );

  return (
    <Fragment>
      {/* .card__shine group: color-dodge, elemFilter, opacity card. No alpha mask. */}
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={elemFilter} blendMode="colorDodge">
        {elementBg}

        {/* ::before — exclusion, opacity 1. */}
        <ShineLayer w={w} h={h} matrix={BEFORE_M} blendMode="exclusion">
          {beforeBg}
        </ShineLayer>

        {/* ::after — soft-light: conic (bottom/normal) · glitter@0/0 (luminosity). */}
        <ShineLayer w={w} h={h} matrix={afterFilter} blendMode="softLight">
          <Rect x={0} y={0} width={w} height={h}>
            {/* CSS conic 0deg = 12 o'clock clockwise => Skia sweep -90..270. */}
            <SweepGradient c={conicCenter} start={-90} end={270} colors={CONIC_COLORS} positions={CONIC_POS} />
          </Rect>
          {glitter ? (
            <Group blendMode="luminosity">
              <TiledTexture img={glitter} w={w} h={h} sizeX={GLITTER_SIZE} sizeY={GLITTER_SIZE} posX={0} posY={0} />
            </Group>
          ) : null}
        </ShineLayer>
      </ShineLayer>

      {/* .card__glare — full-box pointer radial, hard-light, opacity card. */}
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={glareFilter} blendMode="hardLight">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={center} r={radius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
