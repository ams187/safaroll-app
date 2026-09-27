// `sticker-holo` effect — Skia transliteration of
// pokemon-cards-151-main/public/css/cards/poke-ball-holo.css
// (`[data-rarity$="pokeball holo"]` / `"masterball holo"`), from the Scarlet &
// Violet 151 set. Follows the locked ShineLayer pattern of regular-holo.tsx.
//
// The 151 effect is a reverse holo whose foil is a *tiled silhouette*: hundreds
// of small Poké Balls scattered across the card, each one catching an
// iridescent gradient as the card turns.
//
// Here the motif is the animal's own die-cut. Nothing else in the app could
// stand in for a Poké Ball and mean anything; the capture's cut-out already
// carries alpha, so it masks exactly as the source's PNGs do. Two layers, as
// in the source's outer/inner ball pair:
//   :after  (outer) — the silhouette dilated into a halo ring, 45deg sunpillar,
//                     plus-lighter
//   :before (inner) — the silhouette itself, 225deg sunpillar over noise,
//                     lighten
//
// SafaRoll cards are generated, not scanned, so this runs the NO-MASK branch:
// `--foil: none` and the shine clips to `--clip-invert`
// (poke-ball-holo.css:267-271).

import { Fragment, useMemo } from "react";
import {
  Group,
  Image,
  ImageShader,
  LinearGradient,
  Mask,
  Morphology,
  Rect,
} from "@shopify/react-native-skia";
import type { SkImage } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { EffectProps } from "./types";
import { ShineLayer } from "./base";
import { CLIPS } from "./clips";
import {
  brightnessMatrix,
  concatColorMatrices,
  contrastMatrix,
  hsl,
  linearGradientPoints,
  saturateMatrix,
} from "../lib/css";
import { bgPosTranslate } from "./cssBackground";
import { SUNPILLAR } from "./sunpillar";

// --- the ball-scatter geometry -------------------------------------------
// `mask-size: 40% auto` with `mask-position: calc(seed * 500px)`
// (poke-ball-holo.css:156-159). 40% of the *mask box*, which for these two
// pseudo-elements is the card, so one motif is 40% of the card wide — the
// scatter reads as roughly two and a half motifs per row.
const MOTIF_SIZE = 40;
const MOTIF_SEED_SPAN = 500;
/** The outer ring is the same shape grown; 4/340 is the card's rim dilation. */
const RING_DILATION = 4 / 340;

// --- shine base ----------------------------------------------------------
// linear(45deg, 50%, 25%, 25%, 50% grey) scaled by --shine (:42-47, default .8).
const SHINE = 0.8;
const grey = (level: number) => hsl(0, 0, SHINE * level);
const SHINE_COLORS = [grey(50), grey(25), grey(25), grey(50)];
const SHINE_POS = [0.15, 0.45, 0.55, 0.85];
const SHINE_M = concatColorMatrices(brightnessMatrix(0.75), contrastMatrix(1), saturateMatrix(1)); // :54

// --- sunpillar stop lists ------------------------------------------------
// Both pseudo-elements walk the six sunpillar colours twice from index 3
// (`clr-4, clr-5, clr-6, clr-1, clr-2, clr-3` × 2, closing on clr-4) —
// poke-ball-holo.css:67-81 and :102-116. Thirteen stops, evenly spaced.
const SUN_FROM_4 = Array.from({ length: 13 }, (_, i) => SUNPILLAR[(i + 3) % 6]);
const SUN_POS = SUN_FROM_4.map((_, i) => i / 12);

const OUTER_BRIGHTNESS = 0.55; // :31
const INNER_BRIGHTNESS = 0.7; // :30

/**
 * The tiled motif, alpha only. `fit="none"` + repeat is the CSS
 * `background-repeat: repeat` on a `background-size`-scaled tile, exactly as
 * `TiledTexture` does for the shared foils — but this one has to keep the
 * image's aspect ratio (`mask-size: 40% auto`), so it scales uniformly.
 */
function MotifTile({
  dilate = 0,
  img,
  seedX,
  seedY,
  w,
  h,
}: {
  /** Grow the shape before tiling, for the source's outer/inner ball pair. */
  dilate?: number;
  img: SkImage;
  seedX: number;
  seedY: number;
  w: number;
  h: number;
}) {
  const tileW = (MOTIF_SIZE / 100) * w;
  const scale = tileW / img.width();
  return (
    <Rect x={0} y={0} width={w} height={h}>
      <ImageShader
        fit="none"
        image={img}
        transform={[
          { translateX: bgPosTranslate(0, tileW, w) + seedX * MOTIF_SEED_SPAN },
          { translateY: bgPosTranslate(0, img.height() * scale, h) + seedY * MOTIF_SEED_SPAN },
          { scaleX: scale },
          { scaleY: scale },
        ]}
        tx="repeat"
        ty="repeat"
      />
      {dilate > 0 ? <Morphology operator="dilate" radius={dilate} /> : null}
    </Rect>
  );
}

