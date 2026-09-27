import { uiLanguage } from '@/i18n/current';
import { identityFor } from './card-identity';
import { MoltenBackdrop } from './molten-backdrop';
import { SpeciesWiki } from './species-wiki';
import { useLocationGate } from '@/lib/location-permission';
import { MenuView, type MenuAction } from '@expo/ui/community/menu';
import { Button as NativeButton, Divider as NativeDivider, Host, Menu as NativeMenu, RNHostView } from '@expo/ui/swift-ui';
import { menuOrder } from '@expo/ui/swift-ui/modifiers';
import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Suspense, lazy, memo, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { GestureDetector } from 'react-native-gesture-handler';
import { speciesName } from '@/lib/animals/species-name';
import { useCardFlip } from './use-card-flip';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';
import { useUnistyles } from 'react-native-unistyles';
import { animalGroupName } from '@/lib/animals/animal-group-name';
import { currentLanguage } from '@/i18n/languages';
import { cardRarity, tierFor } from '@/lib/animals/rarity';
import { CARD_RATIO, cardMetrics, HoloCard, type HoloCardData } from './holo-card';
import { WaveFade } from '@/components/ui/wave-fade';
import { GlassPill } from '@/components/ui/glass-pill';
import { useCardShare, useCardShareRef } from './card-share-button';
import { FLOATING_SIZE, type MorphAnimation, type Origin } from './use-card-morph';
import { CardGuideSheet } from './card-guide-sheet';
import { api } from '@/lib/supabase/api';
import { useQuery } from '@/lib/supabase/backend';
import type { Rencontre } from '@/components/cards/encounter-switcher';
import { NativeSheet } from '@/components/ui/native-sheet';
import { usePremium } from '@/lib/premium';
import {
  getPinnedCaptureId,
  speciesKey,
  usePinnedVersion,
} from '@/lib/animals/pinned-capture';

const AnimatedImage = Animated.createAnimatedComponent(Image);
const noop = () => {};

/**
 * The transition layer: a tinted backdrop, the animal's clone flying out of its
 * tile, and the full card revealed around it.
 *
 * The clone fades out once the card is visible — it lands pixel on pixel over
 * the card's own portrait, so the swap is invisible and the page can then
 * scroll without a ghost animal stuck to it.
 *
 * Ported from `TresorMorphOverlay` in ~/Bloom.
 */
/**
 * CHARGÉS PARESSEUSEMENT, ET C'EST UNE PROTECTION.
 *
 * `react-native-morph-view` est un composant Fabric : son module natif doit
 * être dans le binaire. Un import statique le ferait résoudre au chargement de
 * cette carte — donc au premier rendu de la collection — et un dev client pas
 * encore reconstruit tomberait sur l'écran le plus utilisé de l'app. Ici il
 * n'est résolu qu'à l'ouverture du panneau, qui n'existe qu'à la demande.
 */
const CardStickerMorph = lazy(() =>
  import('@/components/cards/card-sticker-morph').then((m) => ({
    default: m.CardStickerMorph ?? (() => null),
  })),
);

/**
 * LA FEUILLE SE TAILLE SUR SON CONTENU.
 *
 * Le palier `medium` d'iOS ouvre à la demi-page, et le sélecteur n'a que trois
 * choses à montrer : un titre, une bande de vignettes, un bouton. Le reste
 * était du vide — et ce vide masquait la carte, qui est justement ce qu'on
 * regarde changer.
 *
 * Le compte, depuis les styles de `encounter-switcher` :
 *   16 + 16   padding du panneau, haut et bas
 *   10 + 10   les deux écarts entre ses trois enfants
 *        20   le titre
 *       103   la bande : vignette 84 + écart 5 + date 14
 *        41   le bouton : 12 + 12 de padding, ~17 de texte
 *        28   l'indicateur de glissement de la feuille
 *   = 244
 *
 * L'encart du bas s'y ajoute à l'appel, il dépend de l'appareil.
 */
const HAUTEUR_RENCONTRES = 244;

