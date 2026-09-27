// La transition de l'écusson vers sa vitrine.
//
// C'est le mécanisme de `useTresorMorph` de Bloom, porté tel quel : l'objet se
// décolle de sa grille, s'envole au centre en grossissant, et la vitrine se
// révèle autour de lui. À la fermeture il retombe dans sa case et rebondit une
// fois.
//
// POURQUOI UN CLONE ET PAS UNE NAVIGATION
//
// Pousser un écran ferait disparaître la grille et apparaître une page : deux
// images sans rapport, et le joueur doit refaire le lien. Ici l'écusson qu'il a
// touché est LE MÊME objet qui arrive au centre — il ne le quitte jamais des
// yeux. C'est la continuité qui fait qu'on comprend où l'on est.
//
// LE CLONE S'EFFACE UNE FOIS LA VITRINE VISIBLE
//
// Il se pose au pixel près sur l'écusson de la vitrine, donc l'échange ne se
// voit pas — et la vitrine peut ensuite défiler sans traîner un objet fantôme
// collé au centre.
//
// L'ÉCRASEMENT DU RETOUR N'EST PAS UN ORNEMENT
//
// À l'arrivée dans sa case, l'objet s'aplatit d'un cheveu puis se redresse en
// spring. Sans ce dip, il s'arrête net et on lit une animation qui se coupe ;
// avec, on lit une masse qui se pose.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions, type View } from 'react-native';
import {
  runOnJS,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * Hauteur, en fraction d'écran, où l'écusson vient se poser.
 *
 * Exportée : la vitrine DOIT poser le sien exactement là. Le clone s'efface en
 * arrivant, et s'ils ne coïncident pas au pixel près, l'échange se voit comme
 * un saut.
 */
export const TARGET_Y_RATIO = 0.28;

/** Taille du clone volant avant mise à l'échelle — celle d'une case de grille. */
export const FLOATING_SIZE = 84;
const HALF = FLOATING_SIZE / 2;

/** Ce que l'écusson mesure une fois posé dans la vitrine. */
export const VITRINE_SIZE = 168;

const SETTLE_SPRING = { damping: 18, stiffness: 130, mass: 0.8 } as const;
const BOUNCE_SPRING = { damping: 14, stiffness: 180, mass: 0.7 } as const;
const CLOSE_SPRING = { damping: 26, stiffness: 160, mass: 0.9 } as const;
const CLOSE_SQUASH = { damping: 14, stiffness: 260, mass: 0.6 } as const;

const SQUASH_MIN_SCALE_Y = 0.82;
const SQUASH_DIP_DURATION = 70;

const OVERLAY_FADE_IN = 200;
const OVERLAY_FADE_OUT = 400;
const DETAIL_FADE_OUT = 200;
const DETAIL_REVEAL_DELAY = 250;
const DETAIL_REVEAL_DURATION = 500;

export type BadgeRef = React.RefObject<View | null>;
export type Origine = { readonly x: number; readonly y: number };

export type MorphAnimation = {
  readonly overlayOpacity: SharedValue<number>;
  readonly objetScale: SharedValue<number>;
  readonly objetTranslateX: SharedValue<number>;
  readonly objetTranslateY: SharedValue<number>;
  readonly objetSquashY: SharedValue<number>;
  readonly detailOpacity: SharedValue<number>;
};

export function useBadgeMorph<T>() {
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();

  const [selection, setSelection] = useState<T | null>(null);
  const [origine, setOrigine] = useState<Origine>({ x: 0, y: 0 });
  const enTransition = useRef(false);

  const overlayOpacity = useSharedValue(0);
  const objetScale = useSharedValue(1);
  const objetTranslateX = useSharedValue(0);
  const objetTranslateY = useSharedValue(0);
  const objetSquashY = useSharedValue(1);
  const detailOpacity = useSharedValue(0);

  const ouvrir = useCallback(
    (ref: BadgeRef, item: T) => {
      if (enTransition.current) return;
      const node = ref.current;
      if (!node) return;
      enTransition.current = true;

      // `measure` donne la position À L'ÉCRAN : c'est elle qu'il faut, la grille
      // défile et une position relative au parent serait fausse dès le premier
      // glissement.
      node.measure((_x, _y, width, height, pageX, pageY) => {
        objetTranslateX.set(0);
        objetTranslateY.set(0);
        objetScale.set(1);
        objetSquashY.set(1);
        overlayOpacity.set(0);
        detailOpacity.set(0);

        setOrigine({ x: pageX + width / 2 - HALF, y: pageY + height / 2 - HALF });
        setSelection(item);
      });
    },
    [detailOpacity, objetScale, objetSquashY, objetTranslateX, objetTranslateY, overlayOpacity],
  );

  useEffect(() => {
    if (selection === null) return;

    const targetX = screenWidth / 2 - (origine.x + HALF);
    const targetY = screenHeight * TARGET_Y_RATIO - (origine.y + HALF);

    overlayOpacity.set(withTiming(1, { duration: OVERLAY_FADE_IN }));
    objetTranslateX.set(withSpring(targetX, SETTLE_SPRING));
    objetTranslateY.set(withSpring(targetY, SETTLE_SPRING));
    // L'échelle vise la taille EXACTE de l'écusson de la vitrine, pour que le
    // clone se pose dessus au pixel près avant de s'effacer.
    objetScale.set(withSpring(VITRINE_SIZE / FLOATING_SIZE, BOUNCE_SPRING));
    detailOpacity.set(
      withDelay(DETAIL_REVEAL_DELAY, withTiming(1, { duration: DETAIL_REVEAL_DURATION })),
    );
  }, [
    detailOpacity,
    objetScale,
    objetTranslateX,
    objetTranslateY,
    origine,
    overlayOpacity,
    screenHeight,
    screenWidth,
    selection,
  ]);

  const finir = useCallback(() => {
    setSelection(null);
    enTransition.current = false;
  }, []);

  const fermer = useCallback(() => {
    if (selection === null) return;

    detailOpacity.set(withTiming(0, { duration: DETAIL_FADE_OUT }));
    objetScale.set(withSpring(1, CLOSE_SPRING));
    objetTranslateX.set(withSpring(0, CLOSE_SPRING));
    objetTranslateY.set(
      withSpring(0, CLOSE_SPRING, (finished) => {
        if (finished) {
          objetSquashY.set(
            withSequence(
              withTiming(SQUASH_MIN_SCALE_Y, { duration: SQUASH_DIP_DURATION }),
              withSpring(1, CLOSE_SQUASH),
            ),
          );
        }
      }),
    );
    overlayOpacity.set(
      withTiming(0, { duration: OVERLAY_FADE_OUT }, (finished) => {
        if (finished) runOnJS(finir)();
      }),
    );
  }, [
    detailOpacity,
    finir,
    objetScale,
    objetSquashY,
    objetTranslateX,
    objetTranslateY,
    overlayOpacity,
    selection,
  ]);

  const animation = useMemo<MorphAnimation>(
    () => ({
      detailOpacity,
      objetScale,
      objetSquashY,
      objetTranslateX,
      objetTranslateY,
      overlayOpacity,
    }),
    [detailOpacity, objetScale, objetSquashY, objetTranslateX, objetTranslateY, overlayOpacity],
  );

  return { animation, fermer, origine, ouvrir, selection };
}
