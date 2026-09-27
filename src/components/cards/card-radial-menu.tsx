import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { makeIcon, type RadialActionDef } from './radial/radial-menu';
import { useRadialOverlay } from './radial/use-radial-overlay';

export { OverlayProvider as RadialMenuProvider } from './radial/overlay-provider';
export type { RadialActionDef } from './radial/radial-menu';

/**
 * A card that answers a tap with the radial menu, exactly as the reference
 * plays it: the card is measured, cloned into a full-screen overlay behind a
 * blur that springs to intensity 80, lifted to 1.1x with a small random tilt,
 * and the actions grow out of the point you touched.
 *
 * `renderClone` receives the measured frame, so the copy lands on the pixel the
 * original occupies and the original is hidden underneath — the source's trick
 * for making the lifted card read as *the* card rather than a second one.
 */
export function CardRadialMenu({
  actions,
  children,
  holdGesture,
  onSelect,
}: {
  actions: RadialActionDef[];
  children: React.ReactNode;
  /**
   * What holding the card means, if anything — in the collection it is the
   * drag that carries the card into a deck. It gets priority over the tap: a
   * quick press never reaches it, and once it activates the tap is cancelled,
   * so one card can be both dragged and tapped without the two crossing.
   */
  holdGesture?: GestureType;
  onSelect: (id: string) => void;
}) {
  const cardRef = useRef<View>(null);

  const renderClone = useCallback(
    ({ height, width, x, y }: { height: number; width: number; x: number; y: number }) => (
      <View pointerEvents="none" style={{ height, left: x, position: 'absolute', top: y, width }}>
        {children}
      </View>
    ),
    [children],
  );

  const { overlayOpen, tapGesture } = useRadialOverlay({
    actions,
    onSelect,
    renderClone,
    targetRef: cardRef,
  });

  // Tap opens the menu; holding does whatever the screen says holding means.
  // The reference's own long-press flow still lives in the hook for anyone who
  // wants it; the slide-and-release selection it exists for is now served by
  // the overlay's own pan, once the fan is up.
  const gesture = useMemo(
    () => (holdGesture ? Gesture.Exclusive(holdGesture, tapGesture) : tapGesture),
    [holdGesture, tapGesture],
  );

  // Hide the original while its clone is lifted into the overlay.
  const faceStyle = useAnimatedStyle(() => ({ opacity: overlayOpen.get() === 1 ? 0 : 1 }));

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} ref={cardRef}>
        <Animated.View style={faceStyle}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

/** A tile that carries the standard SafaRoll card actions. */
export function CardActionsMenu({
  children,
  holdGesture,
  onAction,
  onEnlarge,
  onShare,
  onUse,
}: {
  children: React.ReactNode;
  /** See `CardRadialMenu`. */
  holdGesture?: GestureType;
  /** Reports the chosen action's title, for the screen's status line. */
  onAction?: (title: string) => void;
  /** Open the full card. */
  onEnlarge: () => void;
  onShare: () => void;
  /** Arm deck placement: the next deck slot tapped receives this card. */
  onUse: () => void;
}) {
  const { t } = useTranslation();
  const actions = [
    { icon: ENLARGE_ICON, id: 'enlarge', title: t('card_action_enlarge') },
    { icon: USE_ICON, id: 'use', title: t('card_action_use') },
    // `arrow-redo` is the reference's own share glyph.
    { icon: SHARE_ICON, id: 'share', title: t('card_action_share') },
  ];
  return (
    <CardRadialMenu
      actions={actions}
      holdGesture={holdGesture}
      onSelect={(id) => {
        onAction?.(actions.find((action) => action.id === id)?.title ?? id);
        if (id === 'enlarge') onEnlarge();
        else if (id === 'use') onUse();
        else if (id === 'share') onShare();
      }}
    >
      {children}
    </CardRadialMenu>
  );
}

const ENLARGE_ICON = makeIcon('expand');
const USE_ICON = makeIcon('albums');
const SHARE_ICON = makeIcon('arrow-redo');
