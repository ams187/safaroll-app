// Le paywall.
//
// Ce qu'il ne fait plus : dérouler un carrousel de fonctionnalités illustrées
// en pictos. C'est le motif que toutes les apps se copient, et il a un défaut
// de fond — il parle du produit à quelqu'un qui, lui, a déjà quelque chose.
//
// Ce qu'il fait à la place : ouvrir sur SA collection. Les vraies cartes, avec
// leurs vrais effets holo, son vrai décompte d'espèces. C'est le même principe
// que le verrou de la carte des captures (`map.tsx`) — on ne vend pas une
// liste, on montre ce qui est déjà là et ce qu'on en fait.
//
// Le reste vient de ce que font les apps à gros revenus de la catégorie
// (recherche ScreensDesign, août 2026) :
//
// - DEUX plans mis en avant, pas trois. Collectr, Figuritas, HoloDex, StarSnap,
//   Spoly : tous en proposent deux. Le « à vie » reste, en dessous, discret.
// - Restaurer / Conditions / Confidentialité en pied. Sans exception dans
//   l'échantillon.
//
// Le prix et le bouton ne défilent pas. Ils vivent dans une barre fixée en bas,
// donc la décision est toujours à portée de pouce, quel que soit l'endroit où
// on se trouve dans la page.
//
// Aucune couleur en dur : l'écran vit sur les jetons du thème, comme les
// onglets. Ce qui portait l'or (`#e9b84d`) se répartit selon la RÈGLE du
// parchemin (`unistyles.ts`) — jamais du parchemin en TEXTE sur la page crème,
// il y est invisible. Donc : encre sur parchemin, ou parchemin sur encre. Le
// bouton d'achat est un aplat d'encre à type parchemin, les états sélectionnés
// sont des aplats de parchemin cerclés d'encre.

import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { currentLanguage } from '@/i18n/languages';
import { FeatureCarousel } from '@/components/paywall/feature-carousel';
import { ShimmerPressableView } from '@/components/ui/shimmer-pressable-view';
import { LIVRE_ACTIF } from '@/lib/launch-flags';
import { announce, toast } from '@/lib/notify';
import { purchase, restore, useOfferings, type Plan } from '@/lib/purchases';
import { Canvas, Image as SkiaImage, useVideo } from '@shopify/react-native-skia';
import { useAssets } from 'expo-asset';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

/** Le site public. Les pages légales y vivent, en français et en anglais. */
const SITE = 'https://safaroll.com';

/**
 * LES MENTIONS LÉGALES S'OUVRENT PAR-DESSUS, PAS AILLEURS.
 *
 * `Linking.openURL` éjectait le joueur dans Safari. Depuis un PAYWALL, c'est le
 * pire endroit où le faire : il partait lire des conditions et revenir lui
 * coûtait un aller-retour par le sélecteur d'apps — la plupart ne revenaient
 * pas, et l'achat mourait là.
 *
 * `openBrowserAsync` en `PAGE_SHEET` ouvre SFSafariViewController AU-DESSUS du
 * paywall, qu'on voit toujours derrière, et se referme d'un glissement vers le
 * bas. Exactement le traitement de l'article Wikipédia d'une fiche espèce
 * (`components/cards/species-wiki.tsx`) — même geste, même attente.
 */
function ouvrirPageLegale(chemin: string) {
  void WebBrowser.openBrowserAsync(`${SITE}/${chemin}`, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    toolbarColor: '#1a1410',
    controlsColor: OR_BOUTON,
    dismissButtonStyle: 'done',
  }).catch(() => undefined);
}

const TRIAL_DAYS = 3;

/** Le plan qui porte l'essai. Les autres se paient tout de suite. */
const TRIAL_PLAN: Plan = 'annual';

function PaywallHero() {
  const { t: copy } = useUiTranslation();
  const { width } = useWindowDimensions();
  const heroWidth = width * 0.9;
  const [assets] = useAssets([require('../../../assets/paywall-cheetah-loop-app.mp4')]);
  const { currentFrame } = useVideo(assets?.[0]?.localUri ?? null, { looping: true, volume: 0 });

  return (
    <View style={styles.hero}>
      <ExpoImage
        accessibilityLabel={copy("ui_copy_161")}
        contentFit="cover"
        source={require('../../../assets/paywall-cheetah-hero-transparent.png')}
        style={StyleSheet.absoluteFill}
      />
      <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
        <SkiaImage
          fit="cover"
          height={(heroWidth * 9) / 16}
          image={currentFrame}
          width={heroWidth}
          x={0}
          y={0}
        />
      </Canvas>
    </View>
  );
}

