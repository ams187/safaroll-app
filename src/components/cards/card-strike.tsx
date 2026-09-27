import {
  Canvas,
  Group,
  Image as SkiaImage,
  LinearGradient,
  Mask,
  Morphology,
  Paint,
  RadialGradient,
  Rect,
  useImage,
} from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';
import type { Rarity } from '@/lib/animals/rarity';
import { RARITY_ORDER } from '@/lib/animals/rarity';
import { trackCaptureOutcome } from '@/lib/onesignal';
import { revealBurst, useRevealTremor } from '@/lib/reveal-haptics';
import { CARD_RATIO, cardMetrics, portraitRectFor } from './holo-card';

/** How big the animal floats while it waits, relative to its landing rect. */
const WAIT_SCALE = 1.44;
/**
 * How high above its landing rect it hovers, in card heights. The portrait rect
 * already sits at the card's optical centre, so without this the "landing"
 * would be a pure zoom with no travel — and travel is the whole impact.
 */
const HOVER_RISE = 0.13;

/**
 * Where the waiting animal actually floats, in card coordinates. Exported for
 * the capture reveal: the sticker flies OUT of the photo and lands exactly on
 * this rect, so the hand-over to this component is a swap of two identical
 * pixels — computed from the same constants, so the two stages cannot drift.
 */
export function strikeWaitRect(width: number) {
  const height = width / CARD_RATIO;
  const portrait = portraitRectFor(width);
  const waitOffset = height / 2 - (portrait.y + portrait.height / 2) - height * HOVER_RISE;
  const waitWidth = portrait.width * WAIT_SCALE;
  const waitHeight = portrait.height * WAIT_SCALE;
  return {
    height: waitHeight,
    width: waitWidth,
    x: portrait.x + portrait.width / 2 - waitWidth / 2,
    y: portrait.y + portrait.height / 2 + waitOffset - waitHeight / 2,
  };
}
/** Canvas overscan around the subject — room for the rim and the halo. */
const PAD = 0.34;

/**
 * The wait has no known end (BioCLIP takes as long as it takes), so the charge
 * climbs to a plateau and then breathes there instead of pinning at maximum
 * and going numb. The last surge is what says "now".
 */
const IDLE_CHARGE = 0.34;
const IDLE_PEAK = 0.55;
const RAMP_MS = 2100;
const BREATH_MS = 1150;
const SURGE_MS = 220;

/** Heavy and slightly underdamped: the animal is thrown, not eased. */
const STRIKE_SPRING = { damping: 12, mass: 0.85, stiffness: 135 };
/** How long the spring needs to stop ringing after contact. */
const SETTLE_MS = 520;
/**
 * Where the flying subject has fully landed. The card reaches full opacity at
 * 0.52, so the hand-over has to happen here — the two are only ever allowed to
 * be on screen together while they occupy the exact same rect.
 */
const LANDED = 0.56;
/** Haptic resolution over the 0→1 charge. */
const TREMOR_STEPS = 24;

/**
 * The moment the app is built around: an animal becomes a card.
 *
 * Instead of a generic card back hiding the result, the animal the player just
 * lifted floats alone in the dark, its own silhouette scanned by a travelling
 * light, trembling harder and harder — with a real continuous vibration locked
 * to the same shared value, so the phone and the picture shake as one thing.
 * When the identification lands, the tremor surges, the animal is thrown at the
 * viewer and slammed down onto its portrait rect; the card materialises under
 * the impact, already holographic, and a shockwave leaves the point of contact.
 *
 * The flying subject and the subject printed on the card are the same image, so
 * the landing is pure geometry: it arrives exactly on `portraitRectFor(width)`
 * and cross-fades into the card's own copy over the last frames.
 */
