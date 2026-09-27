import { useTranslation as useUiTranslation } from 'react-i18next';
import { eclosion } from '@/lib/haptics';
import { candidatsPseudo } from '@/lib/username';
import { useUser } from '@clerk/expo';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { AnimalCard, type AnimalCardData } from '@/components/animals/animal-card';
import { cardSceneFor } from '@/components/cards/card-scenes';
import { AnimatedView } from '@/components/ui/animated-view';
import { Press3D } from '@/components/ui/press-3d';
import { Image as ExpoImage, type ImageSource } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState } from 'react';
import {
  Linking,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useLocationGate } from '@/lib/location-permission';
import { useCameraPermission } from 'react-native-vision-camera';
import { StyleSheet } from 'react-native-unistyles';

const GOLD = '#E3A93C';
const GOLD_DARK = '#B77A20';

const MASCOT_CAMERA = require('../../../assets/onboarding/expedition/mascot-camera-prep.webp');
const FIND_ANIMAL_PHOTO = require('../../../assets/onboarding/expedition/find-animal-cat.jpg');
const FRAME_AND_SHOOT_PHOTO = require('../../../assets/onboarding/expedition/frame-and-shoot.jpg');
const IDENTIFIED_CAT_PREVIEW = require('../../../assets/onboarding/expedition/identified-cat-card.jpg');
// UNE MASCOTTE PAR ÉCRAN, ET CELLE-CI EXISTE POUR UNE RAISON PRÉCISE.
//
// `ReadyStep` affichait `paywall-cheetah-hero-transparent.png` — le héros du
// paywall. Or dans le FLOW, `paywall` est DEUX écrans avant `ready` : le joueur
// revoyait la même image trente secondes plus tard. Elle est en outre en 2:1
// paysage, posée dans un emplacement portrait.
const MASCOT_READY = require('../../../assets/onboarding/expedition/mascot-ready.webp');
// UNE MASCOTTE PAR RÔLE. `mascot-notes` annonce les questions ; celle-ci
// constate qu'elles ont servi. Les deux écrans sont à quatre pas l'un de
// l'autre : la même image aurait effacé la progression entre les deux.
const MASCOT_CAMP = require('../../../assets/onboarding/expedition/mascot-camp-loop.webp');
// La carte dépliée et le fanion planté : « c'est ICI que je l'ai vu ».
// `mascot-notes` servait déjà au nom ET à l'annonce des questions — trois
// écrans sur la même image, dont deux à quelques secondes d'écart.
const MASCOT_PLACE = require('../../../assets/onboarding/expedition/mascot-place.webp');
// L'étiquette vierge tendue vers l'écran : « et toi, c'est quoi ton nom ? ».
// `mascot-notes` ne peut pas servir ici — elle est le personnage du VOL, celui
// qui passe de « Préparons ton expédition » au bandeau des questions. Le
// réutiliser trois écrans plus tôt casse ce lien avant qu'il existe.
const MASCOT_HELLO = require('../../../assets/onboarding/expedition/mascot-hello-loop.webp');

export function StoryStep({
  image,
  onFrame,
  subtitle,
  title,
}: {
  image: ImageSource;
  /**
   * Rend le cadre de la mascotte EN COORDONNÉES ÉCRAN, pour qu'un autre écran
   * puisse la reprendre exactement là où elle est. Sans mesure, le vol vers le
   * bandeau partirait d'une position calculée — donc fausse dès qu'un texte
   * passe sur deux lignes ou qu'un appareil change de taille.
   */
  onFrame?: (cadre: { hauteur: number; largeur: number; x: number; y: number }) => void;
  subtitle: string;
  title: string;
}) {
  const scene = useRef<View>(null);
  return (
    <View style={styles.story}>
      <AnimatedView entering={ZoomIn.duration(480)} style={styles.mascotStage}>
        <View
          onLayout={() => {
            if (!onFrame) return;
            // `measureInWindow` et non les valeurs d'`onLayout` : celles-ci sont
            // RELATIVES au parent, inutilisables pour une couche posée à la
            // racine de l'écran.
            scene.current?.measureInWindow((x, y, largeur, hauteur) =>
              onFrame({ hauteur, largeur, x, y }));
          }}
          ref={scene}
          style={styles.mascotImage}
        >
          <ExpoImage contentFit="contain" source={image} style={styles.fill} />
        </View>
      </AnimatedView>
      <AnimatedView entering={FadeInDown.delay(140).duration(420)} style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </AnimatedView>
    </View>
  );
}

