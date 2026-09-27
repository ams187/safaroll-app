import { useTranslation as useUiTranslation } from 'react-i18next';
/* eslint-disable react-hooks/immutability -- The upstream game intentionally keeps its 60 fps mutable simulation in a ref; React state only schedules paints. */
import {
  Canvas,
  Circle,
  Group,
  Image as SkiaImage,
  LinearGradient,
  Rect,
  RoundedRect,
  useImage,
  vec,
} from '@shopify/react-native-skia';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  makeMutable,
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

const { width: SW, height: SH } = Dimensions.get('window');

const BIRD_X = SW * 0.28;
const BIRD_R = 14;
const BIRD_SIZE = 58;
const GRAVITY = 0.38;
const FLAP = -7;
const MAX_VEL = 11;
const PIPE_W = 58;
const PIPE_CAP_H = 24;
const PIPE_CAP_EX = 5;
const GAP = 160;
const PIPE_SPEED = 2.6;
const GROUND_H = 90;
const PLAY_H = SH - GROUND_H;
const MIN_GAP_Y = GAP / 2 + 70;
const MAX_GAP_Y = PLAY_H - GAP / 2 - 70;
const PIPE_SPACING = 210;

const SKY_TOP = '#C8E6FF';
const SKY_BOT = '#87CEEB';
const CLOUD = 'rgba(255,255,255,0.85)';
const PIPE_BODY = '#5CB85C';
const PIPE_CAP = '#4A9E4A';
const PIPE_LIGHT = 'rgba(255,255,255,0.12)';
const PIPE_DARK = 'rgba(0,0,0,0.08)';
const GROUND_MAIN = '#DEB887';
const GROUND_DARK = '#C8A87A';
const GRASS_TOP = '#5DBE5D';
const GRASS_DARK = '#4CAF50';

interface PipeData {
  id: number;
  x: SharedValue<number>;
  gapY: number;
  scored: boolean;
}

interface CloudData {
  x: SharedValue<number>;
  y: number;
  r1: number;
  r2: number;
  r3: number;
  speed: number;
}

interface GameState {
  birdY: SharedValue<number>;
  birdRotation: SharedValue<number>;
  birdVel: number;
  pipes: PipeData[];
  clouds: CloudData[];
  groundX: SharedValue<number>;
  frame: number;
  deathFrame: number;
  status: 'ready' | 'playing' | 'dead';
}

const makeClouds = (): CloudData[] => [
  { x: makeMutable(60), y: 80, r1: 18, r2: 24, r3: 16, speed: 0.3 },
  { x: makeMutable(200), y: 130, r1: 14, r2: 20, r3: 12, speed: 0.45 },
  { x: makeMutable(340), y: 60, r1: 20, r2: 26, r3: 18, speed: 0.35 },
  { x: makeMutable(120), y: 190, r1: 12, r2: 16, r3: 10, speed: 0.5 },
  { x: makeMutable(450), y: 110, r1: 16, r2: 22, r3: 14, speed: 0.4 },
];

const randomGapY = () => MIN_GAP_Y + Math.random() * (MAX_GAP_Y - MIN_GAP_Y);

const initState = (): GameState => ({
  birdY: makeMutable(SH * 0.4),
  birdRotation: makeMutable(0),
  birdVel: 0,
  pipes: [],
  clouds: makeClouds(),
  groundX: makeMutable(0),
  frame: 0,
  deathFrame: 0,
  status: 'ready',
});

const CloudSprite = memo(function CloudSprite({ cloud }: { cloud: CloudData }) {
  const x = cloud.x;
  const transform = useDerivedValue(() => [{ translateX: x.value }]);
  return (
    <Group transform={transform}>
      <Circle cx={0} cy={cloud.y} r={cloud.r1} color={CLOUD} />
      <Circle cx={cloud.r2 * 0.9} cy={cloud.y - 4} r={cloud.r2} color={CLOUD} />
      <Circle cx={cloud.r2 * 1.8} cy={cloud.y} r={cloud.r3} color={CLOUD} />
    </Group>
  );
});