export function CardStrike({
  accent,
  armed = true,
  celebrate = true,
  children,
  onLanded,
  rarity,
  revealed,
  subjectUri,
  width,
}: {
  /** The animal's own colour — everything in the ritual is lit with it. */
  accent: string;
  /**
   * False while something else still owns the screen — the sealed booster. The
   * charge, the tremor and the vibration are the ritual; running them behind a
   * pack the player hasn't opened yet means the phone buzzes at nothing.
   */
  armed?: boolean;
  /** False for a failed identification: the card arrives, nothing cheers. */
  celebrate?: boolean;
  /** The finished card, drawn under the impact. */
  children: React.ReactNode;
  /** Fires once at the instant of contact. */
  onLanded?: () => void;
  rarity?: Rarity;
  /** The identification is in — strike. */
  revealed: boolean;
  /** The die-cut animal (or the raw photo if the lift found no subject). */
  subjectUri: string | null;
  width: number;
}) {
  const height = width / CARD_RATIO;
  const portrait = useMemo(() => portraitRectFor(width), [width]);
  // Where the subject hovers: above the card's optical centre, so it reads as
  // floating in the void rather than pre-placed on a plate it can't see.
  const waitOffset =
    height / 2 - (portrait.y + portrait.height / 2) - height * HOVER_RISE;

  const charge = useSharedValue(0);
  const strike = useSharedValue(0);
  const clock = useSharedValue(0);
  const tremor = useRevealTremor();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!armed) return;
    if (reduceMotion) {
      charge.set(0);
      return;
    }
    // A free-running seconds clock: the tremor noise and the scan sweep both
    // read it, so they never restart or pop when the charge changes.
    clock.set(withRepeat(withTiming(600, { duration: 600_000, easing: Easing.linear }), -1));
    charge.set(
      withSequence(
        withTiming(IDLE_CHARGE, { duration: RAMP_MS, easing: Easing.in(Easing.quad) }),
        withRepeat(
          withTiming(IDLE_PEAK, { duration: BREATH_MS, easing: Easing.inOut(Easing.sin) }),
          -1,
          true,
        ),
      ),
    );
    return () => {
      cancelAnimation(clock);
      cancelAnimation(charge);
    };
  }, [armed, charge, clock, reduceMotion]);

  useEffect(() => {
    if (!revealed) return;
    cancelAnimation(charge);
    if (reduceMotion) {
      charge.set(0);
      strike.set(withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }));
      return;
    }
    if (!celebrate) {
      // Nothing to celebrate: the tremor just dies and the card settles in.
      charge.set(withTiming(0, { duration: 420, easing: Easing.out(Easing.quad) }));
      strike.set(withDelay(120, withTiming(1, { duration: 560, easing: Easing.out(Easing.cubic) })));
      return;
    }
    charge.set(
      withSequence(
        withTiming(1, { duration: SURGE_MS, easing: Easing.in(Easing.quad) }),
        withTiming(0, { duration: 280, easing: Easing.out(Easing.quad) }),
      ),
    );
    strike.set(withDelay(SURGE_MS, withSpring(1, STRIKE_SPRING)));
  }, [celebrate, charge, reduceMotion, revealed, strike]);

  // Le moteur haptique est un lecteur CoreHaptics CONTINU : il vit dans le
  // système, pas dans ce composant, et il survit donc au démontage. Sans cet
  // arrêt, tout ce qui retire la carte pendant l'attente — quitter l'écran,
  // ou l'écran « rien de vivant ici » qui remplace le rituel — laissait le
  // téléphone vibrer indéfiniment, sans plus rien à l'écran pour le couper.
  //
  // Séparé du `useEffect` de la charge, qui se rejoue à chaque bascule
  // d'`armed` : ici on ne veut QUE le démontage. Et `scheduleOnUI` parce que
  // `stop` est un worklet — le lecteur appartient au thread UI.
  useEffect(() => () => scheduleOnUI(tremor.stop), [tremor]);

  const land = useCallback(() => {
    if (!celebrate) return;
    revealBurst(rarity);
    // LA MESURE SE POSE À L'INSTANT DE LA CARTE, PAS À L'OUVERTURE DE L'APP.
    //
    // OneSignal attribue l'outcome à la notification reçue dans la fenêtre en
    // cours : nommé ici, il répond à la seule question qui vaille — le message
    // a-t-il fait SORTIR quelqu'un ? Une ouverture ne prouve rien ; une carte
    // qui naît, si. La rareté part avec, parce que deux rappels qui ramènent
    // autant de joueurs ne se valent pas si l'un ne produit que du commun.
    trackCaptureOutcome(rarity ? RARITY_ORDER.indexOf(rarity) + 1 : 0);
    // Deliberately after the card has settled: anything that snapshots the
    // screen from here would otherwise catch the print flash at full white,
    // and mounting it in the impact frame is what made the reveal stutter.
    setTimeout(() => onLanded?.(), SETTLE_MS);
  }, [celebrate, onLanded, rarity]);

  // Contact, not launch: the card appears when the animal actually hits it.
  useAnimatedReaction(
    () => strike.get() >= 0.5,
    (landed, previous) => {
      if (landed && previous === false) runOnJS(land)();
    },
  );

  // The vibration follows the same value as the shake, quantised so the
  // expo-haptics fallback isn't asked for a tap per frame. `-1` is the release:
  // the engine is cut the instant the animal is thrown, which also stops the
  // charge's own decay from restarting it and leaving it humming forever.
  useAnimatedReaction(
    () => (!armed || strike.get() > 0 ? -1 : Math.round(charge.get() * TREMOR_STEPS)),
    (step, previous) => {
      if (step === previous) return;
      if (step < 0) tremor.stop();
      else tremor.set(step / TREMOR_STEPS);
    },
  );

  const subjectStyle = useAnimatedStyle(() => {
    const t = clock.get();
    const s = strike.get();
    // The tremor is released the instant the animal is thrown.
    // The flight finishes at LANDED, not at 1: the card underneath is already
    // fully opaque by then, and any later would leave the flying copy hanging
    // over the card's own printed subject — two stickers, slightly offset.
    const flight = Math.min(1, s / LANDED);
    const shake = charge.get() * (1 - Math.min(1, s * 2.4));
    // Squared, so the wait is a barely-there quiver and only the final surge
    // actually shakes. A flat ramp read as "the app is broken".
    const amplitude = shake * shake * 5.5;
    return {
      // Hands over inside the window where it and the card are both in place.
      opacity: interpolate(s, [0, LANDED * 0.86, LANDED], [1, 1, 0], Extrapolation.CLAMP),
      transform: reduceMotion
        ? [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }, { rotate: '0deg' }]
        : [
            { translateX: (Math.sin(t * 47) + Math.sin(t * 23.3) * 0.6) * amplitude },
            {
              translateY:
                waitOffset * (1 - flight) +
                (Math.cos(t * 41) + Math.sin(t * 29.7) * 0.5) * amplitude,
            },
            // Thrown at the viewer on the way out, then driven down onto the card.
            {
              scale: interpolate(
                flight,
                [0, 0.55, 1],
                [WAIT_SCALE, WAIT_SCALE * 1.16, 1],
                Extrapolation.CLAMP,
              ),
            },
            { rotate: `${Math.sin(t * 19) * shake * 1.4}deg` },
          ],
    };
  });

  const cardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(strike.get(), [0.16, 0.52], [0, 1], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(strike.get(), [0.16, 1], [0.88, 1], Extrapolation.CLAMP) },
    ],
  }));

  // The print flash — the card doesn't fade in, it is struck into existence.
  const flashStyle = useAnimatedStyle(() => ({
    opacity: interpolate(strike.get(), [0.2, 0.44, 0.82], [0, 0.85, 0], Extrapolation.CLAMP),
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(strike.get(), [0.42, 0.54, 1], [0, 0.7, 0], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(strike.get(), [0.42, 1], [0.2, 2.2], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <View style={{ height, width }}>
      <Animated.View style={[StyleSheet.absoluteFill, cardStyle]}>{children}</Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.flash,
          { borderRadius: cardMetrics(width).radius },
          flashStyle,
        ]}
      />

      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            borderColor: accent,
            borderRadius: portrait.width,
            height: portrait.width,
            left: portrait.x + portrait.width / 2 - portrait.width / 2,
            top: portrait.y + portrait.height / 2 - portrait.width / 2,
            width: portrait.width,
          },
          ringStyle,
        ]}
      />

      <Animated.View
        pointerEvents="none"
        style={[
          {
            height: portrait.height,
            left: portrait.x,
            position: 'absolute',
            top: portrait.y,
            width: portrait.width,
          },
          subjectStyle,
        ]}
      >
        <SubjectScan
          accent={accent}
          charge={charge}
          clock={clock}
          height={portrait.height}
          uri={subjectUri}
          width={portrait.width}
        />
      </Animated.View>

    </View>
  );
}