const WORLD_BOAT = require('../../../assets/onboarding/expedition/world-boat-loop.webp');

export function WorldStep() {
  const { t: copy } = useUiTranslation();
  return (
    <View style={styles.story}>
      <AnimatedView entering={ZoomIn.duration(520)} style={styles.mascotStage}>
        <ExpoImage contentFit="contain" source={WORLD_BOAT} style={styles.mascotImage} />
      </AnimatedView>
      <AnimatedView entering={FadeInDown.delay(180).duration(420)} style={styles.copy}>
        <Text style={styles.title}>{copy("ui_copy_008")}</Text>
        <Text style={styles.subtitle}>
          {copy("ui_copy_009")}</Text>
      </AnimatedView>
    </View>
  );
}

const SETUP_MESSAGES = [
  "ui_copy_230",
  "ui_copy_231",
  "ui_copy_232",
  "ui_copy_233",
  "ui_copy_234",
] as const;

export function SetupStep({ onDone }: { onDone: () => void }) {
  const { t: copy } = useUiTranslation();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index === SETUP_MESSAGES.length - 1) {
      // Une seule fois, à l'aboutissement. C'est le seul moment de l'onboarding
      // où quelque chose se termine vraiment avant la première carte.
      eclosion();
      const done = setTimeout(onDone, 650);
      return () => clearTimeout(done);
    }
    const next = setTimeout(() => setIndex((value) => value + 1), 480);
    return () => clearTimeout(next);
  }, [index, onDone]);

  return (
    <View style={styles.setup}>
      <ExpoImage contentFit="contain" source={MASCOT_CAMP} style={styles.mascotImage} />
      <Text style={styles.title}>{copy("ui_copy_010")}</Text>
      {/* L'écran d'intro PROMET (« tes réponses servent à t'orienter ») ; celui-ci
          CONSTATE. Répéter la promesse ici lui retirait son effet de récompense. */}
      <Text style={styles.subtitle}>{copy("ui_copy_011")}</Text>
      <View style={styles.setupTrack}>
        <View style={[styles.setupFill, { width: `${((index + 1) / SETUP_MESSAGES.length) * 100}%` }]} />
      </View>
      <AnimatedView entering={FadeIn.duration(220)} key={SETUP_MESSAGES[index]}>
        <Text style={styles.setupMessage}>{copy(SETUP_MESSAGES[index])}</Text>
      </AnimatedView>
    </View>
  );
}

export function TutorialStep({ phase }: { phase: 'find' | 'scan' | 'identify' }) {
  const { t: copy } = useUiTranslation();
  if (phase === 'find') {
    return (
      <View style={styles.tutorial}>
        <View style={styles.tutorialPhotoWrap}>
          <ExpoImage contentFit="cover" source={FIND_ANIMAL_PHOTO} style={styles.tutorialPhoto} />
          <View style={styles.binocularBadge}>
            <SymbolView name="binoculars.fill" size={25} tintColor="#ffffff" />
          </View>
        </View>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{copy("ui_copy_012")}</Text>
          <Text style={styles.title}>{copy("ui_copy_015")}</Text>
          <Text style={styles.subtitle}>{copy("ui_copy_016")}</Text>
        </View>
      </View>
    );
  }

  if (phase === 'scan') {
    return (
      <View style={styles.tutorial}>
        <View style={styles.scanFrame}>
          <ExpoImage contentFit="cover" source={FRAME_AND_SHOOT_PHOTO} style={styles.fill} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{copy("ui_copy_013")}</Text>
          <Text style={styles.title}>{copy("ui_copy_017")}</Text>
          <Text style={styles.subtitle}>{copy("ui_copy_018")}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.tutorial}>
      <View style={styles.tutorialPhotoWrap}>
        <ExpoImage contentFit="cover" source={IDENTIFIED_CAT_PREVIEW} style={styles.tutorialPhoto} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>{copy("ui_copy_014")}</Text>
        <Text style={styles.title}>{copy("ui_copy_019")}</Text>
        <Text style={styles.subtitle}>{copy("ui_copy_020")}</Text>
      </View>
    </View>
  );
}

