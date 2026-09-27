// `radiant-holo` effect — Skia transliteration of
// pokemon-cards-css/public/css/cards/radiant-holo.css
// (`[data-rarity="radiant rare"]`). Follows the locked ShineLayer pattern of
// regular-holo.tsx.
//
// NOTE: the Task-14 brief mentions `illusion*` textures + `hue-rotate` for this
// effect, but the actual radiant-holo.css references neither (it uses --foil,
// --glitter, foilbg, and --card-glow). Those `illusion`/hue-rotate hints
// belong to later-task files (rainbow-holo, shiny-*, prism-full-art). Transliterated
// exactly what this CSS computes; nothing animates via @keyframes here.
//
// .card__shine isolation group (color-dodge), clipped to --clip-borders, foil-
// alpha-masked when masked. Painted bottom -> top, honoring the :before z-index:2
// (radiant-holo.css:130) which puts :before ABOVE :after:
//   element bg — -45deg metal bars (normal) · 45deg bars (darken) · card-glow
//                ellipse radial (exclusion)
//   :after     — rainbow repeating gradient (bottom) · foil (hard-light; masked
//                cover / non-masked foilbg 25% difference); clipped to --clip
//   :before    — dark ellipse radial (bottom) · glitter 15% (color-dodge);
//                blend overlay, drawn last (z-index 2)
//
// .card__glare — a single white pointer radial, blend hard-light (no :after).

import { Fragment, useMemo } from "react";
import type { ReactNode } from "react";
import { Group, Image, ImageShader, LinearGradient, RadialGradient, Rect } from "@shopify/react-native-skia";
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

// --- --card-glow per energy type (base.css:97-106) -----------------------
const CARD_GLOW: Record<string, string> = {
  water: hsl(192, 97, 60),
  fire: hsl(9, 81, 59),
  grass: hsl(96, 81, 65),
  lightning: hsl(54, 87, 63),
  psychic: hsl(281, 62, 58),
  fighting: "rgb(145, 90, 39)",
  darkness: hsl(189, 77, 27),
  metal: hsl(184, 20, 70),
  dragon: hsl(51, 60, 35),
  fairy: hsl(323, 100, 89),
};
const cardGlowForTypes = (types: string[] = []): string => {
  for (const t of types) {
    const k = t.toLowerCase();
    if (k in CARD_GLOW) return CARD_GLOW[k];
  }
  return hsl(175, 100, 90); // :root default (base.css:25)
};

// --- metal bars (repeating-linear-gradient 45deg/-45deg) ------------------
// --barwidth 1.2% (radiant-holo.css:27). 21 stops: grey ridges with ~0.01%
// hard steps, period 0% -> barwidth*10 (12%). Identical for the +45/-45 layers.
const BAR_WIDTH = 1.2;
const RADIANT_BAR_STOPS = [
  0, 1, BAR_WIDTH,
  BAR_WIDTH + 0.01, BAR_WIDTH * 2,
  BAR_WIDTH * 2 + 0.01, BAR_WIDTH * 3,
  BAR_WIDTH * 3 + 0.01, BAR_WIDTH * 4,
  BAR_WIDTH * 4 + 0.01, BAR_WIDTH * 5,
  BAR_WIDTH * 5 + 0.01, BAR_WIDTH * 6,
  BAR_WIDTH * 6 + 0.01, BAR_WIDTH * 7,
  BAR_WIDTH * 7 + 0.01, BAR_WIDTH * 8,
  BAR_WIDTH * 8 + 0.01, BAR_WIDTH * 9,
  BAR_WIDTH * 9 + 0.01, BAR_WIDTH * 10,
];
const RADIANT_BAR_COLORS = [10, 10, 10, 20, 20, 35, 35, 42.5, 42.5, 50, 50, 42.5, 42.5, 35, 35, 20, 20, 10, 10, 0, 0].map(
  (g) => hsl(0, 0, g),
);
const BAR = normalizeRepeatingStops(RADIANT_BAR_STOPS);

