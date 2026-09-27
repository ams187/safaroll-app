// Flip geometry adapted from HoloDex 151 / AwakeningCard (MIT).
// See docs/licenses/holodex-151.txt. Timings are milliseconds, not frames.
export const DISCOVERY_DURATION = 2650;
const FLIP_TIMES = [700, 1129, 1272, 1350, 1480, 1571, 1766, 2000];
const FLIP_ANGLES = [0, 60, 88, 114, 138, 150, 174, 180];

export function discoveryAngle(time: number) {
  'worklet';
  if (time <= FLIP_TIMES[0]) return 0;
  for (let i = 1; i < FLIP_TIMES.length; i++) {
    if (time <= FLIP_TIMES[i]) {
      const fraction = (time - FLIP_TIMES[i - 1]) / (FLIP_TIMES[i] - FLIP_TIMES[i - 1]);
      return FLIP_ANGLES[i - 1] + fraction * (FLIP_ANGLES[i] - FLIP_ANGLES[i - 1]);
    }
  }
  return 180;
}
