// `gallery-holo` effect — Skia transliteration of the trainer-gallery holo
// (`.card[data-rarity="rare holo"][data-trainer-gallery="true"]` and its promo
// alias `[data-set="swshp"][data-number="swsh020"]`) from
// pokemon-cards-css/public/css/cards/trainer-gallery-holo.css.
//
// CASCADE: the card's effective rarity is "rare holo", so regular-holo.css's
// unconditional `[data-rarity="rare holo"]` rules also match — but every
// trainer-gallery-holo.css selector adds `[data-trainer-gallery="true"]`
// (specificity 0,4,0 > regular-holo's 0,3,0), so it wins every property it
// declares. What LEAKS from the lower-specificity rules (properties gallery-holo does
// NOT set):
//   .card__shine  mix-blend-mode: color-dodge (base.css:257 / regular-holo:62).
//   .card__glare  opacity: card*.8 + filter: brightness(.8) contrast(1.5)
//                 (regular-holo.css:143-149; tg only sets the radial + soft-light).
// gallery-holo DISABLES .card__shine:before and .card__glare:after (content:none).
// A masked card (base.css:321) alpha-masks the shine + ::after to the foil, on
// top of the `--clip-borders` clip the shine group carries.
//
// .card__shine group (color-dodge, opacity card, clip --clip-borders):
//   element bg  — one repeating band (angle -22deg, 7 hsla stops @ space*1..7,
//     space 5%), 300%x400% tile, position 0% background-y.
//   ::after     — a farthest-corner ELLIPSE pointer radial, 400%x500% box at
//     center, blend hard-light.
// .card__glare — a farthest-corner circle pointer radial, blend soft-light.

import { Fragment, useMemo } from "react";
import { Image, Mask, RadialGradient, Rect } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { EffectProps } from "./types";
import { ShineLayer } from "./base";
import { CLIPS } from "./clips";
import {
  brightnessMatrix,
  concatColorMatrices,
  contrastMatrix,
  farthestCornerRadius,
  hsl,
  pct,
  saturateMatrix,
} from "../lib/css";
import { boxedEllipseGeometry, interpolateStopColor, normalizeRepeatingStops } from "./cssBackground";
import { RepeatingBands } from "./prismShared";

// element band (trainer-gallery-holo.css:30-38): 7 hsla stops @ --space*1..7,
// --space 5%, alpha .75; first ≈ last so the period tiles seamlessly.
const BAND_COLORS = [
  hsl(283, 49, 60, 0.75),
  hsl(2, 74, 59, 0.75),
  hsl(53, 67, 53, 0.75),
  hsl(93, 56, 52, 0.75),
  hsl(176, 38, 50, 0.75),
  hsl(228, 100, 77, 0.75),
  hsl(283, 49, 61, 0.75),
];
const BAND = normalizeRepeatingStops([5, 10, 15, 20, 25, 30, 35]);

// ::after ellipse radial (trainer-gallery-holo.css:54-61): white 5% ·
// hsla(300,100%,11%,.6) 40% · hsl(0,0%,22%) 120%; 120% re-anchored to 1.0 at
// t=(100-40)/(120-40)=60/80.
const AFTER_COLORS = [
  hsl(0, 0, 100),
  hsl(300, 100, 11, 0.6),
  interpolateStopColor(hsl(300, 100, 11, 0.6), hsl(0, 0, 22), 60 / 80),
];
const AFTER_POS = [0.05, 0.4, 1.0];

// glare radial (trainer-gallery-holo.css:99-104): white 10% · white .6 35% ·
// hsla(180,11%,35%) 60% (no >100% stop; Skia clamps the outer colour).
const GLARE_COLORS = [hsl(0, 0, 100), hsl(0, 0, 100, 0.6), hsl(180, 11, 35)];
const GLARE_POS = [0.1, 0.35, 0.6];
const GLARE_M = concatColorMatrices(brightnessMatrix(0.8), contrastMatrix(1.5)); // regular-holo.css:146

export function GalleryHolo({ u, mask }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;

  const clip = useMemo(() => CLIPS.clipBorders(w, h), [w, h]);

  // Element band: position 0% background-y (x pinned).
  const bandPosX = useDerivedValue(() => 0);
  const bandPosY = useDerivedValue(() => u.backgroundY.value);

  // ::after ellipse: center at (pointer*0.5 + 25)% of the 400%x500% tile,
  // background-position center; drawn as a circle of radius rx scaled ry/rx.
  const afterGeom = useDerivedValue(() =>
    boxedEllipseGeometry(u.pointerX.value * 0.5 + 25, u.pointerY.value * 0.5 + 25, 50, 50, 4, 5, w, h),
  );
  const afterCenter = useDerivedValue(() => ({ x: afterGeom.value.cx, y: afterGeom.value.cy }));
  const afterRx = useDerivedValue(() => afterGeom.value.rx);
  const afterScale = useDerivedValue(() => [{ scaleY: afterGeom.value.ry / afterGeom.value.rx }]);

  // glare: farthest-corner circle at pointer.
  const center = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const radius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );

  // Filters (brightness follows pointer-from-center).
  const elemFilter = useDerivedValue(() =>
    concatColorMatrices(brightnessMatrix(u.pointerFromCenter.value * 0.3 + 0.5), contrastMatrix(2.3), saturateMatrix(1)),
  );
  const afterFilter = useDerivedValue(() =>
    concatColorMatrices(brightnessMatrix(u.pointerFromCenter.value * 0.2 + 0.4), contrastMatrix(0.85), saturateMatrix(1.1)),
  );
  const glareOpacity = useDerivedValue(() => u.cardOpacity.value * 0.8);

  const band = (
    <RepeatingBands
      u={u}
      angleDeg={-22}
      colors={BAND_COLORS}
      stops={BAND.positions}
      firstPct={BAND.first}
      lastPct={BAND.last}
      tileWmul={3}
      tileHmul={4}
      posX={bandPosX}
      posY={bandPosY}
    />
  );

  return (
    <Fragment>
      {/* .card__shine group: color-dodge, elemFilter, opacity card, clip borders. */}
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={elemFilter} blendMode="colorDodge" clip={clip}>
        {masked && mask ? (
          <Mask mode="alpha" mask={<Image image={mask} x={0} y={0} width={w} height={h} fit="cover" />}>
            {band}
          </Mask>
        ) : (
          band
        )}

        {/* ::after — hard-light ellipse pointer radial, foil-masked when masked. */}
        <ShineLayer w={w} h={h} matrix={afterFilter} blendMode="hardLight" mask={masked ? mask : undefined}>
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient
              c={afterCenter}
              r={afterRx}
              origin={afterCenter}
              transform={afterScale}
              colors={AFTER_COLORS}
              positions={AFTER_POS}
            />
          </Rect>
        </ShineLayer>
      </ShineLayer>

      {/* .card__glare — pointer radial, soft-light, opacity card*.8. */}
      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="softLight">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={center} r={radius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
