import { tickSpring, type SpringOpts } from "./tick";

export type Values = Record<string, number>;

export type SvelteSpringOpts = {
  stiffness: number;
  damping: number;
};

export type SvelteSpringSetOpts = {
  hard?: boolean;
  soft?: boolean | number;
};

/** Minimal shape the engine needs from `useSharedValue` — a `{ value }` box. */
export type SharedBox<T> = { value: T };
export type FrameInfoLike = { timestamp: number };

export type SpringEngine = {
  values: SharedBox<Values>;
  set: (target: Partial<Values>, opts?: SvelteSpringSetOpts) => void;
  setOpts: (opts: SvelteSpringOpts) => void;
};

const PRECISION = 0.01;

/**
 * Reanimated port of svelte/motion's `spring()` store: same `tick_spring`
 * integrator (see ./tick), driven by a `useFrameCallback` instead of svelte's
 * internal raf loop. Supports partial (per-key) targets so a single spring
 * can drive several independent values (e.g. rotateX/rotateY/scale...).
 *
 * Takes `makeShared`/`makeFrameCallback` as parameters instead of calling the
 * Reanimated hooks directly, so this file never imports "react-native-
 * reanimated" and stays importable (and unit-testable) from vitest —
 * `useSvelteSpring` in ./svelteSpring.ts plugs in the real hooks.
 */
export function createSpringEngine(
  makeShared: <T>(initial: T) => SharedBox<T>,
  makeFrameCallback: (
    callback: (frameInfo: FrameInfoLike) => void,
    autostart: boolean
  ) => unknown,
  initial: Values,
  opts: SvelteSpringOpts,
  /**
   * Whether the frame loop is registered at all.
   *
   * A frame callback runs EVERY frame for as long as it exists, even when the
   * spring is settled and the worklet does nothing but return. That is fine
   * for the one card under a finger, and it is not fine for a collection grid:
   * a screenful is two dozen cards, three springs each, so seventy-odd worklets
   * were being invoked per frame — and registered and torn down again every
   * time the list recycled a cell — for cards that cannot be tilted and draw no
   * foil. Pass `false` and the spring holds its resting values and costs
   * nothing; `set()` still records targets, it just never integrates.
   */
  autostart = true
): SpringEngine {
  const values = makeShared<Values>({ ...initial });
  const lastValues = makeShared<Values>({ ...initial });
  const targets = makeShared<Values>({ ...initial });
  const invMass = makeShared(1);
  const invMassRecoveryRate = makeShared(0);
  const lastTime = makeShared<number | null>(null);
  // Whether the frame loop is currently integrating. svelte/motion only
  // resets `last_time`/(re)starts the loop when no task is running yet
  // (`if (!task)`) — without this guard, a set() called every frame (e.g.
  // during a drag gesture) nulls lastTime every frame, dt is always 0, and
  // the spring never moves.
  const running = makeShared(false);
  const springOpts = makeShared<SpringOpts>({
    stiffness: opts.stiffness,
    damping: opts.damping,
    precision: PRECISION,
  });

  makeFrameCallback((frameInfo) => {
    "worklet";
    if (!running.value) return;

    const now = frameInfo.timestamp;
    if (lastTime.value === null) lastTime.value = now;
    const dt = ((now - lastTime.value) * 60) / 1000;
    lastTime.value = now;

    invMass.value = Math.min(invMass.value + invMassRecoveryRate.value, 1);

    const ctx = {
      invMass: invMass.value,
      dt,
      opts: springOpts.value,
      settled: true,
    };

    const current = values.value;
    const last = lastValues.value;
    const target = targets.value;
    const next: Values = {};
    for (const key in current) {
      next[key] = tickSpring(ctx, last[key], current[key], target[key]);
    }

    lastValues.value = current;
    values.value = next;

    if (ctx.settled) {
      running.value = false;
    }
  }, autostart);

  const set = (target: Partial<Values>, o?: SvelteSpringSetOpts) => {
    "worklet";
    const nextTargets = { ...targets.value };
    for (const key in target) {
      const v = target[key];
      if (v === undefined) continue;
      nextTargets[key] = v;
    }
    targets.value = nextTargets;

    if (o?.hard) {
      const nextValues = { ...values.value };
      const nextLast = { ...lastValues.value };
      for (const key in target) {
        const v = target[key];
        if (v === undefined) continue;
        nextValues[key] = v;
        nextLast[key] = v;
      }
      values.value = nextValues;
      lastValues.value = nextLast;
      running.value = false;
      return;
    }

    if (o?.soft) {
      const rate = o.soft === true ? 0.5 : Number(o.soft);
      invMassRecoveryRate.value = 1 / (rate * 60);
      invMass.value = 0;
    }

    if (!running.value) {
      running.value = true;
      lastTime.value = null; // fresh dt on the next tick instead of a stale/huge gap
    }
  };

  const setOpts = (o: SvelteSpringOpts) => {
    "worklet";
    springOpts.value = { stiffness: o.stiffness, damping: o.damping, precision: PRECISION };
  };

  return { values, set, setOpts };
}
