// `secret-rare` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/secret-rare.css (the "SECRET RARE (GOLD)"
// system, `[data-rarity="rare secret"]`). Follows the locked ShineLayer pattern
// of regular-holo.tsx / glitter-foil.tsx.
//
// ROUTING: secret-rare.css groups every rule with a second selector,
// `[data-set="swshp"][data-number="swsh145"]` (an identical promo alias — the
// registry routes it here too). The swsh12pt5-160 promo ("rare secret") is won
// by glitter-foil.css (higher specificity + later load), so this component only
// renders for the non-promo `rare secret` cards; the trainer-gallery secret
// ("rare secret" + TG number) is Task 20's gallery-secret. secret-rare.css itself has
// NO `[data-trainer-gallery]` selectors, no shine clip-path, and no
// `.card__glare:after` — nothing to skip for Task 20 here.
//
// Masking (base.css:321-333 masks `.card.masked` shine + ::before + ::after, but
// secret-rare.css:50-51 / 77-78 force `::before`/`::after { mask-image:none
// !important }`): only the element bg is alpha-masked; the pseudos escape.
//   masked  -> element bg alpha-masked; ::before draws per-card --foil (cover).
//   NO-MASK -> `--foil: geometric.png`, `--imgsize: 33%` (secret-rare.css:131-139);
//              ::before tiles geometric.png @33%; element filter differs.
//
// .card__shine group (color-dodge, opacity card):
//   element bg (blend soft-light, hard-light, overlay; bottom -> top):
//     radial(pointer) · conic(sunpillar 4,5,6,1,4) · glitter@55% · glitter@45%.
//   ::before (lighten, opacity .8): radial(pointer) · linear(45deg gold) ·
//     --foil; brightness1.25 contrast1.25 saturate.35.
//   ::after  (overlay): glitter jittered ±1px by pointer; brightness(pfc*.6+.6)
//     contrast1.5.
// .card__glare — full-box pointer radial (180% stop re-anchored), hard-light.

import { Fragment } from "react";
import { Group, Image, LinearGradient, Mask, RadialGradient, Rect, SweepGradient } from "@shopify/react-native-skia";
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
import { ShiftGlitter } from "./glitter-foil";

const GLITTER_SIZE = 25; // --glittersize (cards.css:6)

// --- element bg (secret-rare.css:22-36) ------------------------------------
// radial(farthest-corner circle at pointer): hsla(150,0%,0%,.98) 10% (=black
// .98) -> hsla(0,0%,95%,.15) 90% (=#f2f2f2 .15).
const ELEM_RADIAL_COLORS = [hsl(150, 0, 0, 0.98), hsl(0, 0, 95, 0.15)];
const ELEM_RADIAL_POS = [0.1, 0.9];
// conic-gradient(clr-4, clr-5, clr-6, clr-1, clr-4). On `.card__shine` the
// --sunpillar-clr-N aliases are identity (base.css:34-39) => sunpillar-4,5,6,1,4
// = SUNPILLAR[3,4,5,0,3]. 5 evenly-spaced stops; endpoints equal so it wraps.
const CONIC_COLORS = [SUNPILLAR[3], SUNPILLAR[4], SUNPILLAR[5], SUNPILLAR[0], SUNPILLAR[3]];
const CONIC_POS = [0, 0.25, 0.5, 0.75, 1];

// --- ::before (secret-rare.css:53-60) --------------------------------------
// radial(pointer): hsla(10,20%,90%,0.95) 10% -> hsl(0,0%,0%) 70%.
const BEFORE_RADIAL_COLORS = [hsl(10, 20, 90, 0.95), hsl(0, 0, 0)];
const BEFORE_RADIAL_POS = [0.1, 0.7];
// linear-gradient(45deg, hsl(46,95%,50%), hsl(52,100%,69%)) — gold sweep.
const BEFORE_LINEAR_COLORS = [hsl(46, 95, 50), hsl(52, 100, 69)];
const BEFORE_LINEAR_POS = [0, 1];

// --- glare (secret-rare.css:103-108) ---------------------------------------
// radial(pointer): hsla(45,8%,80%,0.3) 0% -> hsl(22,15%,12%) 180%.
// 180% stop re-anchored to 1.0 at t=(100-0)/(180-0)=100/180.
const GLARE_COLORS = [hsl(45, 8, 80, 0.3), interpolateStopColor(hsl(45, 8, 80, 0.3), hsl(22, 15, 12), 100 / 180)];
const GLARE_POS = [0, 1.0];

// --- static filters --------------------------------------------------------
const BEFORE_M = concatColorMatrices(brightnessMatrix(1.25), contrastMatrix(1.25), saturateMatrix(0.35)); // :67
const GLARE_M = concatColorMatrices(brightnessMatrix(1.3), contrastMatrix(1.5)); // :110

