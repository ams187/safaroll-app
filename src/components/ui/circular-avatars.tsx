import { uiLanguage } from '@/i18n/current';
import { speciesName } from '@/lib/animals/species-name';
import { Image } from 'expo-image';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  FadeOutUp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/** Placeholder silhouettes for the orbit when the player has no captures yet. */
export const EMPTY_ORBIT: { _id: string; stickerUrl: null; symbol: SFSymbol }[] = [
  { _id: 's1', stickerUrl: null, symbol: 'pawprint.fill' },
  { _id: 's2', stickerUrl: null, symbol: 'hare.fill' },
  { _id: 's3', stickerUrl: null, symbol: 'ant.fill' },
  { _id: 's4', stickerUrl: null, symbol: 'fish.fill' },
  { _id: 's5', stickerUrl: null, symbol: 'ladybug.fill' },
  { _id: 's6', stickerUrl: null, symbol: 'lizard.fill' },
  { _id: 's7', stickerUrl: null, symbol: 'tortoise.fill' },
  { _id: 's8', stickerUrl: null, symbol: 'pawprint.fill' },
];

/**
 * The player's recent catches orbiting slowly, each keeping its own upright
 * angle so the animals never appear upside down. Adapted from
 * arunabhverma/expo-circular-animation: same ring layout, but the counter-
 * rotation per item and the die-cut stickers are SafaRoll's.
 */
export function CircularAvatars({
  captures,
  center,
  size,
}: {
  captures: {
    _id?: string;
    stickerUrl: string | null;
    symbol?: SFSymbol;
    commonName?: string;
    scientificName?: string;
  }[];
  /**
   * Ce qui occupe le cœur de l'anneau. Sans lui, une icône d'oiseau générique
   * — la même pour tout le monde. Sur le profil c'est le JOUEUR qui va là :
   * son portrait entouré des animaux qu'il a trouvés, ce qui dit d'un coup
   * d'œil qui il est et ce qu'il a fait.
   */
  center?: ReactNode;
  size: number;
}) {
  const angle = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    angle.set(
      withRepeat(withTiming(360, { duration: 46_000, easing: Easing.linear }), -1, false),
    );
  }, [angle, reduceMotion]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${angle.get()}deg` }],
  }));

  const items = captures.slice(0, 8);
  const radius = size / 2 - size * 0.12;
  const avatar = size * 0.2;

  return (
    <View style={[styles.stage, { height: size, width: size }]}>
      <View style={[styles.core, { borderRadius: size * 0.22, height: size * 0.44, width: size * 0.44 }]}>
        {center ?? <SymbolView name="pawprint.fill" size={size * 0.18} tintColor="#2b2418" />}
      </View>

      <Animated.View style={[StyleSheet.absoluteFill, ringStyle]}>
        {items.map((capture, index) => {
          const theta = (index / Math.max(1, items.length)) * Math.PI * 2 - Math.PI / 2;
          return (
            <CounterRotating
              key={capture._id ?? index}
              angle={angle}
              size={avatar}
              x={size / 2 + Math.cos(theta) * radius - avatar / 2}
              y={size / 2 + Math.sin(theta) * radius - avatar / 2}
              label={speciesName(capture) ?? capture.scientificName}
            >
              {capture.stickerUrl ? (
                <Image
                  source={{ uri: capture.stickerUrl }}
                  contentFit="contain"
                  style={styles.sticker}
                />
              ) : (
                <SymbolView
                  name={capture.symbol ?? 'pawprint.fill'}
                  size={avatar * 0.5}
                  tintColor="rgba(255,255,255,0.3)"
                />
              )}
            </CounterRotating>
          );
        })}
      </Animated.View>
    </View>
  );
}

/** Sits on the ring but spins backwards, so the animal stays upright. */
function CounterRotating({
  angle,
  children,
  size,
  x,
  y,
  label,
}: {
  angle: SharedValue<number>;
  children: React.ReactNode;
  size: number;
  x: number;
  y: number;
  label?: string;
}) {
  const [active, setActive] = useState(false);
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${-angle.get()}deg` }],
  }));
  return (
    <Animated.View
      style={[
        styles.avatarPosition,
        style,
        { borderRadius: size / 2, height: size, left: x, top: y, width: size },
      ]}
    >
      <Pressable
        accessibilityLabel={label ? (uiLanguage() === 'fr' ? `Capture de ${label}` : `Capture of ${label}`) : undefined}
        accessibilityRole={label ? 'button' : undefined}
        onPressIn={() => {
          if (!label) return;
          setActive(true);
          if (process.env.EXPO_OS === 'ios') void Haptics.selectionAsync();
        }}
        onPressOut={() => setActive(false)}
        style={styles.avatar}
      >
        {children}
      </Pressable>
      {active && label ? (
        <Animated.View
          entering={FadeInDown.springify().damping(18)}
          exiting={FadeOutUp.duration(140)}
          pointerEvents="none"
          style={[styles.tooltip, { left: (size - 150) / 2, top: size + 8 }]}
        >
          <Text numberOfLines={1} style={styles.tooltipText}>{label}</Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(233,184,77,0.35)',
    backgroundColor: 'rgba(233,184,77,0.08)',
  },
  avatarPosition: {
    position: 'absolute',
    overflow: 'visible',
  },
  avatar: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sticker: {
    width: '82%',
    height: '82%',
  },
  tooltip: {
    position: 'absolute',
    width: 150,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: 'rgba(28,20,9,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(233,184,77,0.3)',
    zIndex: 20,
  },
  tooltipText: {
    color: '#fff8e5',
    fontSize: 11,
    fontWeight: '700',
  },
});