const PipeSprite = memo(function PipeSprite({ pipe }: { pipe: PipeData }) {
  const x = pipe.x;
  const transform = useDerivedValue(() => [{ translateX: x.value }]);
  const topH = pipe.gapY - GAP / 2;
  const botY = pipe.gapY + GAP / 2;
  return (
    <Group transform={transform}>
      <Rect x={0} y={0} width={PIPE_W} height={topH} color={PIPE_BODY} />
      <Rect x={0} y={0} width={6} height={topH} color={PIPE_LIGHT} />
      <Rect x={PIPE_W - 6} y={0} width={6} height={topH} color={PIPE_DARK} />
      <RoundedRect x={-PIPE_CAP_EX} y={topH - PIPE_CAP_H} width={PIPE_W + PIPE_CAP_EX * 2} height={PIPE_CAP_H} r={4} color={PIPE_CAP} />
      <RoundedRect x={-PIPE_CAP_EX} y={topH - PIPE_CAP_H} width={6} height={PIPE_CAP_H} r={2} color={PIPE_LIGHT} />
      <Rect x={0} y={botY} width={PIPE_W} height={PLAY_H - botY} color={PIPE_BODY} />
      <Rect x={0} y={botY} width={6} height={PLAY_H - botY} color={PIPE_LIGHT} />
      <Rect x={PIPE_W - 6} y={botY} width={6} height={PLAY_H - botY} color={PIPE_DARK} />
      <RoundedRect x={-PIPE_CAP_EX} y={botY} width={PIPE_W + PIPE_CAP_EX * 2} height={PIPE_CAP_H} r={4} color={PIPE_CAP} />
      <RoundedRect x={-PIPE_CAP_EX} y={botY} width={6} height={PIPE_CAP_H} r={2} color={PIPE_LIGHT} />
    </Group>
  );
});

const circleRect = (
  cx: number,
  cy: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
) => {
  const nearX = Math.max(rx, Math.min(cx, rx + rw));
  const nearY = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nearX;
  const dy = cy - nearY;
  return dx * dx + dy * dy < r * r;
};

