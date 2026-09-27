// `max-prism` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/max-prism.css
// (`[data-rarity="rare holo vmax"]`). Follows the locked ShineLayer pattern.
//
// .card__shine isolation group (color-dodge). The ELEMENT bg uses max-prism's own
// two gradients (max-prism.css:35-51) — a -33deg pastel rainbow and a 133deg green
// streak, both in full 2D-scaled tiles — NOT the shared sunpillar/diagonal
// pair. Painted bottom->top per `background-blend-mode: difference, luminosity,
// soft-light` (bottom radial normal):
//   pastel pointer radial (normal) · green streaks (soft-light) ·
//   pastel rainbow (luminosity) · foil (difference)
// The ::after (max-prism.css:74-105) is the one that uses the shared bands:
//   diagonal streaks (normal) · sunpillar `after` bands (hue); blend lighten,
//   animated opacity. Element + ::after are foil-masked when the card is
//   masked; NO-MASK swaps the foil for prismbg.jpg @60%x30% (filters unchanged).
//
// .card__glare — a plain pointer radial, blend hard-light, animated opacity.

import { Fragment } from "react";
import { Group, Image, Mask, RadialGradient, Rect } from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";

import type { EffectProps } from "./types";
import { ShineLayer } from "./base";
import { textureImages, useTexture } from "../lib/assets";
import { brightnessMatrix, concatColorMatrices, contrastMatrix, hsl, saturateMatrix } from "../lib/css";
import { interpolateStopColor, normalizeRepeatingStops } from "./cssBackground";
import { DiagonalStreaks, RepeatingBands, SunpillarBands, useBoxedRadial, vFoil } from "./prismShared";

// Element pastel rainbow (-33deg, max-prism.css:35-42), stops --space(6%)*[1..6].
const RAINBOW_COLORS = [
  hsl(2, 70, 47),
  hsl(228, 60, 64),
  hsl(176, 55, 39),
  hsl(123, 68, 35),
  hsl(283, 75, 57),
  hsl(2, 70, 47),
];
const RAINBOW = normalizeRepeatingStops([6, 12, 18, 24, 30, 36]);

// Element green streaks (133deg, max-prism.css:43-51), stops [0,2.5,5,7.5,10,15].
const GREEN_COLORS = [
  hsl(227, 53, 12, 0.5),
  hsl(180, 10, 50),
  hsl(83, 50, 35),
  hsl(180, 10, 50),
  hsl(227, 53, 12, 0.5),
  hsl(227, 53, 12, 0.5),
];
const GREEN = normalizeRepeatingStops([0, 2.5, 5, 7.5, 10, 15]);

// Element pastel radial (max-prism.css:52-59), box 200% 200%.
const RADIAL_COLORS = [hsl(189, 76, 77, 0.6), hsl(147, 59, 77, 0.6), hsl(271, 55, 69, 0.6), hsl(355, 56, 72, 0.6)];
const RADIAL_POS = [0, 0.25, 0.5, 0.75];

// Glare radial (max-prism.css:127-133) — 120% stop re-anchored to 1.0 (t=100/120).
const GLARE_COLORS = [hsl(0, 0, 100, 0.75), interpolateStopColor(hsl(0, 0, 100, 0.75), hsl(0, 0, 0), 100 / 120)];
const GLARE_POS = [0, 1.0];

const AFTER_M = saturateMatrix(1.5); // :103
const GLARE_M = brightnessMatrix(1); // brightness(1) contrast(1) — :125

export function MaxPrism({ u, foil, mask }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;
  const prismbg = useTexture(textureImages.prismbg);

  const radial = useBoxedRadial(u, 2, 2, true); // element pastel radial
  const glare = useBoxedRadial(u, 1, 1, false); // plain pointer radial (100% box)

  const bgX = useDerivedValue(() => u.backgroundX.value);
  const bgY = useDerivedValue(() => u.backgroundY.value);

  // La composition est INLINE, pas dans une fabrique du module.
  //
  // Elle vivait dans un `const ELEM_M = (pfc) => …` au niveau du module, et ce
  // fichier était le seul du port à le faire. Une flèche de module n'est pas un
  // worklet : appelée depuis `useDerivedValue`, elle part sur le runtime JS et
  // le runtime UI plante — « Tried to synchronously call a Remote Function ».
  // Les helpers de matrice, eux, portent tous `'worklet'`, donc les appeler
  // directement ici est sûr. Même famille de piège que la capture des
  // paramètres par défaut dans un worklet.
  const elemFilter = useDerivedValue(() =>
    concatColorMatrices(
      brightnessMatrix(u.pointerFromCenter.value * 0.4 + 0.4),
      contrastMatrix(2),
      saturateMatrix(1),
    ), // :69
  );
  const afterOpacity = useDerivedValue(
    () => 0.3 * u.cardOpacity.value + u.cardOpacity.value * u.pointerFromCenter.value * 0.5,
  );
  const glareOpacity = useDerivedValue(
    () => 0.2 * u.cardOpacity.value + u.cardOpacity.value * u.pointerFromCenter.value * 0.8,
  );

  // Foil: masked -> per-card foil cover; NO-MASK -> prismbg.jpg @60%x30%. Both
  // blend `difference`.
  const foilImg = masked ? foil : prismbg;
  const foilNode = <Group blendMode="difference">{vFoil(foilImg, masked, w, h, 60, 30)}</Group>;

  const elementBg = (
    <Fragment>
      <Rect x={0} y={0} width={w} height={h}>
        <RadialGradient c={radial.center} r={radial.radius} colors={RADIAL_COLORS} positions={RADIAL_POS} />
      </Rect>
      <Group blendMode="softLight">
        <RepeatingBands
          u={u}
          angleDeg={133}
          colors={GREEN_COLORS}
          stops={GREEN.positions}
          firstPct={GREEN.first}
          lastPct={GREEN.last}
          tileWmul={6}
          tileHmul={6}
          posX={bgX}
          posY={bgY}
        />
      </Group>
      <Group blendMode="luminosity">
        <RepeatingBands
          u={u}
          angleDeg={-33}
          colors={RAINBOW_COLORS}
          stops={RAINBOW.positions}
          firstPct={RAINBOW.first}
          lastPct={RAINBOW.last}
          tileWmul={11}
          tileHmul={11}
          posX={bgX}
          posY={bgY}
        />
      </Group>
      {foilNode}
    </Fragment>
  );

  return (
    <Fragment>
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={elemFilter} blendMode="colorDodge">
        {masked && mask ? (
          <Mask mode="alpha" mask={<Image image={mask} x={0} y={0} width={w} height={h} fit="cover" />}>
            {elementBg}
          </Mask>
        ) : (
          elementBg
        )}

        {/* ::after — shared diagonal (normal) + sunpillar `after` (hue); blend
            lighten, animated opacity, foil-masked when masked */}
        <ShineLayer w={w} h={h} matrix={AFTER_M} blendMode="lighten" opacity={afterOpacity} mask={masked ? mask : undefined}>
          <DiagonalStreaks u={u} posX={bgX} tileWmul={3} />
          <Group blendMode="hue">
            <SunpillarBands u={u} rot="after" space={6} tileHmul={7} />
          </Group>
        </ShineLayer>
      </ShineLayer>

      <ShineLayer w={w} h={h} opacity={glareOpacity} matrix={GLARE_M} blendMode="hardLight">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={glare.center} r={glare.radius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
