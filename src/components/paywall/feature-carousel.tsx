// LE CARROUSEL DE FONCTIONNALITÉS DU PAYWALL.
//
// Le tableau comparatif dit CE QU'ON A ; ce carrousel dit CE QUE ÇA FAIT. Les
// deux sont nécessaires et ne se remplacent pas : une ligne « Accès à la map »
// dans une colonne se lit en une seconde et ne montre rien, une carte de Londres
// couverte d'animaux épinglés se comprend sans être lue.
//
// LES TEXTES EXISTAIENT DÉJÀ.
//
// Les six clés `paywall_*_title` / `paywall_*_body` étaient dans les deux
// dictionnaires, traduites, et n'étaient AFFICHÉES NULLE PART — écrites pour un
// composant jamais construit. Elles reprennent ici leur rôle plutôt que d'être
// réécrites : `check:i18n` les aurait signalées un jour comme mortes, et on
// aurait supprimé un travail déjà fait.
//
// POURQUOI IL AVANCE TOUT SEUL
//
// Un paywall n'a que quelques secondes. Personne ne balaie six écrans de son
// plein gré avant d'avoir décidé d'acheter — l'avance automatique montre la
// profondeur de l'offre à quelqu'un qui ne fait que regarder. Mais elle
// s'ARRÊTE dès qu'on touche : à partir de là c'est lui qui lit, et lui reprendre
// la main serait le pire moment pour le faire.

import { Image as ExpoImage } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import {
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

const AVANCE_MS = 3600;

type Diapo = {
  key: string;
  /** Une illustration pleine, qui remplit le cadre. */
  illustration?: number;
  /** Ou une rangée d'objets réels, posés au centre. */
  images?: number[];
};

const DIAPOS: Diapo[] = [
  // L'ORDRE SUIT LE TABLEAU COMPARATIF, et les diapos SUIVENT SES LIGNES.
  // Une diapo qui vend ce qui n'est pas dans le tableau — les « notes de
  // terrain », reprises d'un concurrent — promet une fonctionnalité que
  // l'abonnement ne débloque pas.
  { illustration: require('../../../assets/paywall/unlimited.png'), key: 'unlimited' },
  { illustration: require('../../../assets/paywall/guide.png'), key: 'guide' },
  { illustration: require('../../../assets/paywall/map.png'), key: 'map' },
  { illustration: require('../../../assets/paywall/export.png'), key: 'export' },
  {
    // Les VRAIES icônes alternatives, pas une maquette : ce que l'écran promet
    // est exactement ce que les Réglages livreront. D'où une rangée d'objets
    // plutôt qu'une illustration — on montre le produit, pas une évocation.
    images: [
      require('../../../assets/icons/epique.png'),
      require('../../../assets/icons/mythique.png'),
      require('../../../assets/icons/rare.png'),
    ],
    key: 'icons',
  },
  { illustration: require('../../../assets/paywall/badge.png'), key: 'badge' },
  // LE CRÉATEUR SOLO, MIS EN SCÈNE. L'icône de l'app ne racontait rien : elle
  // montrait le produit là où la diapo parle de la PERSONNE qui le fait. Le
  // guépard bricole sa propre app, une figurine de lui-même posée sur l'établi
  // — le fabricant et la chose fabriquée dans le même plan.
  { illustration: require('../../../assets/paywall/support.png'), key: 'support' },
];

function PaginationDot({ active, activeColor, inactiveColor }: {
  active: boolean;
  activeColor: string;
  inactiveColor: string;
}) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.set(withTiming(active ? 1 : 0, { duration: reduceMotion ? 0 : 240 }));
  }, [active, progress, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.get(), [0, 1], [inactiveColor, activeColor]),
    opacity: interpolate(progress.get(), [0, 1], [0.72, 1]),
    width: interpolate(progress.get(), [0, 1], [6, 20]),
  }));

  return <View style={styles.pointSlot}><Animated.View style={[styles.point, animatedStyle]} /></View>;
}

