// La barre des espaces du hub — Carte / Profil.
//
// MÊME RENDU QUE LA LENTILLE WEBGPU, AUTRE MOTEUR
//
// La lentille (`liquid-tabs/`) rastérisait ses libellés dans une texture Skia
// et les tordait sous une pilule de verre, à travers une passe de réfraction
// WebGPU. Beau sur le papier, instable à l'usage — et elle tenait un contexte
// GPU vivant en haut d'un écran dont la section Carte porte déjà une surface
// Mapbox. Ce fichier rend LA MÊME IMAGE en vues natives, et emprunte sa
// chorégraphie au bloc `demos-main-2/src/animations/fluid-tab-interaction`.
//
// CE QUI VIENT DE LA LENTILLE : TOUT CE QUI SE VOIT
//
// Relevé dans son fichier de constantes et dans `layout-tabs.ts` :
//
//   AUCUN FOND         la barre flotte sur la page. Pas de plaque, pas de
//                      bordure — c'est ce qui la distingue d'un contrôle
//                      segmenté, et c'est l'erreur que j'avais faite d'abord.
//   LENS_HEIGHT 35     la hauteur de la pilule, donc celle de la barre.
//   GAP 18             l'écart entre deux CONTENUS, pas entre deux cases.
//   LENS_PAD_X 14      ce dont la pilule déborde du contenu, de chaque côté.
//                      Elle mord donc dans l'écart : `lensHalfWidth =
//                      width / 2 + padX` dans l'original.
//   FONT_SIZE 14       le corps du libellé.
//   fontSize + 3       la taille du glyphe Feather.
//   ICON_GAP 7         l'écart entre le glyphe et son mot.
//   BAR_HEIGHT 84      l'encombrement vertical total — voir `BAR_PADDING`.
//   align "center"     le groupe est centré, chaque item serré sur son texte.
//
// CE QUI VIENT DU BLOC : CE QUI BOUGE
//
// La pilule glisse pendant que TROIS flous s'allument et s'éteignent en cloche
// (`[0, 0.5, 1] → [0, 15, 0]`) : un qui la suit, un sur la case qu'on quitte,
// un sur celle qu'on rejoint. Le mouvement se lit comme un liquide qui se
// redépose. La durée est longue exprès, 1 s : un flou rapide ne se voit pas,
// il salit.
//
// POURQUOI LES LARGEURS SONT MESURÉES
//
// La lentille les calculait dans Skia (`paragraphWidth`). Ici les mots sont de
// vraies vues, donc c'est `onLayout` qui les donne — et ça suit la langue et la
// taille de texte du système sans qu'on ait rien à recalculer.
//
// CE QU'ON A CHANGÉ AU BLOC D'ANIMATION
//
//   PAS DE `pressto`         il tire une dépendance entière pour un
//                            `PressableScale` ; le même ressort tient en six
//                            lignes, comme dans `glass-pill.tsx`.
//   PAS DE HOOKS EN BOUCLE   l'original appelle `useAnimatedStyle` dans un
//                            `.map()` avec un `eslint-disable` par-dessus.

import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
const AnimatedIcon = Animated.createAnimatedComponent(Feather);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const TIMING = { duration: 1000, easing: Easing.bezier(0.4, 0, 0.2, 1) };
const PRESS = { damping: 15, stiffness: 220 };

const PILL_HEIGHT = 35;
const PAD_X = 14;
const GAP = 18;
const FONT_SIZE = 14;
const ICON_SIZE = FONT_SIZE + 3;
const ICON_GAP = 7;

/**
 * Ce que l'appelant ajoute au-dessus ET en dessous pour retrouver les 84 points
 * qu'occupait la lentille, la pilule restant centrée dedans. Sans ça, tout le
 * contenu de l'écran remonterait d'un cran.
 */
export const BAR_PADDING = (84 - PILL_HEIGHT) / 2;

export type FluidTab = {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
};

type Teintes = { active: string; inactive: string; pill: string };

/** Le contenu d'une case, une fois posé. La pilule s'en déduit. */
type Boite = { width: number; x: number };