export default function FlappyBirdScreen() {
  const { t: copy } = useUiTranslation();
  const params = useLocalSearchParams<{
    name?: string | string[];
    stickerThumbUrl?: string | string[];
    stickerUrl?: string | string[];
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const stickerUrl = Array.isArray(params.stickerUrl) ? params.stickerUrl[0] : params.stickerUrl;
  const stickerThumbUrl = Array.isArray(params.stickerThumbUrl) ? params.stickerThumbUrl[0] : params.stickerThumbUrl;
  const birdImage = useImage(stickerThumbUrl ?? stickerUrl);
  const birdName = Array.isArray(params.name) ? params.name[0] : params.name;
  const [game] = useState(initState);
  const [pipes, setPipes] = useState<PipeData[]>([]);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [status, setStatus] = useState<'ready' | 'playing' | 'dead'>('ready');
  const rafRef = useRef(0);

  const scoreScale = useSharedValue(1);
  const flashOpacity = useSharedValue(0);
  const deathTint = useSharedValue(0);

  const scoreStyle = useAnimatedStyle(() => ({ transform: [{ scale: scoreScale.value }] }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));
  const deathStyle = useAnimatedStyle(() => ({ opacity: deathTint.value }));
  const birdYValue = game.birdY;
  const birdRotationValue = game.birdRotation;
  const groundXValue = game.groundX;
  const birdY = useDerivedValue(() => birdYValue.value - BIRD_SIZE / 2);
  const birdOrigin = useDerivedValue(() => vec(BIRD_X, birdYValue.value));
  const birdTransform = useDerivedValue(() => [{ rotate: birdRotationValue.value }]);
  const groundTransform = useDerivedValue(() => {
    const offset = ((groundXValue.value % 36) + 36) % 36;
    return [{ translateX: -offset }];
  });

  const resetGame = useCallback(() => {
    game.birdY.value = SH * 0.4;
    game.birdRotation.value = 0;
    game.birdVel = 0;
    game.pipes = [];
    setPipes([]);
    game.frame = 0;
    game.deathFrame = 0;
    game.status = 'ready';
    setScore(0);
    setStatus('ready');
    deathTint.value = withTiming(0, { duration: 200 });
  }, [deathTint, game]);

  const handleTap = useCallback(() => {
    if (game.status === 'ready') {
      game.status = 'playing';
      game.birdVel = FLAP;
      game.birdRotation.value = -30 * (Math.PI / 180);
      game.pipes = [{ id: game.frame, x: makeMutable(SW + 100), gapY: randomGapY(), scored: false }];
      setPipes(game.pipes);
      setStatus('playing');
    } else if (game.status === 'playing') {
      game.birdVel = FLAP;
    } else if (game.frame - game.deathFrame > 40) {
      resetGame();
    }
  }, [game, resetGame]);

  const handleDeath = useCallback(() => {
    game.status = 'dead';
    game.deathFrame = game.frame;
    setStatus('dead');
    const finalScore = game.pipes.filter((pipe) => pipe.scored).length;
    setScore(finalScore);
    setHighScore((current) => Math.max(current, finalScore));
    flashOpacity.value = withSequence(
      withTiming(0.7, { duration: 50 }),
      withTiming(0, { duration: 300 }),
    );
    deathTint.value = withTiming(0.25, { duration: 200 });
  }, [deathTint, flashOpacity, game]);

  const incrementScore = useCallback(() => {
    setScore((current) => current + 1);
    scoreScale.value = withSequence(
      withTiming(1.4, { duration: 80 }),
      withSpring(1, { damping: 8, stiffness: 300 }),
    );
  }, [scoreScale]);

  const tap = useMemo(
    () => Gesture.Tap().onStart(() => scheduleOnRN(handleTap)),
    [handleTap],
  );

  useEffect(() => {
    const loop = () => {
      const current = game;
      current.frame++;

      current.clouds.forEach((cloud) => {
        cloud.x.value -= cloud.speed;
        if (cloud.x.value < -80) cloud.x.value = SW + 60 + Math.random() * 100;
      });

      if (current.status === 'ready') {
        current.birdY.value = SH * 0.4 + Math.sin(current.frame * 0.04) * 14;
        current.groundX.value -= 1;
      }

      if (current.status === 'playing') {
        current.birdVel = Math.min(current.birdVel + GRAVITY, MAX_VEL);
        current.birdY.value += current.birdVel;
        current.groundX.value -= PIPE_SPEED;
        current.pipes.forEach((pipe) => { pipe.x.value -= PIPE_SPEED; });

        let pipesChanged = false;
        if (current.pipes.length === 0 || current.pipes[current.pipes.length - 1].x.value < SW - PIPE_SPACING) {
          current.pipes.push({ id: current.frame, x: makeMutable(SW + 50), gapY: randomGapY(), scored: false });
          pipesChanged = true;
        }
        const visiblePipes = current.pipes.filter((pipe) => pipe.x.value > -PIPE_W - 20);
        if (visiblePipes.length !== current.pipes.length) {
          current.pipes = visiblePipes;
          pipesChanged = true;
        }
        if (pipesChanged) setPipes([...current.pipes]);
        current.pipes.forEach((pipe) => {
          if (!pipe.scored && pipe.x.value + PIPE_W < BIRD_X) {
            pipe.scored = true;
            incrementScore();
          }
        });

        let hit = current.birdY.value + BIRD_R > PLAY_H || current.birdY.value - BIRD_R < 0;
        if (!hit) {
          for (const pipe of current.pipes) {
            const topH = pipe.gapY - GAP / 2;
            const botY = pipe.gapY + GAP / 2;
            if (
              circleRect(BIRD_X, current.birdY.value, BIRD_R - 1, pipe.x.value, 0, PIPE_W, topH)
              || circleRect(BIRD_X, current.birdY.value, BIRD_R - 1, pipe.x.value, botY, PIPE_W, SH - botY)
              || circleRect(BIRD_X, current.birdY.value, BIRD_R - 1, pipe.x.value - PIPE_CAP_EX, topH - PIPE_CAP_H, PIPE_W + PIPE_CAP_EX * 2, PIPE_CAP_H)
              || circleRect(BIRD_X, current.birdY.value, BIRD_R - 1, pipe.x.value - PIPE_CAP_EX, botY, PIPE_W + PIPE_CAP_EX * 2, PIPE_CAP_H)
            ) {
              hit = true;
              break;
            }
          }
        }
        if (hit) handleDeath();
      }

      if (current.status === 'dead' && current.birdY.value < PLAY_H - BIRD_R) {
        current.birdVel = Math.min(current.birdVel + GRAVITY * 1.8, MAX_VEL * 1.3);
        current.birdY.value = Math.min(current.birdY.value + current.birdVel, PLAY_H - BIRD_R);
      }

      current.birdRotation.value = current.status === 'ready'
        ? Math.sin(current.frame * 0.04) * 0.15
        : Math.min(Math.max(current.birdVel * 4.5, -30), 85) * (Math.PI / 180);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [game, handleDeath, incrementScore]);

  const stripeW = 36;
  const groundStripes = useMemo(
    () => (
      <>
        {Array.from({ length: Math.ceil(SW / stripeW) + 2 }).map((_, index) => (
          <Rect key={`gs-${index}`} x={index * stripeW} y={PLAY_H + 14} width={stripeW / 2} height={3} color={GROUND_DARK} />
        ))}
        {Array.from({ length: Math.ceil(SW / stripeW) + 2 }).map((_, index) => (
          <Rect key={`gs2-${index}`} x={index * stripeW + stripeW * 0.3} y={PLAY_H + 26} width={stripeW / 3} height={2} color={GROUND_DARK} />
        ))}
      </>
    ),
    [],
  );

  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar barStyle="dark-content" hidden />
      <GestureDetector gesture={tap}>
        <View style={styles.container}>
          <Canvas style={styles.canvas}>
            <Rect x={0} y={0} width={SW} height={SH}>
              <LinearGradient start={vec(0, 0)} end={vec(0, PLAY_H)} colors={[SKY_TOP, SKY_BOT]} />
            </Rect>

            {game.clouds.map((cloud, index) => (
              <CloudSprite cloud={cloud} key={index} />
            ))}

            {pipes.map((pipe) => <PipeSprite key={pipe.id} pipe={pipe} />)}

            <Rect x={0} y={PLAY_H} width={SW} height={GROUND_H} color={GROUND_MAIN} />
            <Rect x={0} y={PLAY_H} width={SW} height={6} color={GRASS_TOP} />
            <Rect x={0} y={PLAY_H + 6} width={SW} height={3} color={GRASS_DARK} />
            <Group transform={groundTransform}>
              {groundStripes}
            </Group>

            {birdImage ? (
              <Group transform={birdTransform} origin={birdOrigin}>
                <SkiaImage
                  fit="contain"
                  height={BIRD_SIZE}
                  image={birdImage}
                  width={BIRD_SIZE}
                  x={BIRD_X - BIRD_SIZE / 2}
                  y={birdY}
                />
              </Group>
            ) : null}
          </Canvas>

          <Animated.View style={[styles.flash, flashStyle]} pointerEvents="none" />
          <Animated.View style={[styles.deathTint, deathStyle]} pointerEvents="none" />

          {status === 'playing' ? (
            <Animated.View style={[styles.scoreWrap, scoreStyle]}>
              <Text style={styles.score}>{score}</Text>
            </Animated.View>
          ) : null}

          {status === 'ready' ? (
            <View pointerEvents="none" style={styles.startOverlay}>
              <View style={styles.startCard}>
                <Text style={styles.startTitle}>{copy("card_menu_game")}</Text>
                {birdName ? <Text numberOfLines={1} style={styles.birdName}>{birdName}</Text> : null}
                <Text style={styles.startSub}>{copy("ui_copy_164")}</Text>
                <View style={styles.startDivider} />
                <View style={styles.startChip}>
                  <Text style={styles.startChipVal}>{highScore}</Text>
                </View>
              </View>
            </View>
          ) : null}

          {status === 'dead' ? (
            <View pointerEvents="none" style={styles.deathOverlay}>
              <View style={styles.deathCard}>
                <Text style={styles.deathTitle}>{copy("ui_copy_165")}</Text>
                <View style={styles.deathDivider} />
                <View style={styles.deathScores}>
                  <View style={styles.deathScoreItem}>
                    <Text style={styles.deathLabel}>Score</Text>
                    <Text style={styles.deathVal}>{score}</Text>
                  </View>
                  <View style={styles.deathScoreDivider} />
                  <View style={styles.deathScoreItem}>
                    <Text style={styles.deathLabel}>{copy("ui_copy_166")}</Text>
                    <Text style={[styles.deathVal, styles.bestScore]}>{highScore}</Text>
                  </View>
                </View>
                {score >= highScore && score > 0 ? (
                  <View style={styles.newBadge}><Text style={styles.newBadgeText}>{copy("ui_copy_167")}</Text></View>
                ) : null}
                <Text style={styles.restartHint}>{copy("ui_copy_168")}</Text>
              </View>
            </View>
          ) : null}
        </View>
      </GestureDetector>

      <Pressable
        accessibilityLabel={copy("ui_copy_169")}
        accessibilityRole="button"
        hitSlop={10}
        onPress={() => router.back()}
        style={[styles.close, { top: insets.top + 8 }]}
      >
        <Text style={styles.closeText}>×</Text>
      </Pressable>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  canvas: { flex: 1 },
  close: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    left: 16,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 7,
    width: 44,
  },
  closeText: { color: '#1F2937', fontSize: 30, fontWeight: '500', lineHeight: 32 },
  flash: { ...StyleSheet.absoluteFill, backgroundColor: '#FFF' },
  deathTint: { ...StyleSheet.absoluteFill, backgroundColor: '#FF0000' },
  scoreWrap: { alignSelf: 'center', position: 'absolute', top: 70 },
  score: {
    color: '#FFF',
    fontSize: 56,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 6,
  },
  startOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingBottom: 120 },
  startCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 28,
    gap: 8,
    paddingHorizontal: 48,
    paddingVertical: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
  },
  startTitle: { color: '#1F2937', fontSize: 32, fontWeight: '900', letterSpacing: -1 },
  birdName: { color: '#6B7280', fontSize: 14, fontWeight: '700', maxWidth: 220 },
  startSub: { color: '#9CA3AF', fontSize: 16, fontWeight: '600' },
  startDivider: { backgroundColor: '#FFD93D', borderRadius: 2, height: 3, marginVertical: 6, width: 40 },
  startChip: { backgroundColor: '#FFF8E1', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6 },
  startChipVal: { color: '#F59E0B', fontSize: 16, fontWeight: '800' },
  deathOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  deathCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 28,
    gap: 10,
    minWidth: 240,
    paddingHorizontal: 44,
    paddingVertical: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
  },
  deathTitle: { color: '#EF4444', fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  deathDivider: { backgroundColor: '#EF4444', borderRadius: 2, height: 3, opacity: 0.3, width: 36 },
  deathScores: { alignItems: 'center', flexDirection: 'row' },
  deathScoreItem: { alignItems: 'center', gap: 2, paddingHorizontal: 24 },
  deathScoreDivider: { backgroundColor: '#E5E7EB', height: 36, width: 1 },
  deathLabel: { color: '#9CA3AF', fontSize: 12, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  deathVal: { color: '#111827', fontSize: 32, fontVariant: ['tabular-nums'], fontWeight: '900' },
  bestScore: { color: '#FFD93D' },
  newBadge: { backgroundColor: '#FEF3C7', borderColor: '#FDE68A', borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 4 },
  newBadgeText: { color: '#F59E0B', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  restartHint: { color: '#9CA3AF', fontSize: 14, fontWeight: '600', marginTop: 2 },
});
