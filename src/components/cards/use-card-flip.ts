// Ported from ManasCodeXart/expo-card-insight (`src/hooks/useCardFlipGesture`).
//
// Drag the card on either axis and it turns; let go and it snaps to whichever
// face it was closest to. Kept from the reference: the 0.4 drag-to-degrees
// ratio, the spring, the 600 perspective, the +180 on the back face, and the
// two-axis XOR that decides which face is showing (see `flip-rotation.ts`).
//
// Dropped: the page-swipe branch and the ripple-on-settle. Both belong to the
// reference's card carousel — there is one card here, and nothing to swipe to.
//
// Added: `flip()`, because SafaRoll asks for a button as well as the drag. It
// drives the same shared value the gesture does, so a card turned by the button
// and a card turned by hand end up in exactly the same state.

import { useCallback } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { resolveSnappedRotation, showsBack } from './flip-rotation';

const PERSPECTIVE = 600;
const SPRING = { damping: 18, mass: 0.8, stiffness: 120 } as const;
/** Degrees of turn per point dragged. */
const DRAG_TO_ROTATION = 0.4;

export function useCardFlip({ enabled = true }: { enabled?: boolean } = {}) {
  const rotateY = useSharedValue(0);
  const rotateX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const savedX = useSharedValue(0);

  const gesture = Gesture.Pan()
    .enabled(enabled)
    .onBegin(() => {
      savedY.set(rotateY.get());
      savedX.set(rotateX.get());
    })
    .onUpdate((e) => {
      rotateY.set(savedY.get() + e.translationX * DRAG_TO_ROTATION);
      rotateX.set(savedX.get() - e.translationY * DRAG_TO_ROTATION);
    })
    .onEnd(() => {
      rotateY.set(withSpring(resolveSnappedRotation(rotateY.get()), SPRING));
      rotateX.set(withSpring(resolveSnappedRotation(rotateX.get()), SPRING));
    });

  const back = useDerivedValue(() => showsBack(rotateY.get(), rotateX.get()));

  /** Half a turn from wherever it is, on the Y axis — the button's flip. */
  const flip = useCallback(() => {
    // From the SNAPPED angle, not the raw one: pressing the button while the
    // card is still settling from a drag would otherwise compound the leftover
    // few degrees into a crooked resting pose.
    rotateY.set(withSpring(resolveSnappedRotation(rotateY.get()) + 180, SPRING));
    rotateX.set(withSpring(resolveSnappedRotation(rotateX.get()), SPRING));
  }, [rotateX, rotateY]);

  /**
   * Repose la carte face avant, SANS animation.
   *
   * Les valeurs partagées survivent au changement de carte : l'overlay reste
   * monté et ne fait que changer de `selection`. Une carte laissée retournée
   * rouvrait donc la SUIVANTE déjà sur son dos — on croyait avoir ouvert le
   * mauvais objet.
   *
   * Sans ressort, volontairement : la carte arrive en vol depuis sa tuile, et
   * la voir se dé-retourner pendant ce vol se lit comme un bug d'affichage.
   */
  const reset = useCallback(() => {
    rotateY.set(0);
    rotateX.set(0);
    savedY.set(0);
    savedX.set(0);
  }, [rotateX, rotateY, savedX, savedY]);

  const frontStyle = useAnimatedStyle(() => ({
    opacity: back.get() ? 0 : 1,
    transform: [
      { perspective: PERSPECTIVE },
      { rotateX: `${rotateX.get()}deg` },
      { rotateY: `${rotateY.get()}deg` },
    ],
  }));

  const backStyle = useAnimatedStyle(() => ({
    opacity: back.get() ? 1 : 0,
    transform: [
      { perspective: PERSPECTIVE },
      { rotateX: `${rotateX.get()}deg` },
      // The far side is the same sheet, half a turn further round. Without it
      // the back reads mirrored, which is what a real card's back never does.
      { rotateY: `${rotateY.get() + 180}deg` },
    ],
  }));

  return { backStyle, flip, frontStyle, gesture, reset };
}
