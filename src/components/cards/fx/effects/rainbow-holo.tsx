// `rainbow-holo` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/rainbow-holo.css
// (`[data-rarity="rare rainbow"]`, the Rainbow Secret holo). Follows the locked
// ShineLayer pattern of regular-holo.tsx / glitter-foil.tsx.
//
// The `.card__shine` element background AND its `::after` are structurally the
// SAME as glitter-foil's (identical r-clr palette, angles, tile sizes and
// pointer positions) — this file differs only in the filters, the glitter has
// NO ±shift jitter (plain `center`), and the blend modes (::before darken,
// ::after color-dodge, glare hard-light).
//
// Masking (base.css:321-333 masks `.card.masked` shine + ::before + ::after,
// but rainbow-holo.css:59-60 forces `::after { mask-image: none !important }`):
//   masked   -> element bg + ::before are alpha-masked by the per-card mask;
//               ::after escapes the mask. ::before draws the per-card --foil
//               cover-fit.
//   NO-MASK  -> nothing masked; ::before draws illusion-mask.png @ 33% (auto h)
//               (rainbow-holo.css:138-143).
//
// .card__shine group (color-dodge, base default), opacity card-opacity:
//   element bg (blend luminosity, soft-light -> bottom/normal rainbow, glitter
//     soft-light, diag luminosity): diag(-45deg r1->r5) · glitter · rainbow(-30deg).
//   ::before (darken, opacity (pfc+.4)*.6): --foil, brightness(2.5).
//   ::after  (color-dodge): rainbow(-60deg, bottom/normal) · glitter(soft-light).
// .card__glare — full-box pointer radial (120% stop re-anchored), hard-light.

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
import { RepeatingBands, vFoil } from "./prismShared";

// --- rainbow palette (rainbow-holo.css:21-27, --r-clr-1..7) ----------------
const R1 = hsl(0, 57, 37);
const R2 = hsl(40, 53, 39);
const R3 = hsl(90, 60, 35);
const R4 = hsl(180, 60, 35);
const R5 = hsl(180, 60, 35); // identical to R4 in the CSS
const R6 = hsl(210, 57, 39);
const R7 = hsl(280, 55, 31);

// The 22-stop rainbow (r-clr-1..7 ×3 then r-clr-1), evenly spread 0..1; both
// endpoints r-clr-1 so `mode="repeat"` tiles seamlessly (rainbow-holo.css:32-37).
const RAINBOW = [R1, R2, R3, R4, R5, R6, R7, R1, R2, R3, R4, R5, R6, R7, R1, R2, R3, R4, R5, R6, R7, R1];
const RAINBOW_POS = RAINBOW.map((_, i) => i / (RAINBOW.length - 1));
// The 2-stop -45deg diagonal (r-clr-1 -> r-clr-5), tiled at 200% (:30).
const DIAG_COLORS = [R1, R5];
const DIAG_POS = [0, 1];

const GLITTER_SIZE = 25; // --glittersize (cards.css:6)

// --- glare radial (rainbow-holo.css:108-114) -------------------------------
// hsl(0,0%,80%) 0% · hsla(187,10%,85%,.25) 30% · hsl(197,6%,25%) 120%.
// 120% stop re-anchored to 1.0 at t=(100-30)/(120-30)=0.7778.
const GLARE_COLORS = [
  hsl(0, 0, 80),
  hsl(187, 10, 85, 0.25),
  interpolateStopColor(hsl(187, 10, 85, 0.25), hsl(197, 6, 25), (100 - 30) / (120 - 30)),
];
const GLARE_POS = [0, 0.3, 1.0];

// --- static filters --------------------------------------------------------
const BEFORE_M = brightnessMatrix(2.5); // brightness(2.5) contrast(1) — :87
const GLARE_M = concatColorMatrices(brightnessMatrix(0.9), contrastMatrix(1.75)); // :116