/**
 * LE NOM, DEMANDÉ UNE FOIS — ET LE PSEUDO POSÉ SANS LE DEMANDER.
 *
 * CE QUE ÇA RÉPARE
 *
 * `_layout.tsx` dérive déjà un nom à chaque lancement :
 *
 *     user.fullName || user.username || emailName || 'Explorer'
 *
 * Avec « Connexion avec Apple », l'utilisateur peut masquer son nom ET son
 * e-mail. Clerk ne reçoit alors ni prénom ni nom, `username` est nul, et
 * l'adresse est un relais du type `k7x9m2p4@privaterelay.appleid.com`. Le
 * joueur s'appelle donc `k7x9m2p4` dans son propre profil. Ce n'est pas un cas
 * limite : c'est ce qu'Apple propose par défaut à chaque connexion.
 *
 * PRÉ-REMPLI, ET C'EST LE POINT. Qui arrive avec un vrai nom appuie sur
 * Continuer sans rien lire. La question ne coûte quelque chose qu'à ceux
 * qu'elle sauve.
 *
 * POURQUOI ON ÉCRIT DANS CLERK ET PAS DANS `profiles`
 *
 * `_layout.tsx` RÉÉCRIT `profiles.display_name` et `profiles.username` depuis
 * Clerk à chaque démarrage. Un nom posé dans la table serait effacé au
 * lancement suivant, sans erreur et sans trace. La synchronisation est à sens
 * unique : Clerk est la source.
 */