export function SecretRare({ u, foil, mask }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;
  const glitter = useTexture(textureImages.glitter);
  const geometric = useTexture(textureImages.geometric);

  // Full-box pointer radial (element bg, ::before, glare all share this).
  const center = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const radius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );
  const conicCenter = { x: w / 2, y: h / 2 }; // conic-gradient center = 50% 50%.
  const linear45 = linearGradientPoints(45, w, h); // ::before gold sweep (static).

  // element filter — masked: brightness(.4+pfc*.2) contrast1 saturate2.7 (:42);
  // NO-MASK: brightness(pfc*.3+.2) contrast2 saturate.75 (:137).
  const elemFilter = useDerivedValue(() =>
    masked
      ? concatColorMatrices(
          brightnessMatrix(0.4 + u.pointerFromCenter.value * 0.2),
          contrastMatrix(1),
          saturateMatrix(2.7),
        )
      : concatColorMatrices(
          brightnessMatrix(u.pointerFromCenter.value * 0.3 + 0.2),
          contrastMatrix(2),
          saturateMatrix(0.75),
        ),
  );
  // ::after filter: brightness(pfc*.6+.6) contrast1.5 (:84).
  const afterFilter = useDerivedValue(() =>
    concatColorMatrices(brightnessMatrix(u.pointerFromCenter.value * 0.6 + 0.6), contrastMatrix(1.5)),
  );
  // ::before opacity .8 (:68), glare opacity card (base.css default).
  const beforeOpacity = 0.8;

  // element bg painted bottom -> top per background-blend-mode
  // (soft-light, hard-light, overlay; bottom radial = normal).
  const elementBg = (
    <Fragment>
      <Rect x={0} y={0} width={w} height={h}>
        <RadialGradient c={center} r={radius} colors={ELEM_RADIAL_COLORS} positions={ELEM_RADIAL_POS} />
      </Rect>
      <Group blendMode="overlay">
        <Rect x={0} y={0} width={w} height={h}>
          {/* CSS conic 0deg = 12 o'clock clockwise => Skia sweep start -90..270. */}
          <SweepGradient c={conicCenter} start={-90} end={270} colors={CONIC_COLORS} positions={CONIC_POS} />
        </Rect>
      </Group>
      {glitter ? (
        <Group blendMode="hardLight">
          <TiledTexture img={glitter} w={w} h={h} sizeX={GLITTER_SIZE} sizeY={GLITTER_SIZE} posX={55} posY={55} />
        </Group>
      ) : null}
      {glitter ? (
        <Group blendMode="softLight">
          <TiledTexture img={glitter} w={w} h={h} sizeX={GLITTER_SIZE} sizeY={GLITTER_SIZE} posX={45} posY={45} />
        </Group>
      ) : null}
    </Fragment>
  );

  // ::before bg painted bottom -> top (blend hard-light, multiply; bottom
  // radial = normal). --foil: masked -> per-card foil (cover); NO-MASK ->
  // geometric.png @33%. ::before is never alpha-masked (mask-image:none).
  const beforeFoilImg = masked ? foil : geometric;
  const beforeBg = (
    <Fragment>
      <Rect x={0} y={0} width={w} height={h}>
        <RadialGradient c={center} r={radius} colors={BEFORE_RADIAL_COLORS} positions={BEFORE_RADIAL_POS} />
      </Rect>
      <Group blendMode="multiply">
        <Rect x={0} y={0} width={w} height={h}>
          <LinearGradient start={linear45.start} end={linear45.end} colors={BEFORE_LINEAR_COLORS} positions={BEFORE_LINEAR_POS} />
        </Rect>
      </Group>
      {beforeFoilImg ? (
        <Group blendMode="hardLight">{vFoil(beforeFoilImg, masked, w, h, 33, null)}</Group>
      ) : null}
    </Fragment>
  );

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

        {/* ::before — lighten, opacity .8, unmasked. */}
        <ShineLayer w={w} h={h} opacity={beforeOpacity} matrix={BEFORE_M} blendMode="lighten">
          {beforeBg}
        </ShineLayer>

        {/* ::after — overlay, glitter jittered ±1px (sign +1), unmasked. */}
        <ShineLayer w={w} h={h} matrix={afterFilter} blendMode="overlay">
          {glitter ? <ShiftGlitter img={glitter} u={u} sign={1} /> : null}
        </ShineLayer>
      </ShineLayer>

      {/* .card__glare — full-box pointer radial, hard-light, opacity card. */}
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={GLARE_M} blendMode="hardLight">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={center} r={radius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
