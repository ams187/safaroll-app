import * as Haptics from 'expo-haptics';
import { useCallback, useMemo, type ReactNode, type RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import { useOverlay } from './overlay-provider';
import { RadialMenu, type RadialActionDef } from './radial-menu';

// Ported from SchroederNathan/react-native-motion
// (apps/expo/components/animations/radial-menu/use-radial-overlay.tsx). The
// source's long-press + pan + release flow is kept intact; `tapGesture` is the
// addition this app asked for, opening the same overlay from a plain tap.

const LONG_PRESS_MS = 500;

export interface CloneLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function useRadialOverlay({
  actions,
  onCancel,
  onSelect,
  renderClone,
  targetRef,
}: {
  actions: RadialActionDef[];
  onCancel?: () => void;
  onSelect: (id: string) => void;
  renderClone: (layout: CloneLayout) => ReactNode;
  targetRef: RefObject<View | null>;
}) {
  const { hideOverlay, showOverlay } = useOverlay();

  const cursorX = useSharedValue(0);
  const cursorY = useSharedValue(0);
  const releaseSignal = useSharedValue(0);
  const overlayOpen = useSharedValue(0);
  const isLongPressed = useSharedValue(false);
  // Keep `overlayOpen` at 1 until the close spring settles so the original card
  // stays hidden for the whole lifetime — it reappears exactly as the clone
  // unmounts, making the clone look like the one that moved.
  const handleSelect = useCallback(
    (id: string) => {
      hideOverlay();
      overlayOpen.set(0);
      onSelect(id);
    },
    [hideOverlay, onSelect, overlayOpen],
  );

  const handleCancel = useCallback(() => {
    hideOverlay();
    overlayOpen.set(0);
    onCancel?.();
  }, [hideOverlay, onCancel, overlayOpen]);

  // `measureInWindow` is async and JS-thread only, so the gesture worklet hands
  // the press point here to measure the card and mount the overlay.
  // Same contract as `panGesture` below, but lives inside the overlay so it is
  // available after the opening finger is gone.
  const overlayPan = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .minDistance(0)
        .onBegin((e) => {
          'worklet';
          cursorX.set(e.absoluteX);
          cursorY.set(e.absoluteY);
        })
        .onUpdate((e) => {
          'worklet';
          cursorX.set(e.absoluteX);
          cursorY.set(e.absoluteY);
        })
        // `onFinalize`, not `onEnd`: a still tap produces no move events, so
        // the pan never reaches ACTIVE and `onEnd` never runs — the menu stayed
        // open on every tap outside it. `onFinalize` fires when the gesture
        // ends whether or not it activated, which covers both the tap and the
        // slide with one handler.
        .onFinalize(() => {
          'worklet';
          if (overlayOpen.get() === 1) {
            releaseSignal.set(releaseSignal.get() + 1);
          }
        }),
    [cursorX, cursorY, overlayOpen, releaseSignal],
  );

  const openOverlayAt = useCallback(
    (pressX: number, pressY: number) => {
      targetRef.current?.measureInWindow((x, y, width, height) => {
        showOverlay(
          <View pointerEvents="box-none" style={styles.layer}>
            {/* A tap-opened fan has no finger left driving the cursor, so the
                overlay grows its own pan: press anywhere, slide across the
                icons and release, exactly as the card's own gesture does while
                the finger never lifts. Releasing on nothing cancels, which
                also makes the whole backdrop a dismiss target. */}
            {renderClone({ height, width, x, y })}
            <RadialMenu
              actions={actions}
              cursorX={cursorX}
              cursorY={cursorY}
              onCancel={handleCancel}
              onSelect={handleSelect}
              pressX={pressX}
              pressY={pressY}
              releaseSignal={releaseSignal}
            />
            {/* Last child, so it sits above the fan: a tap-opened menu has no
                finger already captured, and any view rendered on top of this
                would swallow the touch before the pan ever saw it. */}
            <GestureDetector gesture={overlayPan}>
              <View style={StyleSheet.absoluteFill} />
            </GestureDetector>
          </View>,
        );
        overlayOpen.set(1);
      });
    },
    [
      actions,
      cursorX,
      cursorY,
      handleCancel,
      handleSelect,
      overlayOpen,
      overlayPan,
      releaseSignal,
      renderClone,
      showOverlay,
      targetRef,
    ],
  );

  // Built once: the compiler flags gesture callbacks created on every render
  // as render-phase ref access, and rebuilding them each pass would drop the
  // handlers gesture-handler already attached.
  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
    .maxDuration(LONG_PRESS_MS - 20)
    // `openOverlayAt` reads `targetRef.current`; the compiler traces that back
    // into this closure and calls it render-phase ref access. It is not — the
    // body only runs when the gesture fires.
    // eslint-disable-next-line react-hooks/refs
    .onEnd((event) => {
      'worklet';
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
      // Park the cursor on the press point: with no finger down there is no
      // hover, so every button stays at rest until one is tapped.
      cursorX.set(event.absoluteX);
      cursorY.set(event.absoluteY);
      runOnJS(openOverlayAt)(event.absoluteX, event.absoluteY);
    }),
    [cursorX, cursorY, openOverlayAt],
  );

  const longPressGesture = useMemo(
    () =>
      Gesture.LongPress()
    .minDuration(LONG_PRESS_MS)
    .maxDistance(25)
    // Same false positive as the tap gesture above.
    // eslint-disable-next-line react-hooks/refs
    .onStart((event) => {
      'worklet';
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
      isLongPressed.set(true);
      cursorX.set(event.absoluteX);
      cursorY.set(event.absoluteY);
      runOnJS(openOverlayAt)(event.absoluteX, event.absoluteY);
    })
    .onFinalize(() => {
      'worklet';
      isLongPressed.set(false);
    }),
    [cursorX, cursorY, isLongPressed, openOverlayAt],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
    .maxPointers(1)
    .activateAfterLongPress(LONG_PRESS_MS)
    .onBegin((e) => {
      'worklet';
      cursorX.set(e.absoluteX);
      cursorY.set(e.absoluteY);
    })
    .onUpdate((e) => {
      'worklet';
      cursorX.set(e.absoluteX);
      cursorY.set(e.absoluteY);
    })
    .onEnd(() => {
      'worklet';
      // Increment (never toggle) so a same-frame end/restart can't be missed.
      if (overlayOpen.get() === 1) {
        releaseSignal.set(releaseSignal.get() + 1);
      }
    }),
    [cursorX, cursorY, overlayOpen, releaseSignal],
  );

  return { isLongPressed, longPressGesture, overlayOpen, panGesture, tapGesture };
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10000,
  },
});
