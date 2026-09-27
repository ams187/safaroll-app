// `gallery-prism` effect — trainer-gallery V (`[data-rarity="rare holo v"]
// [data-trainer-gallery="true"]`). trainer-gallery-v-regular.css carries ONLY a
// glare-opacity override; the SHINE comes from prism-full-art.css, which groups the
// gallery-prism shine selectors with its own rare-ultra shine (identical recipe
// MINUS the rare-ultra-only ::before white radial). So the shine reuses
// `PrismFullArtShine` with `showBefore={false}`.
//
// GLARE cascade: prism-full-art.css's glare selector is rare-ultra-only and does NOT
// match a "rare holo v" card, so the glare body is prism-foil.css:101-116
// (`[data-rarity="rare holo v"] .card__glare`) — a pointer radial, hard-light,
// filter brightness(.9) contrast(1.75) — with its opacity overridden to
// card*.4 by trainer-gallery-v-regular.css:30-33 (prism-foil.css's own card*.5
// loses on specificity).

import { Fragment } from "react";
import { RadialGradient, Rect } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { EffectProps } from "./types";
import { ShineLayer } from "./base";
import { PrismFullArtShine } from "./prism-full-art";
import { brightnessMatrix, concatColorMatrices, contrastMatrix, farthestCornerRadius, hsl, pct } from "../lib/css";
import { interpolateStopColor } from "./cssBackground";

// prism-foil.css:104-110 glare radial: white 0% · hsla(210,3%,54%,.33) 45% ·
// hsla(0,0%,20%,.9) 130%; 130% re-anchored to 1.0 at t=(100-45)/(130-45)=55/85.
const GLARE_COLORS = [
  hsl(0, 0, 100),
  hsl(210, 3, 54, 0.33),
  interpolateStopColor(hsl(210, 3, 54, 0.33), hsl(0, 0, 20, 0.9), 55 / 85),
];
const GLARE_POS = [0, 0.45, 1.0];
const GLARE_M = concatColorMatrices(brightnessMatrix(0.9), contrastMatrix(1.75)); // prism-foil.css:115

export function GalleryPrism({ u, foil, mask }: EffectProps) {
  const { w, h } = u;

  const center = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const radius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );
  const glareOpacity = useDerivedValue(() => u.cardOpacity.value * 0.4);

  return (
    <Fragment>
      <PrismFullArtShine u={u} foil={foil} mask={mask} showBefore={false} />

      {/* .card__glare — prism-foil pointer radial, hard-light, opacity card*.4. */}
      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="hardLight">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={center} r={radius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