export function NameStep({ onDone }: { onDone: () => void }) {
  const { t: copy } = useUiTranslation();
  const { user } = useUser();
  const [nom, setNom] = useState(() => user?.fullName ?? user?.firstName ?? '');
  const [envoi, setEnvoi] = useState(false);
  const propre = nom.trim().slice(0, 40);

  const valider = async () => {
    if (!propre || !user) { onDone(); return; }
    setEnvoi(true);
    // Clerk n'a pas de champ « nom complet » : `fullName` est la concaténation
    // de prénom et nom. Tout ce qui suit le premier espace part donc en nom de
    // famille, et un nom en un seul mot laisse le champ vide.
    const [prenom, ...reste] = propre.split(/\s+/);
    await user.update({ firstName: prenom, lastName: reste.join(' ') }).catch(() => undefined);

    // LE PSEUDO, EN SILENCE. Aucun appel « est-il libre ? » n'existe côté
    // client : on tente, et on prend le suivant si Clerk refuse. Un échec
    // complet ne casse rien — le pseudo reste dérivable le jour où le
    // classement lui donnera un public.
    if (!user.username) {
      for (const candidat of candidatsPseudo(propre)) {
        const echec = await user.update({ username: candidat }).then(() => null, (e: unknown) => e);
        if (!echec) break;
        // ON NE PASSE AU SUIVANT QUE SI CELUI-CI EST VRAIMENT PRIS.
        //
        // Traiter toute erreur comme une collision brûlait un candidat sur une
        // simple coupure réseau : après six pannes, `janedoe` était perdu
        // alors qu'il était libre. Clerk nomme le cas — `form_identifier_exists`.
        // Toute autre erreur arrête la boucle : le pseudo reste dérivable plus
        // tard, il ne se dégrade pas maintenant.
        const codes = (echec as { errors?: { code?: string }[] })?.errors ?? [];
        if (!codes.some((c) => c.code === 'form_identifier_exists')) break;
      }
    }
    setEnvoi(false);
    onDone();
  };

  return (
    // LE SEUL ÉCRAN DE L'ONBOARDING QUI OUVRE UN CLAVIER. Sans lui, il recouvre
    // le champ ET le bouton : on tape à l'aveugle et on ne peut plus valider.
    // `KeyboardProvider` est déjà monté dans `_layout.tsx`.
    <KeyboardAvoidingView behavior="padding" style={styles.permission}>
      <View style={styles.permissionBody}>
        {/* Plus petite qu'ailleurs : cet écran est un formulaire, pas un temps
            d'histoire, et la mascotte de 290 ne laissait pas la place au champ
            une fois le clavier ouvert. */}
        <ExpoImage contentFit="contain" source={MASCOT_HELLO} style={styles.mascotPetite} />
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{copy("ui_copy_021")}</Text>
          <Text style={styles.title}>{copy("ui_copy_022")}</Text>
          <Text style={styles.subtitle}>
            {copy("ui_copy_023")}</Text>
        </View>
        <TextInput
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={40}
          onChangeText={setNom}
          placeholder={copy("ui_copy_024")}
          placeholderTextColor="#B7AE9F"
          // LA TOUCHE RETOUR NE VALIDE PAS, ELLE REFERME.
          //
          // `onSubmitEditing` faisait avancer d'un écran : on croyait ranger le
          // clavier, on se retrouvait à l'étape suivante sans avoir vu le nom
          // qu'on venait de taper. `blurOnSubmit` (le défaut) suffit — le
          // clavier tombe, le bouton réapparaît, et c'est lui qui fait avancer.
          returnKeyType="done"
          style={styles.champ}
          value={nom}
        />
      </View>
      <Press3D
        accessibilityLabel={copy("ui_copy_025")}
        borderRadius={18}
        disabled={envoi || propre.length === 0}
        faceStyle={styles.goldFace}
        onPress={() => void valider()}
        shadowColor={GOLD_DARK}
        style={styles.fullButton}
      >
        <Text style={styles.goldText}>{copy("auth_continue")}</Text>
      </Press3D>
    </KeyboardAvoidingView>
  );
}

