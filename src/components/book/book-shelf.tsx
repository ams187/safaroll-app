import { useTranslation as useUiTranslation } from 'react-i18next';
// L'étagère — les livres de chaque année, jetés sur la table.
//
// PORTÉ DE `Draggable-Stamps`
//
// Le bloc éparpille des vignettes sur un plateau, les laisse voler à l'inertie
// sous le doigt, et fait bondir celle qu'on touche au centre, agrandie,
// derrière un flou. C'est exactement le geste qu'on veut ici : une pile de
// volumes qu'on fouille avant d'en ouvrir un.
//
// TROIS ÉCARTS AVEC LE BLOC
//
//   LES LIVRES SONT DESSINÉS   il posait des PNG. Ici la couverture est une
//                              vraie couverture — dos toilé, plat d'encre,
//                              filets, étiquette d'année, totaux de l'année.
//                              Elle doit rester lisible à 150 points de large.
//   L'ÉPARPILLEMENT EST SEMÉ    `Math.random()` à chaque montage rejetterait
//                              les livres à chaque retour sur l'écran. La
//                              position vient d'un hachage de l'année : la
//                              pile est en désordre, mais c'est TON désordre,
//                              et il ne bouge plus.
//   DEUX TEMPS POUR OUVRIR     un tap amène le livre au centre et l'agrandit,
//                              un second l'ouvre. Ouvrir sur le premier tap
//                              ferait rater la couverture — qui est la moitié
//                              du plaisir — et rendrait tout glissement
//                              risqué.
//
// Le bouton « mélanger » du bloc n'a pas été repris : re-semer une pile qu'on
// vient d'apprendre par cœur ne sert personne.

import { BLUR_TINT } from '@/lib/theme-tint';
import type { BookYear } from '@/lib/animals/book';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDecay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const COVER = { height: 232, width: 158 };
const SPRING = { damping: 50, stiffness: 190 };
const TIMING = { duration: 420 };
/** Combien la pile s'étale, en points. */
const SPREAD = { rotation: 16, x: 120, y: 220 };

/** Le désordre, semé par l'année : une pile stable d'une visite à l'autre. */
function scatter(year: number, count: number, position: number) {
  const seed = (n: number) => {
    const x = Math.sin(year * 97.13 + n * 41.7) * 43758.5453;
    return x - Math.floor(x);
  };
  // Les livres s'échelonnent aussi verticalement, du plus récent au plus
  // ancien : la pile a un sens de lecture, elle n'est pas qu'un tas.
  const lane = count > 1 ? (position / (count - 1) - 0.5) * 2 : 0;
  return {
    rotation: (seed(3) - 0.5) * SPREAD.rotation,
    x: (seed(1) - 0.5) * SPREAD.x,
    y: lane * SPREAD.y + (seed(2) - 0.5) * 60,
  };
}

