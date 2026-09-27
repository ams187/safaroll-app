import { BlurView } from 'expo-blur';
import { createContext, use, useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// Implemented from the official brief at https://rnmotion.dev/animations/radial-menu.md
// Timings, blur intensity and scrim opacity are the guide's, not the demo
// repo's — the two differ, and the guide is the spec.

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

interface OverlayContextValue {
  showOverlay: (content: ReactNode) => void;
  hideOverlay: () => void;
}

const OverlayContext = createContext<OverlayContextValue | null>(null);

export function useOverlay() {
  const ctx = use(OverlayContext);
  if (!ctx) throw new Error('useOverlay must be used within an OverlayProvider');
  return ctx;
}

/**
 * Owns the blur, the dark scrim and the lifted content layer the radial menu
 * fans out from. Keep it mounted at the app root around the screen that uses
 * the menu.
 */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [isVisible, setIsVisible] = useState(false);
  const [overlayContent, setOverlayContent] = useState<ReactNode>(null);

  const blurIntensity = useSharedValue(0);
  const overlayOpacity = useSharedValue(0);
  const contentScale = useSharedValue(1);
  const contentRotation = useSharedValue(0);

  const showOverlay = useCallback(
    (content: ReactNode) => {
      setOverlayContent(content);
      setIsVisible(true);
      overlayOpacity.set(withTiming(1, { duration: 300 }));
      blurIntensity.set(withTiming(100, { duration: 300 }));
      contentScale.set(withTiming(1.1, { duration: 300 }));
      contentRotation.set(withTiming(Math.random() * 6 - 3, { duration: 300 }));
    },
    [blurIntensity, contentRotation, contentScale, overlayOpacity],
  );

  const hideOverlay = useCallback(() => {
    overlayOpacity.set(withTiming(0, { duration: 200 }));
    blurIntensity.set(withTiming(0, { duration: 200 }));
    contentScale.set(withTiming(1, { duration: 200 }));
    contentRotation.set(withTiming(0, { duration: 200 }));

    setTimeout(() => {
      setIsVisible(false);
      setOverlayContent(null);
    }, 200);
  }, [blurIntensity, contentRotation, contentScale, overlayOpacity]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.get(),
    zIndex: 9998,
  }));

  // The content layer fades with the same value as the blur — without it the
  // lifted card and the fan popped in and out at full opacity.
  const contentStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.get(),
    transform: [{ scale: contentScale.get() }, { rotate: `${contentRotation.get()}deg` }],
    zIndex: 9999,
  }));

  const blurAnimatedProps = useAnimatedProps(() => ({ intensity: blurIntensity.get() }));

  return (
    <OverlayContext value={{ hideOverlay, showOverlay }}>
      {children}
      {isVisible && (
        <>
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, overlayStyle]}
          >
            <AnimatedBlurView
              animatedProps={blurAnimatedProps}
              style={StyleSheet.absoluteFill}
              tint="dark"
            />
            <View style={[StyleSheet.absoluteFill, styles.scrim]} />
          </Animated.View>

          <Animated.View
            pointerEvents="box-none"
            style={[StyleSheet.absoluteFill, contentStyle]}
          >
            {overlayContent}
          </Animated.View>
        </>
      )}
    </OverlayContext>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(0,0,0,0.7)' },
});
