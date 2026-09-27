import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { cancelAnimation, Easing, Extrapolation, interpolate, useAnimatedReaction,
  useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import type { CardStrike } from './card-strike';
import { CARD_RATIO, cardMetrics } from './holo-card';
import { DISCOVERY_DURATION, discoveryAngle } from './discovery-motion';
import { revealBurst, useRevealTremor } from '@/lib/reveal-haptics';
import { RARITY_ORDER } from '@/lib/animals/rarity';
import { trackCaptureOutcome } from '@/lib/onesignal';

type Props = ComponentProps<typeof CardStrike>;

export function CardReveal({ discovery, ...props }: Props & { discovery: boolean }) {
  // A background collection refresh must never replace/restart a reveal in flight.
  const [firstDiscovery] = useState(discovery);
  const reduceMotion = useReducedMotion();
  return firstDiscovery && props.celebrate && !reduceMotion
    ? <DiscoveryReveal {...props} />
    : <StaticReveal {...props} />;
  // Ancien impact désactivé : <CardStrike {...props} />
}

function StaticReveal({ children, width, revealed, onLanded }: Props) {
  const delivered = useRef(false);
  useEffect(() => {
    if (!revealed || delivered.current) return;
    delivered.current = true;
    onLanded?.();
  }, [revealed, onLanded]);
  return <View style={{ width, height: width / CARD_RATIO }}>{children}</View>;
}

function DiscoveryReveal({ children, width, rarity, onLanded }: Props) {
  const time = useSharedValue(0);
  const tremor = useRevealTremor();
  const [settled, setSettled] = useState(false);
  const delivered = useRef(false);
  const mounted = useRef(false);
  const callback = useRef(onLanded);
  useEffect(() => { callback.current = onLanded; }, [onLanded]);
  const finish = useCallback(() => {
    if (!mounted.current || delivered.current) return;
    delivered.current = true;
    setSettled(true);
    callback.current?.();
  }, []);
  const burst = useCallback(() => {
    if (!mounted.current) return;
    revealBurst(rarity);
    trackCaptureOutcome(rarity ? RARITY_ORDER.indexOf(rarity) + 1 : 0);
  }, [rarity]);

  useEffect(() => {
    mounted.current = true;
    time.set(0);
    time.set(withTiming(DISCOVERY_DURATION, { duration: DISCOVERY_DURATION, easing: Easing.linear }, finished => {
      if (finished) scheduleOnRN(finish);
    }));
    return () => { mounted.current = false; cancelAnimation(time); scheduleOnUI(tremor.stop); };
  }, [finish, time, tremor]);
  useAnimatedReaction(() => discoveryAngle(time.get()) >= 90, (visible, previous) => {
    if (visible && previous === false) scheduleOnRN(burst);
  });
  useAnimatedReaction(() => time.get() < 600 ? Math.round(time.get() / 600 * 12) : -1, (level, previous) => {
    if (level === previous) return;
    if (level < 0) tremor.stop(); else tremor.set(level / 12);
  });

  const plane = useAnimatedStyle(() => ({
    transform: [
      { rotateZ: `${interpolate(time.get(), [0, 2000, DISCOVERY_DURATION], [-2.55, -2.55, 0], Extrapolation.CLAMP)}deg` },
      { scale: interpolate(time.get(), [0, 600, 1415, 1636, DISCOVERY_DURATION], [1.4, 1, 1, 1.03, 1], Extrapolation.CLAMP) },
      { translateY: interpolate(time.get(), [0, 1415, 1636, DISCOVERY_DURATION], [0, 0, 5, 0], Extrapolation.CLAMP) },
    ],
  }));
  const back = useAnimatedStyle(() => ({
    opacity: discoveryAngle(time.get()) < 90 ? interpolate(time.get(), [0, 600], [0, 1], Extrapolation.CLAMP) : 0,
    transform: [{ perspective: 900 }, { rotateY: `${discoveryAngle(time.get())}deg` }],
  }));
  const front = useAnimatedStyle(() => ({
    opacity: discoveryAngle(time.get()) >= 90 ? 1 : 0,
    transform: [{ perspective: 900 }, { rotateY: `${discoveryAngle(time.get()) - 180}deg` }],
  }));
  const height = width / CARD_RATIO;
  const radius = cardMetrics(width).radius;
  return <View style={{ width, height }}>
    <Animated.View style={[StyleSheet.absoluteFill, plane]}>
      {!settled && <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[StyleSheet.absoluteFill, styles.back, { borderRadius: radius }, back]}>
        <Image source={require('../../../assets/cards/safaroll-back.webp')} contentFit="cover"
          transition={0} style={StyleSheet.absoluteFill} />
      </Animated.View>}
      <Animated.View pointerEvents={settled ? 'auto' : 'none'} accessibilityElementsHidden={!settled}
        importantForAccessibility={settled ? 'auto' : 'no-hide-descendants'} style={[StyleSheet.absoluteFill, front]}>
        {children}
      </Animated.View>
    </Animated.View>
  </View>;
}

const styles = StyleSheet.create({
  back: { overflow: 'hidden', backfaceVisibility: 'hidden' },
});