export function RainbowHolo({ u, foil, mask }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;
  const glitter = useTexture(textureImages.glitter);
  const illusionMask = useTexture(textureImages["illusion-mask"]);

  // Full-box pointer radial (glare) center/radius.
  const center = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const radius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );

  // Animated filters (brightness depends on pointer-from-center).
  // element: brightness(pfc*.25+.6) contrast(2.2) saturate(.75) (:51).
  const elemFilter = useDerivedValue(() =>
    concatColorMatrices(brightnessMatrix(u.pointerFromCenter.value * 0.25 + 0.6), contrastMatrix(2.2), saturateMatrix(0.75)),
  );
  // ::after: brightness(pfc*.3+.55) contrast(2) saturate(1) (:75).
  const afterFilter = useDerivedValue(() =>
    concatColorMatrices(brightnessMatrix(u.pointerFromCenter.value * 0.3 + 0.55), contrastMatrix(2), saturateMatrix(1)),
  );
  // ::before opacity (pfc+.4)*.6 (:89); glare opacity pfc*.9 (:117).
  const beforeOpacity = useDerivedValue(() => (u.pointerFromCenter.value + 0.4) * 0.6);
  const glareOpacity = useDerivedValue(() => u.pointerFromCenter.value * 0.9);

  // background-position percentages (rainbow-holo.css:46-49, 73).
  const elemRainbowX = useDerivedValue(() => 25 + u.pointerX.value / 2); // rainbow(-30) 25% + pointer/2
  const elemRainbowY = useDerivedValue(() => 25 + u.pointerY.value / 2);
  const diagX = useDerivedValue(() => 25 + 50 * u.pointerFromLeft.value); // diag(-45) 25% + 50%*from-left
  const diagY = useDerivedValue(() => 25 + 50 * u.pointerFromTop.value);
  const afterRainbowX = useDerivedValue(() => u.pointerX.value); // ::after rainbow(-60) = pointer
  const afterRainbowY = useDerivedValue(() => u.pointerY.value);

  // element bg painted bottom -> top (blend luminosity, soft-light).
  const elementBg = (
    <Fragment>
      <RepeatingBands
        u={u}
        angleDeg={-30}
        colors={RAINBOW}
        stops={RAINBOW_POS}
        firstPct={0}
        lastPct={100}
        tileWmul={4}
        tileHmul={4}
        posX={elemRainbowX}
        posY={elemRainbowY}
      />
      {glitter ? (
        <Group blendMode="softLight">
          <TiledTexture img={glitter} w={w} h={h} sizeX={GLITTER_SIZE} sizeY={GLITTER_SIZE} posX={50} posY={50} />
        </Group>
      ) : null}
      <Group blendMode="luminosity">
        <RepeatingBands
          u={u}
          angleDeg={-45}
          colors={DIAG_COLORS}
          stops={DIAG_POS}
          firstPct={0}
          lastPct={100}
          tileWmul={2}
          tileHmul={2}
          posX={diagX}
          posY={diagY}
        />
      </Group>
    </Fragment>
  );

  // ::after — rainbow(-60, bottom/normal) · glitter (soft-light).
  const afterBg = (
    <Fragment>
      <RepeatingBands
        u={u}
        angleDeg={-60}
        colors={RAINBOW}
        stops={RAINBOW_POS}
        firstPct={0}
        lastPct={100}
        tileWmul={4}
        tileHmul={4}
        posX={afterRainbowX}
        posY={afterRainbowY}
      />
      {glitter ? (
        <Group blendMode="softLight">
          <TiledTexture img={glitter} w={w} h={h} sizeX={GLITTER_SIZE} sizeY={GLITTER_SIZE} posX={50} posY={50} />
        </Group>
      ) : null}
    </Fragment>
  );

  // ::before --foil: masked -> per-card foil cover; NO-MASK -> illusion-mask @33%.
  const beforeFoilImg = masked ? foil : illusionMask;

  return (
    <Fragment>
      {/* .card__shine group: color-dodge, elemFilter, opacity card. */}
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={elemFilter} blendMode="colorDodge">
        {masked && mask ? (
          <Mask mode="alpha" mask={<Image image={mask} x={0} y={0} width={w} height={h} fit="cover" />}>
            {elementBg}
          </Mask>
        ) : (
          elementBg
        )}

        {/* ::before — --foil, darken, opacity (pfc+.4)*.6; masked with the card
            mask when masked (base.css:322, not overridden here). */}
        <ShineLayer
          w={w}
          h={h}
          opacity={beforeOpacity}
          matrix={BEFORE_M}
          blendMode="darken"
          mask={masked ? mask : undefined}
        >
          {vFoil(beforeFoilImg, masked, w, h, 33, null)}
        </ShineLayer>

        {/* ::after — color-dodge, unmasked (mask-image:none !important). */}
        <ShineLayer w={w} h={h} matrix={afterFilter} blendMode="colorDodge">
          {afterBg}
        </ShineLayer>
      </ShineLayer>

      {/* .card__glare — full-box pointer radial, hard-light. */}
      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="hardLight">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={center} r={radius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
