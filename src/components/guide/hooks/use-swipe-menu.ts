// Le tiroir latéral de ChatGPT, porté depuis
// Code-with-Beto/swipe-menu-example (`src/features/swipe-menu`).
//
// Ce qui remplace le `PagerView` à deux pages qu'avait le Guide : là-bas les
// discussions ÉTAIENT une page, on y allait et il fallait revenir. Ici elles
// sont posées DESSOUS, immobiles, et c'est la conversation qui coulisse vers la
// droite pour les découvrir. Le décor ne change pas, il se décale — et c'est ce
// qui rend le retour évident : la conversation est toujours là, à moitié
// visible, on la repousse.
//
// Tout se joue sur une seule valeur partagée. Le doigt l'écrit image par image
// sur le thread UI ; React n'apprend que l'état final, ouvert ou fermé.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

/** Le tiroir occupe 78 % de la largeur : la conversation reste lisible derrière. */
export const SWIPE_MENU_WIDTH_RATIO = 0.78;

/**
 * Le rayon de la surface qui coulisse.
 *
 * La référence lit le vrai rayon des coins de l'écran via un module natif, et
 * retombe sur 55 pt sur iOS. Ici le Guide est présenté en modal : la feuille a
 * déjà ses propres coins, et 55 pt à l'intérieur donnerait une pastille. 32 est
 * le repli Android de la référence, et c'est celui qui va à une feuille.
 */
export const SWIPE_MENU_RADIUS = 32;

const SWIPE_GESTURE = {
  activationDistance: 8,
  directionDistanceThreshold: 12,
  openPositionThreshold: 0.18,
  velocityInfluence: 0.05,
  velocityThreshold: 160,
  verticalTolerance: 18,
} as const;

const SWIPE_SPRING = {
  damping: 26,
  mass: 0.8,
  overshootClamping: true,
  stiffness: 220,
} as const;

/** Le tiroir ne fait pas qu'apparaître : il monte et se déplie légèrement. */
const SWIPE_MENU_REVEAL = {
  fadeEndProgress: 0.5,
  fadeStartProgress: 0.08,
  startScale: 0.975,
  startVerticalOffset: 8,
} as const;

type SwipeEndState = {
  currentPosition: number;
  menuWidth: number;
  translationX: number;
  velocityX: number;
};

function clamp(value: number, minimum: number, maximum: number) {
  'worklet';

  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * L'INTENTION AVANT LA POSITION.
 *
 * Un relâchement franc décide par sa direction, pas par l'endroit où le doigt
 * s'est arrêté : un coup sec vers la droite ouvre même à dix pixels du bord.
 * C'est seulement quand le geste est lent ET court — donc sans direction lisible
 * — qu'on regarde où le tiroir en est, avec un seuil bas (18 %) qui penche vers
 * l'ouverture, parce qu'un tiroir entrouvert que l'on relâche voulait s'ouvrir.
 */
function shouldOpenMenu({
  currentPosition,
  menuWidth,
  translationX,
  velocityX,
}: SwipeEndState) {
  'worklet';

  const hasDirectionalIntent =
    Math.abs(translationX) > SWIPE_GESTURE.directionDistanceThreshold ||
    Math.abs(velocityX) > SWIPE_GESTURE.velocityThreshold;

  if (hasDirectionalIntent) {
    return translationX + velocityX * SWIPE_GESTURE.velocityInfluence > 0;
  }

  return currentPosition > menuWidth * SWIPE_GESTURE.openPositionThreshold;
}

export function useSwipeMenu(menuWidth: number) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const translateX = useSharedValue(0);
  const gestureStartX = useSharedValue(0);
  const previousMenuWidth = useRef(menuWidth);

  const animateMenu = useCallback(
    (open: boolean) => {
      setIsMenuOpen(open);
      translateX.set(withSpring(open ? menuWidth : 0, SWIPE_SPRING));
    },
    [menuWidth, translateX],
  );

  // Rotation de l'appareil : la largeur du tiroir change sous un décalage déjà
  // posé. On recale sans animer — l'écran vient de tourner, une glissade en plus
  // ne se lirait pas.
  useEffect(() => {
    if (previousMenuWidth.current === menuWidth) return;
    translateX.set(isMenuOpen ? menuWidth : 0);
    previousMenuWidth.current = menuWidth;
  }, [isMenuOpen, menuWidth, translateX]);

  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        // Les deux tolérances sont ce qui fait cohabiter ce geste avec la liste
        // de la conversation : il faut 8 pt d'horizontale pour l'armer, et 18 pt
        // de vertical le font échouer net au profit du défilement.
        .activeOffsetX([-SWIPE_GESTURE.activationDistance, SWIPE_GESTURE.activationDistance])
        .failOffsetY([-SWIPE_GESTURE.verticalTolerance, SWIPE_GESTURE.verticalTolerance])
        .onBegin(() => {
          gestureStartX.set(translateX.get());
        })
        .onUpdate((event) => {
          translateX.set(clamp(gestureStartX.get() + event.translationX, 0, menuWidth));
        })
        .onEnd((event) => {
          const shouldOpen = shouldOpenMenu({
            currentPosition: translateX.get(),
            menuWidth,
            translationX: event.translationX,
            velocityX: event.velocityX,
          });
          translateX.set(withSpring(shouldOpen ? menuWidth : 0, SWIPE_SPRING));
          // Le seul aller-retour vers React de tout le geste.
          scheduleOnRN(setIsMenuOpen, shouldOpen);
        }),
    [gestureStartX, menuWidth, translateX],
  );

  const mainAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.get() }],
  }));

  const menuContentAnimatedStyle = useAnimatedStyle(() => {
    const progress = translateX.get() / menuWidth;
    return {
      // Le contenu reste invisible sur les premiers 8 % : un tiroir qu'on
      // effleure ne doit pas clignoter.
      opacity: interpolate(
        progress,
        [0, SWIPE_MENU_REVEAL.fadeStartProgress, SWIPE_MENU_REVEAL.fadeEndProgress],
        [0, 0, 1],
        Extrapolation.CLAMP,
      ),
      transform: [
        {
          translateY: interpolate(
            progress,
            [0, 1],
            [SWIPE_MENU_REVEAL.startVerticalOffset, 0],
            Extrapolation.CLAMP,
          ),
        },
        {
          scale: interpolate(
            progress,
            [0, 1],
            [SWIPE_MENU_REVEAL.startScale, 1],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });

  // La barre du bas monte comme le reste mais ne s'efface pas : c'est le seul
  // repère fixe pendant que le tiroir se découvre.
  const menuDockAnimatedStyle = useAnimatedStyle(() => {
    const progress = translateX.get() / menuWidth;
    return {
      transform: [
        {
          translateY: interpolate(
            progress,
            [0, 1],
            [SWIPE_MENU_REVEAL.startVerticalOffset, 0],
            Extrapolation.CLAMP,
          ),
        },
        {
          scale: interpolate(
            progress,
            [0, 1],
            [SWIPE_MENU_REVEAL.startScale, 1],
            Extrapolation.CLAMP,
          ),
        },
      ],
    };
  });

  return {
    animateMenu,
    isMenuOpen,
    mainAnimatedStyle,
    menuContentAnimatedStyle,
    menuDockAnimatedStyle,
    swipeGesture,
  };
}
