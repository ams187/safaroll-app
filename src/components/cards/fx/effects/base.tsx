// Shared Skia pieces every effect module composes, ported from
// pokemon-cards-css/public/css/cards/base.css.
//
//  - ShineLayer: the `.card__shine` recipe (base.css:245-261, 321-333) — render
//    children into an offscreen layer, apply the brightness/contrast/saturate
//    filter, then composite onto the card with `mix-blend-mode: color-dodge` at
//    `opacity: var(--card-opacity)`. Optional foil alpha-mask + clip-path.
//  - Glare: the default `.card__glare` (base.css:292-308) — a farthest-corner
//    radial gradient at the pointer, `mix-blend-mode: overlay`, animated opacity.
//
// Skia mapping notes (verified against @shopify/react-native-skia 2.6.2):
//  - CSS `filter` (a color transform applied to the element's own pixels) +
//    `mix-blend-mode` (compositing against the backdrop) + `opacity` all map to
//    a single `SkCanvas.saveLayer(paint)`: colorFilter, alpha and blendMode on
//    that paint are applied when the layer is *restored* (composited onto the
//    backdrop) — exactly the CSS order (filter -> opacity -> blend). Passing a
//    `<Paint>` element to `Group.layer` becomes that saveLayer paint, so the
//    blend/opacity/colorFilter go on the layer Paint, NOT on the Group itself
//    (Group paint props would blend children against the transparent offscreen).

import type { ReactNode } from "react";
import {
  BlendMode,
  ColorMatrix,
  Group,
  Image,
  ImageShader,
  Mask,
  Paint,
  RadialGradient,
  Rect,
} from "@shopify/react-native-skia";
import type { SkImage, SkPath } from "@shopify/react-native-skia";
import type { SharedValue } from "react-native-reanimated";
import { useDerivedValue } from "react-native-reanimated";

import type { CardUniforms } from "./types";
import {
  brightnessMatrix,
  concatColorMatrices,
  contrastMatrix,
  farthestCornerRadius,
  pct,
  saturateMatrix,
} from "../lib/css";
import { bgPosTranslate } from "./cssBackground";

/** Uncapitalized Skia blend-mode names, e.g. `"colorDodge"`, `"overlay"`. */
export type BlendModeName = Uncapitalize<Extract<keyof typeof BlendMode, string>>;

/** `.card__shine` filter: `brightness(.85) contrast(2.75) saturate(.65)` (base.css:256). */
export const BASE_SHINE_FILTER: number[] = concatColorMatrices(
  brightnessMatrix(0.85),
  contrastMatrix(2.75),
  saturateMatrix(0.65),
);

/** `.card__shine` mix-blend-mode (base.css:257). */
export const SHINE_BLEND: BlendModeName = "colorDodge";
/** `.card__glare` mix-blend-mode (base.css:306). */
export const GLARE_BLEND: BlendModeName = "overlay";

interface ShineLayerProps {
  children: ReactNode;
  /** Card box size in px (mask cover-fit + default clip geometry use this). */
  w: number;
  h: number;
  /**
   * `--card-opacity` (base.css:259), animated. Omit for a NESTED ShineLayer
   * (a CSS ::before/::after inside an element's isolation group): the parent
   * group already carries the one CSS `opacity`, so the child Paint stays at 1.
   */
  opacity?: SharedValue<number> | number;
  /**
   * ColorMatrix filter; defaults to the base shine filter. A `SharedValue`
   * animates the filter (e.g. amazing-rare's `brightness(.75 - from-center*.5)`).
   */
  matrix?: number[] | SharedValue<number[]>;
  /** mix-blend-mode; defaults to color-dodge. */
  blendMode?: BlendModeName;
  /** Optional `.card__glare:after` style clip-path (cards.css `--clip*`). */
  clip?: SkPath;
  /** Optional foil mask image — CSS `mask-image` alpha, `mask-size: cover` (base.css:321-333). */
  mask?: SkImage;
}

