import { uiLanguage } from '@/i18n/current';
import { useTranslation as useUiTranslation } from 'react-i18next';
// Les trois écrans de valeur : viser, convoiter, collectionner.
//
// L'ORDRE EST UNE MONTÉE, PAS UNE LISTE
//
//   VISER          le geste, et il est banal exprès — on peut commencer ce
//                  soir, avec le pigeon d'en bas.
//   CONVOITER      les légendaires. On les montre AVANT de dire qu'on peut les
//                  avoir : l'envie précède la règle du jeu.
//   COLLECTIONNER  l'atlas, et surtout ses trous. Une grille pleine dit « c'est
//                  fini », une grille trouée dit « il en manque ».
//
// AUCUNE COULEUR N'EST ÉCRITE ICI
//
// Les cartes lisent `RARITY_TIERS` — base, accent, libellé — et les planches
// viennent du catalogue d'espèces. Le jour où l'échelle change, ces écrans
// changent avec elle sans qu'on y revienne. C'est aussi ce qui les rend
// incopiables : le concurrent fabrique des autocollants, pas des cartes
// graduées.

import { PHOTOS } from '@/components/onboarding/animal-marquee';
import { AnimatedView } from '@/components/ui/animated-view';
import { RARITY_TIERS } from '@/lib/animals/rarity';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { Text, View } from 'react-native';
import { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

/** Titre + sous-titre, identiques d'un écran à l'autre. */
function Say({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <View style={styles.say}>
      <AnimatedView entering={FadeInDown.delay(160).duration(450)}>
        <Text style={styles.title}>{title}</Text>
      </AnimatedView>
      <AnimatedView entering={FadeInDown.delay(240).duration(450)}>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </AnimatedView>
    </View>
  );
}

/**
 * Écran 1 — le geste.
 *
 * Quatre angles plutôt qu'un cadre fermé : un rectangle complet ENFERME le
 * sujet, quatre coins le DÉSIGNENT. Et le déclencheur est dessiné sous le
 * viseur, parce que « vise » et « déclenche » sont deux gestes et que l'écran
 * en promet deux.
 */
export function CaptureStep() {
  const { t: copy } = useUiTranslation();
  const { theme } = useUnistyles();
  return (
    <View style={styles.step}>
      <View style={styles.stage}>
        <AnimatedView entering={ZoomIn.duration(480)} style={styles.viewfinder}>
          <Image contentFit="cover" source={PHOTOS[12]} style={styles.aimPhoto} />
          <View style={[styles.corner, styles.cornerTopLeft]} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />
        </AnimatedView>

        <AnimatedView entering={FadeInDown.delay(280).duration(400)} style={styles.shutter}>
          <View style={styles.shutterCore} />
          <SymbolView
            name="camera.fill"
            size={17}
            tintColor={theme.colors.onPrimary}
            style={styles.shutterIcon}
          />
        </AnimatedView>
      </View>

      <Say
        subtitle={copy("ui_copy_041")}
        title={copy("ui_copy_042")}
      />
    </View>
  );
}

/**
 * Écran 2 — ce qu'on convoite.
 *
 * Trois cartes en éventail, prises tout en haut de l'échelle : ÉPIQUE,
 * MYTHIQUE, LÉGENDAIRE. La légendaire est devant, plus grande et droite ; les
 * deux autres s'inclinent derrière elle. On ne montre PAS la commune ici —
 * l'écran ne décrit pas l'échelle, il donne envie de son sommet.
 */
const SHOWCASE = [
  {
    art: require('../../../assets/cards/species/calopteryx-virgo.webp'),
    get name() { return uiLanguage() === 'fr' ? 'Caloptéryx vierge' : 'Beautiful Demoiselle'; },
    rarity: 'epic',
  },
  {
    art: require('../../../assets/cards/species/falco-tinnunculus.webp'),
    get name() { return uiLanguage() === 'fr' ? 'Faucon crécerelle' : 'Common Kestrel'; },
    rarity: 'legendary',
  },
  {
    art: require('../../../assets/cards/species/hirundo-rustica.webp'),
    get name() { return uiLanguage() === 'fr' ? 'Hirondelle rustique' : 'Barn Swallow'; },
    rarity: 'mythic',
  },
] as const;

export function LegendaryStep() {
  const { t: copy } = useUiTranslation();
  return (
    <View style={styles.step}>
      <View style={styles.stage}>
        {SHOWCASE.map((card, index) => {
          const tier = RARITY_TIERS[card.rarity];
          const front = index === 1;
          return (
            <AnimatedView
              entering={ZoomIn.delay(front ? 0 : 160 + index * 60).duration(520)}
              key={card.name}
              style={[
                styles.showcaseCard,
                { backgroundColor: tier.base, borderColor: tier.accent },
                front ? styles.showcaseFront : null,
                index === 0 ? styles.showcaseLeft : null,
                index === 2 ? styles.showcaseRight : null,
              ]}
            >
              <Image contentFit="cover" source={card.art} style={styles.showcaseArt} />
              <View style={[styles.showcaseTag, { backgroundColor: tier.accent }]}>
                <Text style={[styles.showcaseTagText, { color: tier.onAccent }]}>
                  {tier.label}
                </Text>
              </View>
            </AnimatedView>
          );
        })}
      </View>

      <Say
        subtitle={copy("ui_copy_043")}
        title={copy("ui_copy_044")}
      />
    </View>
  );
}

/** Écran 3 — l'atlas, et ses trous. */
export function AtlasStep() {
  const { t: copy } = useUiTranslation();
  const { theme } = useUnistyles();
  return (
    <View style={styles.step}>
      <View style={[styles.stage, styles.grid]}>
        {Array.from({ length: 9 }, (_, index) => {
          const locked = index === 2 || index === 5 || index === 6;
          return (
            <AnimatedView
              entering={ZoomIn.delay(55 * index).duration(340)}
              key={index}
              style={[styles.tile, locked && styles.tileLocked]}
            >
              {locked ? (
                <SymbolView
                  name="questionmark"
                  size={20}
                  tintColor={theme.colors.faint}
                  weight="bold"
                />
              ) : (
                <Image contentFit="cover" source={PHOTOS[index + 14]} style={styles.fill} />
              )}
            </AnimatedView>
          );
        })}
      </View>

      <Say
        subtitle={copy("ui_copy_045")}
        title={copy("ui_copy_046")}
      />
    </View>
  );
}

const TILE = 68;

const styles = StyleSheet.create((theme) => ({
  step: {
    flex: 1,
    gap: theme.gap(4),
    justifyContent: 'center',
  },
  // Hauteur FIXE : sans elle, chaque illustration donnerait sa propre taille à
  // l'écran et le titre sauterait d'une étape à l'autre.
  stage: {
    alignItems: 'center',
    height: 288,
    justifyContent: 'center',
  },
  say: {
    alignItems: 'center',
    gap: theme.gap(1),
  },
  title: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 32,
    letterSpacing: -0.6,
    lineHeight: 38,
    textAlign: 'center',
  },
  subtitle: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  fill: { height: '100%', width: '100%' },

  viewfinder: {
    alignItems: 'center',
    height: 196,
    justifyContent: 'center',
    width: 196,
  },
  aimPhoto: {
    borderRadius: 20,
    height: 130,
    width: 130,
  },
  corner: {
    borderColor: theme.colors.foreground,
    height: 30,
    position: 'absolute',
    width: 30,
  },
  cornerTopLeft: { borderLeftWidth: 3, borderTopWidth: 3, left: 0, top: 0 },
  cornerTopRight: { borderRightWidth: 3, borderTopWidth: 3, right: 0, top: 0 },
  cornerBottomLeft: { borderBottomWidth: 3, borderLeftWidth: 3, bottom: 0, left: 0 },
  cornerBottomRight: { borderBottomWidth: 3, borderRightWidth: 3, bottom: 0, right: 0 },
  shutter: {
    alignItems: 'center',
    borderColor: theme.colors.border,
    borderRadius: 27,
    borderWidth: 2,
    height: 54,
    justifyContent: 'center',
    marginTop: theme.gap(2),
    width: 54,
  },
  shutterCore: {
    backgroundColor: theme.colors.primary,
    borderRadius: 21,
    height: 42,
    width: 42,
  },
  shutterIcon: { position: 'absolute' },

  showcaseCard: {
    borderCurve: 'continuous',
    borderRadius: 14,
    borderWidth: 2,
    elevation: 8,
    padding: 6,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    width: 126,
  },
  showcaseFront: {
    elevation: 14,
    shadowOpacity: 0.3,
    width: 150,
    zIndex: 2,
  },
  showcaseLeft: { transform: [{ translateX: -92 }, { rotate: '-13deg' }] },
  showcaseRight: { transform: [{ translateX: 92 }, { rotate: '13deg' }] },
  showcaseArt: {
    borderRadius: 8,
    height: 168,
    width: '100%',
  },
  showcaseTag: {
    alignSelf: 'center',
    borderRadius: 5,
    marginTop: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  showcaseTagText: {
    fontFamily: theme.fonts.bold,
    fontSize: 8,
    letterSpacing: 0.5,
  },

  grid: {
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    width: 3 * TILE + 2 * 10,
  },
  tile: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderCurve: 'continuous',
    borderRadius: 16,
    borderWidth: 1,
    height: TILE,
    overflow: 'hidden',
    width: TILE,
  },
  tileLocked: {
    alignItems: 'center',
    backgroundColor: theme.colors.surfaceMuted,
    justifyContent: 'center',
  },
}));
