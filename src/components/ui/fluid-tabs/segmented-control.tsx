// Fluid segmented control — the selected pill slides between cells while a
// blur pulse crosses the gap it travelled, so the switch reads as liquid
// rather than as a jump.
//
// Vendored from enzomanuelmangano/demos "fluid-tab-interaction" (reactiive.io,
// licensed for in-app use, not for redistribution). SafaRoll changes: `pressto`
// → plain Pressable, MaterialCommunityIcons → SF Symbols (the icon set this
// app already ships), the demo palette → SafaRoll's warm amber, and the per-item
// hooks lifted into a child component (calling hooks inside `.map()` is a
// rules-of-hooks violation the demo suppresses with an eslint-disable).
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { AnimatedBlurView } from './animated-blur-view';

const Palette = {
  background: 'rgba(255,248,229,0.10)',
  baseGray05: 'rgba(255,255,255,0.07)',
  baseLabel: 'rgba(255,255,255,0.52)',
  highlightLabel: '#2b2418',
};

const TimingConfig = {
  duration: 620,
  easing: Easing.bezier(0.4, 0, 0.2, 1),
};

export type SegmentItem = { name: string; icon: SFSymbol };

export function SegmentedControl<T extends SegmentItem>({
  data,
  height = 42,
  onPress,
  selected,
  width,
}: {
  data: readonly T[];
  height?: number;
  onPress: (item: T) => void;
  selected: T;
  width: number;
}) {
  const internalPadding = 5;
  const cellBackgroundWidth = width / data.length;
  const activeIndexes = useSharedValue<number[]>([]);
  const blurProgress = useSharedValue(0);

  const selectedCellIndex = useMemo(
    () => data.findIndex((item) => item.name === selected.name),
    [data, selected],
  );

  const animatedBlurProps = useAnimatedProps(() => ({
    intensity: interpolate(blurProgress.get(), [0, 0.5, 1], [0, 15, 0]),
  }));

  const rCellStyle = useAnimatedStyle(() => {
    const padding = interpolate(
      selectedCellIndex,
      [0, Math.max(1, data.length - 1)],
      [internalPadding, -internalPadding],
    );
    return {
      left: withTiming(cellBackgroundWidth * selectedCellIndex + padding, TimingConfig),
    };
  }, [selectedCellIndex]);

  const rCellBlurStyle = useAnimatedStyle(
    () => ({ left: withTiming(cellBackgroundWidth * selectedCellIndex, TimingConfig) }),
    [selectedCellIndex],
  );

  const handlePress = (item: T, index: number) => {
    onPress(item);
    if (selectedCellIndex === index) return;
    activeIndexes.set([selectedCellIndex, index]);
    cancelAnimation(blurProgress);
    blurProgress.set(
      withTiming(1, TimingConfig, (done) => {
        if (done) {
          blurProgress.set(0);
          activeIndexes.set([]);
        }
      }),
    );
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: Palette.baseGray05, height, padding: internalPadding, width },
      ]}
    >
      {data.map((item, index) => (
        <Segment
          key={item.name}
          activeIndexes={activeIndexes}
          blurProgress={blurProgress}
          index={index}
          item={item}
          onPress={() => handlePress(item, index)}
          selected={selectedCellIndex === index}
        />
      ))}

      <Animated.View
        pointerEvents="none"
        style={[
          styles.highlight,
          rCellStyle,
          {
            height: height - internalPadding * 2,
            width: cellBackgroundWidth - internalPadding / data.length,
          },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.highlightBlur, rCellBlurStyle, { height, width: cellBackgroundWidth }]}
      >
        <AnimatedBlurView animatedProps={animatedBlurProps} tint="light" style={styles.fill} />
      </Animated.View>
    </View>
  );
}

/** One cell. Its own component so the per-item hooks stay legal. */
function Segment({
  activeIndexes,
  blurProgress,
  index,
  item,
  onPress,
  selected,
}: {
  activeIndexes: SharedValue<number[]>;
  blurProgress: SharedValue<number>;
  index: number;
  item: SegmentItem;
  onPress: () => void;
  selected: boolean;
}) {
  const internalBlurProps = useAnimatedProps(() => ({
    intensity: interpolate(
      activeIndexes.get().includes(index) ? blurProgress.get() : 0,
      [0, 0.5, 1],
      [0, 10, 0],
    ),
  }));

  const rLabelStyle = useAnimatedStyle(
    () => ({
      color: withTiming(selected ? Palette.highlightLabel : Palette.baseLabel, TimingConfig),
    }),
    [selected],
  );

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={styles.labelContainer}
    >
      <SymbolView
        name={item.icon}
        size={13}
        tintColor={selected ? Palette.highlightLabel : Palette.baseLabel}
      />
      <Animated.Text style={[styles.label, rLabelStyle]}>{item.name}</Animated.Text>
      <AnimatedBlurView
        animatedProps={internalBlurProps}
        pointerEvents="none"
        tint="light"
        style={styles.blurView}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 30,
    borderWidth: 1,
    borderColor: Palette.baseGray05,
  },
  labelContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    zIndex: 2,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  blurView: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 1,
  },
  highlight: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 1,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(233,184,77,0.35)',
    backgroundColor: Palette.background,
  },
  highlightBlur: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 1,
    overflow: 'hidden',
    borderRadius: 30,
  },
  fill: { flex: 1 },
});
