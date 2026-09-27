// Shared vocabulary every effect module (later tasks) renders against.
// Type-only imports of Skia/Reanimated types are erased at build time, so
// this file has zero runtime dependency on native modules and can be
// imported from vitest (headless) as freely as from the app.

import type { ReactNode } from "react";
import type { SkImage } from "@shopify/react-native-skia";
import type { SharedValue } from "react-native-reanimated";

import type { ClipVariant } from "./clipGeometry";

/**
 * The 22 effect keys the CSS source ships one stylesheet per key for
 * (`pokemon-cards-css/public/css/cards/*.css`, minus `base.css`). `basic` is
 * also the fallback for any card the routing table doesn't otherwise match.
 */
export type EffectKey =
  | "basic"
  | "regular-holo"
  | "reverse-holo"
  | "cosmos-holo"
  | "amazing-rare"
  | "radiant-holo"
  | "prism-foil"
  | "prism-full-art"
  | "max-prism"
  | "star-prism"
  | "full-art-foil"
  | "rainbow-holo"
  | "rainbow-alt"
  | "secret-rare"
  | "shiny-rare"
  | "shimmer-prism"
  | "shimmer-max"
  | "legendary-shiny"
  | "gallery-holo"
  | "gallery-prism"
  | "gallery-max"
  | "gallery-secret"
  | "glitter-foil"
  // Not from the SwSH port: the Scarlet & Violet 151 ball-holo, whose tiled
  // motif is the capture's own die-cut. See sticker-holo.tsx.
  | "sticker-holo"
  | "special-illustration";

/**
 * Per-card animated inputs, ported from Card.svelte's `dynamicStyles`
 * CSS custom properties (lines 277-295) plus the two static per-card
 * randoms (`--seedx`/`--seedy`, used by holo noise) and the cosmos layer's
 * random pixel offset (`--cosmosbg`). One `CardUniforms` object is passed
 * to every effect component; `w`/`h` are the rendered card box size in px.
 */
export interface CardUniforms {
  pointerX: SharedValue<number>;
  pointerY: SharedValue<number>;
  pointerFromCenter: SharedValue<number>;
  pointerFromTop: SharedValue<number>;
  pointerFromLeft: SharedValue<number>;
  backgroundX: SharedValue<number>;
  backgroundY: SharedValue<number>;
  cardOpacity: SharedValue<number>;
  /**
   * The rotate spring's x, in degrees — Card.svelte's `--rotate-x` MINUS
   * `--rotate-delta` (:253-255), which cancels the delta term exactly and
   * leaves `$springRotate.x`. Only `special-illustration` reads it: its two
   * beams take their angle from how far the card is tilted, so the light
   * scissors open instead of sliding.
   */
  rotate: SharedValue<number>;
  seedX: number;
  seedY: number;
  cosmosX: number;
  cosmosY: number;
  w: number;
  h: number;
}

/**
 * Props every effect component receives. `foil`/`mask` are absent for `basic`.
 * SafaRoll: `img` made optional — no effect component reads it (their NO-MASK
 * branches use the shared textures), and SafaRoll cards are composed, not scanned.
 */
export interface EffectProps {
  u: CardUniforms;
  foil?: SkImage;
  mask?: SkImage;
  img?: SkImage;
  /**
   * Which `--clip*` this card's `.card__shine` uses (regular-holo.css:7-16,
   * subtype-only). Defaults to `"base"` (`--clip`); only the holo effects read it.
   */
  clipVariant?: ClipVariant;
  /**
   * Which `--clip*` this card's `.card__glare:after` uses — the shine's subtype
   * rules PLUS the trainer-supertype rule (base.css:347), so it can differ from
   * `clipVariant`. Defaults to `"base"`.
   */
  glareClipVariant?: ClipVariant;
  /**
   * The card's energy types (raw, e.g. `["Metal"]`). Read by reverse-holo
   * (`.card.lightning/darkness/metal` override `--foil-brightness`,
   * reverse-holo.css:50-52) and radiant-holo (`.card.<type>` set `--card-glow`,
   * base.css:97-106). Other effects ignore it.
   */
  types?: string[];
}

/** An effect module renders the `.card__shine` + `.card__glare` subtree. */
export type EffectComponent = (props: EffectProps) => ReactNode;