function Volume({
  entry,
  index,
  onOpen,
  onPick,
  order,
  picked,
  seat,
  someonePicked,
}: {
  entry: BookYear;
  index: number;
  onOpen: (year: number) => void;
  onPick: (index: number) => void;
  order: SharedValue<number[]>;
  picked: SharedValue<number>;
  seat: { rotation: number; x: number; y: number };
  someonePicked: SharedValue<boolean>;
}) {
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const minX = -(screenWidth / 2) + COVER.width / 2;
  const maxX = screenWidth / 2 - COVER.width / 2;
  const minY = -(screenHeight / 2) + COVER.height / 2;
  const maxY = screenHeight / 2 - COVER.height / 2;

  const x = useSharedValue(seat.x);
  const y = useSharedValue(seat.y);
  const restX = useSharedValue(seat.x);
  const restY = useSharedValue(seat.y);
  const rotation = useSharedValue(seat.rotation);
  const scale = useSharedValue(1);

  const raise = (position: number) => {
    'worklet';
    order.modify((previous) => {
      'worklet';
      const next = previous.filter((item) => item !== position);
      next.push(position);
      return next as typeof previous;
    });
  };

  const pan = Gesture.Pan()
    .onStart(() => {
      if (picked.get() === index) return;
      raise(index);
      scale.set(withTiming(1.08, { duration: 110 }));
    })
    .onChange((event) => {
      if (picked.get() === index) return;
      x.set(Math.min(Math.max(x.get() + event.changeX, minX), maxX));
      y.set(Math.min(Math.max(y.get() + event.changeY, minY), maxY));
    })
    .onEnd((event) => {
      if (picked.get() === index) return;
      // L'inertie : un livre poussé glisse et s'arrête contre le bord.
      x.set(withDecay({ clamp: [minX, maxX], velocity: event.velocityX }, () => {
        restX.set(x.get());
      }));
      y.set(withDecay({ clamp: [minY, maxY], velocity: event.velocityY }, () => {
        restY.set(y.get());
      }));
      scale.set(withTiming(1, { duration: 260 }));
    });

  // Quand le livre choisi est reposé, tous retrouvent leur place.
  useAnimatedReaction(
    () => someonePicked.get(),
    (now, before) => {
      if (before && !now) {
        x.set(withTiming(restX.get(), TIMING));
        y.set(withTiming(restY.get(), TIMING));
        rotation.set(withTiming(seat.rotation, TIMING));
        scale.set(withTiming(1, TIMING));
      }
    },
  );

  const style = useAnimatedStyle(() => {
    const chosen = picked.get() === index;
    const rank = order.get().indexOf(index);
    return {
      shadowOpacity: chosen ? withTiming(0.34) : withTiming(0.18),
      transform: [
        { translateX: x.get() },
        { translateY: y.get() },
        { scale: scale.get() },
        { rotate: `${rotation.get()}deg` },
      ],
      zIndex: chosen ? 100 : rank >= 0 ? rank + 1 : 1,
    };
  });

  const tap = () => {
    if (picked.get() === index) {
      // Deuxième appui : le livre s'ouvre.
      runOnJS(onOpen)(entry.year);
      return;
    }
    x.set(withSpring(0, SPRING));
    y.set(withSpring(0, SPRING));
    rotation.set(withSpring(0, SPRING));
    scale.set(withSpring(1.42, SPRING));
    raise(index);
    runOnJS(onPick)(index);
  };

  return (
    <GestureDetector gesture={pan}>
      <AnimatedPressable
        accessibilityLabel={`Livre ${entry.year}`}
        accessibilityRole="button"
        onPress={tap}
        style={[styles.volume, style]}
      >
        <Cover entry={entry} />
      </AnimatedPressable>
    </GestureDetector>
  );
}

/** La couverture : un objet, pas une vignette. */
function Cover({ entry }: { entry: BookYear }) {
  const { t: copy } = useUiTranslation();
  const { theme } = useUnistyles();
  return (
    <View style={styles.cover}>
      {/* Le dos toilé, avec ses nervures de reliure. */}
      <View style={styles.spine}>
        <View style={styles.spineRib} />
        <View style={styles.spineRib} />
      </View>
      <View style={styles.plate}>
        <View style={styles.frame}>
          <Text style={styles.brand}>SAFAROLL</Text>
          <Text style={styles.year}>{entry.year}</Text>
          <View style={styles.rule} />
          <Text style={styles.subtitle}>{copy("ui_copy_077")}{'\n'}{copy("ui_copy_078")}</Text>
        </View>
        <View style={styles.label}>
          <SymbolView name="pawprint.fill" size={11} tintColor={theme.colors.primary} />
          <Text style={styles.labelText}>
            {entry.encounterCount} · {entry.speciesDiscovered} {copy("ui_copy_079")}</Text>
        </View>
      </View>
      {/* La tranche : l'épaisseur du volume, côté ouverture. */}
      <View style={styles.edge} />
    </View>
  );
}

