// Le détourage, là où il a eu lieu : sur la photo.
//
// Transcription du rituel de « Make it Bloom » (analysé image par image, 60fps) :
//
//   1. La photo figée tient l'écran. (Le voile de flash blanc de la référence
//      a été retiré : là-bas il masque un changement de scène, ici la photo est
//      DÉJÀ à l'écran — le gel du capteur l'a posée — donc l'éclair ne cachait
//      rien et blanchissait l'animal une demi-seconde pour rien.)
//   2. Le FOND s'assombrit et se floute progressivement — pas le sujet. Le
//      sujet, lui, se redessine avec son liseré blanc à sa position EXACTE
//      dans la photo, et grossit d'un souffle : décollé du papier (~450 ms).
//   3. La photo sombre s'efface ; le sticker est la seule chose qui reste.
//   4. Il vole en ressort vers son point d'attente au-dessus de la carte.
//
// L'arrivée est `strikeWaitRect` — le rect où `CardStrike` fait flotter le
// sujet en attendant BioCLIP. Même image, même rect, mêmes constantes : le
// passage de ce composant au rituel de la carte est un échange de deux pixels
// identiques, pas une coupe.
//
// Remplace l'explosion de pixels WebGPU : la photo ne se désintègre plus, elle
// s'éteint derrière l'animal — c'est l'animal qu'on regarde.

import { strikeWaitRect } from '@/components/cards/card-strike';
import { CARD_RATIO } from '@/components/cards/holo-card';
import { containIn, stickerFrameIn, type Rect } from '@/lib/animals/lift-reveal-geometry';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { StickerSubjectBounds } from 'subject-lift';

/** Le voile du déclencheur retombe pendant que la photo se pose. */
/** Montée du fond sombre + pop du liseré. */
const DIM_MS = 450;
/** Lancé, pas glissé — un peu de dépassement à l'arrivée. */
const FLIGHT_SPRING = { damping: 15, mass: 0.9, stiffness: 120 };
/** Souffle du décollage : le sujet se soulève du papier. */
const POP_SCALE = 1.06;
/**
 * La vibration d'attente, sur la photo. Mêmes courbes que la frappe de la
 * carte (`card-strike`) : montée lente vers un plateau qui respire, amplitude
 * au carré pour que l'attente soit un frémissement et jamais une panne.
 */
const IDLE_CHARGE = 0.34;
const IDLE_PEAK = 0.55;
const RAMP_MS = 2100;
const BREATH_MS = 1150;

