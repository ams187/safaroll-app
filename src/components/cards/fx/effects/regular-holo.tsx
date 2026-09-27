// `regular-holo` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/regular-holo.css. Reference pattern for
// the remaining holo effect modules.
//
// Five CSS "surfaces" become five stacked ShineLayers (each a saveLayer that
// composites onto the running backdrop with its own filter + blend + opacity,
// exactly as base.tsx documents). CSS z-order, bottom -> top:
//   1. .card__shine        (blend color-dodge)  — rainbow tile OVER scanlines
//   2. .card__shine:before (blend hard-light)   — two bar gradients, screen
//   3. .card__shine:after  (blend luminosity)   — pointer radial
//   4. .card__glare        (blend overlay)       — base white radial, dimmed
//   5. .card__glare:after  (blend overlay)       — second pointer radial
//
// Per-CSS-element `background-image` lists (multiple layers with
// `background-blend-mode`) become multiple child draws inside one ShineLayer:
// the LAST-listed background is the bottom (drawn first, normal); each
// earlier-listed background is drawn above it wrapped in a <Group blendMode>.
//
// Modeling note: CSS `opacity`/`filter` on `.card__shine`/`.card__glare` create
// an isolation group that also wraps their ::before/::after. We instead
// composite each surface straight against the backdrop (the ShineLayer model
// this codebase already uses) — visually near-identical and far simpler than
// nesting saveLayers. Every ::before/::after inherits its parent's opacity
// (shine -> card-opacity; glare -> card-opacity*0.8) and the parent's
// clip-path (clip-path clips generated content), applied per layer below.

import { Fragment, useMemo } from "react";
import { Group, LinearGradient, RadialGradient, Rect } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { EffectProps } from "./types";
import { ShineLayer, GLARE_COLORS, GLARE_STOPS } from "./base";
import { CLIPS } from "./clips";
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

// --- colours -------------------------------------------------------------

// cards.css:12-16 --violet/--blue/--green/--yellow/--red, x3 (regular-holo.css:42-46).
const RAINBOW = [
  "#c929f1", "#0dbde9", "#21e985", "#eedf10", "#f80e35",
  "#c929f1", "#0dbde9", "#21e985", "#eedf10", "#f80e35",
  "#c929f1", "#0dbde9", "#21e985", "#eedf10", "#f80e35",
];
// repeating-linear-gradient with no explicit stops => 15 stops spread evenly.
const RAINBOW_POS = RAINBOW.map((_, i) => i / (RAINBOW.length - 1));

// Scanlines (regular-holo.css:47-50). @media <=900px forces --scanlines-space
// .5px (regular-holo.css:126-130); a phone is always <=900 CSS px, so period =
// .5*4 = 2px: dark 0->1px, light 1->2px. --scanlines-dark black, --light #666.
const SCAN_COLORS = [
  "rgba(0, 0, 0, 1)", "rgba(0, 0, 0, 1)",
  "rgba(102, 102, 102, 1)", "rgba(102, 102, 102, 1)",
];
const SCAN_POS = [0, 0.5, 0.5, 1];
const SCAN_PERIOD = 2; // px, 90deg => horizontal; background-position:center only shifts phase.

// :before bars (regular-holo.css:35-37, 70-90). --bar-bg black, --bar-color
// hsla(0,0%,70%); stops at --bars(3%) * [2,3,3.5,4,5,{14|10}] percent of the
// 200%-scaled line. A repeating gradient tiles the first..last span.
const BAR_BG = "rgba(0, 0, 0, 1)";
const BAR_COLOR = hsl(0, 0, 70);
const BAR_COLORS = [BAR_BG, BAR_COLOR, BAR_BG, BAR_COLOR, BAR_BG, BAR_BG];
const BAR1 = normalizeRepeatingStops([6, 9, 10.5, 12, 15, 42]);
const BAR2 = normalizeRepeatingStops([6, 9, 10.5, 12, 15, 30]);
const BAR_TILE = 2; // background-size 200%

