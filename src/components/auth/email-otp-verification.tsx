import { useTranslation as useUiTranslation } from 'react-i18next';
import { eclosion, toucheLegere } from '@/lib/haptics';
import { Canvas, Path, Skia, usePathInterpolation } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  FlipInXDown,
  FlipOutXDown,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
  type AnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

type Status = 'inProgress' | 'correct' | 'wrong';
type FaceRef = { happy: () => void; sad: () => void; normal: () => void };

const INK = '#2b2418';
const PAPER = '#fffdf8';
const PARCHMENT = '#e6dfc4';
const SUCCESS = '#2f6b4f';
const DANGER = '#c05a3a';

const mouthPaths = [
  'M0 10 Q12.5 20 25 10',
  'M0 10 Q12.5 10 25 10',
  'M0 10 Q12.5 0 25 10',
].map((path) => Skia.Path.MakeFromSVGString(path)!);
const eyebrowPaths = [
  'M0 4 Q7.5 0 15 4',
  'M0 4 Q7.5 4 15 4',
  'M0 4 Q7.5 8 15 4',
].map((path) => Skia.Path.MakeFromSVGString(path)!);

export function EmailOtpVerification({
  onVerify,
}: {
  onVerify: (code: string) => Promise<boolean>;
}) {
  const { t: copy } = useUiTranslation();
  const [code, setCode] = useState<number[]>([]);
  const status = useSharedValue<Status>('inProgress');
  const inputRef = useRef<TextInput>(null);
  const faceRef = useRef<FaceRef>(null);
  const verifyingRef = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shakeX = useSharedValue(0);

  useEffect(() => {
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => {
      clearTimeout(focusTimer);
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.get() }],
  }));

  const reset = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      resetTimer.current = null;
      status.set('inProgress');
      setCode([]);
      inputRef.current?.clear();
      faceRef.current?.normal();
      inputRef.current?.focus();
    }, 1000);
  }, [status]);

  const verify = useCallback(
    async (digits: number[]) => {
      if (verifyingRef.current) return;
      verifyingRef.current = true;
      const valid = await onVerify(digits.join('')).finally(() => {
        verifyingRef.current = false;
      });

      if (valid) {
        status.set('correct');
        faceRef.current?.happy();
        eclosion();
        return;
      }

      status.set('wrong');
      faceRef.current?.sad();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      cancelAnimation(shakeX);
      shakeX.set(0);
      shakeX.set(
        withRepeat(
          withTiming(10, {
            duration: 120,
            easing: Easing.bezier(0.35, 0.7, 0.5, 0.7),
          }),
          6,
          true,
        ),
      );
      reset();
    },
    [onVerify, reset, shakeX, status],
  );

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Face ref={faceRef} currentCodeLength={code.length} maxCodeLength={6} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copy("ui_copy_108")}
          onPress={() => inputRef.current?.focus()}
        >
          <Animated.View style={[styles.codeRow, shakeStyle]}>
            {Array.from({ length: 6 }, (_, index) => (
              <CodeNumber
                key={index}
                code={code[index]}
                highlighted={index === code.length}
                status={status}
              />
            ))}
          </Animated.View>
        </Pressable>
      </View>
      <TextInput
        ref={inputRef}
        accessibilityLabel={copy("ui_copy_109")}
        autoComplete="one-time-code"
        autoFocus
        caretHidden
        inputMode="numeric"
        keyboardType="number-pad"
        maxLength={6}
        onChangeText={(value) => {
          const digits = value.replace(/\D/g, '').slice(0, 6).split('').map(Number);
          if (digits.length) toucheLegere();
          setCode(digits);
          status.set('inProgress');
          faceRef.current?.normal();
          if (digits.length === 6) {
            inputRef.current?.blur();
            void verify(digits);
          }
        }}
        style={styles.hiddenInput}
        textContentType="oneTimeCode"
      />
    </View>
  );
}

