import { useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";
import { createSpringEngine, type SvelteSpringOpts, type SvelteSpringSetOpts, type Values } from "./engine";

export type { SvelteSpringOpts, SvelteSpringSetOpts };

export type SvelteSpring = {
  values: SharedValue<Values>;
  set: (target: Partial<Values>, opts?: SvelteSpringSetOpts) => void;
  setOpts: (opts: SvelteSpringOpts) => void;
};

export function useSvelteSpring(
  initial: Values,
  opts: SvelteSpringOpts,
  /** See `createSpringEngine` — false leaves the frame loop unregistered. */
  autostart = true,
): SvelteSpring {
  const engine = createSpringEngine(useSharedValue, useFrameCallback, initial, opts, autostart);
  // `engine.values` is a `SharedBox<Values>` per the engine's minimal param
  // type (kept narrow so it's testable without react-native-reanimated);
  // since the real `useSharedValue` was just injected above, it's actually
  // a full `SharedValue<Values>` at runtime.
  return {
    values: engine.values as unknown as SharedValue<Values>,
    set: engine.set,
    setOpts: engine.setOpts,
  };
}
