import { useTranslation as useUiTranslation } from 'react-i18next';
// La vitrine d'une distinction.
//
// Portage fidèle de `TresorCarousel` + `TresorMorphOverlay` de Bloom. Trois
// choses font l'effet, et il en manquait trois dans la version précédente :
//
//   LE PIVOT      le médaillon tourne sur lui-même au défilement — `rotateY`
//                 de 260° à −360°, en EXTEND. C'est une pièce qu'on fait
//                 rouler, pas une vignette qui s'efface. Un fondu d'opacité,
//                 c'est ce que fait tout le monde ; le pivot, non.
//   LE FOND       il se teinte à la couleur de la distinction regardée, et
//                 GLISSE d'une couleur à l'autre pendant le geste
//                 (`interpolateColor` sur la POSITION, pas sur un index). C'est
//                 ce qui fait que le doigt peint l'écran ; sur l'index, la
//                 couleur sauterait au relâchement.
//   LE VOILE      un aplat sombre par-dessus le fond coloré. Sans lui, la
//                 crème du texte devient illisible sur les teintes claires.
//
// LA VITRINE DÉBORDE PAR LE BAS, ET C'EST VOULU
//
// Elle vit dans une feuille SwiftUI, qui réserve l'encart bas de l'écran et le
// peint avec son `presentationBackground` — du crème. Un `absoluteFill` s'arrête
// donc au-dessus de cet encart et laisse une bande claire sous le voile sombre.
//
// `@expo/ui` n'expose aucun `ignoresSafeArea`, et rien ne clippe les enfants sur
// iOS : la racine descend simplement plus bas que son conteneur. Les couches de
// fond suivent puisqu'elles la remplissent, et la légende se réancre sur le bas
// VISIBLE pour ne pas descendre avec.
//
// LE RAIL EST POSITIONNÉ, JAMAIS CENTRÉ PAR FLEXBOX
//
// La liste est posée en absolu à `TARGET_Y_RATIO`, à la hauteur exacte d'un
// médaillon. C'est ce qui garantit que le clone volant du morph atterrit
// dessus au pixel près — et ça évite le piège des pourcentages, qui se
// résolvent contre la largeur du conteneur de contenu, soit douze écrans.
//
// LA LÉGENDE N'APPARAÎT QUE CENTRÉE
//
// Les douze légendes sont superposées au même endroit ; seule celle de la page
// regardée est visible ET touchable. Sans le `pointerEvents`, c'est toujours la
// dernière rendue qui capterait le toucher du bouton de partage.
//
// VERROUILLÉE, LA DISTINCTION EST NOMMÉE QUAND MÊME
//
// Sa silhouette est déjà là, en noir et blanc, avec son seuil écrit dessus :
// cacher son nom se contredirait à l'écran. Ce qui reste caché, c'est
// l'accomplissement — remplacé par ce qu'il reste à faire.

import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

import { QuestBadge } from '@/components/challenges/quest-badge';
import { badgeArt } from '@/lib/animals/badge-art';
import { BADGE_FIELD } from '@/lib/animals/badge-colors';
import type { BadgeState } from '@/lib/animals/badges';
import { translate } from '@/i18n';
import { useBadgeShare } from './badge-share-card';
import {
  FLOATING_SIZE,
  TARGET_Y_RATIO,
  VITRINE_SIZE,
  type MorphAnimation,
  type Origine,
} from './use-badge-morph';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Marge verticale autour du médaillon dans le rail. */
const RAIL_PADDING_V = 34;

/** La brume d'une distinction pas encore méritée — jamais sa vraie couleur. */
const BRUME = '#2A2419';

const CREME = '#FFFBF0';

/**
 * Le fond de la page : l'aplat EXACT peint dans l'illustration.
 *
 * Pris plein, il ferait fondre le médaillon dans son propre fond — d'où le
 * voile sombre posé par-dessus, qui le ramène d'un cran. Le résultat est donc
 * EN LIEN avec l'écusson sans jamais être sa couleur : la page est visiblement
 * violette pour le flair, ambrée pour l'ampleur, verte pour les insectes, mais
 * toujours plus sourde que le disque au centre.
 *
 * C'est un seul assombrissement, pas deux. Une première version prenait déjà
 * une teinte rabattue vers l'encre PUIS lui appliquait le voile : la couleur
 * n'y survivait pas, et douze distinctions rendaient douze gris.
 *
 * Verrouillée, la distinction n'a pas droit à sa couleur — la couleur EST la
 * récompense.
 */
const couleurDe = (badge: BadgeState) => (badge.earned ? BADGE_FIELD[badge.key] ?? BRUME : BRUME);

/**
 * Ce que la distinction demande, en une phrase.
 *
 * Dérivée de la famille plutôt qu'écrite douze fois : le seuil est déjà la
 * seule variable, et une table de textes se désynchroniserait du barème au
 * premier réglage.
 */
export function describeBadge(badge: BadgeState): string {
  if (badge.family === 'ampleur') {
    return translate('badge_description_collection', { count: badge.threshold });
  }
  if (badge.family === 'flair') {
    return translate('badge_description_rare', { count: badge.threshold });
  }
  return translate(`badge_description_${badge.key.split('-')[1]}`, { count: badge.threshold });
}

