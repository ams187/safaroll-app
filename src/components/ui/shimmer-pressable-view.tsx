// LE BOUTON QUI BRILLE, PORTÉ DEPUIS ~/Affirm.
//
// Deux choses en une : un appui qui rétrécit le bouton (`pressScale`) et le
// balayage lumineux de `ShimmerEffectStripe`, découpé aux bords par
// `overflow: 'hidden'`.
//
// LE SHIMMER EST CONDITIONNEL, ET C'EST VOULU.
//
// `shimmer` doit suivre l'état ACTIONNABLE du bouton. Une lumière qui balaie un
// bouton désactivé promet quelque chose qui ne se produira pas — elle attire
// l'œil et le doigt vers une cible morte. Éteinte, elle redevient un signal :
// ça brille, donc ça part.
//
// Les styles sont en `StyleSheet` de react-native, pas Unistyles : ils ne lisent
// aucune couleur du thème, tout arrive par les props.
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, type PressableProps, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import {
  ShimmerEffectStripe,
  type ShimmerConfig,
  type ShimmerStripe,
} from '@/components/ui/shimmer-effect-stripe';

export type { ShimmerConfig, ShimmerStripe };

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Voir `shimmer-effect-stripe` : opaque au compilateur React, exprès. */
function setSV(sv: { value: number }, v: number) {
  sv.value = v;
}

export type ShimmerPressableViewProps = Omit<
  PressableProps,
  'onPressIn' | 'onPressOut' | 'style'
> & {
  /** Allume le balayage. @default true */
  shimmer?: boolean;
  shimmerConfig?: ShimmerConfig;
  /** Échelle atteinte à l'appui. @default 0.95 */
  pressScale?: number;
  /** Durée de l'aller-retour d'appui, en ms. @default 200 */
  pressDuration?: number;
  containerStyle?: ViewStyle;
  backgroundColor?: string;
  width?: number;
  height?: number;
  borderRadius?: number;
  onPressIn?: () => void;
  onPressOut?: () => void;
  children: React.ReactNode;
};

export function ShimmerPressableView({
  backgroundColor = '#2C2C2E',
  borderRadius = 24,
  children,
  containerStyle,
  height,
  onPressIn,
  onPressOut,
  pressDuration = 200,
  pressScale = 0.95,
  shimmer = true,
  shimmerConfig,
  width,
  ...pressableProps
}: ShimmerPressableViewProps) {
  'use no memo';
  const containerWidth = useSharedValue(0);
  const scale = useSharedValue(1);

  // Aliases locaux : voir `shimmer-effect-stripe`. Sans eux le compilateur
  // React saute la compilation du fichier entier.
  const scaleRef = scale;
  const containerWidthRef = containerWidth;

  const animatedContainerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    setSV(scaleRef, withTiming(pressScale, { duration: pressDuration }));
    onPressIn?.();
  }, [onPressIn, pressDuration, pressScale, scaleRef]);

  const handlePressOut = useCallback(() => {
    setSV(scaleRef, withTiming(1, { duration: pressDuration }));
    onPressOut?.();
  }, [onPressOut, pressDuration, scaleRef]);

  const handleLayout = useCallback(
    (event: { nativeEvent: { layout: { width: number } } }) => {
      setSV(containerWidthRef, event.nativeEvent.layout.width);
    },
    [containerWidthRef],
  );

  return (
    <AnimatedPressable
      onLayout={handleLayout}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[
        styles.container,
        {
          backgroundColor,
          borderRadius,
          ...(width !== undefined && { width }),
          ...(height !== undefined && { height }),
        },
        containerStyle,
        animatedContainerStyle,
      ]}
      {...pressableProps}
    >
      {shimmer ? (
        <ShimmerEffectStripe config={shimmerConfig} containerWidth={containerWidth} />
      ) : null}
      {children}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  // `overflow: 'hidden'` porte l'effet : c'est lui qui découpe la bande aux
  // bords arrondis. Sans lui elle déborde et barre la page.
  container: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