function Segment({
  blur,
  dark,
  index,
  onMeasure,
  onPress,
  selected,
  tab,
  teintes,
  touched,
}: {
  blur: SharedValue<number>;
  dark: boolean;
  index: number;
  onMeasure: (index: number, boite: Boite) => void;
  onPress: () => void;
  selected: boolean;
  tab: FluidTab;
  teintes: Teintes;
  /** Les deux cases concernées par la transition en cours. */
  touched: SharedValue<number[]>;
}) {
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  // Le flou local ne s'allume que sur la case qu'on quitte et celle qu'on
  // rejoint. L'allumer partout brouillerait la barre entière, ce qui ne dit
  // plus d'où l'on vient ni où l'on va.
  const blurProps = useAnimatedProps(() => ({
    intensity: interpolate(
      touched.get().includes(index) ? blur.get() : 0,
      [0, 0.5, 1],
      [0, 10, 0],
    ),
  }));

  const inkStyle = useAnimatedStyle(() => ({
    color: withTiming(selected ? teintes.active : teintes.inactive, TIMING),
  }));

  return (
    <AnimatedPressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      // La case est SERRÉE sur son contenu — c'est la pilule qui déborde, pas
      // elle. Le doigt, lui, récupère ce débord.
      hitSlop={{ bottom: 8, left: PAD_X, right: PAD_X, top: 8 }}
      onLayout={({ nativeEvent }: LayoutChangeEvent) =>
        onMeasure(index, { width: nativeEvent.layout.width, x: nativeEvent.layout.x })
      }
      onPress={onPress}
      onPressIn={() => scale.set(withSpring(0.96, PRESS))}
      onPressOut={() => scale.set(withSpring(1, PRESS))}
      style={[styles.cell, pressStyle]}
    >
      <AnimatedIcon name={tab.icon} size={ICON_SIZE} style={inkStyle} />
      <Animated.Text style={[styles.label, inkStyle]}>{tab.label}</Animated.Text>
      <AnimatedBlurView
        animatedProps={blurProps}
        style={styles.cellBlur}
        tint={dark ? 'dark' : 'light'}
      />
    </AnimatedPressable>
  );
}

export function FluidLensTabs({
  dark = false,
  index,
  onChange,
  tabs,
}: {
  /** La carte plein écran : encre crème, flou sombre. */
  dark?: boolean;
  index: number;
  onChange: (index: number) => void;
  tabs: readonly FluidTab[];
}) {
  const { theme } = useUnistyles();
  const [boites, setBoites] = useState<Boite[]>([]);
  const blur = useSharedValue(0);
  const touched = useSharedValue<number[]>([]);

  const couleurs: Teintes = {
    active: dark ? '#fff8e5' : theme.colors.foreground,
    inactive: dark ? 'rgba(255,248,229,0.6)' : theme.colors.muted,
    // L'encre à 8 %, exactement ce que cet écran passait à la lentille
    // (`pill={{ color: foreground, opacity: 0.08 }}`). Un aplat de surface
    // ferait un bouton ; ici c'est une ombre posée sous le mot.
    pill: dark ? 'rgba(255,248,229,0.16)' : 'rgba(43,36,24,0.08)',
  };

  const active = boites[index];

  const mesurer = (position: number, boite: Boite) => {
    setBoites((current) => {
      const held = current[position];
      if (held && held.x === boite.x && held.width === boite.width) return current;
      const next = [...current];
      next[position] = boite;
      return next;
    });
  };

  // La pilule déborde du contenu de `PAD_X` de chaque côté — la formule de
  // `layout-tabs.ts`, à l'identique.
  const pillStyle = useAnimatedStyle(() => ({
    left: withTiming(active ? active.x - PAD_X : 0, TIMING),
    opacity: active ? 1 : 0,
    width: withTiming(active ? active.width + PAD_X * 2 : 0, TIMING),
  }));
  const blurProps = useAnimatedProps(() => ({
    intensity: interpolate(blur.get(), [0, 0.5, 1], [0, 15, 0]),
  }));

  const choisir = (next: number) => {
    if (next === index) return;
    if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync().catch(() => undefined);
    onChange(next);
    touched.set([index, next]);
    // Annulé avant relance : deux appuis rapides empileraient deux cloches, et
    // la seconde repartirait d'une intensité déjà montée.
    cancelAnimation(blur);
    blur.set(
      withTiming(1, TIMING, (fini) => {
        if (!fini) return;
        blur.set(0);
        touched.set([]);
      }),
    );
  };

  return (
    <View style={styles.row}>
      {/* Déclarée avant les cases : la pilule est un fond, pas un calque. */}
      <Animated.View style={[styles.pill, { backgroundColor: couleurs.pill }, pillStyle]}>
        <AnimatedBlurView
          animatedProps={blurProps}
          style={styles.fill}
          tint={dark ? 'dark' : 'light'}
        />
      </Animated.View>

      {tabs.map((tab, position) => (
        <Segment
          blur={blur}
          dark={dark}
          index={position}
          key={tab.label}
          onMeasure={mesurer}
          onPress={() => choisir(position)}
          selected={position === index}
          tab={tab}
          teintes={couleurs}
          touched={touched}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: GAP,
    height: PILL_HEIGHT,
  },
  cell: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: ICON_GAP,
    height: PILL_HEIGHT,
  },
  cellBlur: {
    bottom: 0,
    left: -PAD_X,
    position: 'absolute',
    right: -PAD_X,
    top: 0,
  },
  label: {
    // La lentille typographiait en `SemiBold`. Satoshi n'embarque que Regular,
    // Medium et Bold — Skia résolvait donc vers le Bold, et c'est ce qu'on voit
    // sur l'ancienne barre. Le medium la rendrait maigre.
    fontFamily: theme.fonts.bold,
    fontSize: FONT_SIZE,
  },
  pill: {
    borderCurve: 'continuous',
    borderRadius: PILL_HEIGHT / 2,
    height: PILL_HEIGHT,
    overflow: 'hidden',
    position: 'absolute',
  },
  fill: { flex: 1 },
}));
