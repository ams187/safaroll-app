// `basic` effect, ported from pokemon-cards-css/public/css/cards/basic.css.
//
// basic.css ships no rules — it's 14 lines of section-header comments — so a
// "basic" card renders only the default `.card__glare` from base.css (no
// `.card__shine`, no foil/mask). This is also the routing fallback for any
// card whose dedicated effect module isn't implemented yet.

import type { EffectProps } from "./types";
import { Glare } from "./base";

export function Basic({ u }: EffectProps) {
  return <Glare u={u} />;
}
