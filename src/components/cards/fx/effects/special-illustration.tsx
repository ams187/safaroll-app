// `special-illustration` effect — Skia transliteration of
// pokemon-cards-151-main/public/css/cards/ex-special-illustration-rare.css
// (`[data-rarity="special illustration rare"]`), from the Scarlet & Violet 151
// set. Follows the locked ShineLayer pattern of regular-holo.tsx.
//
// What makes this card different from every other effect in the port: its two
// silver beams take their ANGLE from the tilt itself —
//
//   linear-gradient( calc((var(--rotate-x) - var(--rotate-delta)) * -0.25), … )
//   linear-gradient( calc((var(--rotate-x) - var(--rotate-delta)) *  0.25), … )
//
// (:36-41). Card.svelte sets `--rotate-x: $springRotate.x + $springRotateDelta.x`
// and `--rotate-delta: $springRotateDelta.x` (:253-255), so the subtraction
// cancels the delta exactly and both angles are `$springRotate.x * ±0.25`.
// That is `u.rotate`. The two beams therefore counter-rotate around each other
// as the card turns — the light scissors open and shut instead of sliding
// across, which is the whole signature of the card.
//
// Three layers, drawn bottom -> top inside the shine group (brightness .6,
// contrast 1.5 — :27):
//   :before (z 2, overlay)    — 15deg repeating sunpillar over a 240% tile
//   :after  (z 3, hard-light) — the two beams, blended `exclusion` with each
//                               other, contrast .75
//
// Les `.card__glitter` (:82-148) SONT portées, en branche NO-MASK.
//
// Elles ne l'étaient pas, et la carte en mourait. Ce qui reste sans elles, ce
// sont deux faisceaux `#000 → #797979 → #000` composés en `colorDodge` : sur du
// noir, colorDodge ne change rien. Sur l'illustration sombre d'origine la bande
// argentée claque ; sur une carte SafaRoll claire, un légendaire ne scintillait
// pas du tout — un panda géant rendu plus terne qu'un moineau.
//
// La CSS les masque par `var(--mask)` en mode luminance. Une carte SafaRoll n'a
// pas de masque, et la feuille de style les laisse alors pleine page : c'est
// exactement ce que fait chaque autre effet du port, et ce fichier n'avait
// simplement pas de branche à exécuter. Elle existe maintenant.
//
//   .card__glitter        (:82)  --iri9, plus-lighter, contrast 2 saturate 1.2
//   .card__glitter:before (:108) --iri8, overlay, décalé de +shift
//   .card__glitter:after  (:138) --iri7, overlay, décalé de -shift
//
// Les trois `--iri` sont la même planche de paillettes dans ce port ; ce qui
// les distingue est le décalage opposé et l'opacité croisée sur
// `--pointer-from-top`, donc l'une prend la main quand l'autre s'efface.

import { Fragment, useMemo } from "react";
import { Group, LinearGradient, RadialGradient, Rect } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { EffectProps } from "./types";
import { ShineLayer } from "./base";
import { ShiftGlitter } from "./glitter-foil";
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
import { bgPosTranslate } from "./cssBackground";
import { SUNPILLAR } from "./sunpillar";

// --- the two beams -------------------------------------------------------
// black 24%, #797979 30%, black 36% — a narrow silver band on black (:37, :40).
const BEAM_COLORS = ["#000000", "#797979", "#000000"];
const BEAM_POS = [0.24, 0.3, 0.36];
/** How much of the tilt each beam takes, in degrees per degree (:36, :39). */
const BEAM_ANGLE_RATIO = 0.25;
/** background-position: 50% (background-y * 1.7) and 50% (background-y * -1.3) — :44-45. */
const BEAM_A_DRIFT = 1.7;
const BEAM_B_DRIFT = -1.3;
const BEAM_TILE = 3; // background-size: 300% 300% (:48)

