// Path-trim tracing technique adapted from "bezier-curve-outline" by Enzo Manuel
// Mangano (https://github.com/enzomanuelmangano/demos) — custom license permits
// in-app use but forbids redistribution of the original source.
import { Blur, Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/** Comet length as a fraction of the loop. */
const TAIL = 0.45;
/** Clock overshoot so the tail fully catches the head before the loop restarts. */
const OVERDRIVE = 1 + TAIL;
const POINTS = 14;

/**
 * A luminous stroke that traces itself around the lifted sticker while the
 * identification runs — a faint full loop underneath, and a glowing comet
 * that redraws it on every cycle, as if the app were outlining the animal.
 */
export function TracingOutline({
  color = '#2b2418',
  height,
  width,
}: {
  color?: string;
  height: number;
  width: number;
}) {
  const path = useMemo(() => {
    const p = Skia.Path.Make();
    const cx = width / 2;
    const cy = height / 2;
    // A slightly wobbly closed loop reads hand-traced rather than geometric.
    // Deterministic jitter: no flicker across re-renders.
    const points = Array.from({ length: POINTS }, (_, i) => {
      const angle = (i / POINTS) * Math.PI * 2 - Math.PI / 2;
      const wobble = 1 + 0.05 * Math.sin(i * 2.7) + 0.03 * Math.cos(i * 4.1);
      return {
        x: cx + Math.cos(angle) * width * 0.44 * wobble,
        y: cy + Math.sin(angle) * height * 0.45 * wobble,
      };
    });
    const at = (i: number) => points[(i + POINTS) % POINTS];
    p.moveTo(at(0).x, at(0).y);
    for (let i = 0; i < POINTS; i++) {
      const p0 = at(i - 1);
      const p1 = at(i);
      const p2 = at(i + 1);
      const p3 = at(i + 2);
      // Catmull-Rom through the samples, expressed as cubic Bézier segments.
      p.cubicTo(
        p1.x + (p2.x - p0.x) / 6,
        p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6,
        p2.y - (p3.y - p1.y) / 6,
        p2.x,
        p2.y,
      );
    }
    p.close();
    return p;
  }, [height, width]);

  const clock = useSharedValue(0);
  useEffect(() => {
    clock.set(0);
    clock.set(
      withRepeat(
        withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.cubic) }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(clock);
  }, [clock]);

  const end = useDerivedValue(() => Math.min(1, clock.get() * OVERDRIVE));
  const start = useDerivedValue(() => Math.max(0, clock.get() * OVERDRIVE - TAIL));

  return (
    <Canvas style={{ height, width }}>
      <Path color={color} opacity={0.16} path={path} strokeWidth={1} style="stroke" />
      <Path
        color={color}
        end={end}
        opacity={0.55}
        path={path}
        start={start}
        strokeCap="round"
        strokeWidth={6}
        style="stroke"
      >
        <Blur blur={6} />
      </Path>
      <Path
        color="#fff8e5"
        end={end}
        path={path}
        start={start}
        strokeCap="round"
        strokeWidth={2}
        style="stroke"
      />
    </Canvas>
  );
}