/**
 * Le tableau comparatif.
 *
 * `LIVRE_ACTIF` le filtre : promettre le Livre sur un paywall alors que rien
 * dans l'app n'y mène, c'est vendre une fonctionnalité introuvable — et c'est
 * exactement ce qu'Apple refuse à la revue (directive 2.3.1, métadonnées
 * trompeuses). La ligne revient d'elle-même le jour où le drapeau passe à vrai.
 */
// CES CONSTANTES PORTENT DES CLÉS, PAS DU TEXTE.
//
// Elles vivent au niveau module, donc hors de tout composant : `t()` n'y est
// pas appelable. Y écrire les libellés en clair, c'est ce qui a maintenu ce
// paywall — l'écran qui vend l'abonnement — en français pour un anglophone.
// La résolution se fait au rendu, où `t` existe.
/**
 * L'OR DU BOUTON D'ACHAT, ET DES COCHES QUI LE PROMETTENT.
 *
 * Une seule constante pour les deux : les coches de la colonne SafaRoll+ disent
 * « voilà ce que ce bouton ouvre », donc elles portent sa couleur. Écrites en
 * dur à deux endroits, elles auraient divergé au premier ajustement de teinte.
 */
/**
 * TROIS ORS, TROIS RÔLES — ET UN SEUL POUR TOUT CE QUI EST PLEIN OU TRACÉ.
 *
 * `OR_BOUTON`  aplats et traits : bouton d'achat, pastille du tableau, contours
 *              de la formule choisie, disque du lifetime, barre du navigateur.
 * `OR_COCHE`   les marques posées SUR la bande, où l'or saturé se noierait.
 * `OR_BANDE`   le lavis derrière la colonne SafaRoll+.
 *
 * Il y avait un quatrième or, `#EED28B`, pâle. Il ne tenait aucun de ces trois
 * rôles : trop clair pour porter du blanc, trop clair pour se détacher du crème
 * (1,45:1 — un contour qu'on devine plus qu'on ne le voit). Sa valeur ne survit
 * que dans `OR_BANDE`, où être pâle EST la fonction.
 *
 * POURQUOI SATURÉ PLUTÔT QUE SOMBRE. Le libellé du bouton est blanc, et c'est
 * la saturation qui le rend lisible, pas le ratio. Mesuré sur Gotcha : leur
 * blanc tient à 1,65–2,68:1, sous le seuil WCAG, et se lit parfaitement — leur
 * or est à ~85 % de saturation. Descendre vers un or olive conforme (#A57D18,
 * 3,8:1) gagnait un chiffre et perdait le bouton.
 */
const OR_BOUTON = '#E3A93C';

/** L'ambre des marques posées SUR la bande, où l'or du bouton se noierait :
 *  même famille, deux crans plus soutenue. */
const OR_COCHE = '#c8901f';
/** Le lavis derrière la colonne SafaRoll+. Un souffle d'or, pas un aplat :
 *  des libellés se lisent par-dessus. */
const OR_BANDE = 'rgba(238, 210, 139, 0.22)';

const TABLE: { key: string; free: boolean }[] = [
  { key: 'pay_row_capture', free: true },
  { key: 'pay_row_unlimited', free: false },
  { key: 'pay_row_guide', free: false },
  { key: 'pay_row_map', free: false },
  ...(LIVRE_ACTIF ? [{ key: 'pay_row_book', free: false }] : []),
  { key: 'pay_row_export', free: false },
  { key: 'pay_row_icons', free: false },
  { key: 'pay_row_badge', free: false },
  { key: 'pay_row_support', free: false },
];

const PLAN_META: Record<
  Plan,
  { titleKey: string; perKey?: string; badgeKey?: string; noteKey?: string }
> = {
  weekly: { titleKey: 'pay_plan_weekly', perKey: 'pay_plan_weekly_per' },
  annual: {
    titleKey: 'pay_plan_annual',
    perKey: 'pay_plan_annual_per',
    badgeKey: 'pay_plan_annual_badge',
    noteKey: 'pay_plan_annual_note',
  },
  lifetime: { titleKey: 'pay_plan_lifetime', noteKey: 'pay_plan_lifetime_note' },
};

/**
 * `onClose` est fourni quand le paywall n'est PAS une route mais la dernière
 * étape de l'onboarding, montée à l'intérieur de lui (comme `(spaces)/index`
 * monte le profil). Là, il n'y a rien à dépiler : fermer veut dire « termine
 * l'onboarding », et c'est l'appelant qui sait comment.
 */