// --- :after rainbow (repeating-linear-gradient 55deg, --space 200px) ------
// radiant-holo.css:107-115. Pixel-period stops (200px..1400px) over the
// 400% x 100% tile; first==last colour so the period tiles seamlessly.
const RAINBOW_COLORS = [
  hsl(3, 95, 85),
  hsl(207, 100, 84),
  hsl(29, 100, 85),
  hsl(160, 100, 86),
  hsl(309, 94, 87),
  hsl(188, 95, 85),
  hsl(3, 95, 85),
];
const RAINBOW = normalizeRepeatingStops([200, 400, 600, 800, 1000, 1200, 1400]);

// --- :before dark radial (radiant-holo.css:136-140) ----------------------
const BEFORE_RADIAL_COLORS = [hsl(0, 0, 58, 0.8), hsl(0, 0, 20, 0.9), hsl(0, 0, 20, 0.5)];
const BEFORE_RADIAL_POS = [0.1, 0.2, 0.5];

// --- glare radial (radiant-holo.css:166-170) — 110% stop re-anchored to 1.0.
const GLARE_COLORS = [hsl(0, 0, 100, 0.33), interpolateStopColor(hsl(0, 0, 100, 0.33), hsl(0, 0, 25), 100 / 110)];
const GLARE_POS = [0, 1.0];

// --- filters --------------------------------------------------------------
const SHINE_M = concatColorMatrices(brightnessMatrix(0.5), contrastMatrix(2), saturateMatrix(1.75)); // :96
const AFTER_M = concatColorMatrices(brightnessMatrix(0.6), contrastMatrix(3), saturateMatrix(2)); // :120
const BEFORE_M = concatColorMatrices(brightnessMatrix(0.66), contrastMatrix(2), saturateMatrix(0.5)); // :147
const GLARE_M = contrastMatrix(1.5); // brightness(1) contrast(1.5) — :172

