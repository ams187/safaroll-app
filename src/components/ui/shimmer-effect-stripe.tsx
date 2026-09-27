// LE BALAYAGE LUMINEUX, PORTÉ DEPUIS ~/Affirm.
//
// Un paquet de bandes verticales, inclinées, plus lumineuses au centre qu'aux
// bords, qui traverse le bouton de gauche à droite puis attend avant de
// recommencer. C'est le reflet d'une carte qu'on incline sous une lampe — le
// même vocabulaire que les cartes holographiques de l'app, appliqué au bouton.
//
// POURQUOI UN RESSORT ET PAS UN `withTiming`
//
// Le passage utilise `withSpring` : la bande part vite et finit en ralentissant,
// comme une vraie lumière qui glisse. Un déplacement linéaire se lit tout de
// suite comme une animation d'interface, pas comme un reflet.
//
// POURQUOI `useAnimatedReaction` ET PAS UN `useEffect`
//
// L'animation ne peut démarrer qu'une fois DEUX largeurs connues : celle du
// bouton et celle du paquet de bandes, toutes deux mesurées au montage. Les
// attendre sur le fil UI évite l'aller-retour vers JS, et le drapeau
// `animationStarted` garantit qu'on ne relance pas la boucle à chaque mesure.
//
// Les styles sont en `StyleSheet` de react-native, pas Unistyles : ils ne lisent
// aucune couleur du thème — tout ce qui varie passe par `config`.
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

export type ShimmerStripe = {
  /** Largeur de la bande, en points. */
  width: number;
  /** Opacité de la bande (0-1). */
  opacity: number;
};

export type ShimmerConfig = {
  /** Attente entre deux passages, en ms. @default 2000 */
  delay?: number;
  /** Durée de base du passage, en ms. @default 1100 */
  duration?: number;
  /** Inclinaison, en degrés. @default 30 */
  angle?: number;
  /** Couleur des bandes. */
  color?: string;
  /** Bandes sur mesure ; sinon elles sont générées. */
  stripes?: ShimmerStripe[];
  /** Nombre de bandes générées si `stripes` est absent. @default 3 */
  stripeCount?: number;
};

const DEFAULT_STRIPES: ShimmerStripe[] = [
  { width: 24, opacity: 0.33 },
  { width: 20, opacity: 1 },
  { width: 24, opacity: 0.33 },
];

const DEFAULT_CONFIG: Required<Omit<ShimmerConfig, 'stripes' | 'stripeCount'>> = {
  angle: 30,
  color: 'rgba(180, 180, 180, 0.2)',
  delay: 2000,
  duration: 1100,
};

/** La bande part et finit HORS du bouton : sans marge, on la voit apparaître. */
const SHIMMER_OVERSCALE = 1.2;

const EMPTY_CONFIG: ShimmerConfig = {};

/**
 * Le compilateur React refuse une affectation `.value =` faite directement dans
 * un `useCallback` : il ne sait pas prouver que la mémoïsation reste valide et
 * saute la compilation du fichier entier. Passer par une fonction de portée
 * MODULE la lui rend opaque — c'est le contournement retenu dans ~/Affirm, d'où
 * ce composant est porté.
 */
function setSV(sv: { value: number }, v: number) {
  sv.value = v;
}

/** Un dégradé d'opacité : lumineux au centre, éteint aux bords. */
function generateDefaultStripes(count: number): ShimmerStripe[] {
  const stripes: ShimmerStripe[] = [];
  const baseWidth = 20;

  for (let index = 0; index < count; index += 1) {
    const position = index / (count - 1 || 1);
    const distanceFromCenter = Math.abs(position - 0.5) * 2;
    const opacity = 1 - distanceFromCenter * 0.7;
    const width = baseWidth + (1 - distanceFromCenter) * 4;

    stripes.push({
      opacity: Math.max(0.2, Math.min(1, opacity)),
      width: Math.max(16, Math.min(28, width)),
    });
  }

  return stripes;
}

