// The angle arithmetic behind a card that flips, from
// ManasCodeXart/expo-card-insight (`src/hooks/flipRotation.ts`), verbatim.
//
// Pure and worklet-safe on purpose: it is the one part of the flip with an
// answer that can be wrong rather than merely ugly, and `scripts/check-flip.ts`
// pins it. Everything else in the gesture is springs and styles.

const FACE_BACK_RANGE_START = 90;
const FACE_BACK_RANGE_END = 270;

export function normalizeAngle(angle: number): number {
  'worklet';
  return ((angle % 360) + 360) % 360;
}

/** True while the viewer is looking at the far side of the sheet. */
export function isAngleShowingBack(normalizedAngle: number): boolean {
  'worklet';
  return normalizedAngle > FACE_BACK_RANGE_START && normalizedAngle < FACE_BACK_RANGE_END;
}

/** How far from face-on, 0..180 — which way it turned does not matter. */
export function getRotationProgress(normalizedAngle: number): number {
  'worklet';
  return normalizedAngle > 180 ? 360 - normalizedAngle : normalizedAngle;
}

/**
 * The nearest resting angle, keeping whole turns already made.
 *
 * A card released mid-flip must land flat, and it must land on the face it was
 * closest to — not back where it started. Carrying `fullRotations` is what lets
 * someone spin it several times without the spring unwinding all of it.
 */
export function resolveSnappedRotation(currentAngle: number): number {
  'worklet';
  const normalized = normalizeAngle(currentAngle);
  const fullRotations = Math.floor(currentAngle / 360) * 360;
  const snappedFace = isAngleShowingBack(normalized)
    ? 180
    : normalized > FACE_BACK_RANGE_END
      ? 360
      : 0;
  return fullRotations + snappedFace;
}

/**
 * Which face a pair of axis angles shows.
 *
 * The XOR is the reference's, and it is the whole trick: turning a card half a
 * turn about EITHER axis shows the back, but half a turn about BOTH shows the
 * front again, upside down. Testing the two axes independently gets that wrong
 * exactly half the time.
 */
export function showsBack(rotateY: number, rotateX: number): boolean {
  'worklet';
  return isAngleShowingBack(normalizeAngle(rotateY)) !== isAngleShowingBack(normalizeAngle(rotateX));
}