function CodeNumber({
  code,
  highlighted,
  status,
}: {
  code?: number;
  highlighted: boolean;
  status: SharedValue<Status>;
}) {
  const boxStyle = useAnimatedStyle(() => {
    const color =
      status.get() === 'correct'
        ? SUCCESS
        : status.get() === 'wrong'
          ? DANGER
          : highlighted
            ? INK
            : 'rgba(43, 36, 24, 0.22)';
    return {
      borderColor: withTiming(color),
      borderWidth: withTiming(highlighted ? 2.4 : 1.4),
    };
  }, [highlighted]);

  return (
    <Animated.View style={[styles.codeBox, boxStyle]}>
      {code != null ? (
        <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(250)}>
          <Animated.Text
            entering={FlipInXDown.duration(500)
              .easing(Easing.bezier(0, 0.75, 0.5, 0.9).factory())
              .build()}
            exiting={FlipOutXDown.duration(500)
              .easing(Easing.bezier(0.6, 0.1, 0.4, 0.8).factory())
              .build()}
            style={styles.codeText}
          >
            {code}
          </Animated.Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const Face = forwardRef<
  FaceRef,
  { currentCodeLength: number; maxCodeLength: number; style?: AnimatedStyle<ViewStyle> }
>(({ currentCodeLength, maxCodeLength, style }, ref) => {
  const progress = useDerivedValue(
    () => withTiming(currentCodeLength / maxCodeLength, { duration: 500 }),
    [currentCodeLength, maxCodeLength],
  );
  const rotationStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 300 },
      { rotateY: `${interpolate(progress.get(), [0, 1], [-Math.PI / 8, Math.PI / 8])}rad` },
      { rotateX: `${-Math.PI / 8}rad` },
    ],
  }));

  return (
    <Animated.View style={[styles.faceSquare, style, rotationStyle]}>
      <FaceFeatures ref={ref} progress={progress} />
    </Animated.View>
  );
});
Face.displayName = 'Face';

const FaceFeatures = forwardRef<FaceRef, { progress: SharedValue<number> }>(({ progress }, ref) => {
  const expression = useSharedValue(1);
  const animatedExpression = useDerivedValue(() => withTiming(expression.get()));
  const mouthPath = usePathInterpolation(animatedExpression, [0, 1, 2], mouthPaths);
  const eyebrowPath = usePathInterpolation(expression, [0, 1, 2], eyebrowPaths);

  useImperativeHandle(ref, () => ({
    happy: () => expression.set(0),
    normal: () => expression.set(1),
    sad: () => expression.set(2),
  }));

  const positionStyle = useAnimatedStyle(() => ({
    gap: interpolate(progress.get(), [0, 1], [7, 3]),
    transform: [
      { translateY: 10 },
      { translateX: interpolate(progress.get(), [0, 1], [-10, 10]) },
    ],
  }));
  const featuresStyle = useAnimatedStyle(() => ({
    gap: interpolate(progress.get(), [0, 1], [7, 3]),
  }));

  return (
    <Animated.View style={[styles.faceFeatures, positionStyle]}>
      <Animated.View style={[styles.featureRow, featuresStyle]}>
        <Brow path={eyebrowPath} />
        <Brow path={eyebrowPath} />
      </Animated.View>
      <Animated.View style={[styles.featureRow, featuresStyle]}>
        <Eye progress={progress} />
        <Eye progress={progress} />
      </Animated.View>
      <Canvas style={styles.mouth}>
        <Path path={mouthPath} color={PARCHMENT} style="stroke" strokeWidth={2} />
      </Canvas>
    </Animated.View>
  );
});
FaceFeatures.displayName = 'FaceFeatures';

function Brow({ path }: { path: SharedValue<ReturnType<typeof Skia.Path.Make>> }) {
  return (
    <Canvas style={styles.brow}>
      <Path path={path} color={PARCHMENT} style="stroke" strokeWidth={1.2} />
    </Canvas>
  );
}

function Eye({ progress }: { progress: SharedValue<number> }) {
  const eyeStyle = useAnimatedStyle(() => {
    const size = interpolate(progress.get(), [0, 1], [4, 8]);
    return {
      width: size,
      height: size,
      borderRadius: size / 2,
      transform: [
        { translateX: interpolate(progress.get(), [0, 1], [-4, 4]) },
        { translateY: 3 },
      ],
    };
  });

  return (
    <View style={styles.eye}>
      <Animated.View style={[styles.pupil, eyeStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', height: 230, alignItems: 'center', justifyContent: 'center' },
  content: { width: '100%', alignItems: 'center', gap: 38 },
  hiddenInput: { position: 'absolute', bottom: -50, width: 1, height: 1, opacity: 0 },
  codeRow: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  codeBox: {
    width: 43,
    height: 52,
    borderCurve: 'continuous',
    borderRadius: 15,
    backgroundColor: PAPER,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0px 8px 12px rgba(43, 36, 24, 0.08)',
  },
  codeText: { color: INK, fontFamily: 'Satoshi-Bold', fontSize: 31 },
  faceSquare: {
    width: 96,
    height: 96,
    borderCurve: 'continuous',
    borderRadius: 24,
    backgroundColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faceFeatures: { alignItems: 'center', justifyContent: 'center' },
  featureRow: { flexDirection: 'row' },
  brow: { width: 15, height: 8 },
  mouth: { width: 25, height: 20 },
  eye: {
    width: 20,
    height: 20,
    borderRadius: 10,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PARCHMENT,
  },
  pupil: { backgroundColor: INK },
});
