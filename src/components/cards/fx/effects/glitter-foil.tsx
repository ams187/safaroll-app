// `glitter-foil` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/glitter-foil.css, the exact
// `[data-rarity="rare secret"][data-set="swsh12pt5"][data-number="160"]`
// promo (the "Rainbow secret" glitter).
//
// CASCADE: this "rare secret" card ALSO matches secret-rare.css's
// `[data-rarity="rare secret"]` rules, but every glitter-foil.css selector adds
// two more attribute selectors (specificity 0,5,0 vs secret-rare's 0,3,0) AND
// loads later (index.html:59 vs :51), so glitter-foil.css wins EVERY property it
// declares. The ONLY thing that survives from secret-rare.css is `--shift: 1px`
// (secret-rare.css:19) — the glitter jitter amount used below — and, for the
// NO-MASK branch only, `--imgsize` is instead set to 33% by glitter-foil.css:140
// (masked keeps secret-rare.css:21's `cover`). Task 18 will transliterate
// secret-rare.css itself; the overlap is limited to those declarations.
//
// .card__shine isolation group (color-dodge, base.css default). Only the element
// bg is foil-masked (base.css:321); ::before/::after carry `mask-image:none
// !important` (glitter-foil.css:59-60; secret-rare.css:50-51 for ::before), so
// they render across the whole card — the amazing-rare masking shape.
//   element bg (blend luminosity,soft-light): linear(-30deg 22-stop rainbow,
//     bottom/normal) · glitter (soft-light) · linear(-45deg r1→r5, luminosity)
//   ::before (blend MULTIPLY, opacity (pfc+.4)*.6): --foil (per-card cover when
//     masked / illusion-mask.png @33% NO-MASK), filter brightness2.5
//   ::after  (blend EXCLUSION): linear(-60deg 22-stop rainbow, bottom/normal) ·
//     glitter (soft-light)
// .card__glare — a full-box pointer radial (130% stop re-anchored), hard-light.

import { Fragment } from "react";
import { Group, ImageShader, Mask, Image, RadialGradient, Rect } from "@shopify/react-native-skia";
import type { SkImage } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { CardUniforms, EffectProps } from "./types";
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
import { bgPosTranslate, interpolateStopColor } from "./cssBackground";
import { RepeatingBands, vFoil } from "./prismShared";

// --- rainbow palette (glitter-foil.css:20-27, --r-clr-1..7) ---------------
const R1 = hsl(0, 57, 37);
const R2 = hsl(40, 53, 39);
const R3 = hsl(90, 60, 35);
const R4 = hsl(180, 60, 35);
const R5 = hsl(180, 60, 35); // identical to R4 in the CSS
const R6 = hsl(210, 57, 39);
const R7 = hsl(280, 55, 31);

// The 22-stop rainbow (r-clr-1..7 ×3 then r-clr-1) with no explicit positions =>
// evenly spread 0..1; endpoints both r-clr-1 so `mode="repeat"` tiles seamlessly.
const RAINBOW = [R1, R2, R3, R4, R5, R6, R7, R1, R2, R3, R4, R5, R6, R7, R1, R2, R3, R4, R5, R6, R7, R1];
const RAINBOW_POS = RAINBOW.map((_, i) => i / (RAINBOW.length - 1));
// The 2-stop -45deg diagonal (r-clr-1 -> r-clr-5), tiled at 200%.
const DIAG_COLORS = [R1, R5];
const DIAG_POS = [0, 1];

// --shift (secret-rare.css:19) — the glitter position jitter, in px.
const SHIFT = 1;
const GLITTER_SIZE = 25; // --glittersize (cards.css:6)

// --- glare radial (glitter-foil.css:114) ---------------------------------
// hsl(0,0%,80%) 0% · hsla(0,0%,74.9%,.25) 30% · hsl(0,0%,21.6%) 130%.
// 130% stop re-anchored to 1.0 at t=(100-30)/(130-30)=0.7.
const GLARE_COLORS = [hsl(0, 0, 80), hsl(0, 0, 74.9, 0.25), interpolateStopColor(hsl(0, 0, 74.9, 0.25), hsl(0, 0, 21.6), 0.7)];
const GLARE_POS = [0, 0.3, 1.0];

// --- filters --------------------------------------------------------------
const BEFORE_M = brightnessMatrix(2.5); // brightness(2.5) contrast(1) — :93
const GLARE_M = concatColorMatrices(brightnessMatrix(0.9), contrastMatrix(2)); // brightness(.9) contrast(2) — :116

