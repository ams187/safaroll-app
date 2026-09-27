// `rainbow-alt` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/rainbow-alt.css
// (`[data-rarity="rare rainbow alt"]`, the Rainbow Alternate-Art holo). Follows
// the locked ShineLayer pattern of regular-holo.tsx / glitter-foil.tsx.
//
// SCOPE: rainbow-alt.css groups each rule with a second selector,
// `[data-rarity="rare holo vmax"][data-trainer-gallery="true"]` — that is
// gallery-max's shine (built in Task 20 from THIS cascade), NOT this effect's
// routing. Only the `rare rainbow alt` half is transliterated here; the gallery-max
// selectors are identical rules, so Task 20 reuses this component's recipe.
//
// Masking (base.css:321-333 masks `.card.masked` shine + ::before + ::after,
// but rainbow-alt.css:61-62 forces `::after { mask-image: none !important }`):
//   masked   -> element bg + ::before alpha-masked by the per-card mask; ::after
//               escapes. ::before draws the per-card --foil cover-fit.
//   NO-MASK  -> `--foil: none` (rainbow-alt.css:140-147) so ::before draws
//               nothing; nothing masked.
//
// .card__shine group (color-dodge, base default), opacity card-opacity:
//   element bg (blend luminosity, overlay -> bottom/normal rainbow, glitter
//     overlay, band luminosity): repeating(133deg 7-stop) · glitter ·
//     rainbow(-30deg).
//   ::before (color-dodge, opacity (pfc+.6)*.4): --foil, brightness(1.5) contrast(1.5).
//   ::after  (color-dodge, opacity 1.2 - pfc/2): rainbow(-60deg, bottom/normal) ·
//     glitter (overlay).
// .card__glare — full-box pointer radial, overlay (base default).

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
import { normalizeRepeatingStops } from "./cssBackground";
import { RepeatingBands, vFoil } from "./prismShared";

// --- rainbow palette (rainbow-alt.css:23-29, --r-clr-1..7) -----------------
const R1 = hsl(0, 57, 37);
const R2 = hsl(40, 53, 39);
const R3 = hsl(90, 60, 35);
const R4 = hsl(180, 60, 35);
const R5 = hsl(180, 60, 35); // identical to R4 in the CSS
const R6 = hsl(210, 57, 39);
const R7 = hsl(280, 55, 31);

// The 22-stop rainbow (r-clr-1..7 ×3 then r-clr-1), evenly spread 0..1; both
// endpoints r-clr-1 so `mode="repeat"` tiles seamlessly (rainbow-alt.css:43-48).
const RAINBOW = [R1, R2, R3, R4, R5, R6, R7, R1, R2, R3, R4, R5, R6, R7, R1, R2, R3, R4, R5, R6, R7, R1];
const RAINBOW_POS = RAINBOW.map((_, i) => i / (RAINBOW.length - 1));

// The repeating-linear-gradient(--angle=133deg) 7 hsla stops at --space*1..7
// (--space=5%, cards.css:8-9). rainbow-alt.css:32-41.
const BAND_COLORS = [
  hsl(283, 49, 60, 0.75),
  hsl(2, 70, 58, 0.75),
  hsl(53, 67, 53, 0.75),
  hsl(93, 56, 52, 0.75),
  hsl(176, 38, 50, 0.75),
  hsl(228, 100, 77, 0.75),
  hsl(283, 49, 61, 0.75),
];
const BAND = normalizeRepeatingStops([5, 10, 15, 20, 25, 30, 35]);
const BAND_ANGLE = 133;

const GLITTER_SIZE = 25; // --glittersize (cards.css:6)

// --- glare radial (rainbow-alt.css:110-117) --------------------------------
// hsla(50,20%,90%,.75) 0% · hsla(150,20%,30%,.65) 45% · hsla(0,0%,0%,1) 100%.
const GLARE_COLORS = [hsl(50, 20, 90, 0.75), hsl(150, 20, 30, 0.65), hsl(0, 0, 0, 1)];
const GLARE_POS = [0, 0.45, 1.0];

// --- static filters --------------------------------------------------------
const BEFORE_M = concatColorMatrices(brightnessMatrix(1.5), contrastMatrix(1.5)); // :90
const GLARE_M = concatColorMatrices(brightnessMatrix(0.9), contrastMatrix(2)); // :119

/**
 * The `.card__shine` isolation group (element bg + ::before + ::after) shared by
 * `[data-rarity="rare rainbow alt"]` and, via CSS cascade, gallery-max
 * (`[data-rarity="rare holo vmax"][data-trainer-gallery="true"]` — rainbow-alt.css
 * groups both selectors on every shine rule). Task 20 reuses this exact recipe;
 * the ONLY cascade difference is the band's `--space`, which leaks from max-prism.css
 * (`--space: 6%`) for gallery-max vs cards.css's default `5%` for rainbow-alt, so
 * the band period is parametrized by `bandSpace`. The glare differs entirely
 * between the two effects and is rendered by each caller separately.
 */