const EncounterSwitcher = lazy(async () => {
  const m = await import('@/components/cards/encounter-switcher');
  // METRO PEUT RENDRE UN MODULE CREUX, ET C'EST UN VRAI PIÈGE EN DEV.
  //
  // Quand le fichier n'était pas encore dans le graphe au démarrage de l'app,
  // le morceau asynchrone revient résolu mais VIDE : `m` ne porte plus qu'une
  // clé `default`, et le composant est `undefined`. React refuse alors le type
  // d'élément et l'erreur remonte jusqu'à faire tomber toute la carte — pour
  // une bêtise de rechargement, pas un bug de code. Un rendu vide referme
  // proprement au lieu d'emporter l'écran.
  return { default: m.EncounterSwitcher ?? (() => null) };
});

export const CardMorphOverlay = memo(function CardMorphOverlay({
  animation,
  cardTop,
  cardWidth,
  onClose,
  onDelete,
  origin,
  selection: selectionOuverte,
  settled,
  shareable = true,
}: {
  animation: MorphAnimation;
  cardTop: number;
  cardWidth: number;
  onClose: () => void;
  /** Omitted where a card cannot be destroyed — a community deck, say. */
  onDelete?: (card: HoloCardData, cardRef: RefObject<View | null>) => void;
  origin: Origin;
  selection: HoloCardData | null;
  settled: boolean;
  /**
   * False on someone else's card. Exporter la carte d'un autre joueur, c'est
   * s'attribuer sa rencontre — et une capture ne prouve quelque chose que
   * parce qu'elle est la preuve que SON auteur y était.
   */
  shareable?: boolean;
}) {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const cardRef = useCardShareRef();
  /**
   * Calculé ICI, au-dessus du `if (!selection)` de plus bas, parce que
   * `useCardShare` est un hook : appelé après un retour anticipé, il ne
   * s'exécuterait pas au même rang d'un rendu à l'autre. D'où le repli sur
   * `'carte'` — il ne sert jamais, l'export n'est atteignable que carte ouverte.
   */
  // L'ESPÈCE, PAS LA CAPTURE. Épingler ici fixe le visage que la grille montre
  // pour cette espèce — voir `@/lib/animals/pinned-capture`.
  const espece = selectionOuverte ? speciesKey(selectionOuverte) : null;
  // Déjà en cache : la collection l'observe, et `animals.listCaptures` ne
  // refetche pas au montage (voir `backendQuery`).
  const toutes = useQuery(api.animals.listCaptures, {});
  const rencontres = useMemo(() => {
    if (!espece) return [];
    return (toutes ?? [])
      .filter((c: Rencontre) => speciesKey(c) === espece)
      .sort((a: Rencontre, b: Rencontre) => (b.capturedAt ?? 0) - (a.capturedAt ?? 0));
  }, [espece, toutes]);

  /**
   * LA CARTE AFFICHÉE SUIT L'ÉPINGLE, PAS LA VIGNETTE QU'ON A TAPÉE.
   *
   * `selectionOuverte` est un instantané : la capture que la grille montrait au
   * moment du tap. Épingler une autre photo repeint bien la grille — elle relit
   * l'épingle — mais l'instantané, lui, ne bouge plus : on choisissait une photo
   * et la carte sous les yeux gardait l'ancienne jusqu'à ce qu'on la referme.
   * Le geste semblait sans effet là où il en avait le plus.
   *
   * On relit donc l'épingle ici aussi. Tout ce qui suit — la face, le partage,
   * le nom, la suppression — parle de la capture RÉELLEMENT montrée.
   */
  const pinVersion = usePinnedVersion();
  const selection = useMemo(() => {
    if (!selectionOuverte || !espece) return selectionOuverte;
    const par = (id: string) =>
      (toutes ?? []).find((c) => String(c._id) === id) as HoloCardData | undefined;
    const epinglee = getPinnedCaptureId(espece);
    if (epinglee && epinglee !== String(selectionOuverte._id)) {
      return par(epinglee) ?? selectionOuverte;
    }
    // LA CAPTURE OUVERTE PEUT AVOIR ÉTÉ SUPPRIMÉE SOUS NOS PIEDS.
    //
    // Le sélecteur permet de jeter une rencontre, y compris celle qu'on a tapée
    // pour ouvrir la carte. `selectionOuverte` est un instantané : il continue
    // de décrire une ligne qui n'existe plus, avec des URL signées qui vont
    // expirer sur un objet déjà effacé du stockage. On retombe sur la plus
    // récente rencontre restante — celle que la grille montrera de toute façon.
    //
    // `toutes` non chargé n'est pas une absence : on ne conclut rien tant que
    // la liste n'est pas là.
    if (toutes && !par(String(selectionOuverte._id))) {
      return (rencontres[0] as HoloCardData | undefined) ?? selectionOuverte;
    }
    return selectionOuverte;
    // `pinVersion` n'est pas lu : il ne sert qu'à refaire ce calcul quand une
    // épingle bouge, `getPinnedCaptureId` lisant un store hors de React.
  }, [espece, pinVersion, rencontres, selectionOuverte, toutes]);

  const nomCarte = selection
    ? (speciesName(selection) ?? selection.scientificName ?? (uiLanguage() === 'fr' ? 'carte' : 'card'))
    : 'carte';
  const { busy: shareBusy, partager } = useCardShare(nomCarte, cardRef);
  const flip = useCardFlip();
  const insets = useSafeAreaInsets();
  const { theme } = useUnistyles();
  const router = useRouter();
  const { isPremium } = usePremium();
  const [rencontresOuvertes, setRencontresOuvertes] = useState(false);
  /**
   * L'APERÇU EN COURS, JOUÉ SUR LA CARTE.
   *
   * `MorphView` anime quand `sens` bascule, entre deux images fixes. On garde
   * donc les DEUX et on alterne laquelle est la cible : taper une vignette
   * écrit dans celle qui n'est pas montrée, puis bascule.
   *
   * Rien n'est épinglé tant que le bouton n'a pas été pressé — regarder n'est
   * pas décider.
   */
  const [apercu, setApercu] = useState<{ a: string; b: string; sens: boolean } | null>(null);
  const apercevoir = useCallback((uri: string) => {
    setApercu((v) =>
      v == null ? null : v.sens ? { a: uri, b: v.b, sens: false } : { a: v.a, b: uri, sens: true },
    );
  }, []);
  const fermerRencontres = useCallback(() => {
    setRencontresOuvertes(false);
    setApercu(null);
  }, []);
  /**
   * UNE SEULE RENCONTRE N'A PLUS RIEN À SÉLECTIONNER.
   *
   * On peut supprimer depuis le panneau jusqu'à n'en laisser qu'une, et rester
   * ouvert sur une bande d'une seule vignette serait une impasse.
   *
   * DÉRIVÉ, PAS UN EFFET. Un `useEffect` qui appellerait `fermerRencontres`
   * poserait un `setState` dans un effet — cascade de rendus, et le compilateur
   * React le refuse. La question « le panneau a-t-il encore un sens ? » se
   * répond au rendu à partir de données déjà là ; il n'y a rien à synchroniser.
   */
  const panneauOuvert = rencontresOuvertes && rencontres.length > 1;
  // Même raison pour l'aperçu : la carte doit reprendre son détourage à la
  // seconde où le panneau disparaît, sans passer par un état à remettre à zéro.
  const apercuActif = panneauOuvert ? apercu : null;
  const [backReadyFor, setBackReadyFor] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const [menuPrewarm, setMenuPrewarm] = useState<'waiting' | 'mounted' | 'done'>('waiting');
  const closeGuide = useCallback(() => setGuideOpen(false), []);
  const { cloneScale, cloneSquashY, cloneTranslateX, cloneTranslateY, detailOpacity, overlayOpacity } = animation;

  const backdrop = useAnimatedStyle(() => ({ opacity: overlayOpacity.get() }));
  const clone = useAnimatedStyle(() => ({
    opacity: interpolate(detailOpacity.get(), [0.6, 1], [1, 0], 'clamp'),
    transform: [
      { translateX: cloneTranslateX.get() },
      { translateY: cloneTranslateY.get() },
      { scaleX: cloneScale.get() },
      { scaleY: cloneScale.get() * cloneSquashY.get() },
    ],
  }));
  const detail = useAnimatedStyle(() => ({ opacity: detailOpacity.get() }));

  // RNHostView + SwiftUI Menu register their native view configs on first
  // render. Doing that while the card opens cost 332 ms in the profiler. Warm
  // exactly those views during genuine idle time, then remove them next frame.
  useEffect(() => {
    if (menuPrewarm !== 'waiting' || selection) return;
    const idle = requestIdleCallback(() => setMenuPrewarm('mounted'));
    return () => cancelIdleCallback(idle);
  }, [menuPrewarm, selection]);
  useEffect(() => {
    if (menuPrewarm !== 'mounted') return;
    const frame = requestAnimationFrame(() => setMenuPrewarm('done'));
    return () => cancelAnimationFrame(frame);
  }, [menuPrewarm]);

  // La face de la carte, figée sur SES entrées. `FullCard` n'est pas mémoïsé :
  // le moindre rendu de cet overlay reconstruirait sinon tout son arbre Skia —
  // canevas, masques, effets — et ça se voit.
  // Reset before paint so a newly selected card can never flash the previous
  // card's back face for one frame.
  const { reset } = flip;
  useLayoutEffect(() => { reset(); }, [reset, selection?._id]);
  const backReady = Boolean(selection && backReadyFor === String(selection._id));
  const revealBack = useCallback(() => {
    if (selection) setBackReadyFor(String(selection._id));
  }, [selection]);
  const flipCard = useCallback(() => {
    revealBack();
    flip.flip();
  }, [flip, revealBack]);

  // Expo déconseille de monter le verre sous un parent encore animé en opacité.
  // `settled` vient du callback réel de fin du morph Reanimated : contrairement
  // à InteractionManager, il sait exactement quand l'animation UI est terminée.
  const posee = Boolean(selection && settled);

  /**
   * PENDANT L'APERÇU, LA CARTE NE PEINT PLUS SON DÉTOURAGE.
   *
   * Sans ça le morph se posait PAR-DESSUS un canevas qui continuait de peindre
   * l'animal d'origine : on voyait deux bêtes l'une sur l'autre au lieu d'une
   * seule qui se transforme. Le morph ne se superpose pas à l'animal de la
   * carte — il EST l'animal de la carte, le temps du choix.
   *
   * `hideSubject` ET NON UN `stickerUrl` VIDÉ. Vider l'URL empêchait bien de
   * peindre l'animal, mais emportait avec lui son OMBRE PORTÉE au sol et sa
   * texture dans le foil `sticker-holo` — deux couches qui ne dessinent pas
   * l'animal et qui ont besoin de lui. L'ombre disparaissait donc au moment du
   * choix, et revenait à la fermeture.
   */
  const cardFace = useMemo(
    () =>
      selection ? (
        <HoloCard data={selection} hideSubject={apercuActif != null} width={cardWidth} />
      ) : null,
    [apercuActif, cardWidth, selection],
  );

  if (!selection) {
    return menuPrewarm === 'mounted' ? (
      <View pointerEvents="none" style={styles.menuPrewarm}>
        <Host ignoreSafeArea="all" matchContents>
          <NativeMenu
            label={<RNHostView matchContents><View style={styles.menuPrewarmLabel} /></RNHostView>}
            modifiers={[menuOrder('fixed')]}
          >
            <NativeButton label={t('card_menu_actions')} onPress={noop} systemImage="ellipsis" />
            <NativeDivider />
          </NativeMenu>
        </Host>
      </View>
    ) : null;
  }

  const tier = tierFor(cardRarity(selection));

  const sticker = (selection.status === 'ready' || selection.status === 'needs_review')
    && selection.taxonomy?.class === 'Aves'
    ? selection.stickerUrl
    : null;
  const name = nomCarte;
  /**
   * Seules les captures situées proposent la carte. Une capture faite avant
   * l'autorisation de position n'a pas de coordonnées et n'en aura jamais —
   * un bouton qui ouvrirait une carte vide vaut moins que pas de bouton.
   */
  const located =
    selection._id !== undefined
    && selection.latitude !== undefined
    && selection.longitude !== undefined;
  const voirSurLaCarte = () =>
    router.push({ pathname: '/map', params: { capture: selection._id as string } });
  const openGuide = () => {
    if (!isPremium) {
      router.push('/paywall');
      return;
    }
    setGuideOpen(true);
  };
  const ouvrirRencontres = () => {
    // Les deux faces partent identiques : tant qu'aucune vignette n'est tapée,
    // le morph a remplacé l'animal sans rien changer à ce qu'on voit.
    const actuel = selection.stickerUrl;
    setApercu(actuel ? { a: actuel, b: actuel, sens: false } : null);
    setRencontresOuvertes(true);
  };
  // ATTENTION : CE TABLEAU N'EST PAS LE MENU D'iOS.
  //
  // Sur iOS c'est le `NativeMenu` SwiftUI plus bas qui est rendu — une liste de
  // `NativeButton` écrite à la main. Ce tableau-ci n'alimente que le repli
  // `MenuView`, hors iOS. Toute entrée ajoutée ici DOIT l'être aux deux endroits,
  // sinon elle n'existe que sur la plateforme que le projet ne livre pas.
  const menuActions: MenuAction[] = [
    { id: 'guide', title: t('card_menu_guide'), image: 'sparkles' },
    ...(sticker ? [{ id: 'game', title: t('card_menu_game'), image: 'gamecontroller.fill' as const }] : []),
    ...(located ? [{ id: 'map', title: t('card_menu_map'), image: 'map' as const }] : []),
    ...(shareable ? [{ id: 'share', title: t('card_menu_share'), image: 'square.and.arrow.up' as const, attributes: { disabled: shareBusy } }] : []),
    // Proposée seulement si l'espèce est identifiée : sans clé d'espèce, il n'y
    // a pas de case dans la grille à représenter.
    // Une seule rencontre n'a rien à comparer : l'action n'apparaît qu'à partir
    // de deux photos de la même espèce.
    ...(rencontres.length > 1 ? [{
      id: 'encounters',
      title: t('card_menu_encounters'),
      image: 'photo.stack' as const,
    }] : []),
    ...(onDelete ? [{ id: 'delete', title: t('card_menu_delete'), image: 'trash' as const, attributes: { destructive: true } }] : []),
  ];
  const onMenuAction = (id: string) => {
    if (id === 'encounters') ouvrirRencontres();
    else if (id === 'guide') openGuide();
    else if (id === 'game' && sticker) router.push({ pathname: '/flappy-bird', params: { name, stickerThumbUrl: selection.stickerThumbUrl ?? sticker, stickerUrl: sticker } });
    else if (id === 'map') voirSurLaCarte();
    else if (id === 'share') void partager();
    else if (id === 'delete') onDelete?.(selection, cardRef);
  };
  const menuTrigger = (
    <View accessibilityLabel={t('card_menu_actions')} accessible style={styles.menuButton}>
      {posee && isLiquidGlassAvailable() ? (
        <GlassView glassEffectStyle="clear" style={styles.menuButton} tintColor="systemUltraThinMaterial">
          <SymbolView name="ellipsis" size={19} tintColor="#fff8e5" weight="bold" />
        </GlassView>
      ) : (
        <BlurView intensity={40} style={[styles.menuButton, styles.menuButtonFallback]} tint="dark">
          <SymbolView name="ellipsis" size={19} tintColor="#fff8e5" weight="bold" />
        </BlurView>
      )}
    </View>
  );
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: tier.onAccent }, backdrop]}>
      {/* LA PIÈCE. Un lavis de la couleur de la rareté pour toutes les cartes —
          sauf la LÉGENDAIRE, qui obtient la roche en fusion, teintée par la
          couleur dominante de sa propre capture.

          C'est ICI que ça se joue, pas sur `[id].tsx` : la collection ouvre cet
          overlay, et la fiche détail n'est atteinte que par d'autres chemins.
          Le fond doit vivre là où la carte se regarde. */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.wash, detail]} pointerEvents="none">
        {cardRarity(selection) === 'legendary' ? (
          <MoltenBackdrop color={identityFor(selection).body[1]} />
        ) : (
          <View style={[styles.rarityWash, { backgroundColor: tier.accent }]} />
        )}
      </Animated.View>

      <Animated.View style={[StyleSheet.absoluteFill, detail]}>
        <View style={[styles.stage, { paddingTop: cardTop }]}>
          {/* The ref the burn photographs. On the flip wrapper, not on the
              front face: `makeImageFromView` captures what is rendered, so a
              card turned to its back burns showing its back — which is right. */}
          <GestureDetector gesture={flip.gesture}>
            <Animated.View
              collapsable={false}
              onTouchStart={revealBack}
              ref={cardRef}
              style={{ height: cardWidth / CARD_RATIO, width: cardWidth }}
            >
              <Animated.View style={[styles.face, flip.frontStyle]}>
                {/* Le cache passe PAR-DESSUS la vraie carte : elle est montée,
                    à sa place et complète dès la première frame. Rien ne la
                    remplace à la fin du balayage. */}
                <WaveFade
                  color={tier.onAccent}
                  key={String(selection._id)}
                  radius={cardMetrics(cardWidth).radius}
                >
                  {cardFace}
                </WaveFade>
                {/* PAR-DESSUS LE CANEVAS, DANS LA FACE AVANT.
                    Dans la face plutôt que dans le cadre : la carte se
                    retourne, et un morph collé au cadre resterait visible sur
                    le dos. Ici il disparaît avec l'animal qu'il remplace. */}
                {apercuActif ? (
                  <Suspense fallback={null}>
                    <CardStickerMorph
                      a={apercuActif.a}
                      b={apercuActif.b}
                      largeurCarte={cardWidth}
                      sens={apercuActif.sens}
                    />
                  </Suspense>
                ) : null}
              </Animated.View>

              <Animated.View style={[styles.face, flip.backStyle]}>
                {backReady ? (
                  <CardBack
                    accent={tier.accent}
                    base={tier.base}
                    selection={selection}
                    width={cardWidth}
                  />
                ) : null}
              </Animated.View>
            </Animated.View>
          </GestureDetector>

        </View>
      </Animated.View>

      <GlassPill
        accessibilityLabel={t('detail_close_card')}
        contentStyle={styles.closeContent}
        onPress={onClose}
        ready={posee}
        shape={[styles.close, { top: insets.top + 8 }]}
      >
        <SymbolView name="xmark" size={16} tintColor="#fff8e5" weight="semibold" />
      </GlassPill>

      {/* LES COMMANDES VIVENT HORS DE TOUTE ENVELOPPE ANIMÉE EN OPACITÉ.
          Elles étaient dans le calque qui fait apparaître la fiche, et son
          `opacity` animée aplatissait leur verre : Apple précise qu'une alpha
          posée sur un `UIVisualEffectView` OU SUR UN DE SES ANCÊTRES dégrade le
          flou. Le verre était bien rendu, et rendu plat — d'où l'impression
          qu'il n'y en avait pas, alors qu'il marche dans Affirm où les mêmes
          boutons vivent dans une simple `View`.

          Elles perdent leur fondu d'entrée. C'est le prix, et il est juste : un
          fondu qu'on ne remarque pas contre un verre qu'on voit. */}
      <View
        pointerEvents="box-none"
        style={[
          styles.controlsLayer,
          // La scène qu'on quitte : le dégagement du haut PLUS la hauteur de la
          // carte. Sans elle, les commandes remontaient sur la carte ou —
          // épinglées en bas — décollaient d'elle de la moitié de l'écran.
          { paddingTop: cardTop + cardWidth / CARD_RATIO },
        ]}
      >
        <View style={styles.actionRow}>
          <GlassPill
            accessibilityLabel={t('card_flip')}
            contentStyle={styles.flipContent}
            onPress={flipCard}
            ready={posee}
            shape={styles.flipButton}
          >
            <SymbolView name="arrow.trianglehead.2.clockwise.rotate.90" size={17} tintColor="#fff8e5" weight="semibold" />
            <Text style={[styles.flipText, { fontFamily: theme.fonts.bold }]}>{t('card_flip')}</Text>
          </GlassPill>
          {Platform.OS === 'ios' ? (
            /* `matchContents` bridges two layout engines. The label swaps its
               blur for glass once the morph settles, and SwiftUI can expose one
               intrinsic-size frame while RN catches up. This fixed wrapper is
               the button's real geometry: the native bridge may remeasure, but
               it can never paint wider than the existing 48 pt control. */
            <View style={styles.menuButton}>
              <Host ignoreSafeArea="all" matchContents>
                <NativeMenu
                  label={<RNHostView matchContents>{menuTrigger}</RNHostView>}
                  modifiers={[menuOrder('fixed')]}
                >
                  <NativeButton label={t('card_menu_guide')} onPress={openGuide} systemImage="sparkles" />
                  {sticker ? (
                    <NativeButton
                      label={copy("card_menu_game")}
                      onPress={() => router.push({ pathname: '/flappy-bird', params: { name, stickerThumbUrl: selection.stickerThumbUrl ?? sticker, stickerUrl: sticker } })}
                      systemImage="gamecontroller.fill"
                    />
                  ) : null}
                  {located ? <NativeButton label={t('card_menu_map')} onPress={voirSurLaCarte} systemImage="map" /> : null}
                  {shareable ? <NativeButton label={t('card_menu_share')} onPress={() => void partager()} systemImage="square.and.arrow.up" /> : null}
                  {rencontres.length > 1 ? (
                    <NativeButton
                      label={t('card_menu_encounters')}
                      onPress={ouvrirRencontres}
                      systemImage="photo.stack"
                    />
                  ) : null}
                  {onDelete ? <NativeDivider /> : null}
                  {onDelete ? <NativeButton label={t('card_menu_delete')} onPress={() => onDelete(selection, cardRef)} role="destructive" systemImage="trash" /> : null}
                </NativeMenu>
              </Host>
            </View>
          ) : (
            <MenuView actions={menuActions} onPressAction={(event) => onMenuAction(event.nativeEvent.event)}>
              {menuTrigger}
            </MenuView>
          )}
        </View>
      </View>

      {selection.stickerUrl ? (
        <AnimatedImage
          source={{ uri: selection.stickerThumbUrl ?? selection.stickerUrl }}
          contentFit="contain"
          style={[styles.clone, { left: origin.x, top: origin.y }, clone]}
        />
      ) : null}
      {guideOpen ? <CardGuideSheet card={selection} onClose={closeGuide} open /> : null}
      {/* Même montage que la feuille du Guide : monté à la demande, démonté à
          la fermeture. Rien ne reste derrière une carte refermée. */}
      {panneauOuvert ? (
        <NativeSheet detents={[{ height: HAUTEUR_RENCONTRES + insets.bottom }]} onClose={fermerRencontres} open>
          <Suspense fallback={null}>
            <EncounterSwitcher
              onApercu={apercevoir}
              onClose={fermerRencontres}
              rencontres={rencontres}
            />
          </Suspense>
        </NativeSheet>
      ) : null}
    </Animated.View>
  );
});