// --- the holo band -------------------------------------------------------
// repeating-linear-gradient(15deg, --holo, --holo, --holo) where --holo is the
// six sunpillar colours closing on the first (151 base.css:42). Repeated three
// times over one 240% tile (:63-73).
const HOLO_COLORS = [...SUNPILLAR, SUNPILLAR[0]];
const HOLO_POS = HOLO_COLORS.map((_, i) => i / (HOLO_COLORS.length - 1));
const HOLO_TILE = 2.4;

// --- filters -------------------------------------------------------------
const SHINE_M = concatColorMatrices(brightnessMatrix(0.6), contrastMatrix(1.5), saturateMatrix(1)); // :27
const BEAM_M = contrastMatrix(0.75); // :51
const HOLO_M = contrastMatrix(0.75); // :75
const GLARE_M = contrastMatrix(1.5); // :174

// .card__glare radial: hsl(0 0% 80%) 10% -> hsl(0 0% 50%) 70% (:167-171).
const GLARE_COLORS = [hsl(0, 0, 80), hsl(0, 0, 50)];
const GLARE_POS = [0.1, 0.7];

// --- les paillettes ------------------------------------------------------
// .card__glitter : brightness(1) contrast(2) saturate(1.2) — :90.
const GLITTER_M = concatColorMatrices(brightnessMatrix(1), contrastMatrix(2), saturateMatrix(1.2));
// :before et :after : brightness(2) contrast(1.2) saturate(2) — :117.
const GLITTER_SHIFT_M = concatColorMatrices(brightnessMatrix(2), contrastMatrix(1.2), saturateMatrix(2));

