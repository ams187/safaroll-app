import { Gesture } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";
import { adjust, clamp, round } from "../lib/math";

export type InteractPayload = {
  background: { x: number; y: number };
  rotate: { x: number; y: number };
  glare: { x: number; y: number; o: number };
};

export type PointerCallbacks = {
  onInteract: (payload: InteractPayload) => void;
  onInteractEnd: (delayMs: number) => void;
  onActivate: () => void;
};

/**
 * Port of Card.svelte's interact()/interactEnd()/activate() (lines 78-144,
 * 173-196): percent/center/rotate/background/glare math, run as worklets so
 * it stays on the UI thread.
 *
 * `Gesture.Pan().minDistance(0)` is the touch analogue of `pointermove` — it
 * starts immediately, no drag threshold — and drives onInteract/onInteractEnd.
 * `Gesture.Tap()` is the `click` analogue and drives onActivate. They're
 * composed with `Simultaneous` (not `Race`) because a `Race` would let the
 * always-armed pan claim the gesture on first touch and starve the tap.
 */
export function usePointer(
  size: SharedValue<{ w: number; h: number }>,
  cbs: PointerCallbacks
) {
  const pan = Gesture.Pan()
    .minDistance(0)
    .onUpdate((e) => {
      "worklet";
      const { w, h } = size.value;
      if (w <= 0 || h <= 0) return;

      const percent = {
        x: clamp(round((100 / w) * e.x)),
        y: clamp(round((100 / h) * e.y)),
      };
      const center = { x: percent.x - 50, y: percent.y - 50 };

      cbs.onInteract({
        background: {
          x: adjust(percent.x, 0, 100, 37, 63),
          y: adjust(percent.y, 0, 100, 33, 67),
        },
        rotate: {
          x: round(-(center.x / 3.5)),
          y: round(center.y / 3.5),
        },
        glare: {
          x: round(percent.x),
          y: round(percent.y),
          o: 1,
        },
      });
    })
    .onEnd(() => {
      "worklet";
      cbs.onInteractEnd(500);
    });

  const tap = Gesture.Tap().onEnd((_e, success) => {
    "worklet";
    if (success) cbs.onActivate();
  });

  return Gesture.Simultaneous(tap, pan);
}
