import { useTranslation as useUiTranslation } from 'react-i18next';
import {
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  RadialGradient,
  Shadow,
  Skia,
  vec,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { Text, View, type AccessibilityActionEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';
import { scheduleOnRN } from 'react-native-worklets';

const MONTHS = 12;

export function MonthRangeSlider({
  onChange,
  size = 250,
  value,
}: {
  onChange: (months: number) => void;
  size?: number;
  value: number;
}) {
  const { t: copy } = useUiTranslation();
  const stroke = size * 0.2;
  const center = size / 2;
  const radius = (size - stroke) / 2 - 4;
  const knobRadius = stroke * 0.28;
  const progress = useSharedValue(value / MONTHS);
  const lastMonth = useSharedValue(value);

  const circlePath = useMemo(() => {
    const path = Skia.Path.Make();
    path.addCircle(center, center, radius);
    return path;
  }, [center, radius]);

  const dots = useMemo(
    () =>
      Array.from({ length: MONTHS }, (_, index) => {
        const angle = -Math.PI / 2 + (index * Math.PI * 2) / MONTHS;
        return {
          x: center + Math.cos(angle) * radius,
          y: center + Math.sin(angle) * radius,
        };
      }),
    [center, radius],
  );

  const knobX = useDerivedValue(() => {
    const angle = -Math.PI / 2 + progress.value * Math.PI * 2;
    return center + Math.cos(angle) * radius;
  });
  const knobY = useDerivedValue(() => {
    const angle = -Math.PI / 2 + progress.value * Math.PI * 2;
    return center + Math.sin(angle) * radius;
  });

  const updateFromPoint = (x: number, y: number) => {
    'worklet';
    const angle = (Math.atan2(y - center, x - center) + Math.PI * 2.5) % (Math.PI * 2);
    const month = Math.min(MONTHS, Math.max(1, Math.round((angle / (Math.PI * 2)) * MONTHS)));
    progress.value = month / MONTHS;
    if (month !== lastMonth.value) {
      lastMonth.value = month;
      scheduleOnRN(onChange, month);
    }
  };

  const gesture = Gesture.Pan()
    .minDistance(0)
    .onBegin(({ x, y }) => updateFromPoint(x, y))
    .onUpdate(({ x, y }) => updateFromPoint(x, y))
    .onEnd(() => {
      progress.value = withTiming(lastMonth.value / MONTHS, { duration: 120 });
    });

  const adjust = (event: AccessibilityActionEvent) => {
    const delta = event.nativeEvent.actionName === 'increment' ? 1 : -1;
    const month = Math.min(MONTHS, Math.max(1, value + delta));
    lastMonth.value = month;
    progress.value = withTiming(month / MONTHS, { duration: 160 });
    onChange(month);
  };

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel={copy("ui_copy_122")}
        accessibilityRole="adjustable"
        accessibilityValue={{ max: MONTHS, min: 1, now: value, text: copy('month_count', { count: value }) }}
        onAccessibilityAction={adjust}
        style={[styles.root, { height: size, width: size }]}
      >
        <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Circle
            color="#e8e2d5"
            cx={center}
            cy={center}
            r={radius}
            strokeWidth={stroke}
            style="stroke"
          >
            <Shadow blur={10} color="rgba(52,39,18,0.2)" dx={0} dy={7} inner />
            <Shadow blur={4} color="rgba(255,255,255,0.9)" dx={0} dy={-3} inner />
          </Circle>

          {dots.map((dot, index) => (
            <Circle color="rgba(44,38,28,0.42)" cx={dot.x} cy={dot.y} key={index} r={2} />
          ))}

          <Group origin={vec(center, center)} transform={[{ rotate: -Math.PI / 2 }]}>
            <Path
              end={progress}
              path={circlePath}
              start={0}
              strokeCap="round"
              strokeWidth={stroke * 0.82}
              style="stroke"
            >
              <RadialGradient
                c={vec(center, center)}
                // A value ramp, so it stays a ramp — three steps of the ink
                // instead of three steps of amber.
                colors={['#8d8271', '#2b2418', '#100d08']}
                r={size / 2}
              />
              <Shadow blur={7} color="rgba(155,82,15,0.42)" dx={0} dy={0} />
            </Path>
          </Group>

          <Circle color="#fffdf7" cx={knobX} cy={knobY} r={knobRadius}>
            <LinearGradient
              colors={['#ffffff', '#d8d2c7']}
              end={vec(0, knobRadius * 2)}
              start={vec(0, 0)}
            />
            <Shadow blur={5} color="rgba(45,30,8,0.34)" dx={0} dy={3} />
          </Circle>
        </Canvas>

        <View pointerEvents="none" style={styles.value}>
          <Text style={styles.number}>{value}</Text>
          <Text style={styles.unit}>{copy("ui_copy_123")}</Text>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    alignItems: 'center',
  },
  number: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 58,
    fontVariant: ['tabular-nums'],
    lineHeight: 62,
  },
  unit: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bold,
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
}));