export function CameraPermissionStep({ onDone }: { onDone: () => void }) {
  const { t: copy } = useUiTranslation();
  const { canRequestPermission, hasPermission, requestPermission } = useCameraPermission();
  const [asking, setAsking] = useState(false);

  const allow = async () => {
    if (asking) return;
    if (hasPermission) {
      onDone();
      return;
    }
    if (!canRequestPermission) {
      await Linking.openSettings().catch(() => undefined);
      return;
    }
    setAsking(true);
    try {
      await requestPermission();
      onDone(); // Le refus système ne bloque pas l'onboarding.
    } catch {
      onDone(); // Une caméra indisponible ne bloque pas non plus la suite.
    } finally {
      setAsking(false);
    }
  };

  return (
    <View style={styles.permission}>
      {/* CENTRÉ DANS L'ESPACE RESTANT, pas dans toute la page : ces deux étapes
          portent leur propre bouton au lieu d'utiliser le pied de page commun,
          et sans ce bloc il remontait au milieu — seul écran de l'onboarding
          où le bouton ne tombait pas au même endroit que partout ailleurs. */}
      <View style={styles.permissionBody}>
        <ExpoImage contentFit="contain" source={MASCOT_CAMERA} style={styles.mascotImage} />
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{copy("ui_copy_026")}</Text>
          <Text style={styles.title}>{copy("ui_copy_027")}</Text>
          <Text style={styles.subtitle}>
            {copy("ui_copy_028")}</Text>
        </View>
      </View>
      <Press3D
        accessibilityLabel={copy(!hasPermission && !canRequestPermission ? "ui_copy_236" : "auth_continue")}
        borderRadius={18}
        disabled={asking}
        faceStyle={styles.goldFace}
        onPress={() => void allow()}
        shadowColor={GOLD_DARK}
        style={styles.fullButton}
      >
        <Text style={styles.goldText}>
          {hasPermission || canRequestPermission ? copy("auth_continue") : copy("ui_copy_236")}
        </Text>
      </Press3D>
      {!hasPermission && !canRequestPermission ? (
        <Pressable onPress={onDone} style={styles.later}>
          <Text style={styles.laterText}>{copy("ui_copy_030")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const VICTORY_PROMISES = [
  ['camera.fill', "ui_copy_238"],
  ['arrow.up.right', "ui_copy_239"],
  ['book.closed.fill', "ui_copy_240"],
] as const;

/**
 * LA POSITION, DEMANDÉE UNE FOIS, AU BON MOMENT.
 *
 * POURQUOI ICI ET PAS AILLEURS
 *
 * Elle vient APRÈS la capture de démonstration : c'est le premier instant où
 * « où tu l'as vu » est une question qui a du sens plutôt qu'une formalité.
 * Posée avant la moindre carte, elle brûle la seule cartouche d'iOS pour une
 * promesse que le joueur ne peut pas encore se représenter.
 *
 * LE COÛT DE NE PAS LA POSER ICI
 *
 * Une capture faite sans position n'en aura JAMAIS — rien ne patche une ligne
 * après coup. Quelqu'un qui collectionne trente cartes puis s'abonne pour la
 * carte géographique la trouve vide, et le restera jusqu'à sa trente-et-unième
 * capture. `location-rules.ts` le dit déjà de l'écran map : « vendre
 * Naturaliste à quelqu'un dont la carte sera vide juste après l'achat, c'est le
 * remboursement assuré. » Ce pas-ci est ce qui empêche d'en arriver là.
 *
 * CE QU'ELLE NE VEND PAS : la carte géographique, qui est payante. On ne
 * demande jamais une permission au nom d'une fonctionnalité payante — sinon un
 * joueur gratuit n'a aucune raison d'accepter, et le stock qui vaudra
 * l'abonnement plus tard ne se constitue jamais. Ce qui est gratuit et vrai :
 * l'endroit est gravé sur la capture, et il ne se rattrape pas.
 */
export function LocationPermissionStep({ onDone }: { onDone: () => void }) {
  const { t: copy } = useUiTranslation();
  const { ask, gate, openSettings } = useLocationGate();
  const [asking, setAsking] = useState(false);

  // `unknown` = l'autorisation n'a pas encore été lue. On propose quand même :
  // `ask` retombe sur le dialogue système, et un bouton grisé une fraction de
  // seconde se lit comme une panne.
  const granted = gate === 'granted';

  const allow = async () => {
    if (granted) {
      onDone();
      return;
    }
    if (gate === 'settings') {
      openSettings();
      return;
    }
    setAsking(true);
    await ask().catch(() => undefined);
    setAsking(false);
    // On avance quel que soit le verdict : un refus est une réponse, et le
    // rappel existe déjà sur l'écran map le jour où il manquera.
    onDone();
  };

  return (
    <View style={styles.permission}>
      {/* CENTRÉ DANS L'ESPACE RESTANT, pas dans toute la page : ces deux étapes
          portent leur propre bouton au lieu d'utiliser le pied de page commun,
          et sans ce bloc il remontait au milieu — seul écran de l'onboarding
          où le bouton ne tombait pas au même endroit que partout ailleurs. */}
      <View style={styles.permissionBody}>
        <ExpoImage contentFit="contain" source={MASCOT_PLACE} style={styles.mascotImage} />
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{copy("ui_copy_031")}</Text>
          <Text style={styles.title}>{copy("ui_copy_032")}</Text>
          <Text style={styles.subtitle}>
            {copy("ui_copy_033")}</Text>
        </View>
      </View>
      <Press3D
        accessibilityLabel={copy(gate === 'settings' ? "ui_copy_236" : "auth_continue")}
        borderRadius={18}
        disabled={asking}
        faceStyle={styles.goldFace}
        onPress={() => void allow()}
        shadowColor={GOLD_DARK}
        style={styles.fullButton}
      >
        <Text style={styles.goldText}>
          {gate === 'settings' ? copy("ui_copy_236") : copy("auth_continue")}
        </Text>
      </Press3D>
      {gate === 'settings' ? (
        <Pressable onPress={onDone} style={styles.later}>
          <Text style={styles.laterText}>{copy("ui_copy_004")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function MasteryStep({ capture }: { capture?: AnimalCardData | null }) {
  const { t: copy } = useUiTranslation();
  const { height, width } = useWindowDimensions();
  const cardWidth = Math.min(width * 0.43, height * 0.225, 178);
  const scene = capture
    ? cardSceneFor(capture.scientificName, capture.rarity, { sceneSlug: capture.sceneSlug })
    : undefined;

  return (
    <View style={styles.victory}>
      <Text style={styles.eyebrow}>{copy("ui_copy_035")}</Text>
      <View style={[styles.victoryDeck, { height: cardWidth / 0.714 }]}>
        <View style={[styles.futureCard, styles.futureCardLeft]} />
        <View style={[styles.futureCard, styles.futureCardRight]} />
        {capture ? (
          <AnimalCard
            animated={false}
            contentScale={0.76}
            data={scene ? { ...capture, sceneAsset: scene } : capture}
            width={cardWidth}
          />
        ) : (
          <View style={[styles.capturePlaceholder, { height: cardWidth / 0.714, width: cardWidth }]}>
            <SymbolView name="pawprint.fill" size={42} tintColor={GOLD} />
          </View>
        )}
      </View>
      {/* LE TEXTE SUIT CE QUI S'EST RÉELLEMENT PASSÉ.
          Il affirmait « Ton premier animal est déjà à toi » dans TOUS les cas —
          y compris après un refus, quand aucune capture n'existe et que le
          cadre ne montre qu'une empreinte. Féliciter quelqu'un pour une carte
          qu'il n'a pas est la façon la plus rapide de lui apprendre à ne pas
          croire ce que l'app raconte. */}
      <View style={styles.victoryCopy}>
        <Text style={styles.title}>
          {capture ? copy("ui_copy_241") : copy("ui_copy_242")}
        </Text>
        <Text style={styles.subtitle}>
          {capture
            ? copy("ui_copy_243")
            : copy("ui_copy_244")}
        </Text>
      </View>
      <View style={styles.victoryPromises}>
        {VICTORY_PROMISES.map(([icon, label]) => (
          <View key={label} style={styles.victoryPromise}>
            <View style={styles.promiseIcon}>
              <SymbolView name={icon} size={17} tintColor={GOLD_DARK} weight="semibold" />
            </View>
            <Text style={styles.promiseText}>{copy(label)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function ReadyStep() {
  const { t: copy } = useUiTranslation();
  return (
    <View style={styles.ready}>
      <ExpoImage contentFit="contain" source={MASCOT_READY} style={styles.mascotImage} />
      <Text style={styles.eyebrow}>{copy("ui_copy_036")}</Text>
      <Text style={styles.title}>{copy("ui_copy_037")}</Text>
      <Text style={styles.subtitle}>{copy("ui_copy_038")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { height: '100%', width: '100%' },
  story: { flex: 1, justifyContent: 'center', gap: 24 },
  mascotStage: { alignItems: 'center', height: 300, justifyContent: 'center', width: '100%' },
  mascotImage: { alignSelf: 'center', height: 290, width: '100%' },
  mascotPetite: { alignSelf: 'center', height: 170, width: '100%' },
  copy: { alignItems: 'center', gap: 8 },
  title: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.brand,
    fontSize: 32,
    letterSpacing: -0.7,
    lineHeight: 37,
    textAlign: 'center',
  },
  subtitle: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 15,
    lineHeight: 22,
    maxWidth: 340,
    textAlign: 'center',
  },
  eyebrow: {
    color: GOLD_DARK,
    fontFamily: theme.fonts.bold,
    fontSize: 12,
    letterSpacing: 1.7,
    textAlign: 'center',
  },
  setup: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center' },
  setupTrack: {
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: 7,
    height: 14,
    marginTop: 12,
    overflow: 'hidden',
    width: '100%',
  },
  setupFill: { backgroundColor: GOLD, borderRadius: 7, height: '100%' },
  setupMessage: { color: theme.colors.foreground, fontFamily: theme.fonts.bold, fontSize: 15 },
  tutorial: { flex: 1, gap: 26, justifyContent: 'center' },
  tutorialPhotoWrap: { alignSelf: 'center', height: 300, width: 270 },
  tutorialPhoto: { borderRadius: 28, height: '100%', width: '100%' },
  binocularBadge: {
    alignItems: 'center',
    backgroundColor: GOLD,
    borderRadius: 26,
    bottom: -12,
    height: 52,
    justifyContent: 'center',
    position: 'absolute',
    right: -12,
    width: 52,
  },
  scanFrame: {
    alignSelf: 'center',
    borderRadius: 28,
    height: 300,
    overflow: 'hidden',
    position: 'relative',
    width: 270,
  },
  permission: { alignItems: 'center', flex: 1, gap: 12 },
  // `alignSelf: 'stretch'` N'EST PAS DÉCORATIF. Le parent `permission` porte
  // `alignItems: 'center'`, ce qui rétrécit ses enfants sur leur contenu. Sans
  // ce stretch, ce bloc s'effondre à la largeur du plus large texte — et tout
  // `width: '100%'` posé dedans se calcule sur cette largeur-là, d'où un champ
  // de saisie minuscule.
  permissionBody: { alignItems: 'center', alignSelf: 'stretch', flex: 1, gap: 18, justifyContent: 'center' },
  fullButton: { marginTop: 10, width: '100%' },
  goldFace: { backgroundColor: GOLD, height: 56 },
  goldText: { color: '#ffffff', fontFamily: theme.fonts.bold, fontSize: 17 },
  later: { padding: 12 },
  champ: {
    backgroundColor: theme.colors.surfaceMuted,
    borderCurve: 'continuous',
    borderRadius: 16,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 18,
    minHeight: 56,
    paddingHorizontal: 18,
    textAlign: 'center',
    width: '100%',
  },
  laterText: { color: theme.colors.muted, fontFamily: theme.fonts.medium, fontSize: 14 },
  victory: { alignItems: 'center', flex: 1, gap: 12, justifyContent: 'center' },
  victoryDeck: { alignItems: 'center', justifyContent: 'center', marginVertical: 3, position: 'relative', width: '100%' },
  futureCard: {
    backgroundColor: theme.colors.surfaceMuted,
    borderColor: theme.colors.border,
    borderRadius: 18,
    borderWidth: 1.5,
    height: '88%',
    opacity: 0.72,
    position: 'absolute',
    width: '39%',
  },
  futureCardLeft: { transform: [{ rotate: '-8deg' }, { translateX: -46 }] },
  futureCardRight: { transform: [{ rotate: '8deg' }, { translateX: 46 }] },
  capturePlaceholder: {
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    borderColor: GOLD,
    borderCurve: 'continuous',
    borderRadius: 20,
    borderWidth: 2,
    justifyContent: 'center',
  },
  victoryCopy: { alignItems: 'center', gap: 4, marginTop: 10 },
  victoryPromises: { gap: 7, marginTop: 2, width: '100%' },
  victoryPromise: { alignItems: 'center', flexDirection: 'row', gap: 11, paddingHorizontal: 8 },
  promiseIcon: {
    alignItems: 'center',
    backgroundColor: '#E3A93C1C',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  promiseText: { color: theme.colors.foreground, flex: 1, fontFamily: theme.fonts.medium, fontSize: 13, lineHeight: 17 },
  ready: { alignItems: 'center', flex: 1, gap: 14, justifyContent: 'center' },
}));