/**
 * The far side of the card: everything that used to be listed under it.
 *
 * A card has two sides and only one of them is the animal — the numbers belong
 * on the other, the way a trading card puts its stats on its back. Same box,
 * same corner radius, same rarity colours as the face, so the two read as one
 * object turning rather than as a card and a panel.
 */
const CardBack = memo(function CardBack({
  accent,
  base,
  selection,
  width,
}: {
  accent: string;
  base: string;
  selection: HoloCardData;
  width: number;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { ask, gate: gateLieu, openSettings: ouvrirReglages } = useLocationGate();
  const router = useRouter();
  const radius = Math.round(width * 0.055);

  // Recalculé ici plutôt que passé en prop : le dos est le SEUL endroit qui
  // parle du lieu maintenant, et une prop de plus traverserait tout le fichier
  // pour un booléen dérivable de `selection`.
  const located =
    selection._id !== undefined
    && selection.latitude !== undefined
    && selection.longitude !== undefined;
  const voirSurLaCarte = () =>
    router.push({ pathname: '/map', params: { capture: selection._id as string } });
  const demanderLieu = () => void ask();

  return (
    <View
      style={[
        styles.back,
        { backgroundColor: base, borderColor: accent, borderRadius: radius, width },
      ]}
    >
      <Text style={[styles.backTitle, { color: accent, fontFamily: theme.fonts.bold }]}>
        {speciesName(selection) ?? selection.scientificName}
      </Text>

      {/* Scrolls, because a field note plus eight rows overflows a card at the
          smaller card widths and a card you cannot read all of is worse than
          one you have to nudge. */}
      <ScrollView showsVerticalScrollIndicator={false} style={styles.backScroll}>
        {selection.mastery ? (
          <>
            <Detail
              fonts={theme.fonts}
              label={t('detail_mastery')}
              value={t('mastery_level', { level: selection.mastery.level })}
            />
            <Detail
              fonts={theme.fonts}
              label={t('detail_observation_days')}
              value={t('mastery_days', { count: selection.mastery.observationDays })}
            />
            <Detail
              fonts={theme.fonts}
              label={t('detail_next_level')}
              value={
                selection.mastery.level === 5
                  ? t('mastery_complete')
                  : t('mastery_days_remaining', { count: selection.mastery.daysToNextLevel })
              }
            />
          </>
        ) : null}
        <Detail
          fonts={theme.fonts}
          label={t('detail_class')}
          value={animalGroupName(selection.taxonomy, currentLanguage())}
        />
        <Detail
          fonts={theme.fonts}
          label={t('detail_family')}
          value={selection.taxonomy?.family ?? t('detail_unknown')}
        />
        <Detail
          fonts={theme.fonts}
          label={t('detail_source')}
          value={selection.captureSource === 'library' ? t('detail_imported') : t('detail_field_capture')}
        />
        {/* LE LIEU VIT ICI, ET PLUS SOUS LA CARTE RÉVÉLÉE.
            La ligne dit l'état de CETTE capture, et l'action ne promet rien
            qu'elle ne tienne : une capture faite sans position n'en aura jamais
            — rien ne patche une ligne après coup. Le bouton nomme donc
            l'interrupteur pour les PROCHAINES, jamais un rattrapage. */}
        <Detail
          accent={accent}
          fonts={theme.fonts}
          label={t('detail_place')}
          onPress={located ? voirSurLaCarte : gateLieu === 'settings' ? ouvrirReglages : gateLieu === 'ask' ? demanderLieu : undefined}
          value={
            located
              ? t('detail_place_view')
              : gateLieu === 'settings'
              ? t('detail_place_settings')
              : gateLieu === 'ask'
              ? t('detail_place_enable')
              : t('detail_place_none')
          }
        />
        <SpeciesWiki accent={accent} scientificName={selection.scientificName} />
      </ScrollView>
    </View>
  );
});

function Detail({ accent, fonts, label, onPress, value }: {
  accent?: string;
  fonts: { bold: string; medium: string };
  label: string;
  /** Rend la VALEUR touchable. Le libellé, lui, reste un libellé. */
  onPress?: () => void;
  value: string;
}) {
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }: { pressed: boolean }) => [styles.detail, pressed && styles.detailPressed]}
      >
        <Text style={[styles.detailLabel, { fontFamily: fonts.medium }]}>{label}</Text>
        <Text numberOfLines={1} style={[styles.detailValue, { color: accent, fontFamily: fonts.bold }]}>
          {value}
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.detail}>
      <Text style={[styles.detailLabel, { fontFamily: fonts.medium }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.detailValue, { fontFamily: fonts.bold }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    zIndex: 100,
  },
  wash: {
    overflow: 'hidden',
  },
  rarityWash: {
    position: 'absolute',
    top: '-30%',
    right: '-20%',
    left: '-20%',
    height: '70%',
    borderRadius: 999,
    opacity: 0.16,
  },
  close: {
    borderRadius: 20,
    height: 40,
    position: 'absolute',
    right: 16,
    width: 40,
    zIndex: 102,
  },
  closeContent: {
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
  },
  stage: {
    flex: 1,
    alignItems: 'center',
  },
  // Le calque des commandes : même géométrie que `stage`, mais frère de
  // l'enveloppe animée plutôt que son enfant. `box-none` laisse passer les
  // gestes vers la carte en dessous — seuls les boutons captent le doigt.
  // Le contenu part du HAUT, décalé de la carte : épinglé en bas, il aurait
  // flotté loin d'elle sur un grand écran.
  controlsLayer: {
    alignItems: 'center',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 101,
  },
  // Both faces occupy the same box; the flip decides which one you see.
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backfaceVisibility: 'hidden',
  },
  back: {
    flex: 1,
    overflow: 'hidden',
    borderWidth: 2,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 14,
  },
  backTitle: {
    fontSize: 12,
    letterSpacing: 1.4,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  backScroll: {
    flex: 1,
  },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  flipButton: {
    borderRadius: 999,
  },
  flipContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  flipText: {
    color: '#fff8e5',
    fontSize: 14,
  },
  menuButton: {
    alignItems: 'center',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 48,
  },
  menuButtonFallback: {
    borderColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
  },
  menuPrewarm: {
    height: 1,
    left: -2,
    opacity: 0,
    position: 'absolute',
    top: -2,
    width: 1,
  },
  menuPrewarmLabel: {
    height: 1,
    width: 1,
  },
  detail: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.09)',
  },
  detailPressed: { opacity: 0.6 },
  detailLabel: {
    color: 'rgba(255,255,255,0.52)',
    fontSize: 12,
  },
  detailValue: {
    flex: 1,
    color: '#fff8e5',
    fontSize: 13,
    textAlign: 'right',
    textTransform: 'capitalize',
  },
  clone: {
    position: 'absolute',
    width: FLOATING_SIZE,
    height: FLOATING_SIZE,
    zIndex: 101,
    // A transparent view still swallows touches: the page must stay scrollable.
    pointerEvents: 'none',
  },
});
