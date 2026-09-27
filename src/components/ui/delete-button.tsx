// Ported from alexandrius/react-native-delete-button (`button.js`, `icon.js`).
//
// Press it and the bin's lid tips off and flies, the body swells to four times
// its size while the letters of the label are dragged down and swallowed by it,
// then the whole thing lands back where it started and the word types itself
// in again. Every timing, easing and interpolation below is the reference's.
//
// The icon is the reference's own icomoon face — two glyphs, `Top` (the lid)
// and `Bottom` (the body) — because the animation is entirely about those two
// pieces moving independently, and no stock icon set ships a bin split in two.
//
// Adaptations:
//   - the label is a prop, so it can be `Supprimer` rather than `Delete`;
//   - `onPress` fires when the letters have been swallowed rather than on the
//     touch, so what the caller does next happens on the beat of the animation;
//   - the font is embedded through the app's `expo-font` config plugin rather
//     than loaded at runtime, which is how every other face in this app ships.

import { createIconSet } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

const ICON_SIZE = 24;
const MAX_SCALE = 4;
const MAX_POSITION = 5;
const RESET_POSITION = 6;
const BUTTON_HEIGHT = 45;
/** Keeps the growth anchored where the lid meets the body. */
const ICON_ANCHOR_OFFSET = ICON_SIZE / 2;

const easing = Easing.bezier(0.11, 0, 0.5, 0);
/** The reference's, and load-bearing: half of these interpolations are layout. */
const useNativeDriver = false;

// `icomoon` is the family name the file itself declares. The font is embedded
// by the app's `expo-font` plugin (see app.json) exactly like Satoshi and
// Exposure, so it is already resolved by the time this renders; the asset is
// still passed because Expo's `createIconSet` requires it in its signature.
//
// Exported: the deck's drag-to-remove bin draws the same two-piece bin, and
// the whole point of this face is that no stock icon set ships a lid that can
// open separately from its body.
export const DeleteIconFont = createIconSet(
  { Bottom: 59648, Top: 59649 },
  'icomoon',
  require('../../../assets/fonts/delete-icon.ttf'),
);
/*
 * The glyph is NOT an animated component.
 *
 * The reference wrapped it and animated its `size` on iOS, which drives
 * `setNativeProps` on the underlying Text — and on React Native 0.86 with the
 * new architecture that method is gone, so the first frame of the animation
 * throws `undefined is not a function` inside @expo/vector-icons.
 *
 * The block already carries the answer: its ANDROID branch never animates the
 * font size. It leaves the glyph at a fixed size and scales the VIEW around it,
 * with a translateX to keep the growth anchored where the lid meets the body.
 * That path is used on both platforms now — which is why every tuning constant
 * below is the reference's Android value, not its iOS one. They are not
 * interchangeable: one set was measured against a growing glyph, the other
 * against a growing view.
 */