export function SpecialIllustration({ u }: EffectProps) {
  const { h, w } = u;
  const glitter = useTexture(textureImages.glitter);

  // Both beams share one 300% tile; only the angle and the vertical drift
  // differ. The angle is live, so unlike every other effect in the port the
  // gradient line is rebuilt per frame instead of precomputed.
  const beamA = useDerivedValue(() => {
    const line = linearGradientPoints(u.rotate.value * -BEAM_ANGLE_RATIO, BEAM_TILE * w, BEAM_TILE * h);
    const dx = bgPosTranslate(50, BEAM_TILE * w, w);
    const dy = bgPosTranslate(u.backgroundY.value * BEAM_A_DRIFT, BEAM_TILE * h, h);
    return {
      start: { x: line.start.x + dx, y: line.start.y + dy },
      end: { x: line.end.x + dx, y: line.end.y + dy },
    };
  });
  const beamB = useDerivedValue(() => {
    const line = linearGradientPoints(u.rotate.value * BEAM_ANGLE_RATIO, BEAM_TILE * w, BEAM_TILE * h);
    const dx = bgPosTranslate(50, BEAM_TILE * w, w);
    const dy = bgPosTranslate(u.backgroundY.value * BEAM_B_DRIFT, BEAM_TILE * h, h);
    return {
      start: { x: line.start.x + dx, y: line.start.y + dy },
      end: { x: line.end.x + dx, y: line.end.y + dy },
    };
  });
  const beamAStart = useDerivedValue(() => beamA.value.start);
  const beamAEnd = useDerivedValue(() => beamA.value.end);
  const beamBStart = useDerivedValue(() => beamB.value.start);
  const beamBEnd = useDerivedValue(() => beamB.value.end);

  // :before — 15deg, static position (center center), 240% tile.
  const holoLine = useMemo(() => linearGradientPoints(15, HOLO_TILE * w, HOLO_TILE * h), [h, w]);
  const holoStart = useMemo(
    () => ({
      x: holoLine.start.x + bgPosTranslate(50, HOLO_TILE * w, w),
      y: holoLine.start.y + bgPosTranslate(50, HOLO_TILE * h, h),
    }),
    [h, holoLine, w],
  );
  const holoEnd = useMemo(
    () => ({
      x: holoLine.end.x + bgPosTranslate(50, HOLO_TILE * w, w),
      y: holoLine.end.y + bgPosTranslate(50, HOLO_TILE * h, h),
    }),
    [h, holoLine, w],
  );

  const glareCenter = useDerivedValue(() => ({
    x: pct(u.pointerX.value, w),
    y: pct(u.pointerY.value, h),
  }));
  const glareRadius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );

  // opacity: calc(--card-opacity * (.2 + --pointer-from-center * .5)) — :103.
  const glitterOpacity = useDerivedValue(
    () => u.cardOpacity.value * (0.2 + u.pointerFromCenter.value * 0.5),
  );
  // Les deux couches décalées se relaient : `opacity: --pointer-from-top` pour
  // l'une (:126), son complément pour l'autre (:147). Incliner la carte fait
  // donc passer le scintillement d'une planche à l'autre au lieu de le faire
  // seulement glisser.
  const glitterTopOpacity = useDerivedValue(() => u.cardOpacity.value * u.pointerFromTop.value);
  const glitterBottomOpacity = useDerivedValue(
    () => u.cardOpacity.value * (1 - u.pointerFromTop.value),
  );

  return (
    <Fragment>
      {/* Full-bleed, as the source is: a special illustration rare IS full art.
          Nothing here can bury the card's text — the name, the plate and the
          pill are a React view stacked ON TOP of the Skia canvas, not inside
          it. */}
      <ShineLayer blendMode="colorDodge" h={h} matrix={SHINE_M} opacity={u.cardOpacity} w={w}>
        {/* :before (z-index 2) — the holo band, three periods over one tile. */}
        <ShineLayer blendMode="overlay" h={h} matrix={HOLO_M} w={w}>
          <Rect height={h} width={w} x={0} y={0}>
            <LinearGradient
              colors={HOLO_COLORS}
              end={holoEnd}
              mode="repeat"
              positions={HOLO_POS}
              start={holoStart}
            />
          </Rect>
        </ShineLayer>

        {/* :after (z-index 3) — the scissoring beams. `background-blend-mode:
            exclusion` blends the two gradients *with each other* inside the
            pseudo-element, before its own hard-light hits the card. */}
        <ShineLayer blendMode="hardLight" h={h} matrix={BEAM_M} w={w}>
          <Rect height={h} width={w} x={0} y={0}>
            <LinearGradient
              colors={BEAM_COLORS}
              end={beamBEnd}
              mode="repeat"
              positions={BEAM_POS}
              start={beamBStart}
            />
          </Rect>
          <Group blendMode="exclusion">
            <Rect height={h} width={w} x={0} y={0}>
              <LinearGradient
                colors={BEAM_COLORS}
                end={beamAEnd}
                mode="repeat"
                positions={BEAM_POS}
                start={beamAStart}
              />
            </Rect>
          </Group>
        </ShineLayer>
      </ShineLayer>

      {/* .card__glitter — pleine page, faute de masque. C'est cette couche qui
          porte tout le scintillement de la carte. */}
      {glitter ? (
        <Fragment>
          <ShineLayer
            blendMode="plusLighter"
            h={h}
            matrix={GLITTER_M}
            opacity={glitterOpacity}
            w={w}
          >
            <ShiftGlitter img={glitter} sign={0} u={u} />
          </ShineLayer>
          <ShineLayer
            blendMode="overlay"
            h={h}
            matrix={GLITTER_SHIFT_M}
            opacity={glitterTopOpacity}
            w={w}
          >
            <ShiftGlitter img={glitter} sign={1} u={u} />
          </ShineLayer>
          <ShineLayer
            blendMode="overlay"
            h={h}
            matrix={GLITTER_SHIFT_M}
            opacity={glitterBottomOpacity}
            w={w}
          >
            <ShiftGlitter img={glitter} sign={-1} u={u} />
          </ShineLayer>
        </Fragment>
      ) : null}

      {/* .card__glare — multiply, not the usual overlay (:173). */}
      <ShineLayer blendMode="multiply" h={h} matrix={GLARE_M} opacity={u.cardOpacity} w={w}>
        <Rect height={h} width={w} x={0} y={0}>
          <RadialGradient c={glareCenter} colors={GLARE_COLORS} positions={GLARE_POS} r={glareRadius} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
