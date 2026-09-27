// The press from react-native-3d-animated-buttons (`src/AnimatedButton.tsx`),
// MIT.
//
// A button with real thickness: a shadow layer sits `DEPTH` points below the
// face, and pressing springs the face down onto it. Let go and it comes back
// up. That is the whole trick — the "Duolingo key" — and the two things that
// make it work rather than look like a scale animation are that the shadow
// never moves, and that the spring is stiff and heavy enough to arrive with a
// small thud instead of easing in.
//
// Every value below is the reference's: the 6-point drop, the
// {stiffness 300, damping 20, mass 0.4} spring, the haptic on press-IN rather
// than on press, and `useNativeDriver: true`.
//
// What is not ported is everything the reference's button is *for* — a title,
// icons through `react-native-svg`, loading states, RTL icon swapping,
// full-width layout. This is the mechanism on its own, so it can wrap a deck
// tab, and it also means the block's `react-native-svg` peer is not needed.

import * as Haptics from 'expo-haptics';
import { useCallback, useState, type ReactNode } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/** How far the face travels, and how far the shadow sits below it. */
export const PRESS_DEPTH = 6;

const SPRING = { damping: 20, mass: 0.4, stiffness: 300, useNativeDriver: true } as const;

export function Press3D({
  accessibilityLabel,
  borderRadius,
  children,
  disabled = false,
  faceStyle,
  onPress,
  selected,
  shadowColor,
  style,
  testID,
}: {
  accessibilityLabel?: string;
  borderRadius: number;
  children: ReactNode;
  disabled?: boolean;
  /** The lit face. Everything visual — fill, border, bevel — belongs here. */
  faceStyle?: StyleProp<ViewStyle>;
  onPress: () => void;
  /** Reported to assistive tech; does not change the press itself. */
  selected?: boolean;
  /** The thickness under the face. Darker than it, or there is no depth. */
  shadowColor: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  // `useState` rather than the reference's `useRef(...).current`: reading a
  // ref during render is an error under this project's lint, and the ref form
  // also constructs a throw-away Animated.Value on every render.
  const [pressY] = useState(() => new Animated.Value(0));

  const press = useCallback(
    (down: boolean) => {
      if (disabled) return;
      // On press-IN, with the movement: the feedback is the key bottoming out,
      // and firing it on release would land after the thing it describes.
      if (down) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      Animated.spring(pressY, { ...SPRING, toValue: down ? PRESS_DEPTH : 0 }).start();
    },
    [disabled, pressY],
  );

  return (
    <View style={[styles.root, style]}>
      {/* Never moves. The face travels down onto it, which is what reads as
          the button having a side rather than being scaled. */}
      <View
        pointerEvents="none"
        style={[
          styles.shadow,
          { backgroundColor: shadowColor, borderRadius, top: PRESS_DEPTH },
        ]}
      />
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled, selected }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={() => press(true)}
        onPressOut={() => press(false)}
        style={styles.pressable}
        testID={testID}
      >
        <Animated.View style={{ transform: [{ translateY: pressY }] }}>
          <View
            style={[
              styles.face,
              isIOS ? styles.borderCurve : null,
              { borderRadius },
              faceStyle,
            ]}
          >
            {children}
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const isIOS = Platform.OS === 'ios';

const styles = StyleSheet.create({
  root: {
    position: 'relative',
  },
  shadow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '100%',
    ...(isIOS ? { borderCurve: 'continuous' as const } : null),
  },
  pressable: {
    zIndex: 3,
  },
  face: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  borderCurve: {
    borderCurve: 'continuous',
  },
});