export function RainbowAltShine({
  u,
  foil,
  mask,
  bandSpace = 5,
}: Pick<EffectProps, "u" | "foil" | "mask"> & { bandSpace?: number }) {
  const { w, h } = u;
  const masked = !!mask;
  const glitter = useTexture(textureImages.glitter);

  // Animated filters (brightness depends on pointer-from-center).
  // element: brightness(pfc*.3+.3) contrast(3) saturate(1.8) (:53).
  const elemFilter = useDerivedValue(() =>
    concatColorMatrices(brightnessMatrix(u.pointerFromCenter.value * 0.3 + 0.3), contrastMatrix(3), saturateMatrix(1.8)),
  );
  // ::after: brightness(pfc*.5+.6) contrast(3) saturate(1) (:75).
  const afterFilter = useDerivedValue(() =>
    concatColorMatrices(brightnessMatrix(u.pointerFromCenter.value * 0.5 + 0.6), contrastMatrix(3), saturateMatrix(1)),
  );
  // ::before opacity (pfc+.6)*.4 (:91); ::after opacity 1.2 - pfc/2 clamped (:78);
  // glare opacity card-opacity*.75 (:120).
  const beforeOpacity = useDerivedValue(() => (u.pointerFromCenter.value + 0.6) * 0.4);
  const afterOpacity = useDerivedValue(() => Math.max(0, Math.min(1, 1.2 - u.pointerFromCenter.value / 2)));

  // background-position percentages (rainbow-alt.css:51, 74).
  const zeroPos = useDerivedValue(() => 0); // band posX = 0%
  const bandY = useDerivedValue(() => u.backgroundY.value); // band posY = background-y
  const elemRainbowX = useDerivedValue(() => 1.5 * u.backgroundX.value); // rainbow(-30) 1.5*bg
  const elemRainbowY = useDerivedValue(() => 1.5 * u.backgroundY.value);
  const afterRainbowX = useDerivedValue(() => -1.5 * u.backgroundX.value); // ::after rainbow(-60) -1.5*bg
  const afterRainbowY = useDerivedValue(() => -1.5 * u.backgroundY.value);

  // element bg painted bottom -> top (blend luminosity, overlay).
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
        <Group blendMode="overlay">
          <TiledTexture img={glitter} w={w} h={h} sizeX={GLITTER_SIZE} sizeY={GLITTER_SIZE} posX={50} posY={50} />
        </Group>
      ) : null}
      <Group blendMode="luminosity">
        <RepeatingBands
          u={u}
          angleDeg={BAND_ANGLE}
          colors={BAND_COLORS}
          stops={BAND.positions}
          firstPct={bandSpace}
          lastPct={bandSpace * 7}
          tileWmul={2}
          tileHmul={4}
          posX={zeroPos}
          posY={bandY}
        />
      </Group>
    </Fragment>
  );

  // ::after — rainbow(-60, bottom/normal) · glitter (overlay).
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
        <Group blendMode="overlay">
          <TiledTexture img={glitter} w={w} h={h} sizeX={GLITTER_SIZE} sizeY={GLITTER_SIZE} posX={50} posY={50} />
        </Group>
      ) : null}
    </Fragment>
  );

  return (
    // .card__shine group: color-dodge, elemFilter, opacity card.
    <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={elemFilter} blendMode="colorDodge">
      {masked && mask ? (
        <Mask mode="alpha" mask={<Image image={mask} x={0} y={0} width={w} height={h} fit="cover" />}>
          {elementBg}
        </Mask>
      ) : (
        elementBg
      )}

      {/* ::before — --foil (masked cover; NO-MASK none -> nothing), color-dodge,
          opacity (pfc+.6)*.4; masked with the card mask when masked. */}
      <ShineLayer
        w={w}
        h={h}
        opacity={beforeOpacity}
        matrix={BEFORE_M}
        blendMode="colorDodge"
        mask={masked ? mask : undefined}
      >
        {vFoil(masked ? foil : undefined, masked, w, h, 25, null)}
      </ShineLayer>

      {/* ::after — color-dodge, opacity 1.2 - pfc/2, unmasked. */}
      <ShineLayer w={w} h={h} opacity={afterOpacity} matrix={afterFilter} blendMode="colorDodge">
        {afterBg}
      </ShineLayer>
    </ShineLayer>
  );
}

export function RainbowAlt({ u, foil, mask }: EffectProps) {
  const { w, h } = u;

  // Full-box pointer radial (glare) center/radius (rainbow-alt.css:110-117).
  const center = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const radius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );
  const glareOpacity = useDerivedValue(() => u.cardOpacity.value * 0.75);

  return (
    <Fragment>
      <RainbowAltShine u={u} foil={foil} mask={mask} />

      {/* .card__glare — full-box pointer radial, overlay (base default). */}
      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="overlay">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={center} r={radius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