/**
 * `.card__shine`: renders `children` into a saved layer, applies the color
 * matrix + blend + opacity on composite, with an optional cover-fitted alpha
 * mask and clip path. Used by the holo effect modules (Tasks 10-20). Nests:
 * a ShineLayer whose children include more ShineLayers reproduces a CSS
 * isolation group with its pseudo-elements (each inner layer = one ::before/
 * ::after, blended + filtered against the group buffer before the outer
 * group's own filter/opacity/blend composite it onto the card).
 */
export function ShineLayer({
  children,
  w,
  h,
  opacity,
  matrix = BASE_SHINE_FILTER,
  blendMode = SHINE_BLEND,
  clip,
  mask,
}: ShineLayerProps) {
  const content = mask ? (
    <Mask
      mode="alpha"
      mask={<Image image={mask} x={0} y={0} width={w} height={h} fit="cover" />}
    >
      {children}
    </Mask>
  ) : (
    children
  );

  return (
    <Group
      clip={clip}
      layer={
        <Paint blendMode={blendMode} opacity={opacity}>
          <ColorMatrix matrix={matrix} />
        </Paint>
      }
    >
      {content}
    </Group>
  );
}

// `.card__glare` radial stops (base.css:300-302): white .8 @10%, white .65 @20%, black .5 @90%.
// Exported because regular-holo (and other holo effects) reuse this exact
// gradient for their overridden `.card__glare` background.
export const GLARE_COLORS = [
  "rgba(255, 255, 255, 0.8)",
  "rgba(255, 255, 255, 0.65)",
  "rgba(0, 0, 0, 0.5)",
];
export const GLARE_STOPS = [0.1, 0.2, 0.9];

/**
 * Default `.card__glare` (base.css:292-308): a farthest-corner radial gradient
 * centered at the pointer, composited `mix-blend-mode: overlay` at
 * `opacity: var(--card-opacity)`. The single Rect draw blends straight against
 * the card backdrop, so blend + opacity live on the Group paint (no layer).
 */
export function Glare({ u }: { u: CardUniforms }) {
  const center = useDerivedValue(() => ({
    x: pct(u.pointerX.value, u.w),
    y: pct(u.pointerY.value, u.h),
  }));
  const radius = useDerivedValue(() => {
    const cx = pct(u.pointerX.value, u.w);
    const cy = pct(u.pointerY.value, u.h);
    return farthestCornerRadius(cx, cy, u.w, u.h);
  });

  return (
    <Group blendMode={GLARE_BLEND} opacity={u.cardOpacity}>
      <Rect x={0} y={0} width={u.w} height={u.h}>
        <RadialGradient c={center} r={radius} colors={GLARE_COLORS} positions={GLARE_STOPS} />
      </Rect>
    </Group>
  );
}

/**
 * One CSS `background-image: url(tex)` layer: the texture stretched to
 * `sizeX%` x `sizeY%` of the card box (a non-uniform `background-size`), tiled
 * (`background-repeat: repeat` — TileMode.Repeat both axes), and phase-shifted
 * by `background-position: posX% posY%` (bgPosTranslate on the scaled tile).
 * Used for the shared `--glitter`/`--foil` texture layers (amazing-rare,
 * radiant-holo). Static positions only — glitter/foil positions never animate.
 */
export function TiledTexture({
  img,
  w,
  h,
  sizeX,
  sizeY,
  posX,
  posY,
}: {
  img: SkImage;
  w: number;
  h: number;
  sizeX: number;
  sizeY: number;
  posX: number;
  posY: number;
}) {
  const tileW = (sizeX / 100) * w;
  const tileH = (sizeY / 100) * h;
  return (
    <Rect x={0} y={0} width={w} height={h}>
      <ImageShader
        image={img}
        fit="none"
        tx="repeat"
        ty="repeat"
        transform={[
          { translateX: bgPosTranslate(posX, tileW, w) },
          { translateY: bgPosTranslate(posY, tileH, h) },
          { scaleX: tileW / img.width() },
          { scaleY: tileH / img.height() },
        ]}
      />
    </Rect>
  );
}
