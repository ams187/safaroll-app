// `gallery-max` effect — trainer-gallery VMAX (`[data-rarity="rare holo vmax"]
// [data-trainer-gallery="true"]`). trainer-gallery-v-max.css carries ONLY the
// glare; the SHINE comes from rainbow-alt.css, which groups the gallery-max shine
// selectors with its own `rare rainbow alt` shine (identical RainbowAlt recipe).
// So the shine reuses `RainbowAltShine`.
//
// ONE cascade subtlety: the band uses `var(--space)`, and while rainbow-alt.css
// never sets it, max-prism.css's `[data-rarity="rare holo vmax"] .card__shine`
// (which also matches this card) sets `--space: 6%` — winning over cards.css's
// default 5% that `rare rainbow alt` uses. Hence `bandSpace={6}`.
//
// GLARE cascade: rainbow-alt.css's glare selector is `rare rainbow alt`-only and
// does NOT match a vmax card, so the winning glare is trainer-gallery-v-max.css's
// radial (0,4,0), and its mix-blend-mode — which that rule does NOT set — LEAKS
// `hard-light` from max-prism.css:124 (`[data-rarity="rare holo vmax"] .card__glare`,
// 0,3,0, beating base.css's overlay). Filter is identity; opacity card*pfc*.85.

import { Fragment } from "react";
import { RadialGradient, Rect } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { EffectProps } from "./types";
import { ShineLayer } from "./base";
import { RainbowAltShine } from "./rainbow-alt";
import { brightnessMatrix, farthestCornerRadius, hsl, pct } from "../lib/css";
import { interpolateStopColor } from "./cssBackground";

// glare radial (trainer-gallery-v-max.css:32-39): hsl(50,30%,90%) 0% ·
// hsl(162,5%,40%) [unpositioned -> midway 60%] · hsl(0,0%,0%) 120%; 120%
// re-anchored to 1.0 at t=(100-60)/(120-60)=40/60.
const GLARE_COLORS = [
  hsl(50, 30, 90),
  hsl(162, 5, 40),
  interpolateStopColor(hsl(162, 5, 40), hsl(0, 0, 0), 40 / 60),
];
const GLARE_POS = [0, 0.6, 1.0];
const GLARE_M = brightnessMatrix(1); // brightness(1) contrast(1) = identity.

export function GalleryMax({ u, foil, mask }: EffectProps) {
  const { w, h } = u;

  const center = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const radius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );
  const glareOpacity = useDerivedValue(() => u.cardOpacity.value * u.pointerFromCenter.value * 0.85);

  return (
    <Fragment>
      <RainbowAltShine u={u} foil={foil} mask={mask} bandSpace={6} />

      {/* .card__glare — hard-light pointer radial (blend leaks from max-prism.css). */}
      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="hardLight">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={center} r={radius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