export function DeleteButton({
  // La terre cuite du thème (`danger`). Une seule couleur pour « détruire »
  // dans toute l'app — ce bouton et la poubelle du deck sont le même geste.
  color = '#c05a3a',
  label,
  onPress,
}: {
  color?: string;
  label: string;
  /** Fires once the letters are gone, not on touch-down. */
  onPress: () => void;
}) {
  const letters = label.split('');
  const [scale] = useState(() => new Animated.Value(1));
  const [position] = useState(() => new Animated.Value(1));
  const [letterAnimations] = useState(() => letters.map(() => new Animated.Value(0)));
  const [letterOpacities] = useState(() => letters.map(() => new Animated.Value(1)));
  const [width, setWidth] = useState<number>();
  const animationFinishedRef = useRef(true);

  const SCALE_TRANSFORMS = [
    {
      translateX: scale.interpolate({
        inputRange: [1, MAX_SCALE],
        outputRange: [0, ICON_ANCHOR_OFFSET * 2],
      }),
    },
    { scale },
    { translateX: 0 },
  ];

  const resetLetters = () => {
    letterOpacities.forEach((opacity, index) => {
      Animated.timing(opacity, {
        toValue: 1,
        delay: index * 50,
        duration: 200,
        easing,
        useNativeDriver,
      }).start();
    });
    animationFinishedRef.current = true;
  };

  const startReset = () => {
    // The caller's beat: the word has just been eaten, and the bin is at full
    // size. Anything that opens now opens out of that.
    onPress();

    letterOpacities.forEach((o) => o.setValue(0));
    letterAnimations.forEach((anim) => anim.setValue(0));

    Animated.timing(position, {
      toValue: MAX_POSITION,
      duration: 400,
      useNativeDriver,
    }).start();

    Animated.timing(scale, {
      toValue: 1,
      duration: 400,
      useNativeDriver,
    }).start(() => {
      setTimeout(() => {
        Animated.timing(position, {
          toValue: RESET_POSITION,
          duration: 400,
          easing: Easing.bezier(0.64, 0, 0.78, 0),
          useNativeDriver,
        }).start(() => {
          position.setValue(1);
          resetLetters();
        });
      }, 200);
    });
  };

  const startLetterAnimations = () => {
    letterAnimations.forEach((anim, index) => {
      Animated.timing(anim, {
        toValue: 1,
        delay: index * 60,
        duration: 300,
        easing,
        useNativeDriver,
      }).start(index === letterAnimations.length - 1 ? startReset : undefined);
    });
  };

  const startAnimation = () => {
    const config = {
      toValue: MAX_SCALE,
      duration: 600,
      easing: Easing.bezier(0.25, 1, 0.5, 1),
      useNativeDriver,
    };
    Animated.timing(position, config).start();
    Animated.timing(scale, config).start(startLetterAnimations);
  };

  const topTransforms = [
    {
      translateY: position.interpolate({
        inputRange: [1, MAX_SCALE, MAX_POSITION, RESET_POSITION],
        outputRange: [0, 17, 0, 0],
      }),
    },
    {
      translateX: position.interpolate({
        inputRange: [1, MAX_SCALE, MAX_POSITION, RESET_POSITION],
        outputRange: [0, 20, 40, 0],
      }),
    },
    {
      rotateZ: position.interpolate({
        inputRange: [1, MAX_SCALE, MAX_POSITION, RESET_POSITION],
        outputRange: ['0deg', '-15deg', '0deg', '0deg'],
      }),
    },
    ...SCALE_TRANSFORMS,
  ];

  const bottomTransforms = [
    {
      translateY: position.interpolate({
        inputRange: [1, MAX_SCALE, MAX_POSITION, RESET_POSITION],
        outputRange: [0, 23, 0, 0],
      }),
    },
    {
      translateX: position.interpolate({
        inputRange: [1, MAX_SCALE, MAX_POSITION, RESET_POSITION],
        outputRange: [0, 14, 40, 0],
      }),
    },
    {
      rotateZ: position.interpolate({
        inputRange: [1, MAX_SCALE, MAX_POSITION, RESET_POSITION],
        outputRange: ['0deg', '1deg', '0deg', '0deg'],
      }),
    },
    ...SCALE_TRANSFORMS,
  ];

  const letterContainerTransforms = [
    {
      rotateZ: scale.interpolate({
        inputRange: [1, MAX_SCALE],
        outputRange: ['0deg', '-15deg'],
      }),
    },
    {
      translateY: scale.interpolate({
        inputRange: [1, MAX_SCALE],
        outputRange: [0, -3],
      }),
    },
  ];

  const getLetterTransforms = (i: number) => [
    {
      translateX: letterAnimations[i].interpolate({
        inputRange: [0, 1],
        outputRange: [0, -8 * i],
      }),
    },
    {
      translateY: letterAnimations[i].interpolate({
        inputRange: [0, 1],
        outputRange: [0, 20],
      }),
    },
    {
      rotateZ: letterAnimations[i].interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '-5deg'],
      }),
    },
  ];

  return (
    <TouchableOpacity
      accessibilityLabel={label}
      accessibilityRole="button"
      onLayout={({ nativeEvent }) => {
        const { layout } = nativeEvent;
        // Pinned once: the body scales to 4x inside this button, and a width
        // that followed its contents would grow with it.
        if (!width && layout.width) setWidth(layout.width);
      }}
      activeOpacity={0.8}
      style={[styles.button, { backgroundColor: color, width }]}
      onPress={() => {
        if (animationFinishedRef.current) {
          animationFinishedRef.current = false;
          startAnimation();
        }
      }}
    >
      <View style={styles.contentContainer}>
        <View>
          <Animated.View style={[styles.top, { transform: topTransforms }]}>
            <DeleteIconFont name="Top" color="white" size={ICON_SIZE} />
          </Animated.View>
          <Animated.View style={[styles.bottom, { transform: bottomTransforms }]}>
            <DeleteIconFont name="Bottom" color="white" size={ICON_SIZE} />
          </Animated.View>
        </View>
      </View>
      <View style={styles.labelContainer}>
        <Animated.View
          style={[styles.letterContainer, { transform: letterContainerTransforms }]}
        >
          {letters.map((letter, i) => (
            <Animated.Text
              key={`${letter}-${i}`}
              style={{
                ...styles.letter,
                opacity: letterOpacities[i],
                transform: getLetterTransforms(i),
              }}
            >
              {letter}
            </Animated.Text>
          ))}
        </Animated.View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    height: BUTTON_HEIGHT,
    paddingHorizontal: 15,
    borderRadius: 11,
    // What makes the trick work: the bin grows past the button and is clipped
    // by it, so the letters are not thrown off-screen, they are eaten.
    overflow: 'hidden',
    justifyContent: 'center',
  },
  contentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 100,
    width: 100,
  },
  labelContainer: {
    position: 'absolute',
    height: BUTTON_HEIGHT,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    left: 25,
  },
  letterContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  letter: {
    color: 'white',
    fontWeight: 'bold',
    marginRight: Platform.select({ ios: 0, android: 1 }),
  },
  top: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
});
