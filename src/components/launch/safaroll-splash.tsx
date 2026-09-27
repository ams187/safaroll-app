import { marque } from '@/lib/boot-trace';
import MaskedView from '@react-native-masked-view/masked-view';
import { useAuth } from '@clerk/expo';
import { Asset } from 'expo-asset';
import { Image } from 'expo-image';
import { useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Mask, Rect } from 'react-native-svg';

const faceOpen = require('../../../assets/splash/safaroll-face-open.png');
const faceClosed = require('../../../assets/splash/safaroll-face-closed.png');
const wordmark = require('../../../assets/splash/safaroll-wordmark.png');
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const DURATION = 1233;
const clamp = (value: number) => {
  'worklet';
  return Math.min(1, Math.max(0, value));
};
const segment = (time: number, start: number, end: number) => {
  'worklet';
  return clamp((time - start) / (end - start));
};

/** Duolingo's measured launch motion, wearing SafaRoll's own identity. */
export function SafaRollSplash({ children }: PropsWithChildren) {
  const { isLoaded } = useAuth();
  const segments = useSegments();
  // The root index only redirects and paints nothing. Wait for its destination.
  const destinationMounted = segments.length > 0;
  const started = useRef(false);
  const { height, width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const time = useSharedValue(0);
  const [assetsReady, setAssetsReady] = useState(false);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let mounted = true;
    void Asset.loadAsync([faceOpen, faceClosed, wordmark]).finally(() => {
      if (mounted) setAssetsReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!assetsReady || !isLoaded || !destinationMounted || started.current) return;
    // Let the destination commit before the UI-thread animation can reveal it.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        started.current = true;
        marque('route montée + assets prêts → masquage du splash natif');
        SplashScreen.hide();
        if (reducedMotion) {
          setFinished(true);
          return;
        }
        time.set(withTiming(DURATION, { duration: DURATION, easing: Easing.linear }, (done) => {
          if (done) runOnJS(setFinished)(true);
          if (done) runOnJS(marque)('fin de l’animation de splash');
        }));
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [assetsReady, isLoaded, destinationMounted, reducedMotion, time]);

  const faceStyle = useAnimatedStyle(() => {
    const shrink = Easing.in(Easing.cubic)(segment(time.get(), 900, 1033));
    return {
      opacity: 1 - segment(time.get(), 1133, 1233),
      transform: [{ scale: interpolate(shrink, [0, 1], [1, 0.36]) }],
    };
  });
  const blinkStyle = useAnimatedStyle(() => {
    const close = segment(time.get(), 400, 417);
    const open = 1 - segment(time.get(), 500, 567);
    const shrinkClose = segment(time.get(), 900, 1000);
    return { opacity: Math.max(Math.min(close, open), shrinkClose) };
  });
  const holeProps = useAnimatedProps(() => {
    const reveal = segment(time.get(), 1133, 1233);
    const scale = interpolate(reveal, [0, 0.34, 0.67, 1], [0.01, 2.6, 7.5, 10]);
    return { r: width * 0.125 * scale };
  });
  const visible = !finished;

  return (
    <View style={styles.root}>
      {children}
      {visible ? (
        <MaskedView
          pointerEvents="auto"
          style={StyleSheet.absoluteFill}
          maskElement={
            <Svg height={height} width={width}>
              <Defs>
                <Mask id="safaroll-splash-hole" maskType="luminance">
                  <Rect fill="#fff" height={height} width={width} />
                  <AnimatedCircle
                    animatedProps={holeProps}
                    cx={width / 2}
                    cy={height / 2}
                    fill="#000"
                  />
                </Mask>
              </Defs>
              <Rect
                fill="#fff"
                height={height}
                mask="url(#safaroll-splash-hole)"
                width={width}
              />
            </Svg>
          }
        >
          <View style={styles.splash}>
            <StatusBar style="dark" />
            <Animated.View style={[styles.face, faceStyle]}>
              <Image contentFit="contain" source={faceOpen} style={StyleSheet.absoluteFill} />
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, blinkStyle]}>
                <Image contentFit="contain" source={faceClosed} style={StyleSheet.absoluteFill} />
              </Animated.View>
            </Animated.View>
            <Image contentFit="contain" source={wordmark} style={styles.wordmark} />
          </View>
        </MaskedView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  splash: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#e6dfc4',
  },
  face: {
    position: 'absolute',
    top: '50%',
    marginTop: -115,
    width: 230,
    height: 230,
    transformOrigin: 'center center',
  },
  wordmark: {
    position: 'absolute',
    bottom: '10.5%',
    width: 210,
    height: 70,
  },
});
