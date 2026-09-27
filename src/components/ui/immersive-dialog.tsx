import { useTranslation as useUiTranslation } from 'react-i18next';
import { Blur, Canvas, Circle } from '@shopify/react-native-skia';
import { BlurView } from 'expo-blur';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

/**
 * Full-screen confirmation surface: a soft-edged ripple swells from the tap
 * point (bottom centre by default) and darkens into the app background while
 * the scrim blurs in, then the content rises on a spring. Tapping the scrim
 * dismisses. Stays mounted just long enough for the exit animation.
 */
export function ImmersiveDialog({
  children,
  onDismiss,
  origin,
  visible,
}: {
  children: ReactNode;
  onDismiss: () => void;
  /** Where the ripple starts — pass the tap location when you have one. */
  origin?: { x: number; y: number };
  visible: boolean;
}) {
  const { t: copy } = useUiTranslation();
  const { height, width } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  // Render-time adjustment (not an effect) so opening mounts immediately.
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) return;
    // Keep the tree alive until the exit animation lands.
    const timer = setTimeout(() => setMounted(false), 420);
    return () => clearTimeout(timer);
  }, [visible]);

  const progress = useDerivedValue(
    () =>
      withTiming(visible ? 1 : 0, {
        duration: visible ? 560 : 360,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
      }),
    [visible],
  );
  const rise = useDerivedValue(
    () =>
      visible
        ? withDelay(120, withSpring(0, { damping: 16, stiffness: 190 }))
        : withTiming(90, { duration: 280, easing: Easing.in(Easing.quad) }),
    [visible],
  );

  const cx = origin?.x ?? width / 2;
  const cy = origin?.y ?? height;
  // Reach the farthest screen corner whatever the origin, with a little slack
  // so the blurred rim never shows inside the viewport.
  const coverRadius = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy)) * 1.2;

  const radius = useDerivedValue(() => interpolate(progress.get(), [0, 1], [24, coverRadius]));
  const rippleColor = useDerivedValue(() =>
    // Ink falling to black. The ramp used to start amber; it starts at the
    // page's own ink now, so the dialog darkens out of the app rather than out
    // of a colour the app no longer uses.
    interpolateColor(progress.get(), [0, 0.55, 1], ['#5a5040', '#2b2418', '#100d08']),
  );
  const rippleOpacity = useDerivedValue(() =>
    interpolate(progress.get(), [0, 0.12, 1], [0, 0.85, 0.96]),
  );

  const blurProps = useAnimatedProps(() => ({ intensity: progress.get() * 34 }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.45, 1], [0, 0, 1]),
    transform: [{ translateY: rise.get() }],
  }));

  if (!mounted) return null;

  return (
    <Animated.View pointerEvents={visible ? 'auto' : 'none'} style={styles.root}>
      <AnimatedBlurView
        animatedProps={blurProps}
        intensity={0}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        tint="dark"
      />
      <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Circle cx={cx} cy={cy} color={rippleColor} opacity={rippleOpacity} r={radius}>
          <Blur blur={26} />
        </Circle>
      </Canvas>
      <Pressable accessibilityLabel={copy("reveal_close")} onPress={onDismiss} style={StyleSheet.absoluteFill} />
      <Animated.View pointerEvents="box-none" style={[styles.content, contentStyle]}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create(() => ({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
}));
