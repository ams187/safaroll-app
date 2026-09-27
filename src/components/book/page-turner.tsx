// Le tourneur de pages — plein écran, une page à la fois.
//
// LA MÉCANIQUE, PORTÉE DE `react-native-page-flipper`
//
// La référence (chris24elias/react-native-page-flipper) fait exactement ce
// geste, mais elle tire deux modules natifs de dégradé — rebuild obligatoire —
// et date de Reanimated 2. Sa mécanique est reprise ici en Reanimated 4 pur :
//
//   LA FEUILLE PIVOTE SUR SA TRANCHE   le pivot est le bord GAUCHE de l'écran
//                                      (translateX aller-retour autour du
//                                      rotateY). À -180°, la feuille est
//                                      repliée hors champ, à gauche — comme
//                                      une page déjà lue.
//   CHAQUE FEUILLE A UN VERSO          deux faces en `backfaceVisibility:
//                                      hidden`, le verso pré-tourné de 180° :
//                                      passé 90°, on voit le DOS de la page —
//                                      du papier, pas le contenu suivant.
//   UNE SEULE VALEUR MÈNE TOUT         `turn` est la position continue dans le
//                                      livre. La rotation de la feuille i est
//                                      `clamp(turn - i, 0, 1) × -180°`. Le
//                                      doigt écrit turn, le ressort le pose
//                                      sur un entier, et chaque feuille se
//                                      place toute seule.
//
// L'OMBRE FAIT LA MOITIÉ DE L'ILLUSION
//
// Deux ombres, calculées de la même rotation : sur la feuille qui se soulève
// (maximale à 90°, en `sin`) et sur la page qu'elle découvre (qui s'éclaire à
// mesure). Sans elles, le pli se lit comme une rotation d'interface ; avec,
// comme du papier qui prend la lumière.
//
// SEULES TROIS FEUILLES SONT MONTÉES
//
// Les pages portent six cartes chacune — des canevas Skia qui décodent une
// planche et allument un foil. Tout monter serait payer le livre entier à
// l'ouverture. La fenêtre est [index-1, index+1] : celle qu'on lit, celle
// qu'on découvre, celle qu'on vient de tourner. Une quatrième ne se voit
// jamais et coûtait six cartes de plus.