export function SubjectLiftReveal({
  cardWidth,
  onComplete,
  originalUri,
  ready,
  stageWidth,
  stickerUri,
  subjectBounds,
  subjectUri,
}: {
  /** La carte que `CardStrike` affichera ensuite — fixe la cible du vol. */
  cardWidth: number;
  onComplete: () => void;
  originalUri: string;
  /**
   * L'identification est tombée. C'est ELLE qui déclenche le départ : toute
   * l'attente se passe ici, sur la photo — le sticker y frémit à sa place,
   * dans son décor, et ne s'envole que pour aller frapper la carte. Pas de
   * page noire intermédiaire.
   */
  ready: boolean;
  /** Largeur allouée à la photo figée, centrée sur la carte. */
  stageWidth: number;
  /** Null tant que Vision travaille — la photo attend, nette. */
  stickerUri: string | null;
  subjectBounds: StickerSubjectBounds | null;
  /** Le sujet sans liseré : le point de départ du fondu vers le sticker. */
  subjectUri: string | null;
}) {
  const cardHeight = cardWidth / CARD_RATIO;

  // La photo, centrée sur le centre de la carte, en coordonnées carte.
  const aspect =
    subjectBounds && subjectBounds.imageHeight > 0
      ? subjectBounds.imageWidth / subjectBounds.imageHeight
      : 3 / 4;
  const photoHeight = Math.min(stageWidth / aspect, cardHeight * 1.5);
  const photoWidth = photoHeight * aspect;
  const photoRect: Rect = {
    height: photoHeight,
    width: photoWidth,
    x: (cardWidth - photoWidth) / 2,
    y: (cardHeight - photoHeight) / 2,
  };

  // Départ : le sticker posé sur son sujet dans la photo. Arrivée : le même
  // PNG en `contain` dans le rect d'attente du CardStrike. Le conteneur animé
  // a le ratio du PNG, donc aucune déformation entre les deux.
  const from = subjectBounds ? stickerFrameIn(photoRect, subjectBounds) : photoRect;
  const to = containIn(strikeWaitRect(cardWidth), from.width / from.height);

  const dim = useSharedValue(0);
  const outline = useSharedValue(0);
  const flight = useSharedValue(0);
  const charge = useSharedValue(0);
  const clock = useSharedValue(0);

  useEffect(() => {
    if (!stickerUri) return;
    // Le fond s'éteint, le liseré s'allume — le détourage a lieu SOUS les yeux.
    dim.set(withTiming(1, { duration: DIM_MS, easing: Easing.inOut(Easing.quad) }));
    outline.set(
      withSequence(
        withTiming(1, { duration: DIM_MS * 0.8, easing: Easing.out(Easing.quad) }),
        withSpring(1, { damping: 12, stiffness: 200 }),
      ),
    );
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    // Puis le frémissement d'attente, sur place, dans la photo : une horloge
    // libre pour le bruit, une charge qui monte et respire.
    clock.set(withRepeat(withTiming(600, { duration: 600_000, easing: Easing.linear }), -1));
    charge.set(
      withDelay(
        DIM_MS,
        withSequence(
          withTiming(IDLE_CHARGE, { duration: RAMP_MS, easing: Easing.in(Easing.quad) }),
          withRepeat(
            withTiming(IDLE_PEAK, { duration: BREATH_MS, easing: Easing.inOut(Easing.sin) }),
            -1,
            true,
          ),
        ),
      ),
    );
    return () => {
      cancelAnimation(clock);
      cancelAnimation(charge);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- séquence unique, déclenchée par l'arrivée du sticker
  }, [stickerUri]);

  // Le départ : uniquement quand l'identification est là. Le tremblement
  // meurt, le sticker est lancé vers son point de frappe.
  useEffect(() => {
    if (!ready || !stickerUri) return;
    cancelAnimation(charge);
    charge.set(withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) }));
    flight.set(
      withSpring(1, FLIGHT_SPRING, (finished) => {
        if (finished) scheduleOnRN(onComplete);
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- le vol ne part qu'une fois
  }, [ready, stickerUri]);

  const photoStyle = useAnimatedStyle(() => ({
    // La photo nette s'en va avec le vol : quand l'animal part, il ne reste
    // rien à quitter.
    opacity: 1 - flight.get(),
  }));
  const dimStyle = useAnimatedStyle(() => ({
    opacity: dim.get() * (1 - flight.get()),
  }));

  const subjectStyle = useAnimatedStyle(() => {
    const f = flight.get();
    const t = clock.get();
    // Le frémissement s'éteint dès que le vol commence — on ne tremble pas en
    // l'air. Au carré : l'attente est un frisson, pas une panne.
    const shake = charge.get() * (1 - Math.min(1, f * 2.4));
    const amplitude = shake * shake * 5.5;
    const scale =
      interpolate(outline.get(), [0, 1], [1, POP_SCALE]) * interpolate(f, [0, 1], [1, to.width / from.width]);
    return {
      opacity: stickerUri ? 1 : 0,
      transform: [
        {
          translateX:
            interpolate(f, [0, 1], [0, to.x + to.width / 2 - (from.x + from.width / 2)]) +
            (Math.sin(t * 47) + Math.sin(t * 23.3) * 0.6) * amplitude,
        },
        {
          translateY:
            interpolate(f, [0, 1], [0, to.y + to.height / 2 - (from.y + from.height / 2)]) +
            (Math.cos(t * 41) + Math.sin(t * 29.7) * 0.5) * amplitude,
        },
        { scale },
        // Un rien d'inclinaison en vol — jeté, pas téléporté — et le frisson
        // d'attente sur le même canal.
        { rotate: `${Math.sin(f * Math.PI) * -4 + Math.sin(t * 19) * shake * 1.4}deg` },
      ],
    };
  });
  // Le sujet nu fond vers sa version à liseré : le trait blanc APPARAÎT.
  const bareStyle = useAnimatedStyle(() => ({ opacity: 1 - outline.get() }));
  const cutStyle = useAnimatedStyle(() => ({ opacity: outline.get() }));

  return (
    <View style={{ height: cardHeight, width: cardWidth }}>
      <Animated.View
        style={[
          styles.photo,
          {
            borderRadius: 24,
            height: photoRect.height,
            left: photoRect.x,
            top: photoRect.y,
            width: photoRect.width,
          },
          photoStyle,
        ]}
      >
        <Image contentFit="cover" source={{ uri: originalUri }} style={styles.fill} />
        {/* Le fond qui s'éteint : la même photo, floutée et assombrie, montée
            en fondu par-dessus la nette. Le sticker, posé au-dessus, est la
            seule chose que l'obscurité ne touche pas. */}
        <Animated.View style={[StyleSheet.absoluteFill, dimStyle]}>
          <Image
            blurRadius={22}
            contentFit="cover"
            source={{ uri: originalUri }}
            style={styles.fill}
          />
          <View style={styles.shade} />
        </Animated.View>
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.sticker,
          { height: from.height, left: from.x, top: from.y, width: from.width },
          subjectStyle,
        ]}
      >
        {subjectUri ? (
          <Animated.View style={[StyleSheet.absoluteFill, bareStyle]}>
            <Image contentFit="fill" source={{ uri: subjectUri }} style={styles.fill} />
          </Animated.View>
        ) : null}
        {stickerUri ? (
          <Animated.View style={[StyleSheet.absoluteFill, cutStyle]}>
            <Image contentFit="fill" source={{ uri: stickerUri }} style={styles.fill} />
          </Animated.View>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {
    position: 'absolute',
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  shade: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(5, 6, 10, 0.62)',
  },
  sticker: {
    position: 'absolute',
  },
});