// :after pointer radial (regular-holo.css:106-113).
const AFTER_COLORS = [hsl(0, 0, 90, 0.8), hsl(0, 0, 78, 0.1), hsl(0, 0, 0)];
const AFTER_POS = [0, 0.25, 0.9];

// glare:after radial (regular-holo.css:155-161). The 110% stop is past Skia's
// clamped domain: place the colour CSS shows at exactly 100% (interpolated
// between the 55% and 110% stops) at position 1.0.
const GLARE_AFTER_COLORS = [
  hsl(180, 100, 95),
  hsl(0, 0, 39, 0.25),
  interpolateStopColor(hsl(0, 0, 39, 0.25), hsl(0, 0, 0, 0.36), (100 - 55) / (110 - 55)),
];
const GLARE_AFTER_POS = [0.05, 0.55, 1.0];

// --- filters (filter: brightness()/contrast()/saturate()) ----------------

const SHINE_M = concatColorMatrices(brightnessMatrix(1.1), contrastMatrix(1.1), saturateMatrix(1.2)); // :61
const BEFORE_M = concatColorMatrices(brightnessMatrix(1.15), contrastMatrix(1.1)); // :97
const AFTER_M = concatColorMatrices(brightnessMatrix(0.6), contrastMatrix(4)); // :122
const GLARE_M = concatColorMatrices(brightnessMatrix(0.8), contrastMatrix(1.5)); // :146
const GLARE_AFTER_M = concatColorMatrices(brightnessMatrix(0.6), contrastMatrix(3)); // :164

const clipPathFor = (variant: string, w: number, h: number) =>
  (variant === "stage" ? CLIPS.clipStage : variant === "trainer" ? CLIPS.clipTrainer : CLIPS.clip)(w, h);

