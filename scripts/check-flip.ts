// The card flip's angle arithmetic. Everything else in the gesture is springs
// and styles — this is the part with an answer that can be wrong.
//   bun run check:flip
import {
  getRotationProgress,
  isAngleShowingBack,
  normalizeAngle,
  resolveSnappedRotation,
  showsBack,
} from '../src/components/cards/flip-rotation';

let failures = 0;
function assert(ok: unknown, message: string) {
  if (ok) return;
  failures += 1;
  console.error(`  ✗ ${message}`);
}

// Normalisation has to survive negatives and many turns: a card can be spun.
for (const [angle, want] of [[0, 0], [360, 0], [-90, 270], [450, 90], [-720, 0]] as const) {
  assert(normalizeAngle(angle) === want, `normalizeAngle(${angle}) !== ${want}`);
}

// Face-on shows the front; half a turn shows the back; the boundaries are edges.
assert(!isAngleShowingBack(0), '0° must show the front');
assert(isAngleShowingBack(180), '180° must show the back');
assert(!isAngleShowingBack(90) && !isAngleShowingBack(270), 'edge-on belongs to neither face');

// Snapping lands flat, on the nearer face, keeping whole turns already made.
for (const [angle, want] of [
  [0, 0], [44, 0], [95, 180], [180, 180], [265, 180], [300, 360], [-30, 0], [540, 540], [710, 720],
] as const) {
  assert(
    resolveSnappedRotation(angle) === want,
    `resolveSnappedRotation(${angle}) = ${resolveSnappedRotation(angle)}, want ${want}`,
  );
}
for (let a = -1080; a <= 1080; a += 7) {
  const snapped = resolveSnappedRotation(a);
  // Exactly edge-on is ambiguous by definition — neither face is showing, so
  // there is no nearer one and no face to preserve. Every other angle has an
  // answer and must get it.
  const edgeOn = getRotationProgress(normalizeAngle(a)) === 90;
  assert(normalizeAngle(snapped) % 180 === 0, `snapping ${a} landed edge-on at ${snapped}`);
  assert(
    edgeOn || Math.abs(snapped - a) <= 180,
    `snapping ${a} travelled ${Math.abs(snapped - a)}° the long way`,
  );
  // The face it lands on must be the face it was already showing, or the flip
  // would visibly change its mind as the finger lifts.
  assert(
    edgeOn ||
      isAngleShowingBack(normalizeAngle(snapped)) === isAngleShowingBack(normalizeAngle(a)),
    `snapping ${a} swapped face`,
  );
}

// The XOR. Half a turn about EITHER axis shows the back; half a turn about BOTH
// shows the front again, upside down — testing the axes independently gets this
// wrong exactly half the time.
assert(!showsBack(0, 0), 'flat must be the front');
assert(showsBack(180, 0), 'turned on Y must be the back');
assert(showsBack(0, 180), 'turned on X must be the back');
assert(!showsBack(180, 180), 'turned on BOTH is the front again, upside down');

if (failures > 0) {
  console.error(`\ncheck-flip: ${failures} failure(s)`);
  process.exit(1);
}
console.log('check-flip: snaps flat, keeps its turns, never swaps face, and both axes agree');