export function FeatureCarousel({ active, width }: { active: boolean; width: number }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const listRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  // Une fois touché, il ne reprend plus la main.
  const [manuel, setManuel] = useState(false);

  useEffect(() => {
    if (!active || manuel) return;
    const minuteur = setInterval(() => {
      setIndex((courant) => {
        const suivant = (courant + 1) % DIAPOS.length;
        listRef.current?.scrollTo({ animated: true, x: suivant * width });
        return suivant;
      });
    }, AVANCE_MS);
    return () => clearInterval(minuteur);
  }, [active, manuel, width]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const vu = Math.round(event.nativeEvent.contentOffset.x / width);
    if (vu !== index) setIndex(vu);
  };

  return (
    // Le rythme vertical du paywall est porté par chaque bloc (le bandeau a son
    // `marginTop: 20`). Sans cette marge le carrousel se collait au tableau.
    <View style={styles.bloc}>
      <ScrollView
        decelerationRate="fast"
        horizontal
        onMomentumScrollEnd={onScroll}
        onScrollBeginDrag={() => setManuel(true)}
        pagingEnabled
        ref={listRef}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
      >
        {DIAPOS.map((diapo) => (
          <View key={diapo.key} style={[styles.diapo, { width }]}>
            <View style={styles.scene}>
              {diapo.illustration ? (
                // `cover` : l'illustration est en 3:2, le cadre plus large.
                // La rogner vaut mieux que laisser deux bandes de fond.
                <ExpoImage
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  source={diapo.illustration}
                  style={styles.illustration}
                />
              ) : (
                <View style={styles.rangee}>
                  {diapo.images!.map((source, i) => (
                    <ExpoImage
                      cachePolicy="memory-disk"
                      contentFit="contain"
                      key={i}
                      source={source}
                      style={diapo.images!.length > 1 ? styles.icone : styles.iconeSeule}
                    />
                  ))}
                </View>
              )}
            </View>
            <Text style={styles.titre}>{t(`paywall_${diapo.key}_title`)}</Text>
            <Text style={styles.corps}>{t(`paywall_${diapo.key}_body`)}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.points}>
        {DIAPOS.map((diapo, i) => (
          <PaginationDot
            active={i === index}
            activeColor={theme.colors.foreground}
            inactiveColor={theme.colors.faint}
            key={diapo.key}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bloc: { marginTop: 26 },
  diapo: { alignItems: 'center', gap: theme.gap(0.75), paddingHorizontal: theme.gap(2.5) },
  scene: {
    alignItems: 'center',
    // LE CADRE PREND LE RATIO DE L'ILLUSTRATION, PAS UNE HAUTEUR FIXE.
    //
    // À hauteur figée (168) le cadre était bien plus large que le 3:2 des
    // images : `cover` remplissait la largeur et rognait le haut et le bas —
    // on perdait la tête du guépard. `contain` aurait laissé deux bandes de
    // fond sur les côtés. En calant le cadre sur 3:2, l'image le remplit
    // exactement : ni rognage, ni bande.
    aspectRatio: 3 / 2,
    // AUCUN FOND. Les illustrations portent déjà le crème de l'app, donc un
    // cadre teinté ne se voyait que derrière la rangée d'icônes — un rectangle
    // gris apparaissant sur une seule diapo, qui donnait l'air d'un bug.
    backgroundColor: 'transparent',
    borderRadius: 22,
    justifyContent: 'center',
    marginBottom: theme.gap(1),
    overflow: 'hidden',
    width: '100%',
  },
  illustration: { borderRadius: 22, height: '100%', width: '100%' },
  rangee: { alignItems: 'center', flexDirection: 'row', gap: theme.gap(1.25) },
  icone: { borderRadius: 16, height: 72, width: 72 },
  iconeSeule: { borderRadius: 24, height: 104, width: 104 },
  titre: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 17,
    textAlign: 'center',
  },
  corps: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: 'center',
  },
  points: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: theme.gap(1.25),
  },
  point: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  pointSlot: { alignItems: 'center', height: 6, justifyContent: 'center', width: 20 },
}));