export default function PaywallScreen({ onClose }: { onClose?: () => void } = {}) {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  // Le site n'a que deux langues ; tout le reste retombe sur l'anglais.
  const langue = currentLanguage() === 'fr' ? 'fr' : 'en';
  const router = useRouter();
  const close =
    onClose ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  // La largeur de fenêtre pilote la pagination du carrousel : une diapo = un
  // écran, sinon l'accrochage tombe entre deux.
  const { width: largeurFenetre } = useWindowDimensions();
  const [plan, setPlan] = useState<Plan>('annual');
  // Verrou d'achat : sans lui, deux appuis rapides lancent deux feuilles
  // StoreKit et la seconde échoue avec une erreur que le joueur n'a pas
  // provoquée.
  const [busy, setBusy] = useState(false);
  // Mesurée plutôt que devinée : la barre change de hauteur avec la taille de
  // texte du système, et un padding en dur finirait par cacher le pied de page.
  const [footerHeight, setFooterHeight] = useState(0);
  const carouselTop = useRef(Number.POSITIVE_INFINITY);
  const [carouselActive, setCarouselActive] = useState(false);
  const { loading: offeringsLoading, offerings } = useOfferings();

  const acheter = async () => {
    if (busy) return;
    setBusy(true);
    const issue = await purchase(plan);
    setBusy(false);
    // Une annulation ne dit rien : le joueur a fermé la feuille, il sait
    // pourquoi. L'alerter reviendrait à lui reprocher son choix.
    if (!issue.ok && !issue.cancelled) {
      announce.fail('Achat impossible', issue.error);
      return;
    }
    if (issue.ok) close();
  };

  const restaurer = async () => {
    if (busy) return;
    setBusy(true);
    const issue = await restore();
    setBusy(false);
    if (!issue.ok) {
      announce.fail(t('pay_restore_failed'), issue.cancelled ? t('pay_restore_cancelled') : issue.error);
      return;
    }
    if (issue.entitled) {
      // La feuille se ferme sur une restauration réussie : sans un mot, elle
      // disparaît et rien ne distingue « c'est rendu » de « ça n'a rien fait ».
      // Le bandeau, lui, survit à la fermeture — il vit dans sa propre fenêtre.
      announce.done(t('pay_restore_done'), t('pay_restore_done_body'));
      close();
      return;
    }
    toast.info(t('pay_restore_nothing'), t('pay_restore_nothing_body'));
  };

  const trialPlan = plan === TRIAL_PLAN;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: footerHeight + 24 }}
        onScroll={(event) => {
          if (carouselActive) return;
          const { contentOffset, layoutMeasurement } = event.nativeEvent;
          if (contentOffset.y + layoutMeasurement.height >= carouselTop.current + 80) {
            setCarouselActive(true);
          }
        }}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <View style={styles.wordmarkRow}>
            <ExpoImage
              accessibilityLabel={copy("ui_copy_140")}
              contentFit="contain"
              source={require('../../../assets/icon.png')}
              style={styles.appLogo}
            />
            <ExpoImage
              accessibilityLabel="SafaRoll+"
              contentFit="contain"
              source={require('../../../assets/splash/safaroll-plus-wordmark.png')}
              style={styles.wordmark}
            />
          </View>
          <Pressable accessibilityLabel={copy("reveal_close")} hitSlop={14} onPress={close}>
            <SymbolView
              name="xmark"
              size={15}
              style={{ opacity: 0.65 }}
              tintColor={theme.colors.faint}
              weight="semibold"
            />
          </Pressable>
        </View>

        <PaywallHero />


        {/* Ce que ça ouvre — court, et au présent de SA collection. */}
        <View style={styles.section}>
          <View style={styles.table}>
            {/* LA BANDE, ET POURQUOI ELLE EST CONTINUE.
                Une teinte posée cellule par cellule se lit comme huit cases
                colorées ; une seule bande derrière toute la colonne se lit
                comme UNE offre. C'est elle qui fait le travail, pas les coches.
                Rendue en premier donc dessous, et découpée par l'`overflow` du
                tableau — d'où les coins hauts arrondis à la main. */}
            <View pointerEvents="none" style={styles.plusBand} />
            <View style={styles.tableHeader}>
              <View style={styles.tableLabelCell} />
              <Text style={styles.tableHeaderFree}>{t('pay_table_free')}</Text>
              <View style={styles.plusPill}>
                <Text style={styles.tableHeaderPlus}>SafaRoll+</Text>
              </View>
            </View>
            {TABLE.map((row, index) => (
              <View key={row.key} style={styles.tableRow}>
                {/* Le séparateur ne court QUE sous le libellé et la colonne
                    gratuite : il s'arrête au bord de la bande, sinon il la
                    tranche et casse sa continuité verticale. */}
                {index < TABLE.length - 1 ? (
                  <View pointerEvents="none" style={styles.tableRowDivider} />
                ) : null}
                <Text style={styles.tableLabel}>{t(row.key)}</Text>
                <View style={styles.tableCell}>
                  {row.free ? (
                    <SymbolView name="checkmark" size={15} tintColor={theme.colors.faint} weight="semibold" />
                  ) : (
                    <Text style={styles.tableDash}>—</Text>
                  )}
                </View>
                <View style={[styles.tableCell, styles.tableCellPlus]}>
                  <SymbolView name="checkmark" size={16} tintColor={OR_COCHE} weight="bold" />
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* CE QUE ÇA FAIT, après CE QU'ON A.
            Le tableau au-dessus énumère, ce carrousel montre — et il vient
            APRÈS : on lit d'abord ce qui sépare le gratuit du payant, puis on
            voit à quoi ça ressemble. Il mène droit au bandeau de confiance,
            puis au prix. */}
        <View onLayout={(event) => { carouselTop.current = event.nativeEvent.layout.y; }}>
          <FeatureCarousel active={carouselActive} width={largeurFenetre} />
        </View>

        {/* UNE RAISON DE FAIRE CONFIANCE, JUSTE AVANT LA BARRE D'ACHAT.
            C'est là qu'elle vaut le plus, et c'est pour ça qu'elle doit être
            VRAIE. Il y avait ici « 1 % à la protection de la faune » : un
            pourcentage annoncé engage, et sans programme ni reversement
            vérifiable, c'est une allégation trompeuse — celles qu'Apple et la
            DGCCRF sanctionnent, et qu'un utilisateur ne pardonne pas.
            La promesse actuelle ne coûte rien à tenir et se vérifie dans
            `package.json` : aucun SDK publicitaire, aucun traqueur marketing. */}
        <View style={styles.section}>
          <View style={styles.banner}>
            <SymbolView name="hand.raised.fill" size={18} tintColor={theme.colors.success} />
            <Text style={styles.bannerText}>
              <Text style={styles.bannerStrong}>{t('pay_banner_strong')}</Text>
              {t('pay_banner_rest')}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.linksRow}>
            <Pressable hitSlop={10} onPress={() => void restaurer()}>
              <Text style={styles.link}>{t('pay_restore')}</Text>
            </Pressable>
            <Text style={styles.linkDot}>·</Text>
            {/* Ces deux liens étaient des `Pressable` SANS `onPress` : ils
                avaient l'air cliquables et ne faisaient rien. Apple relit le
                paywall à chaque revue et exige que les conditions et la
                politique y soient ATTEIGNABLES (directive 3.1.2). Le domaine
                existe maintenant, donc ils mènent quelque part. */}
            <Pressable
              accessibilityRole="link"
              hitSlop={10}
              onPress={() => ouvrirPageLegale(`${langue}/terms`)}
            >
              <Text style={styles.link}>{t('pay_terms')}</Text>
            </Pressable>
            <Text style={styles.linkDot}>·</Text>
            <Pressable
              accessibilityRole="link"
              hitSlop={10}
              onPress={() => ouvrirPageLegale(`${langue}/privacy`)}
            >
              <Text style={styles.link}>{t('pay_privacy')}</Text>
            </Pressable>
          </View>

          <Text style={styles.legal}>
            {t('pay_legal')}
          </Text>
        </View>
      </ScrollView>

      {/* La barre d'achat. Hors du ScrollView, donc toujours à l'écran : le prix
          et le bouton ne doivent jamais être quelque chose qu'il faut aller
          chercher. Le contenu passe dessous, d'où le fond plein et le liseré. */}
      <View
        onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
        style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}
      >
        <View style={styles.plans}>
          {offerings
            .filter((offering) => offering.plan !== 'lifetime')
            .map((offering) => {
              const meta = PLAN_META[offering.plan];
              const selected = plan === offering.plan;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  key={offering.plan}
                  onPress={() => setPlan(offering.plan)}
                  style={[styles.planCard, selected && styles.planCardSelected]}
                >
                  {meta.badgeKey ? (
                    <View style={styles.planBadge}>
                      <Text style={styles.planBadgeText}>{t(meta.badgeKey)}</Text>
                    </View>
                  ) : null}
                  <Text style={styles.planTitle}>{t(meta.titleKey)}</Text>
                  <Text style={styles.planPrice}>
                    {offering.price}
                    {meta.perKey ? <Text style={styles.planPer}>{t(meta.perKey)}</Text> : null}
                  </Text>
                  <Text style={styles.planNote}>{meta.noteKey ? t(meta.noteKey) : t('pay_plan_default_note')}</Text>
                </Pressable>
              );
            })}
        </View>

        {/* Le « à vie » existe, il ne se dispute pas la place avec les deux
            autres. Trois cartes de même poids, personne ne choisit. */}
        {offerings
          .filter((offering) => offering.plan === 'lifetime')
          .map((offering) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: plan === 'lifetime' }}
              key={offering.plan}
              onPress={() => setPlan('lifetime')}
              style={[styles.lifetime, plan === 'lifetime' && styles.lifetimeSelected]}
            >
              {/* RENDU PALETTE : deux couches, deux couleurs.
                  En monochrome, l'anneau et le disque prennent la même teinte —
                  posés sur `OR_BANDE`, l'or se fondait dans son propre fond et
                  le rond disparaissait. Le disque garde l'or du contour, l'anneau
                  passe à l'ambre soutenue pour le détourer. */}
              <SymbolView
                name={plan === 'lifetime' ? 'largecircle.fill.circle' : 'circle'}
                size={17}
                {...(plan === 'lifetime'
                  ? { type: 'palette' as const, colors: [OR_BOUTON, OR_COCHE] }
                  : { tintColor: theme.colors.faint })}
              />
              <Text style={styles.lifetimeText}>{t('pay_lifetime_switch')}</Text>
              <Text style={styles.lifetimePrice}>{offering.price}</Text>
            </Pressable>
          ))}

        {/* LE BALAYAGE NE BRILLE QUE SI LE BOUTON PART.
            `shimmer` suit l'état actionnable : pendant l'achat ou le chargement
            des offres, la lumière s'éteint. Une lumière qui balaie un bouton
            mort attire le doigt vers rien. */}
        <ShimmerPressableView
          backgroundColor={OR_BOUTON}
          borderRadius={18}
          containerStyle={{
            marginTop: 10,
            width: '100%',
            ...((busy || offeringsLoading) && styles.ctaBusy),
          }}
          disabled={busy || offeringsLoading}
          height={50}
          onPress={() => void acheter()}
          shimmer={!busy && !offeringsLoading}
          shimmerConfig={{
            color: 'rgba(255, 255, 255, 0.55)',
            delay: 1200,
            duration: 900,
            stripeCount: 5,
          }}
        >
          {busy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.ctaText}>
              {trialPlan ? t('pay_cta_trial', { days: TRIAL_DAYS }) : t('pay_cta_upgrade')}
            </Text>
          )}
        </ShimmerPressableView>
        <Text style={styles.trial}>
          {trialPlan
            ? t('pay_footnote_trial', {
                days: TRIAL_DAYS,
                price: offerings.find((o) => o.plan === 'annual')?.price ?? '',
              })
            : t('pay_footnote')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  section: {
    paddingHorizontal: 20,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  appLogo: {
    width: 28,
    height: 28,
    borderRadius: 7,
  },
  wordmark: {
    width: 102,
    height: 28,
    transform: [{ translateY: 1 }],
  },
  hero: {
    width: '90%',
    aspectRatio: 16 / 9,
    alignSelf: 'center',
    marginBottom: 18,
    borderRadius: 22,
    overflow: 'hidden',
  },
  table: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingVertical: 4,
    // Découpe la bande sur les coins du tableau.
    overflow: 'hidden',
  },
  plusBand: {
    backgroundColor: OR_BANDE,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    bottom: 0,
    position: 'absolute',
    // 14 = le `paddingHorizontal` des rangées. La bande doit se caler sur la
    // COLONNE, pas sur le bord du tableau : à `right: 0` elle décalait de 14 px
    // et la pastille flottait à gauche de sa propre bande.
    right: 14,
    top: 0,
    width: 72,
  },
  plusPill: {
    alignItems: 'center',
    backgroundColor: OR_BOUTON,
    borderRadius: 999,
    paddingVertical: 4,
    width: 72,
  },
  tableRowDivider: {
    backgroundColor: theme.colors.border,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    left: 14,
    position: 'absolute',
    // S'arrête au bord gauche de la bande (14 de padding + 72 de colonne) :
    // la trancher casserait sa continuité verticale.
    right: 86,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  tableLabelCell: { flex: 1 },
  tableHeaderFree: {
    width: 62,
    textAlign: 'center',
    color: theme.colors.faint,
    fontFamily: theme.fonts.bold,
    fontSize: 10,
    letterSpacing: 1,
  },
  tableHeaderPlus: {
    textAlign: 'center',
    color: '#2b2418',
    fontFamily: theme.fonts.bold,
    fontSize: 10,
    letterSpacing: 1,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  tableLabel: {
    flex: 1,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.regular,
    fontSize: 13.5,
  },
  tableCell: { width: 62, alignItems: 'center' },
  tableCellPlus: { width: 72 },
  tableDash: {
    color: theme.colors.faint,
    fontFamily: theme.fonts.regular,
    fontSize: 13,
  },
  // La barre d'achat, posée sur le contenu qui défile dessous. Fond plein
  // plutôt que translucide : ce qui passe derrière, ce sont des cartes holo, et
  // un flou les laisserait bouger sous les prix.
  footer: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  plans: {
    flexDirection: 'row',
    gap: 11,
    // De la place pour que le badge « ÉCONOMISE » dépasse au-dessus des cartes
    // sans se faire couper par le liseré de la barre.
    marginTop: 4,
  },
  planCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  // Aplat de parchemin cerclé d'encre : c'est la forme que prend toute chose
  // sélectionnée dans l'app.
  planCardSelected: {
    // L'or du bouton d'achat, pas `primary` — qui vaut l'ENCRE en thème clair
    // et cerclait la formule choisie de noir, juste au-dessus d'un bouton doré.
    borderColor: OR_BOUTON,
    // La MÊME teinte que la colonne SafaRoll+ du tableau : la formule choisie
    // et la colonne qu'elle débloque parlent d'un seul or.
    backgroundColor: OR_BANDE,
  },
  planBadge: {
    position: 'absolute',
    top: -8,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 9,
    backgroundColor: OR_BOUTON,
  },
  planBadgeText: {
    // Le même blanc que le bouton d'achat : les deux aplats d'or saturé
    // portent le même texte. (Pas `onPrimary`, qui est le parchemin prévu
    // pour un fond ENCRE et virerait au clair sur clair.)
    color: '#ffffff',
    fontFamily: theme.fonts.bold,
    fontSize: 9,
    letterSpacing: 0.6,
  },
  planTitle: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 11,
  },
  planPrice: {
    marginTop: 3,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 18,
  },
  planPer: {
    color: theme.colors.faint,
    fontFamily: theme.fonts.regular,
    fontSize: 11,
  },
  planNote: {
    marginTop: 2,
    color: theme.colors.faint,
    fontFamily: theme.fonts.regular,
    fontSize: 10.5,
  },
  lifetime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  lifetimeSelected: {
    // L'or du bouton d'achat, pas `primary` — qui vaut l'ENCRE en thème clair
    // et cerclait la formule choisie de noir, juste au-dessus d'un bouton doré.
    borderColor: OR_BOUTON,
    // La MÊME teinte que la colonne SafaRoll+ du tableau : la formule choisie
    // et la colonne qu'elle débloque parlent d'un seul or.
    backgroundColor: OR_BANDE,
  },
  lifetimeText: {
    flex: 1,
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 13,
  },
  lifetimePrice: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 13,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginTop: 20,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: theme.colors.success,
    backgroundColor: theme.colors.surface,
    padding: 13,
  },
  bannerText: {
    flex: 1,
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 12.5,
    lineHeight: 17,
  },
  bannerStrong: {
    color: theme.colors.success,
    fontFamily: theme.fonts.bold,
  },
  ctaBusy: { opacity: 0.6 },
  ctaText: {
    color: '#ffffff',
    fontFamily: theme.fonts.bold,
    fontSize: 16,
  },
  trial: {
    marginTop: 7,
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 11.5,
    textAlign: 'center',
  },
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 22,
  },
  link: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 12.5,
  },
  linkDot: {
    color: theme.colors.faint,
    fontFamily: theme.fonts.regular,
    fontSize: 12.5,
  },
  legal: {
    marginTop: 14,
    color: theme.colors.faint,
    fontFamily: theme.fonts.regular,
    fontSize: 10.5,
    lineHeight: 15,
    textAlign: 'center',
  },
}));