export function BookShelf({
  book,
  onOpen,
  onPick: onPickYear,
  preparing,
}: {
  book: BookYear[];
  onOpen: (year: number) => void;
  /** Le tome qu'on vient de prendre en main — l'appelant précharge le sien. */
  onPick?: (year: number) => void;
  /** Avancement du préchargement, 0..1, ou null quand il n'y a rien à faire. */
  preparing?: number | null;
}) {
  const { t: copy } = useUiTranslation();
  const picked = useSharedValue(-1);
  const order = useSharedValue<number[]>(book.map((_, index) => index));
  const someonePicked = useDerivedValue(() => picked.get() >= 0);

  const pick = (index: number) => {
    picked.set(index);
    // LE PREMIER APPUI EST LA FENÊTRE DE CHARGEMENT.
    //
    // Entre « je prends le livre » et « je l'ouvre », il y a le temps de
    // regarder la couverture. C'est là qu'on va chercher les images du tome —
    // gratuitement, sans rien bloquer. Au second appui, tout est en cache.
    const year = book[index]?.year;
    if (year !== undefined) onPickYear?.(year);
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync().catch(() => undefined);
  };
  const drop = () => {
    picked.set(-1);
  };

  const veil = useAnimatedProps(() => ({
    intensity: interpolate(someonePicked.get() ? 1 : 0, [0, 1], [0, 26], Extrapolation.CLAMP),
  }));
  const veilStyle = useAnimatedStyle(() => ({
    opacity: withTiming(someonePicked.get() ? 1 : 0, { duration: 240 }),
    pointerEvents: someonePicked.get() ? 'auto' : 'none',
  }));

  return (
    <View style={styles.table}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.veil, veilStyle]}>
        <AnimatedBlurView animatedProps={veil} style={StyleSheet.absoluteFill} tint={BLUR_TINT}>
          <Pressable onPress={drop} style={styles.veilTap} />
        </AnimatedBlurView>
      </Animated.View>

      {book.map((entry, index) => (
        <Volume
          entry={entry}
          index={index}
          key={entry.year}
          onOpen={onOpen}
          onPick={pick}
          order={order}
          picked={picked}
          seat={scatter(entry.year, book.length, index)}
          someonePicked={someonePicked}
        />
      ))}

      <View pointerEvents="none" style={styles.hint}>
        {preparing !== null && preparing !== undefined && preparing < 1 ? (
          <View style={styles.progress}>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(preparing * 100)}%` }]} />
            </View>
            <Text style={styles.hintText}>{copy("ui_copy_080")}</Text>
          </View>
        ) : (
          <Text style={styles.hintText}>
            {copy("ui_copy_081")}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  table: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  veil: { zIndex: 99 },
  veilTap: { flex: 1 },
  volume: {
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { height: 10, width: -3 },
    shadowRadius: 16,
  },
  cover: {
    borderCurve: 'continuous',
    borderRadius: 8,
    flexDirection: 'row',
    height: COVER.height,
    overflow: 'hidden',
    width: COVER.width,
  },
  spine: {
    backgroundColor: theme.colors.primary,
    gap: 4,
    justifyContent: 'center',
    paddingHorizontal: 3,
    width: 15,
  },
  spineRib: {
    backgroundColor: theme.colors.onPrimary,
    height: 1,
    opacity: 0.28,
  },
  plate: {
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  // Le filet imprimé du plat : ce qui fait « couverture » et pas « rectangle ».
  frame: {
    alignItems: 'center',
    borderColor: theme.colors.onPrimary,
    borderRadius: 4,
    borderWidth: 1,
    gap: 5,
    opacity: 0.92,
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  brand: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.bold,
    fontSize: 8,
    letterSpacing: 2,
    opacity: 0.7,
  },
  year: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.display,
    fontSize: 34,
    letterSpacing: -0.5,
  },
  rule: {
    backgroundColor: theme.colors.onPrimary,
    height: 1,
    opacity: 0.4,
    width: 28,
  },
  subtitle: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.display,
    fontSize: 12,
    lineHeight: 15,
    opacity: 0.85,
    textAlign: 'center',
  },
  label: {
    alignItems: 'center',
    backgroundColor: theme.colors.onPrimary,
    borderRadius: 5,
    bottom: 12,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    position: 'absolute',
  },
  labelText: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.bold,
    fontSize: 9,
  },
  edge: {
    backgroundColor: theme.colors.surfaceMuted,
    bottom: 4,
    position: 'absolute',
    right: 0,
    top: 4,
    width: 3,
  },
  hint: {
    alignItems: 'center',
    bottom: 26,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  hintText: {
    color: theme.colors.faint,
    fontFamily: theme.fonts.medium,
    fontSize: 12,
  },
  progress: {
    alignItems: 'center',
    gap: 8,
  },
  progressTrack: {
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    height: 3,
    overflow: 'hidden',
    width: 132,
  },
  progressFill: {
    backgroundColor: theme.colors.primary,
    height: '100%',
  },
}));
