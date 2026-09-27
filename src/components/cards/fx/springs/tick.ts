/**
 * 1:1 port of svelte/motion's `tick_spring` (spring.js) as a Reanimated worklet.
 * Pure function: one Euler integration step of a damped spring toward `target`.
 */
export type SpringOpts = {
  stiffness: number;
  damping: number;
  precision: number;
};

export type SpringCtx = {
  invMass: number;
  dt: number;
  opts: SpringOpts;
  settled: boolean;
};

export function tickSpring(
  ctx: SpringCtx,
  lastValue: number,
  value: number,
  target: number
): number {
  "worklet";
  const delta = target - value;
  const velocity = (value - lastValue) / (ctx.dt || 1 / 60);
  const spring = ctx.opts.stiffness * delta;
  const damper = ctx.opts.damping * velocity;
  const acceleration = (spring - damper) * ctx.invMass;
  const d = (velocity + acceleration) * ctx.dt;
  if (Math.abs(d) < ctx.opts.precision && Math.abs(delta) < ctx.opts.precision) return target;
  ctx.settled = false;
  return value + d;
}