import * as Haptics from 'expo-haptics';
import { useEffect, useState, type ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

/** Le ressort d'une page qui retombe : lourd, sans rebond flottant. */
const SETTLE = { damping: 22, mass: 0.9, stiffness: 160 };
/** Au-delà, le geste emporte la page même à mi-course. */
const FLING = 500;

function Sheet({
  children,
  index,
  turn,
  width,
}: {
  children: ReactNode;
  index: number;
  turn: SharedValue<number>;
  width: number;
}) {
  const flip = useDerivedValue(() =>
    interpolate(turn.get() - index, [0, 1], [0, 1], Extrapolation.CLAMP),
  );

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1600 },
      { translateX: -width / 2 },
      { rotateY: `${flip.get() * -180}deg` },
      { translateX: width / 2 },
    ],
    zIndex: 10_000 - index,
  }));

  const liftShade = useAnimatedStyle(() => ({
    opacity: Math.sin(flip.get() * Math.PI) * 0.32,
  }));
  const castShade = useAnimatedStyle(() => ({
    opacity: interpolate(flip.get(), [0, 0.15, 1], [0.34, 0.3, 0], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View pointerEvents="box-none" style={[styles.sheet, sheetStyle]}>
      <View style={styles.face}>
        {children}
        <Animated.View pointerEvents="none" style={[styles.shade, liftShade]} />
      </View>
      <View style={[styles.face, styles.back]}>
        <View style={styles.paperEdge} />
        <Animated.View pointerEvents="none" style={[styles.shade, liftShade]} />
      </View>
      <Animated.View pointerEvents="none" style={[styles.castShade, castShade]} />
    </Animated.View>
  );
}

export function PageTurner({
  goTo,
  onClosePull,
  onPage,
  pages,
}: {
  /**
   * Une page demandée de l'extérieur — le sommaire. Le livre y va en tournant
   * ses feuilles, il ne s'y téléporte pas : sauter au mois de mars doit rester
   * un mouvement de livre.
   */
  goTo?: number;
  /** Tirer la couverture vers la droite ferme le livre. */
  onClosePull?: () => void;
  /** La page posée. L'appelant s'en sert pour ne charger que celle-là. */
  onPage?: (index: number) => void;
  pages: ReactNode[];
}) {
  const { width } = useWindowDimensions();
  const last = pages.length - 1;
  const turn = useSharedValue(0);
  const grabbed = useSharedValue(0);
  const [index, setIndex] = useState(0);

  const land = (page: number) => {
    setIndex(page);
    onPage?.(page);
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync().catch(() => undefined);
  };

  useEffect(() => {
    if (goTo === undefined) return;
    const target = Math.min(Math.max(goTo, 0), last);
    if (target === index) return;
    cancelAnimation(turn);
    turn.set(
      withSpring(target, SETTLE, (finished) => {
        if (finished) runOnJS(land)(target);
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une demande, un saut
  }, [goTo]);

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onBegin(() => {
      cancelAnimation(turn);
      grabbed.set(turn.get());
    })
    .onUpdate(({ translationX }) => {
      const raw = grabbed.get() + -translationX / width;
      // Une résistance aux deux couvertures : le livre ne défile pas dans le
      // vide, il RETIENT — c'est ce que fait un vrai cahier relié.
      const bounded = Math.min(Math.max(raw, -0.18), last + 0.18);
      turn.set(bounded < 0 ? bounded / 3 : bounded > last ? last + (bounded - last) / 3 : bounded);
    })
    .onEnd(({ translationX, velocityX }) => {
      const current = turn.get();
      if (current <= 0 && translationX > width * 0.22 && onClosePull) {
        runOnJS(onClosePull)();
        turn.set(withSpring(0, SETTLE));
        return;
      }
      const thrown = Math.abs(velocityX) > FLING ? (velocityX < 0 ? 1 : -1) : 0;
      const target = Math.min(Math.max(Math.round(current + thrown * 0.5), 0), last);
      turn.set(
        withSpring(target, SETTLE, (finished) => {
          if (finished) runOnJS(land)(target);
        }),
      );
    });

  return (
    <GestureDetector gesture={pan}>
      <View style={styles.book}>
        {pages.map((page, i) =>
          i >= index - 1 && i <= index + 1 ? (
            <Sheet index={i} key={i} turn={turn} width={width}>
              {page}
            </Sheet>
          ) : null,
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create((theme) => ({
  // L'INTÉRIEUR DU CLASSEUR EST SOMBRE, PARTOUT.
  //
  // Le conteneur ne peignait rien et le verso des feuilles portait un crème
  // pâle : passé 90°, ce verso balayait tout l'écran, et entre deux feuilles
  // le fond crème de l'app transparaissait. Lu comme un écran blanc à chaque
  // page tournée. Un classeur n'a aucune surface claire à l'intérieur.
  book: {
    backgroundColor: theme.colors.primary,
    flex: 1,
  },
  sheet: {
    ...StyleSheet.absoluteFillObject,
  },
  // Le recto ne peint RIEN : c'est la page qu'il porte qui donne sa couleur.
  // Avec un fond crème posé ici, chaque feuille tournée montrait un éclair
  // clair le temps que la page sombre du classeur se peigne par-dessus.
  face: {
    ...StyleSheet.absoluteFillObject,
    backfaceVisibility: 'hidden',
  },
  // Le dos d'une page : la même matière que le recto, pré-tournée pour
  // n'exister qu'au-delà de 90°, avec la tranche marquée côté reliure.
  back: {
    backgroundColor: theme.colors.primary,
    transform: [{ rotateY: '180deg' }],
  },
  paperEdge: {
    backgroundColor: 'rgba(0,0,0,0.22)',
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: 14,
  },
  shade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  castShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: -1,
  },
}));