/**
 * The `--glitter` layer at `background-size: 25% 25%`, position
 * `50% ± (--shift px)` jittered by the pointer:
 *   element ::  `50% - (2·shift)·pfl + shift`  -> px = shift·(1 - 2·pfl)  (sign=+1)
 *   ::after  ::  `50% - (2·shift)·pfl - shift`  -> px = shift·(-1 - 2·pfl) (sign=-1)
 * i.e. px = shift·sign - 2·shift·pfl (same for the Y axis with pft). A ±1px
 * jitter — sub-pixel, but modeled to match the CSS exactly. Shared shape with
 * secret-rare.css:82 (Task 18).
 */
export function ShiftGlitter({ img, u, sign }: { img: SkImage; u: CardUniforms; sign: number }) {
  const { w, h } = u;
  const tileW = (GLITTER_SIZE / 100) * w;
  const tileH = (GLITTER_SIZE / 100) * h;
  const scaleX = tileW / img.width();
  const scaleY = tileH / img.height();
  const baseX = bgPosTranslate(50, tileW, w);
  const baseY = bgPosTranslate(50, tileH, h);
  const transform = useDerivedValue(() => [
    { translateX: baseX + SHIFT * sign - 2 * SHIFT * u.pointerFromLeft.value },
    { translateY: baseY + SHIFT * sign - 2 * SHIFT * u.pointerFromTop.value },
    { scaleX },
    { scaleY },
  ]);
  return (
    <Rect x={0} y={0} width={w} height={h}>
      <ImageShader image={img} fit="none" tx="repeat" ty="repeat" transform={transform} />
    </Rect>
  );
}

export function GlitterFoil({ u, foil, mask }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;
  const glitter = useTexture(textureImages.glitter);
  const illusionMask = useTexture(textureImages["illusion-mask"]);

  // Full-box pointer radial (glare) center/radius.
  const center = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const radius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );

  // element outer filter: brightness(pfc*.5+.75) contrast2 saturate1 (:51).
  const elemFilter = useDerivedValue(() =>
    concatColorMatrices(brightnessMatrix(u.pointerFromCenter.value * 0.5 + 0.75), contrastMatrix(2), saturateMatrix(1)),
  );
  // ::after filter: brightness(pfc*.35+.35) contrast2 saturate1 (:81).
  const afterFilter = useDerivedValue(() =>
    concatColorMatrices(brightnessMatrix(u.pointerFromCenter.value * 0.35 + 0.35), contrastMatrix(2), saturateMatrix(1)),
  );
  // ::before opacity: (pfc+.4)*.6 (:95); glare opacity: pfc*.9 (:117).
  const beforeOpacity = useDerivedValue(() => (u.pointerFromCenter.value + 0.4) * 0.6);
  const glareOpacity = useDerivedValue(() => u.pointerFromCenter.value * 0.9);

  // element linear-30 rainbow position calc(25% + pointer/2) both axes (:49).
  const elemRainbowX = useDerivedValue(() => 25 + u.pointerX.value / 2);
  const elemRainbowY = useDerivedValue(() => 25 + u.pointerY.value / 2);
  // element linear-45 position calc(25% + 50%*pfl / pft) (:47).
  const diagX = useDerivedValue(() => 25 + 50 * u.pointerFromLeft.value);
  const diagY = useDerivedValue(() => 25 + 50 * u.pointerFromTop.value);
  // ::after linear-60 rainbow position = pointer-x pointer-y (:79).
  const afterRainbowX = useDerivedValue(() => u.pointerX.value);
  const afterRainbowY = useDerivedValue(() => u.pointerY.value);

  // element bg, painted bottom -> top per background-blend-mode luminosity,
  // soft-light (3 layers -> bottom normal, glitter soft-light, diag luminosity).
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
          <ShiftGlitter img={glitter} u={u} sign={1} />
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

  // ::after — linear-60 rainbow (bottom/normal) · glitter (soft-light).
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
          <ShiftGlitter img={glitter} u={u} sign={-1} />
        </Group>
      ) : null}
    </Fragment>
  );

  // ::before foil: masked -> per-card foil cover; NO-MASK -> illusion-mask @33%.
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

        {/* ::before — foil (masked cover / NO-MASK illusion-mask @33%), MULTIPLY,
            opacity (pfc+.4)*.6; unmasked. Drawn before ::after (no z-index
            override -> ::after paints on top). */}
        <ShineLayer w={w} h={h} opacity={beforeOpacity} matrix={BEFORE_M} blendMode="multiply">
          {vFoil(beforeFoilImg, masked, w, h, 33, null)}
        </ShineLayer>

        {/* ::after — EXCLUSION, unmasked */}
        <ShineLayer w={w} h={h} matrix={afterFilter} blendMode="exclusion">
          {afterBg}
        </ShineLayer>
      </ShineLayer>

      {/* .card__glare — full-box pointer radial, hard-light */}
      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="hardLight">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={center} r={radius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