export function StickerHolo({ img, u }: EffectProps) {
  const { h, w } = u;

  // The whole effect is the motif. With no die-cut there is nothing to tile,
  // and a card mid-identification has none yet — it simply shows no foil.
  const shineClip = useMemo(() => CLIPS.clipInvert(w, h), [h, w]);

  // shine base: 45deg over a 200% tile, positioned at the pointer (:49-50).
  const baseLine = useMemo(() => linearGradientPoints(45, 2 * w, 2 * h), [h, w]);
  const baseStart = useDerivedValue(() => ({
    x: baseLine.start.x + bgPosTranslate(u.pointerX.value, 2 * w, w),
    y: baseLine.start.y + bgPosTranslate(u.pointerY.value, 2 * h, h),
  }));
  const baseEnd = useDerivedValue(() => ({
    x: baseLine.end.x + bgPosTranslate(u.pointerX.value, 2 * w, w),
    y: baseLine.end.y + bgPosTranslate(u.pointerY.value, 2 * h, h),
  }));

  // :after — 45deg sunpillar over a 200% 200% tile at the pointer (:83-84).
  const outerLine = useMemo(() => linearGradientPoints(45, 2 * w, 2 * h), [h, w]);
  const outerStart = useDerivedValue(() => ({
    x: outerLine.start.x + bgPosTranslate(u.pointerX.value, 2 * w, w),
    y: outerLine.start.y + bgPosTranslate(u.pointerY.value, 2 * h, h),
  }));
  const outerEnd = useDerivedValue(() => ({
    x: outerLine.end.x + bgPosTranslate(u.pointerX.value, 2 * w, w),
    y: outerLine.end.y + bgPosTranslate(u.pointerY.value, 2 * h, h),
  }));
  // saturate(pointer-from-center * 1.1) — :86. Animated, so it cannot be a
  // static ColorMatrix; the group opacity carries the rest.
  const outerOpacity = useDerivedValue(() => u.cardOpacity.value);

  // :before — 225deg over a 170% tile, and note the axes are *swapped*:
  // `background-position: var(--pointer-y) var(--pointer-x)` (:121). That
  // transposition is the source's, and it is what makes the inner motif drift
  // against the outer one instead of with it.
  const innerLine = useMemo(() => linearGradientPoints(225, 1.7 * w, 1.7 * h), [h, w]);
  const innerStart = useDerivedValue(() => ({
    x: innerLine.start.x + bgPosTranslate(u.pointerY.value, 1.7 * w, w),
    y: innerLine.start.y + bgPosTranslate(u.pointerX.value, 1.7 * h, h),
  }));
  const innerEnd = useDerivedValue(() => ({
    x: innerLine.end.x + bgPosTranslate(u.pointerY.value, 1.7 * w, w),
    y: innerLine.end.y + bgPosTranslate(u.pointerX.value, 1.7 * h, h),
  }));
  // opacity: card-opacity + pointer-from-center - 0.75 (:127), clamped.
  const innerOpacity = useDerivedValue(() =>
    Math.max(0, Math.min(1, u.cardOpacity.value + u.pointerFromCenter.value - 0.75)),
  );

  const outerM = useMemo(
    () => concatColorMatrices(brightnessMatrix(OUTER_BRIGHTNESS), contrastMatrix(1.8)),
    [],
  );
  const innerM = useMemo(
    () => concatColorMatrices(brightnessMatrix(INNER_BRIGHTNESS), contrastMatrix(2)),
    [],
  );

  return (
    <Fragment>
      <ShineLayer
        blendMode="colorDodge"
        clip={shineClip}
        h={h}
        matrix={SHINE_M}
        opacity={u.cardOpacity}
        w={w}
      >
        <Rect height={h} width={w} x={0} y={0}>
          <LinearGradient colors={SHINE_COLORS} end={baseEnd} positions={SHINE_POS} start={baseStart} />
        </Rect>

        {img ? (
          <Fragment>
            {/* :after — the outer ring, without the source's cursor-shaped
                cutout: on touch screens it reads as a large opaque circle. */}
            <ShineLayer blendMode="plusLighter" h={h} matrix={outerM} opacity={outerOpacity} w={w}>
              <Mask
                mode="alpha"
                mask={
                  <MotifTile
                    dilate={Math.max(0.5, w * RING_DILATION)}
                    h={h}
                    img={img}
                    seedX={u.seedX}
                    seedY={u.seedY}
                    w={w}
                  />
                }
              >
                <Rect height={h} width={w} x={0} y={0}>
                  <LinearGradient colors={SUN_FROM_4} end={outerEnd} positions={SUN_POS} start={outerStart} />
                </Rect>
              </Mask>
            </ShineLayer>

            {/* :before — the inner fill. The last rule drops the radial from its
                mask (:167-175), so this one keeps every motif lit. */}
            <ShineLayer blendMode="lighten" h={h} matrix={innerM} opacity={innerOpacity} w={w}>
              <Mask
                mode="alpha"
                mask={<MotifTile h={h} img={img} seedX={u.seedX} seedY={u.seedY} w={w} />}
              >
                <Rect height={h} width={w} x={0} y={0}>
                  <LinearGradient colors={SUN_FROM_4} end={innerEnd} positions={SUN_POS} start={innerStart} />
                </Rect>
                {/* the source layers --noise under the gradient with
                    background-blend-mode: darken (:117-122). */}
                <Group blendMode="darken">
                  <Image fit="cover" height={h} image={img} width={w} x={0} y={0} opacity={0.25} />
                </Group>
              </Mask>
            </ShineLayer>
          </Fragment>
        ) : null}
      </ShineLayer>

    </Fragment>
  );
}
