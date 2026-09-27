// `amazing-rare` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/amazing-rare.css
// (`[data-rarity="amazing rare"]`). Follows the locked ShineLayer pattern of
// regular-holo.tsx.
//
// .card__shine isolation group (color-dodge). The CSS masks ONLY the element
// background to the foil (base.css:321) and explicitly opts the pseudos OUT
// (`mask-image: none !important`, amazing-rare.css:40-41,65-66), so only the
// element bg is alpha-masked here; :before/:after render across the whole card.
//   element bg — glitter (soft-light) · glitter (color-burn) · pointer radial
//   :before    — foil (color-burn) · pointer radial; blend lighten, opacity .5
//   :after     — sunpillar repeating rainbow; blend saturation, animated
//                brightness(.75 - from-center*.5)
//
// Glare split by mask (amazing-rare.css "GLARE" vs "NO MASK"):
//   masked     — group radial (overlay) + a foil-masked :after radial (overlay)
//   non-masked — a single white pointer radial, blend multiply, no filter

import { Fragment, useMemo } from "react";
import { Group, Image, LinearGradient, Mask, RadialGradient, Rect } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { EffectProps } from "./types";
import { ShineLayer, TiledTexture } from "./base";
import { CLIPS } from "./clips";
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
import { bgPosTranslate, interpolateStopColor, normalizeRepeatingStops } from "./cssBackground";

// --- shine element bg radial (amazing-rare.css:22-28) --------------------
const SHINE_RADIAL_COLORS = [hsl(150, 20, 10, 1), hsl(177, 22, 80, 0.1), hsl(0, 0, 95, 0.98)];
const SHINE_RADIAL_POS = [0.1, 0.5, 0.9];

// --- :before radial (amazing-rare.css:44-50) -----------------------------
const BEFORE_RADIAL_COLORS = [hsl(50, 20, 90, 0.95), "rgba(181, 139, 164, 0.5)", hsl(0, 0, 0, 1)];
const BEFORE_RADIAL_POS = [0.1, 0.5, 0.6];

// --- :after sunpillar rainbow (amazing-rare.css:68-78) -------------------
// repeating-linear-gradient(133deg, clr-1..6 @ space*1..6, clr-1 @ space*7),
// --space 5% (cards.css:8), --angle 133deg (cards.css:9). On `.card__shine:after`
// the sunpillar aliases rotate to 6,1,2,3,4,5 (base.css:281-286).
const SUN_AFTER_COLORS = [
  hsl(283, 100, 73), // clr-1 = --sunpillar-6
  hsl(2, 100, 73), //   clr-2 = --sunpillar-1
  hsl(53, 100, 69), //  clr-3 = --sunpillar-2
  hsl(93, 100, 69), //  clr-4 = --sunpillar-3
  hsl(176, 100, 76), // clr-5 = --sunpillar-4
  hsl(228, 100, 74), // clr-6 = --sunpillar-5
  hsl(283, 100, 73), // clr-1 (7th, seamless)
];
const SUN = normalizeRepeatingStops([5, 10, 15, 20, 25, 30, 35]);

// --- glare radials --------------------------------------------------------
// masked bg (amazing-rare.css:101-107): 120% stop re-anchored to 1.0
// (t = (100-45)/(120-45)).
const GLARE_MASKED_COLORS = [
  hsl(50, 20, 90, 0.45),
  hsl(150, 20, 30, 0.45),
  interpolateStopColor(hsl(150, 20, 30, 0.45), hsl(0, 0, 0, 0.9), 55 / 75),
];
const GLARE_MASKED_POS = [0, 0.45, 1.0];
// masked :after (amazing-rare.css:122-128).
const GLARE_AFTER_COLORS = [hsl(50, 20, 90, 0.75), hsl(150, 20, 30, 0.65), hsl(0, 0, 0, 1)];
const GLARE_AFTER_POS = [0, 0.45, 0.9];
// non-masked (amazing-rare.css:156-162).
const GLARE_PLAIN_COLORS = [hsl(0, 0, 100, 1), hsl(0, 0, 100, 0.85), hsl(0, 0, 0, 0.35)];
const GLARE_PLAIN_POS = [0.1, 0.2, 0.9];

// --- filters --------------------------------------------------------------
const IDENTITY_M = brightnessMatrix(1); // brightness(1) contrast(1) saturate(1)
const SHINE_M = saturateMatrix(0.9); // brightness(1) contrast(1) saturate(.9) — :33
const GLARE_M = concatColorMatrices(brightnessMatrix(0.9), contrastMatrix(2)); // :109
const GLARE_AFTER_M = contrastMatrix(1.5); // brightness(1) contrast(1.5) — :130

