// Effect component registry: maps each EffectKey to its Skia renderer.
// `resolveEffect()` (registry.ts) picks the key; CardFace looks it up here and
// falls back to `basic` (glare-only) for any key not yet implemented.

import type { EffectComponent, EffectKey } from "./types";
import { Basic } from "./basic";
import { RegularHolo } from "./regular-holo";
import { ReverseHolo } from "./reverse-holo";
import { CosmosHolo } from "./cosmos-holo";
import { AmazingRare } from "./amazing-rare";
import { RadiantHolo } from "./radiant-holo";
import { PrismFoil } from "./prism-foil";
import { PrismFullArt } from "./prism-full-art";
import { MaxPrism } from "./max-prism";
import { StarPrism } from "./star-prism";
import { FullArtFoil } from "./full-art-foil";
import { RainbowHolo } from "./rainbow-holo";
import { RainbowAlt } from "./rainbow-alt";
import { GlitterFoil } from "./glitter-foil";
import { SecretRare } from "./secret-rare";
import { ShinyRare } from "./shiny-rare";
import { ShimmerPrism } from "./shimmer-prism";
import { ShimmerMax } from "./shimmer-max";
import { LegendaryShiny } from "./legendary-shiny";
import { GalleryHolo } from "./gallery-holo";
import { GalleryPrism } from "./gallery-prism";
import { GalleryMax } from "./gallery-max";
import { GallerySecret } from "./gallery-secret";
import { StickerHolo } from "./sticker-holo";
import { SpecialIllustration } from "./special-illustration";

export const components: Partial<Record<EffectKey, EffectComponent>> = {
  basic: Basic,
  "regular-holo": RegularHolo,
  "reverse-holo": ReverseHolo,
  "cosmos-holo": CosmosHolo,
  "amazing-rare": AmazingRare,
  "radiant-holo": RadiantHolo,
  "prism-foil": PrismFoil,
  "prism-full-art": PrismFullArt,
  "max-prism": MaxPrism,
  "star-prism": StarPrism,
  "full-art-foil": FullArtFoil,
  "rainbow-holo": RainbowHolo,
  "rainbow-alt": RainbowAlt,
  "glitter-foil": GlitterFoil,
  "secret-rare": SecretRare,
  "shiny-rare": ShinyRare,
  "shimmer-prism": ShimmerPrism,
  "shimmer-max": ShimmerMax,
  "legendary-shiny": LegendaryShiny,
  "gallery-holo": GalleryHolo,
  "gallery-prism": GalleryPrism,
  "gallery-max": GalleryMax,
  "gallery-secret": GallerySecret,
  "sticker-holo": StickerHolo,
  "special-illustration": SpecialIllustration,
};

/** Fallback for cards whose dedicated effect module isn't registered yet. */
export const fallbackEffect: EffectComponent = Basic;
