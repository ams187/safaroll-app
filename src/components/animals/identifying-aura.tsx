import { useEffect } from 'react';
import { useSiri } from '@/components/ui/organisms/apple-intelligence/context';

/** The shader holds eight colour stops; more are ignored. */
const MAX_STOPS = 8;
/**
 * The provider snapshots what it wraps, so it must not fire before the die-cut
 * has actually painted — otherwise the aura ripples an empty frame for the
 * whole wait.
 */
const ARM_MS = 650;

/**
 * The Apple-Intelligence aura, armed while BioCLIP thinks.
 *
 * Renders nothing: it only drives the provider it sits inside. The provider
 * takes one snapshot of the subject and then warps, shimmers and glows it for
 * as long as the identification runs — which is why the tremor underneath
 * stops being visible the moment this arms, and why the haptics carry the
 * waiting on their own from there.
 *
 * The colour stops are the animal's, so a flamingo waits in pink and a
 * kingfisher in blue.
 */
export function IdentifyingAura({
  colors,
  waiting,
}: {
  /** Ramp for the glow, animal-first. */
  colors: string[];
  waiting: boolean;
}) {
  const { isActive, toggle } = useSiri();

  useEffect(() => {
    if (waiting && !isActive) {
      const timer = setTimeout(
        () =>
          toggle({
            glow: { colors: colors.slice(0, MAX_STOPS), saturation: 0.9, speed: 0.5 },
            shimmer: { amount: 0.5, speed: 0.7 },
            wave: { speed: 0.35, strength: 0.5 },
          }),
        ARM_MS,
      );
      return () => clearTimeout(timer);
    }
    // Dismissed the instant the result lands: the strike has to hit a live
    // card, not a snapshot of the one that was waiting.
    if (!waiting && isActive) toggle();
  }, [colors, isActive, toggle, waiting]);

  return null;
}