export function ShimmerEffectStripe({
  config = EMPTY_CONFIG,
  containerWidth,
}: {
  /** Largeur du bouton, mesurée par le parent. */
  containerWidth: SharedValue<number>;
  config?: ShimmerConfig;
}) {
  'use no memo';
  const shimmerWidth = useSharedValue(0);
  const animationStarted = useSharedValue(false);
  const translateX = useSharedValue(0);
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  const stripesWithKeys = useMemo(() => {
    let rawStripes: ShimmerStripe[];
    if (config.stripes && config.stripes.length > 0) {
      rawStripes = config.stripes;
    } else {
      const count = config.stripeCount || 3;
      rawStripes = count === 3 ? DEFAULT_STRIPES : generateDefaultStripes(count);
    }
    return rawStripes.map((stripe, index) => ({
      ...stripe,
      key: `s${index}-w${stripe.width}-o${stripe.opacity}`,
    }));
  }, [config.stripes, config.stripeCount]);

  const delayMs = mergedConfig.delay;
  useAnimatedReaction(
    () => ({
      containerWidth: containerWidth.value,
      shimmerWidth: shimmerWidth.value,
      started: animationStarted.value,
    }),
    (current, previous) => {
      'worklet';
      if (
        current.started ||
        current.shimmerWidth === 0 ||
        current.containerWidth === 0 ||
        (previous && previous.shimmerWidth !== 0 && previous.containerWidth !== 0)
      ) {
        return;
      }
      animationStarted.value = true;

      // Le premier passage part tout de suite ; les suivants attendent `delay`.
      translateX.value = withRepeat(
        withSequence(
          withTiming(-current.shimmerWidth * SHIMMER_OVERSCALE, { duration: 0 }),
          withSpring(current.containerWidth * SHIMMER_OVERSCALE, {
            damping: 25,
            mass: 1.2,
            stiffness: 60,
          }),
          withDelay(delayMs, withTiming(-current.shimmerWidth * SHIMMER_OVERSCALE, { duration: 0 })),
          withSpring(current.containerWidth * SHIMMER_OVERSCALE, {
            damping: 25,
            mass: 1.2,
            stiffness: 60,
          }),
        ),
        -1,
        false,
      );
    },
  );

  const angle = mergedConfig.angle;
  const animatedStyle = useAnimatedStyle(() => {
    // Invisible tant qu'une des deux largeurs manque : sinon la bande clignote
    // en haut à gauche le temps de la première mesure.
    if (shimmerWidth.value === 0 || containerWidth.value === 0) return { opacity: 0 };

    return {
      opacity: 1,
      transform: [{ translateX: translateX.value }, { rotate: `${angle}deg` }],
    };
  }, [angle]);

  // L'ALIAS N'EST PAS DÉCORATIF. Le compilateur React refuse de mémoïser un
  // `useCallback` qui écrit dans une valeur partagée nommée directement ; passé
  // par une constante locale, il ne le voit plus. Même contournement que
  // `setSV`, sous une autre forme — les deux viennent de ~/Affirm.
  const shimmerWidthRef = shimmerWidth;
  const handleLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) => {
      setSV(shimmerWidthRef, event.nativeEvent.layout.width);
    },
    [shimmerWidthRef],
  );

  return (
    <Animated.View onLayout={handleLayout} style={[styles.shimmer, animatedStyle]}>
      {stripesWithKeys.map((stripe) => (
        <View
          key={stripe.key}
          style={[
            styles.stripe,
            { backgroundColor: mergedConfig.color, opacity: stripe.opacity, width: stripe.width },
          ]}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Débordement vertical : inclinée à 30°, une bande à la hauteur exacte du
  // bouton laisserait deux coins vides.
  shimmer: { bottom: -200, flexDirection: 'row', left: 0, position: 'absolute', top: -200 },
  stripe: { height: '100%' },
});