export function BadgeVitrine({
  animation,
  badges,
  onClose,
  origine,
  selection,
}: {
  animation: MorphAnimation;
  badges: BadgeState[];
  onClose: () => void;
  origine: Origine;
  selection: BadgeState | null;
}) {
  const { t: copy } = useUiTranslation();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { carte, partager } = useBadgeShare();
  const scrollX = useSharedValue(0);

  // Calculé une fois au montage, pas dans une ref : lire `ref.current` pendant
  // le rendu est interdit, et le composant est REMONTÉ à chaque ouverture (voir
  // la `key` posée par l'écran) — donc l'initialiseur retombe juste.
  const [depart] = useState(() =>
    Math.max(0, badges.findIndex((item) => item.key === selection?.key)),
  );
  const [actif, setActif] = useState(depart);

  // Ce dont la racine dépasse en bas. Généreux : l'encart varie selon l'appareil,
  // et du noir en trop hors écran ne coûte rien, une bande claire se voit.
  const debord = insets.bottom + 48;

  const hauteurRail = VITRINE_SIZE + RAIL_PADDING_V * 2;
  const hautRail = height * TARGET_Y_RATIO - RAIL_PADDING_V - VITRINE_SIZE / 2;

  const couleurs = badges.map(couleurDe);
  const bornes = badges.map((_, index) => index * width);
  const fond = useDerivedValue(() => interpolateColor(scrollX.get(), bornes, couleurs));
  const fondAnime = useAnimatedStyle(() => ({ backgroundColor: fond.get() }));

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.set(event.contentOffset.x);
    },
  });

  const entree = useAnimatedStyle(() => ({ opacity: animation.overlayOpacity.get() }));
  const detail = useAnimatedStyle(() => ({ opacity: animation.detailOpacity.get() }));
  const clone = useAnimatedStyle(() => ({
    // Le clone s'efface une fois la vitrine visible : il est alors exactement
    // sous le médaillon de la page, donc l'échange ne se voit pas.
    opacity: interpolate(animation.detailOpacity.get(), [0.6, 1], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateX: animation.objetTranslateX.get() },
      { translateY: animation.objetTranslateY.get() },
      { scaleX: animation.objetScale.get() },
      { scaleY: animation.objetScale.get() * animation.objetSquashY.get() },
    ],
  }));

  if (!selection) return null;

  return (
    <Animated.View style={[styles.plein, { bottom: -debord }, entree]}>
      <Animated.View pointerEvents="none" style={[RNStyleSheet.absoluteFill, fondAnime]} />
      {/* Le voile assombrit la couleur vive pour que la crème du texte reste
          lisible, y compris sur la savane et l'aube. */}
      <View pointerEvents="none" style={[RNStyleSheet.absoluteFill, styles.voile]} />

      <Animated.View style={[RNStyleSheet.absoluteFill, detail]}>
        <View style={[styles.entete, { paddingTop: insets.top + 8 }]}>
          <Pressable
            accessibilityLabel={copy("reveal_close")}
            accessibilityRole="button"
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              onClose();
            }}
            style={styles.fermer}
          >
            <SymbolView name="chevron.down" size={20} tintColor={CREME} />
          </Pressable>
          <Text style={styles.collection}>{copy("ui_copy_049")}</Text>
        </View>

        <Animated.FlatList
          contentContainerStyle={styles.railContenu}
          data={badges}
          decelerationRate="fast"
          disableIntervalMomentum
          getItemLayout={(_, index) => ({ index, length: width, offset: width * index })}
          horizontal
          initialScrollIndex={depart}
          keyExtractor={(item) => (item as BadgeState).key}
          onMomentumScrollEnd={(event) => {
            const index = Math.round(event.nativeEvent.contentOffset.x / width);
            if (index !== actif) {
              setActif(index);
              void Haptics.selectionAsync().catch(() => undefined);
            }
          }}
          onScroll={onScroll}
          pagingEnabled
          removeClippedSubviews
          renderItem={({ index, item }) => (
            <Medaillon badge={item as BadgeState} index={index} scrollX={scrollX} width={width} />
          )}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
          snapToAlignment="center"
          snapToInterval={width}
          style={[styles.rail, { height: hauteurRail, top: hautRail }]}
        />

        {/* Les légendes sont hors du rail : elles se fondent l'une dans l'autre
            au lieu de glisser, ce qui garde le texte lisible pendant tout le
            geste. */}
        {badges.map((badge, index) => (
          <Legende
            actif={index === actif}
            badge={badge}
            index={index}
            key={badge.key}
            onPartager={() =>
              partager({
                badge,
                description: describeBadge(badge),
                fond: BADGE_FIELD[badge.key] ?? BRUME,
              })
            }
            bas={debord}
            scrollX={scrollX}
            top={hautRail + hauteurRail + 12}
            width={width}
          />
        ))}
      </Animated.View>

      {/* Le clone volant. `pointerEvents: none` : une vue transparente capte
          quand même les touches, et la vitrine doit rester défilable. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.clone, clone, { left: origine.x, top: origine.y }]}
      >
        <QuestBadge
          art={badgeArt(selection.key)}
          earned={selection.earned}
          label={String(selection.threshold)}
          size={FLOATING_SIZE}
        />
      </Animated.View>

      {carte}
    </Animated.View>
  );
}

/**
 * Le médaillon : l'écusson qui pivote sur lui-même au défilement.
 *
 * `EXTEND` et pas `CLAMP` : les voisines doivent continuer de tourner au-delà
 * de leur borne, sinon elles se figent de profil au milieu du geste.
 */
function Medaillon({
  badge,
  index,
  scrollX,
  width,
}: {
  badge: BadgeState;
  index: number;
  scrollX: SharedValue<number>;
  width: number;
}) {
  const range = [(index - 1) * width, index * width, (index + 1) * width];
  const pivot = useAnimatedStyle(() => ({
    transform: [
      { rotateY: `${interpolate(scrollX.get(), range, [260, 0, -360], Extrapolation.EXTEND)}deg` },
    ],
  }));

  return (
    <View style={[styles.slide, { width }]}>
      <Animated.View style={pivot}>
        <QuestBadge
          art={badgeArt(badge.key)}
          earned={badge.earned}
          label={String(badge.threshold)}
          size={VITRINE_SIZE}
        />
      </Animated.View>
    </View>
  );
}

/** Le texte sous le médaillon : il n'apparaît que lorsque sa page est centrée. */
function Legende({
  actif,
  badge,
  bas,
  index,
  onPartager,
  scrollX,
  top,
  width,
}: {
  actif: boolean;
  badge: BadgeState;
  /** Ce dont la racine déborde : la légende se réancre sur le bas VISIBLE. */
  bas: number;
  index: number;
  onPartager: () => void;
  scrollX: SharedValue<number>;
  top: number;
  width: number;
}) {
  const { t: copy } = useUiTranslation();
  const range = [
    (index - 1) * width,
    (index - 1) * width + width / 2.5,
    index * width,
    (index + 1) * width - width / 2,
    (index + 1) * width,
  ];
  const apparition = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.get(), range, [0, 0, 1, 0, 0], Extrapolation.CLAMP),
  }));
  // Le bouton s'estompe moins vite que le texte, comme dans la référence.
  const opaciteBouton = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.get(), range, [0, 0.5, 1, 0.5, 0], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View
      pointerEvents={actif ? 'box-none' : 'none'}
      style={[styles.legende, { bottom: bas, top }]}
    >
      <Animated.View style={[apparition, styles.bloc]}>
        <Text style={styles.nom}>{badge.label}</Text>
        <Text style={styles.description}>{describeBadge(badge)}</Text>
        <Text style={styles.condition}>
          {badge.earned
            ? copy('badge_earned')
            : copy('badge_remaining', { left: Math.max(1, Math.ceil((1 - badge.progress) * badge.threshold)), total: badge.threshold })}
        </Text>
      </Animated.View>

      {badge.earned ? (
        <View style={styles.pied}>
          <AnimatedPressable
            accessibilityLabel={copy('badge_share_a11y', { name: badge.label })}
            accessibilityRole="button"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
              onPartager();
            }}
            style={[styles.bouton, opaciteBouton]}
          >
            <SymbolView name="square.and.arrow.up" size={19} tintColor="#2B2418" />
            <Text style={styles.boutonTexte}>{copy("card_action_share")}</Text>
          </AnimatedPressable>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  plein: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    backgroundColor: '#17120A',
  },
  voile: { backgroundColor: 'rgba(23,18,10,0.42)' },
  clone: {
    position: 'absolute',
    width: FLOATING_SIZE,
    height: FLOATING_SIZE,
    zIndex: 101,
  },

  entete: { paddingHorizontal: 16, paddingBottom: 6, alignItems: 'center' },
  fermer: { position: 'absolute', left: 12, bottom: 0, padding: 8 },
  collection: {
    color: CREME,
    fontFamily: theme.fonts.bold,
    fontSize: 17,
  },

  rail: { position: 'absolute', left: 0, right: 0, flexGrow: 0 },
  railContenu: { alignItems: 'center' },
  slide: { alignItems: 'center', justifyContent: 'center', paddingVertical: RAIL_PADDING_V },

  legende: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: theme.gap(4),
  },
  bloc: { alignItems: 'center', gap: 10 },
  nom: {
    color: CREME,
    fontFamily: theme.fonts.display,
    fontSize: 30,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  description: {
    color: 'rgba(255,251,240,0.72)',
    fontFamily: theme.fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  condition: {
    color: 'rgba(255,251,240,0.45)',
    fontFamily: theme.fonts.bold,
    fontSize: 11.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 4,
  },
  pied: { position: 'absolute', bottom: 64 },
  bouton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 999,
    backgroundColor: CREME,
  },
  boutonTexte: { color: '#2B2418', fontFamily: theme.fonts.bold, fontSize: 15 },
}));