export function RegularHolo({ u, clipVariant = "base", glareClipVariant = "base" }: EffectProps) {
  const { w, h } = u;

  // Shine clip-path (regular-holo.css:39, subtype-only) and glare:after
  // clip-path (base.css:347 adds the trainer-supertype rule) can differ.
  const shineClip = useMemo(() => clipPathFor(clipVariant, w, h), [clipVariant, w, h]);
  const glareClip = useMemo(() => clipPathFor(glareClipVariant, w, h), [glareClipVariant, w, h]);

  // Rainbow: 400% tile (regular-holo.css:56-58), animated background-position
  // (:52-54). linearGradientPoints gives the 110deg line across the 4w x 4h
  // tile; TileMode.Repeat tiles it (the x3 colour list IS the repeat), and the
  // bg-position shift moves the whole line. Fixed w x h rect + animated
  // start/end (not a Group transform) keeps the drawn area at 1x, not ~99x.
  const rainbowBase = useMemo(() => linearGradientPoints(110, 4 * w, 4 * h), [w, h]);
  const rainbowShift = useDerivedValue(() => ({
    tx: bgPosTranslate((50 - u.backgroundX.value) * 2.6 + 50, 4 * w, w),
    ty: bgPosTranslate((50 - u.backgroundY.value) * 3.5 + 50, 4 * h, h),
  }));
  const rainbowStart = useDerivedValue(() => ({
    x: rainbowBase.start.x + rainbowShift.value.tx,
    y: rainbowBase.start.y + rainbowShift.value.ty,
  }));
  const rainbowEnd = useDerivedValue(() => ({
    x: rainbowBase.end.x + rainbowShift.value.tx,
    y: rainbowBase.end.y + rainbowShift.value.ty,
  }));

  // Bars: 200% tiles, 90deg horizontal. Only background-position X matters to a
  // horizontal gradient (the CSS Y term is a no-op here). Start/end pin the
  // first/last stop of one repeat period on the shifted tile. (regular-holo.css:88-90)
  const bar1Off = useDerivedValue(() =>
    bgPosTranslate((50 - u.backgroundX.value) * 1.65 + 50 + u.backgroundY.value * 0.5, BAR_TILE * w, w),
  );
  const bar1Start = useDerivedValue(() => ({ x: bar1Off.value + (BAR1.first / 100) * BAR_TILE * w, y: 0 }));
  const bar1End = useDerivedValue(() => ({ x: bar1Off.value + (BAR1.last / 100) * BAR_TILE * w, y: 0 }));
  const bar2Off = useDerivedValue(() =>
    bgPosTranslate((50 - u.backgroundX.value) * -0.9 + 50 - u.backgroundY.value * 0.75, BAR_TILE * w, w),
  );
  const bar2Start = useDerivedValue(() => ({ x: bar2Off.value + (BAR2.first / 100) * BAR_TILE * w, y: 0 }));
  const bar2End = useDerivedValue(() => ({ x: bar2Off.value + (BAR2.last / 100) * BAR_TILE * w, y: 0 }));

  // Pointer radials (:after shine, glare, glare:after) — identical geometry.
  const center = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const radius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );
  const glareOpacity = useDerivedValue(() => u.cardOpacity.value * 0.8);

  // Two isolation groups (shine, glare), each a saveLayer holding its element
  // background plus nested ::before/::after saveLayers. Inner layers carry only
  // their own blend + filter; the ONE CSS opacity and the group filter live on
  // the outer Paint and apply once to the combined surface (CSS truth). Radial
  // stops with varying alpha interpolate in straight (non-premultiplied) RGB —
  // a known Skia-vs-CSS engine difference, monitored via the pixel-diff pipeline.
  return (
    <Fragment>
      {/* .card__shine isolation group: element bg + :before + :after, then the
          group's own filter(SHINE_M)/opacity(card)/color-dodge onto the card.
          clip-path clips the whole group incl. the pseudo-elements. */}
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={SHINE_M} blendMode="colorDodge" clip={shineClip}>
        {/* element bg: scanlines (bottom) + rainbow tile (overlay, top) */}
        <Rect x={0} y={0} width={w} height={h}>
          <LinearGradient
            start={{ x: 0, y: 0 }}
            end={{ x: SCAN_PERIOD, y: 0 }}
            colors={SCAN_COLORS}
            positions={SCAN_POS}
            mode="repeat"
          />
        </Rect>
        <Group blendMode="overlay">
          <Rect x={0} y={0} width={w} height={h}>
            <LinearGradient start={rainbowStart} end={rainbowEnd} colors={RAINBOW} positions={RAINBOW_POS} mode="repeat" />
          </Rect>
        </Group>

        {/* :before — hard-light against the bg, filter BEFORE_M (bars 2 then 1 screen) */}
        <ShineLayer w={w} h={h} matrix={BEFORE_M} blendMode="hardLight">
          <Rect x={0} y={0} width={w} height={h}>
            <LinearGradient start={bar2Start} end={bar2End} colors={BAR_COLORS} positions={BAR2.positions} mode="repeat" />
          </Rect>
          <Group blendMode="screen">
            <Rect x={0} y={0} width={w} height={h}>
              <LinearGradient start={bar1Start} end={bar1End} colors={BAR_COLORS} positions={BAR1.positions} mode="repeat" />
            </Rect>
          </Group>
        </ShineLayer>

        {/* :after — luminosity against bg+before, filter AFTER_M (pointer radial) */}
        <ShineLayer w={w} h={h} matrix={AFTER_M} blendMode="luminosity">
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient c={center} r={radius} colors={AFTER_COLORS} positions={AFTER_POS} />
          </Rect>
        </ShineLayer>
      </ShineLayer>

      {/* .card__glare isolation group: element bg (base white radial) + :after,
          then group filter(GLARE_M)/opacity(card*0.8)/overlay onto the card.
          The element itself is NOT clipped; only :after is (its own clip below). */}
      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="overlay">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={center} r={radius} colors={GLARE_COLORS} positions={GLARE_STOPS} />
        </Rect>

        {/* :after — overlay against the base radial, filter GLARE_AFTER_M, clipped */}
        <ShineLayer w={w} h={h} matrix={GLARE_AFTER_M} blendMode="overlay" clip={glareClip}>
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient c={center} r={radius} colors={GLARE_AFTER_COLORS} positions={GLARE_AFTER_POS} />
          </Rect>
        </ShineLayer>
      </ShineLayer>
    </Fragment>
  );
}
