import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setCardOverlayOpen } from './card-overlay-state';
import { PixelRatio, useWindowDimensions, type View } from 'react-native';
import { cardRarity } from '@/lib/animals/rarity';
import { prewarmCardImage } from './card-image';
import { cardSceneFor } from './card-scenes';
import {
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { CARD_RATIO, portraitRectFor, type HoloCardData } from './holo-card';

/** Size of the flying clone before scaling. */
export const FLOATING_SIZE = 70;
const FLOATING_HALF_SIZE = FLOATING_SIZE / 2;

/** Where the opened card sits on screen — top of the card, as a screen fraction. */
const CARD_TOP_RATIO = 0.14;

const SETTLE_SPRING = { damping: 18, stiffness: 130, mass: 0.8 } as const;
/**
 * L'échelle du clone, et elle ne rebondit PAS.
 *
 * Elle était à `damping: 14` — un taux d'amortissement de 0,62, soit 8 % de
 * dépassement. Le sticker grandit de 70 pt à ~306 pt : 8 % de trop font 25 pt.
 * Il gonflait au-delà de sa taille finale puis redescendait, ce qui se lit comme
 * une erreur de trajectoire, pas comme du ressort.
 *
 * `damping: 22` amène le taux à 0,98 — critique. Le rebond a sa place quand un
 * geste a porté un élan ; ici la carte se pose sur un rectangle au pixel près,
 * et dépasser cette cible c'est rater précisément ce qui rend l'échange
 * invisible.
 */
const BOUNCE_SPRING = { damping: 22, stiffness: 180, mass: 0.7 } as const;
const CLOSE_SPRING = { damping: 26, stiffness: 160, mass: 0.9 } as const;
const CLOSE_SQUASH = { damping: 14, stiffness: 260, mass: 0.6 } as const;

const SQUASH_MIN_SCALE_Y = 0.82;
const SQUASH_DIP_DURATION = 70;

const OVERLAY_FADE_IN_DURATION = 200;
const OVERLAY_FADE_OUT_DURATION = 400;
const DETAIL_FADE_OUT_DURATION = 200;
const DETAIL_REVEAL_DELAY = 250;
const DETAIL_REVEAL_DURATION = 500;

export type Origin = { x: number; y: number };

export type MorphAnimation = {
  overlayOpacity: SharedValue<number>;
  cloneScale: SharedValue<number>;
  cloneTranslateX: SharedValue<number>;
  cloneTranslateY: SharedValue<number>;
  cloneSquashY: SharedValue<number>;
  detailOpacity: SharedValue<number>;
};

export function cardWidthFor(screenWidth: number) {
  return Math.min(screenWidth - 42, 370);
}

/**
 * Opening a card: the animal peels off its grid tile, flies to the middle
 * growing as it goes, and the full card is revealed around it — landing pixel
 * on pixel where the card draws its portrait, so the swap is invisible. On
 * close it drops back into its tile and bounces once.
 *
 * Ported from the treasure morph in ~/Bloom (`useTresorMorph`).
 */
export function useCardMorph() {
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();

  const [selection, setSelection] = useState<HoloCardData | null>(null);
  const [origin, setOrigin] = useState<Origin>({ x: 0, y: 0 });
  const [settled, setSettled] = useState(false);
  const transitioning = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tells the tab bar to stand down: the enlarged card is an overlay, not a
  // route, so the navigator cannot work this out for itself.
  useEffect(() => {
    setCardOverlayOpen('card', selection !== null);
  }, [selection]);
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setCardOverlayOpen('card', false);
  }, []);

  const overlayOpacity = useSharedValue(0);
  const cloneScale = useSharedValue(1);
  const cloneTranslateX = useSharedValue(0);
  const cloneTranslateY = useSharedValue(0);
  const cloneSquashY = useSharedValue(1);
  const detailOpacity = useSharedValue(0);

  const open = useCallback(
    (stickerRef: React.RefObject<View | null>, data: HoloCardData) => {
      if (transitioning.current) return;
      const node = stickerRef.current;
      if (!node) return;

      transitioning.current = true;
      setSettled(false);

      // Le décodage grand format part MAINTENANT, pas au montage de la carte.
      // Sinon il commence au moment exact où il faudrait afficher le sticker,
      // et on le regarde arriver.
      const edge = PixelRatio.getPixelSizeForLayoutSize(cardWidthFor(screenWidth) / CARD_RATIO);
      const ready = data.status === 'ready' || data.status === 'needs_review';
      prewarmCardImage(data.stickerUrl, edge);
      prewarmCardImage(
        cardSceneFor(data.scientificName, ready ? cardRarity(data) : undefined, {
          sceneSlug: data.sceneSlug,
        }),
        edge,
      );

      node.measure((_x, _y, width, height, pageX, pageY) => {
        cloneTranslateX.set(0);
        cloneTranslateY.set(0);
        cloneScale.set(1);
        cloneSquashY.set(1);
        overlayOpacity.set(0);
        detailOpacity.set(0);

        setOrigin({
          x: pageX + width / 2 - FLOATING_HALF_SIZE,
          y: pageY + height / 2 - FLOATING_HALF_SIZE,
        });
        setSelection(data);
      });
    },
    [
      cloneScale,
      cloneSquashY,
      cloneTranslateX,
      cloneTranslateY,
      detailOpacity,
      overlayOpacity,
      screenWidth,
    ],
  );

  useEffect(() => {
    if (!selection) return;

    // Land the clone exactly on the portrait window of the opened card.
    const cardWidth = cardWidthFor(screenWidth);
    const portrait = portraitRectFor(cardWidth);
    const cardX = (screenWidth - cardWidth) / 2;
    const cardY = screenHeight * CARD_TOP_RATIO;

    const targetX = cardX + portrait.x + portrait.width / 2 - (origin.x + FLOATING_HALF_SIZE);
    const targetY = cardY + portrait.y + portrait.height / 2 - (origin.y + FLOATING_HALF_SIZE);

    overlayOpacity.set(withTiming(1, { duration: OVERLAY_FADE_IN_DURATION }));
    cloneTranslateX.set(withSpring(targetX, SETTLE_SPRING));
    cloneTranslateY.set(withSpring(targetY, SETTLE_SPRING));
    cloneScale.set(withSpring(portrait.width / FLOATING_SIZE, BOUNCE_SPRING));
    detailOpacity.set(withDelay(
      DETAIL_REVEAL_DELAY,
      withTiming(1, { duration: DETAIL_REVEAL_DURATION }, (finished) => {
        if (finished) scheduleOnRN(setSettled, true);
      }),
    ));
  }, [
    cloneScale,
    cloneTranslateX,
    cloneTranslateY,
    detailOpacity,
    origin,
    overlayOpacity,
    screenHeight,
    screenWidth,
    selection,
  ]);

  const finishClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setSettled(false);
    setSelection(null);
    transitioning.current = false;
  }, []);

  const close = useCallback(() => {
    if (!selection) return;

    // Reanimated may cancel a completion callback during a reload or an
    // interrupted transition. Never leave the full Skia card alive, invisible,
    // behind the collection.
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(finishClose, OVERLAY_FADE_OUT_DURATION + 100);

    detailOpacity.set(withTiming(0, { duration: DETAIL_FADE_OUT_DURATION }));
    cloneScale.set(withSpring(1, CLOSE_SPRING));
    cloneTranslateX.set(withSpring(0, CLOSE_SPRING));
    cloneTranslateY.set(
      withSpring(0, CLOSE_SPRING, (finished) => {
        if (finished) {
          cloneSquashY.set(
            withSequence(
              withTiming(SQUASH_MIN_SCALE_Y, { duration: SQUASH_DIP_DURATION }),
              withSpring(1, CLOSE_SQUASH),
            ),
          );
        }
      }),
    );
    overlayOpacity.set(
      withTiming(0, { duration: OVERLAY_FADE_OUT_DURATION }, (finished) => {
        if (finished) scheduleOnRN(finishClose);
      }),
    );
  }, [
    cloneScale,
    cloneSquashY,
    cloneTranslateX,
    cloneTranslateY,
    detailOpacity,
    finishClose,
    overlayOpacity,
    selection,
  ]);

  const animation = useMemo<MorphAnimation>(
    () => ({
      overlayOpacity,
      cloneScale,
      cloneTranslateX,
      cloneTranslateY,
      cloneSquashY,
      detailOpacity,
    }),
    [cloneScale, cloneSquashY, cloneTranslateX, cloneTranslateY, detailOpacity, overlayOpacity],
  );

  const layout = useMemo(() => {
    const width = cardWidthFor(screenWidth);
    return { cardWidth: width, cardHeight: width / CARD_RATIO, cardTop: screenHeight * CARD_TOP_RATIO };
  }, [screenHeight, screenWidth]);

  return { animation, close, layout, open, origin, selection, settled };
}