export function RadiantHolo({ u, foil, mask, types }: EffectProps) {
  const { w, h } = u;
  const masked = !!mask;
  const glitter = useTexture(textureImages.glitter);
  const foilbg = useTexture(textureImages.foilbg);

  const shineClip = useMemo(() => CLIPS.clipBorders(w, h), [w, h]);
  const afterClip = useMemo(() => CLIPS.clip(w, h), [w, h]);

  // card-glow ellipse radial colours: 130% stop re-anchored to 1.0
  // (t = (100-20)/(130-20)); the outer colour is the per-type --card-glow.
  const glow = cardGlowForTypes(types);
  const shineRadialColors = useMemo(
    () => [hsl(0, 0, 95), interpolateStopColor(hsl(0, 0, 95), glow, 80 / 110)],
    [glow],
  );

  // Both radials are `farthest-corner ellipse at calc(pointer*0.5 + 25%)`.
  // Skia radial is circular, so draw radius=ry and scaleX by rx/ry about the
  // centre. farthest-CORNER ellipse (aspect ratio of the farthest sides, scaled
  // to reach the corner) => rx=√2·dx, ry=√2·dy where dx,dy are the farthest-side
  // distances; the rx/ry ratio (scaleX) equals dx/dy, unaffected by the √2.

  // Shine card-glow radial: background-size cover => card-box tile (w×h).
  const ellCenter = useDerivedValue(() => ({
    x: pct(0.5 * u.pointerX.value + 25, w),
    y: pct(0.5 * u.pointerY.value + 25, h),
  }));
  const ellRadius = useDerivedValue(() => {
    const cy = pct(0.5 * u.pointerY.value + 25, h);
    return Math.max(cy, h - cy) * Math.SQRT2;
  });
  const ellTransform = useDerivedValue(() => {
    const cx = pct(0.5 * u.pointerX.value + 25, w);
    const cy = pct(0.5 * u.pointerY.value + 25, h);
    return [{ scaleX: Math.max(cx, w - cx) / Math.max(cy, h - cy) }];
  });

  // :before dark radial: background-size 350% 350%, position center
  // (radiant-holo.css:142-143). The gradient's coordinate box is a 3.5w×3.5h
  // tile centred on the card, so centre & farthest-corner radius live in tile
  // space: q=(0.5·pointer+25)/100, centre=(3.5q−1.25)·box, side dist=3.5·box·max(q,1−q).
  const beforeCenter = useDerivedValue(() => ({
    x: (3.5 * ((0.5 * u.pointerX.value + 25) / 100) - 1.25) * w,
    y: (3.5 * ((0.5 * u.pointerY.value + 25) / 100) - 1.25) * h,
  }));
  const beforeRadius = useDerivedValue(() => {
    const qy = (0.5 * u.pointerY.value + 25) / 100;
    return 3.5 * h * Math.max(qy, 1 - qy) * Math.SQRT2;
  });
  const beforeTransform = useDerivedValue(() => {
    const qx = (0.5 * u.pointerX.value + 25) / 100;
    const qy = (0.5 * u.pointerY.value + 25) / 100;
    return [{ scaleX: (w * Math.max(qx, 1 - qx)) / (h * Math.max(qy, 1 - qy)) }];
  });

  // Metal bars: 45deg / -45deg lines across the 2.1w x 2.1h tile (210% 210%);
  // period runs from the 0% stop to the 12% stop. bg-position (bg-50%)*1.5+50%.
  const bar45 = useMemo(() => linearGradientPoints(45, 2.1 * w, 2.1 * h), [w, h]);
  const barNeg = useMemo(() => linearGradientPoints(-45, 2.1 * w, 2.1 * h), [w, h]);
  const barPoint = (base: { start: { x: number; y: number }; end: { x: number; y: number } }, tPct: number) => ({
    x: base.start.x + (tPct / 100) * (base.end.x - base.start.x),
    y: base.start.y + (tPct / 100) * (base.end.y - base.start.y),
  });
  const bar45First = useMemo(() => barPoint(bar45, BAR.first), [bar45]);
  const bar45Last = useMemo(() => barPoint(bar45, BAR.last), [bar45]);
  const barNegFirst = useMemo(() => barPoint(barNeg, BAR.first), [barNeg]);
  const barNegLast = useMemo(() => barPoint(barNeg, BAR.last), [barNeg]);
  const barOffset = useDerivedValue(() => ({
    x: bgPosTranslate((u.backgroundX.value - 50) * 1.5 + 50, 2.1 * w, w),
    y: bgPosTranslate((u.backgroundY.value - 50) * 1.5 + 50, 2.1 * h, h),
  }));
  const bar45Start = useDerivedValue(() => ({ x: bar45First.x + barOffset.value.x, y: bar45First.y + barOffset.value.y }));
  const bar45End = useDerivedValue(() => ({ x: bar45Last.x + barOffset.value.x, y: bar45Last.y + barOffset.value.y }));
  const barNegStart = useDerivedValue(() => ({ x: barNegFirst.x + barOffset.value.x, y: barNegFirst.y + barOffset.value.y }));
  const barNegEnd = useDerivedValue(() => ({ x: barNegLast.x + barOffset.value.x, y: barNegLast.y + barOffset.value.y }));

  // :after rainbow: 55deg line over the 4w x h tile; the px period (200..1400px)
  // is placed along the line's unit direction. bg-position (bg-50%)*-2.5+50%.
  const rainbowBase = useMemo(() => linearGradientPoints(55, 4 * w, h), [w, h]);
  const rainbowDir = useMemo(() => {
    const dx = rainbowBase.end.x - rainbowBase.start.x;
    const dy = rainbowBase.end.y - rainbowBase.start.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }, [rainbowBase]);
  const rainbowFirst = useMemo(
    () => ({ x: rainbowBase.start.x + RAINBOW.first * rainbowDir.x, y: rainbowBase.start.y + RAINBOW.first * rainbowDir.y }),
    [rainbowBase, rainbowDir],
  );
  const rainbowLast = useMemo(
    () => ({ x: rainbowBase.start.x + RAINBOW.last * rainbowDir.x, y: rainbowBase.start.y + RAINBOW.last * rainbowDir.y }),
    [rainbowBase, rainbowDir],
  );
  const rainbowStart = useDerivedValue(() => ({
    x: rainbowFirst.x + bgPosTranslate((u.backgroundX.value - 50) * -2.5 + 50, 4 * w, w),
    y: rainbowFirst.y + bgPosTranslate((u.backgroundY.value - 50) * -2.5 + 50, h, h),
  }));
  const rainbowEnd = useDerivedValue(() => ({
    x: rainbowLast.x + bgPosTranslate((u.backgroundX.value - 50) * -2.5 + 50, 4 * w, w),
    y: rainbowLast.y + bgPosTranslate((u.backgroundY.value - 50) * -2.5 + 50, h, h),
  }));

  // glare: farthest-corner circle at the pointer.
  const glareCenter = useDerivedValue(() => ({ x: pct(u.pointerX.value, w), y: pct(u.pointerY.value, h) }));
  const glareRadius = useDerivedValue(() =>
    farthestCornerRadius(pct(u.pointerX.value, w), pct(u.pointerY.value, h), w, h),
  );

  // :after foil: masked -> per-card foil, cover, hard-light; non-masked ->
  // foilbg at 25% auto (uniform scale to 25% width), tiled, difference
  // (radiant-holo.css:117,123 + NO-MASK 196-204).
  let foilNode: ReactNode = null;
  if (masked && foil) {
    foilNode = <Image image={foil} x={0} y={0} width={w} height={h} fit="cover" />;
  } else if (!masked && foilbg) {
    const scale = (0.25 * w) / foilbg.width();
    const tileW = 0.25 * w;
    const tileH = foilbg.height() * scale;
    foilNode = (
      <Rect x={0} y={0} width={w} height={h}>
        <ImageShader
          image={foilbg}
          fit="none"
          tx="repeat"
          ty="repeat"
          transform={[{ translateX: bgPosTranslate(50, tileW, w) }, { translateY: bgPosTranslate(50, tileH, h) }, { scale }]}
        />
      </Rect>
    );
  }

  return (
    <Fragment>
      {/* .card__shine group — color-dodge, --clip-borders, foil-masked if masked */}
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={SHINE_M} blendMode="colorDodge" clip={shineClip} mask={mask}>
        {/* element bg: -45deg bars (normal) · 45deg bars (darken) · ellipse (exclusion) */}
        <Rect x={0} y={0} width={w} height={h}>
          <LinearGradient start={barNegStart} end={barNegEnd} colors={RADIANT_BAR_COLORS} positions={BAR.positions} mode="repeat" />
        </Rect>
        <Group blendMode="darken">
          <Rect x={0} y={0} width={w} height={h}>
            <LinearGradient start={bar45Start} end={bar45End} colors={RADIANT_BAR_COLORS} positions={BAR.positions} mode="repeat" />
          </Rect>
        </Group>
        <Group blendMode="exclusion">
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient c={ellCenter} r={ellRadius} origin={ellCenter} transform={ellTransform} colors={shineRadialColors} positions={[0.2, 1.0]} />
          </Rect>
        </Group>

        {/* :after (color-dodge, clip --clip): rainbow (bottom) · foil (hard-light) */}
        <ShineLayer w={w} h={h} matrix={AFTER_M} blendMode="colorDodge" clip={afterClip}>
          <Rect x={0} y={0} width={w} height={h}>
            <LinearGradient start={rainbowStart} end={rainbowEnd} colors={RAINBOW_COLORS} positions={RAINBOW.positions} mode="repeat" />
          </Rect>
          {foilNode ? <Group blendMode={masked ? "hardLight" : "difference"}>{foilNode}</Group> : null}
        </ShineLayer>

        {/* :before (overlay, z-index 2 -> drawn last): ellipse radial · glitter 15% */}
        <ShineLayer w={w} h={h} matrix={BEFORE_M} blendMode="overlay">
          <Rect x={0} y={0} width={w} height={h}>
            <RadialGradient c={beforeCenter} r={beforeRadius} origin={beforeCenter} transform={beforeTransform} colors={BEFORE_RADIAL_COLORS} positions={BEFORE_RADIAL_POS} />
          </Rect>
          {glitter ? (
            <Group blendMode="colorDodge">
              <TiledTexture img={glitter} w={w} h={h} sizeX={15} sizeY={15} posX={50} posY={50} />
            </Group>
          ) : null}
        </ShineLayer>
      </ShineLayer>

      {/* .card__glare — single white pointer radial, hard-light */}
      <ShineLayer w={w} h={h} opacity={u.cardOpacity} matrix={GLARE_M} blendMode="hardLight">
        <Rect x={0} y={0} width={w} height={h}>
          <RadialGradient c={glareCenter} r={glareRadius} colors={GLARE_COLORS} positions={GLARE_POS} />
        </Rect>
      </ShineLayer>
    </Fragment>
  );
}