export function AmazingRare({ u, foil, mask }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;
  const glitter = useTexture(textureImages.glitter);

  // Masked shine has no clip (the alpha mask shapes it); non-masked clips to
  // --clip (amazing-rare.css:152).
  const shineClip = useMemo(() => (masked ? undefined : CLIPS.clip(w, h)), [masked, w, h]);

  // Every amazing radial is a farthest-corner circle at the pointer.
  const center = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const radius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );

  // Sunpillar :after: 133deg line across the 4w x 8h tile (background-size
  // 400% 800%); the repeating period runs from the 5% stop to the 35% stop.
  const afterBase = useMemo(() => linearGradientPoints(133, 4 * w, 8 * h), [w, h]);
  const afterFirst = useMemo(
    () => ({
      x: afterBase.start.x + (SUN.first / 100) * (afterBase.end.x - afterBase.start.x),
      y: afterBase.start.y + (SUN.first / 100) * (afterBase.end.y - afterBase.start.y),
    }),
    [afterBase],
  );
  const afterLast = useMemo(
    () => ({
      x: afterBase.start.x + (SUN.last / 100) * (afterBase.end.x - afterBase.start.x),
      y: afterBase.start.y + (SUN.last / 100) * (afterBase.end.y - afterBase.start.y),
    }),
    [afterBase],
  );
  // background-position calc(50% + (50% - bg)*3) both axes (amazing-rare.css:81).
  const afterStart = useDerivedValue(() => ({
    x: afterFirst.x + bgPosTranslate(50 + (50 - u.backgroundX.value) * 3, 4 * w, w),
    y: afterFirst.y + bgPosTranslate(50 + (50 - u.backgroundY.value) * 3, 8 * h, h),
  }));
  const afterEnd = useDerivedValue(() => ({
    x: afterLast.x + bgPosTranslate(50 + (50 - u.backgroundX.value) * 3, 4 * w, w),
    y: afterLast.y + bgPosTranslate(50 + (50 - u.backgroundY.value) * 3, 8 * h, h),
  }));
  // filter: brightness(.75 - from-center*.5) contrast(1) saturate(1) — animated.
  const afterMatrix = useDerivedValue(() => brightnessMatrix(0.75 - u.pointerFromCenter.value * 0.5));

  // element bg: pointer radial (bottom) · glitter color-burn · glitter soft-light.
  const elementBg = (
    <Fragment>
      <Rect x={0} y={0} width={w} height={h}>
        <RadialGradient c={center} r={radius} colors={SHINE_RADIAL_COLORS} positions={SHINE_RADIAL_POS} />
      </Rect>
      {glitter ? (
        <Fragment>
          <Group blendMode="colorBurn">
            <TiledTexture img={glitter} w={w} h={h} sizeX={25} sizeY={25} posX={55} posY={55} />
          </Group>
          <Group blendMode="softLight">
            <TiledTexture img={glitter} w={w} h={h} sizeX={25} sizeY={25} posX={40} posY={45} />
          </Group>
        </Fragment>
      ) : null}
    </Fragment>
  );

  return (
    <Fragment>
      {/* .card__shine group (color-dodge, filter saturate .9, opacity card). */}
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={SHINE_M} blendMode="colorDodge" clip={shineClip}>
        {/* element bg only is foil-masked (pseudos are mask:none !important) */}
        {masked && mask ? (
          <Mask mode="alpha" mask={<Image image={mask} x={0} y={0} width={w} height={h} fit="cover" />}>
            {elementBg}
          </Mask>
        ) : (
          elementBg
        )}

        {/* :before (lighten, opacity .5): foil color-burn over a pointer radial */}
        <ShineLayer w={w} h={h} opacity={0.5} matrix={IDENTITY_M} blendMode="lighten">
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient c={center} r={radius} colors={BEFORE_RADIAL_COLORS} positions={BEFORE_RADIAL_POS} />
          </Rect>
          {foil ? (
            <Group blendMode="colorBurn">
              <Image image={foil} x={0} y={0} width={w} height={h} fit="cover" />
            </Group>
          ) : null}
        </ShineLayer>

        {/* :after (saturation): the sunpillar repeating rainbow */}
        <ShineLayer w={w} h={h} matrix={afterMatrix} blendMode="saturation">
          <Rect x={0} y={0} width={w} height={h}>
            <LinearGradient start={afterStart} end={afterEnd} colors={SUN_AFTER_COLORS} positions={SUN.positions} mode="repeat" />
          </Rect>
        </ShineLayer>
      </ShineLayer>

      {/* .card__glare */}
      {masked ? (
        <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={GLARE_M} blendMode="overlay">
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient c={center} r={radius} colors={GLARE_MASKED_COLORS} positions={GLARE_MASKED_POS} />
          </Rect>
          {/* :after — its own foil alpha-mask (amazing-rare.css:116-117), overlay */}
          <ShineLayer w={w} h={h} matrix={GLARE_AFTER_M} blendMode="overlay" mask={mask}>
            <Rect x={0} y={0} width={w} height={h}>
              <RadialGradient c={center} r={radius} colors={GLARE_AFTER_COLORS} positions={GLARE_AFTER_POS} />
            </Rect>
          </ShineLayer>
        </ShineLayer>
      ) : (
        <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={IDENTITY_M} blendMode="multiply">
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient c={center} r={radius} colors={GLARE_PLAIN_COLORS} positions={GLARE_PLAIN_POS} />
          </Rect>
        </ShineLayer>
      )}
    </Fragment>
  );
}