/**
 * The animal, plus a light travelling around its true silhouette — the rim is
 * a dilation of the die-cut alpha with the animal punched back out, so the
 * outline is the creature's own shape rather than a decorative loop. The halo
 * behind it and the sweep speed both ride the charge, which is why the wait
 * visibly tightens instead of looping.
 */
function SubjectScan({
  accent,
  charge,
  clock,
  height,
  uri,
  width,
}: {
  accent: string;
  charge: SharedValue<number>;
  clock: SharedValue<number>;
  height: number;
  uri: string | null;
  width: number;
}) {
  const image = useImage(uri ?? undefined);
  const padX = width * PAD;
  const padY = height * PAD;
  const canvasWidth = width + padX * 2;
  const canvasHeight = height + padY * 2;

  // A band of light running down the silhouette, quicker as the charge climbs.
  const sweepStart = useDerivedValue(() => {
    const phase = (clock.get() * (0.32 + charge.get() * 1.1)) % 1;
    return { x: 0, y: -canvasHeight + phase * canvasHeight * 2.2 };
  });
  const sweepEnd = useDerivedValue(() => ({
    x: canvasWidth,
    y: sweepStart.get().y + canvasHeight * 0.7,
  }));
  const rimPaint = useDerivedValue(() => 0.3 + charge.get() * 0.7);
  const haloPaint = useDerivedValue(() => 0.18 + charge.get() * 0.42);

  if (!image) return null;
  const stamp = {
    fit: 'contain' as const,
    height,
    image,
    width,
    x: padX,
    y: padY,
  };

  return (
    <Canvas
      style={{
        height: canvasHeight,
        left: -padX,
        position: 'absolute',
        top: -padY,
        width: canvasWidth,
      }}
    >
      <Group layer={<Paint opacity={haloPaint} />}>
        <Rect x={0} y={0} width={canvasWidth} height={canvasHeight}>
          <RadialGradient
            c={{ x: canvasWidth / 2, y: canvasHeight / 2 }}
            r={canvasWidth * 0.52}
            colors={[`${accent}aa`, `${accent}22`, `${accent}00`]}
          />
        </Rect>
      </Group>

      {/* Isolated layer: the dstOut below must eat the rim, not the halo. */}
      <Group layer={<Paint opacity={rimPaint} />}>
        <Mask
          mode="alpha"
          mask={
            <SkiaImage {...stamp}>
              <Morphology operator="dilate" radius={3} />
            </SkiaImage>
          }
        >
          <Rect x={0} y={0} width={canvasWidth} height={canvasHeight}>
            <LinearGradient
              start={sweepStart}
              end={sweepEnd}
              colors={[`${accent}00`, accent, '#ffffff', accent, `${accent}00`]}
            />
          </Rect>
        </Mask>
        <Group layer={<Paint blendMode="dstOut" />}>
          <SkiaImage {...stamp} />
        </Group>
      </Group>

      <SkiaImage {...stamp} />
    </Canvas>
  );
}

const styles = StyleSheet.create({
  flash: { backgroundColor: '#ffffff' },
  ring: {
    borderWidth: 2,
    position: 'absolute',
  },
});
