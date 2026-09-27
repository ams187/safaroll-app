import {
  Canvas,
  Circle,
  Group,
  Line,
  RadialGradient,
  Rect,
  useClock,
  vec,
} from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  SensorType,
  useAnimatedSensor,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

const AMBER = '#e6dfc4';
const DUST_COUNT = 26;
const SAFARI_FRAME = require('../../../assets/camera/safari-vehicle-frame.webp');
const SAFARI_TELEPHOTO = require('../../../assets/camera/safari-telephoto.webp');

/**
 * The living viewfinder: the rear of a safari 4x4 frames the real camera feed,
 * dust drifts in gyroscope parallax, corner brackets breathe, and a warm
 * vignette holds the eye. No frame processor, so capture stays untouched.
 * Subject-anchored effects (detection) come later on this same surface.
 */
export function WildLens({ focusPulse, shutterPulse }: { focusPulse: number; shutterPulse: number }) {
  const { height, width } = useWindowDimensions();
  const clock = useClock();
  const reduceMotion = useReducedMotion();
  const rotation = useAnimatedSensor(SensorType.ROTATION, {
    adjustToInterfaceOrientation: true,
    interval: 32,
  });
  const focusKick = useSharedValue(0);
  const shutterKick = useSharedValue(0);
  const shutterShade = useSharedValue(0);

  useEffect(() => {
    if (focusPulse === 0 || reduceMotion) return;
    focusKick.set(1);
    focusKick.set(withSpring(0, { damping: 13, stiffness: 210 }));
  }, [focusKick, focusPulse, reduceMotion]);

  useEffect(() => {
    if (shutterPulse === 0) return;
    if (!reduceMotion) {
      shutterKick.set(withSequence(withTiming(1, { duration: 45 }), withSpring(0, { damping: 14, stiffness: 260 })));
    }
    shutterShade.set(withSequence(withTiming(0.46, { duration: 38 }), withTiming(0, { duration: 120 })));
  }, [reduceMotion, shutterKick, shutterPulse, shutterShade]);

  // Two dust layers: the far one barely moves, the near one moves against the
  // tilt — the disparity is what reads as depth.
  const dust = useMemo(() => {
    const points: { layer: number; phase: number; r: number; x: number; y: number }[] = [];
    let seed = 0x9e3779b9;
    const next = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) % 1000) / 1000;
    };
    for (let index = 0; index < DUST_COUNT; index += 1) {
      points.push({
        layer: index % 2,
        phase: next() * Math.PI * 2,
        r: 0.8 + next() * 1.6,
        x: next() * width,
        y: next() * height,
      });
    }
    return points;
  }, [height, width]);

  const parallaxFar = useDerivedValue(() => {
    const { pitch, roll } = rotation.sensor.get();
    return [{ translateX: roll * -14 }, { translateY: pitch * -14 }];
  });
  const parallaxNear = useDerivedValue(() => {
    const { pitch, roll } = rotation.sensor.get();
    return [{ translateX: roll * 34 }, { translateY: pitch * 34 }];
  });
  const vehicleStyle = useAnimatedStyle(() => {
    if (reduceMotion) return {};
    const { pitch, roll } = rotation.sensor.get();
    return {
      transform: [
        { translateX: roll * -3 },
        { translateY: pitch * -2 },
        { rotateZ: `${roll * -0.006}rad` },
        { scale: 1.015 },
      ],
    };
  });
  const telephotoStyle = useAnimatedStyle(() => {
    const { pitch, roll } = rotation.sensor.get();
    return {
      transform: [
        { translateX: reduceMotion ? 0 : roll * 5 },
        { translateY: (reduceMotion ? 0 : pitch * 4) - focusKick.get() * 5 + shutterKick.get() * 10 },
        { rotateZ: `${reduceMotion ? 0 : roll * 0.004}rad` },
        { scale: 1.012 + focusKick.get() * 0.009 - shutterKick.get() * 0.004 },
      ],
    };
  });

  // Brackets breathe: opacity swells gently.
  const breath = useDerivedValue(() => {
    if (reduceMotion) return 0.55;
    return 0.42 + 0.22 * Math.sin(clock.get() / 700);
  });

  const bracket = Math.round(width * 0.09);
  const inset = Math.round(width * 0.12);
  const top = height * 0.26;
  const bottom = height * 0.68;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={StyleSheet.absoluteFill}>
        {/* Warm vignette — the frame draws the eye to the centre. */}
        <Rect x={0} y={0} width={width} height={height}>
          <RadialGradient
            c={vec(width / 2, height * 0.45)}
            r={height * 0.62}
            colors={['rgba(16,11,4,0)', 'rgba(16,11,4,0)', 'rgba(16,11,4,0.42)']}
            positions={[0, 0.72, 1]}
          />
        </Rect>

        {/* Far dust. */}
        <Group transform={parallaxFar} opacity={0.5}>
          {dust
            .filter((point) => point.layer === 0)
            .map((point, index) => (
              <Circle key={index} cx={point.x} cy={point.y} r={point.r} color="rgba(255,240,200,0.35)" />
            ))}
        </Group>
        {/* Near dust — moves more, reads closer. */}
        <Group transform={parallaxNear} opacity={0.7}>
          {dust
            .filter((point) => point.layer === 1)
            .map((point, index) => (
              <Circle key={index} cx={point.x} cy={point.y} r={point.r * 1.4} color="rgba(233,184,77,0.4)" />
            ))}
        </Group>

        {/* Viewfinder brackets, breathing. */}
        <Group opacity={breath} transform={parallaxFar}>
          {(
            [
              [inset, top, inset + bracket, top, inset, top + bracket],
              [width - inset, top, width - inset - bracket, top, width - inset, top + bracket],
              [inset, bottom, inset + bracket, bottom, inset, bottom - bracket],
              [width - inset, bottom, width - inset - bracket, bottom, width - inset, bottom - bracket],
            ] as const
          ).map(([x, y, hx, hy, vx, vy], index) => (
            <Group key={index}>
              <Line p1={vec(x, y)} p2={vec(hx, hy)} color={AMBER} strokeWidth={2} />
              <Line p1={vec(x, y)} p2={vec(vx, vy)} color={AMBER} strokeWidth={2} />
            </Group>
          ))}
        </Group>
        <Rect x={0} y={0} width={width} height={height} color="#000" opacity={shutterShade} />
      </Canvas>
      <Animated.View style={[StyleSheet.absoluteFill, vehicleStyle]}>
        <Image contentFit="fill" priority="high" source={SAFARI_FRAME} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, telephotoStyle]}>
        <Image contentFit="fill" priority="high" source={SAFARI_TELEPHOTO} style={StyleSheet.absoluteFill} />
      </Animated.View>
    </View>
  );
}
