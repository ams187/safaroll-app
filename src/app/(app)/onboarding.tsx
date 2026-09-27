import { translate } from '@/i18n';
import { useTranslation as useUiTranslation } from 'react-i18next';
import PaywallScreen from '@/app/(app)/paywall';
import { NotificationsStep } from '@/components/onboarding/asks';
import { AnimalMarquee } from '@/components/onboarding/animal-marquee';
import { OnboardingCamera } from '@/components/navigation/expandable-camera-tab-bar';
import {
  CameraPermissionStep,
  NameStep,
  LocationPermissionStep,
  MasteryStep,
  ReadyStep,
  SetupStep,
  StoryStep,
  TutorialStep,
  WorldStep,
} from '@/components/onboarding/expedition-steps';
import { QuestionStep, type OnboardingChoice } from '@/components/onboarding/question-step';
import { MissionCardsStep } from '@/components/onboarding/tarot-animal-cards';
import { Press3D } from '@/components/ui/press-3d';
import { APP_NAME } from '@/constants/app';
import { useOnboarding } from '@/lib/onboarding';
import { api } from '@/lib/supabase/api';
import { useBackendAuth, useMutation, useQuery } from '@/lib/supabase/backend';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  css,
  Easing,
  FadeIn,
  FadeInDown,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { claquement } from '@/lib/haptics';
import { StyleSheet } from 'react-native-unistyles';

const GOLD = '#E3A93C';
const GOLD_DARK = '#B77A20';
const MASCOT = require('../../../assets/onboarding/expedition/mascot-notes.webp');
const MASCOT_PREPARE = require('../../../assets/onboarding/expedition/mascot-notes-loop.webp');
const GUIDE_WELCOME = require('../../../assets/onboarding/expedition/guide-welcome-loop.webp');

const blockOut = css.keyframes({ from: { width: 0 }, to: { width: '33.33%' } });
const blockIn = css.keyframes({ from: { width: '33.33%' }, to: { width: 0 } });
const rotateIn = css.keyframes({
  '0%': { transform: [{ rotate: '8deg' }] },
  '100%': { transform: [{ rotate: '0deg' }] },
});
const rotateOut = css.keyframes({
  '0%': { transform: [{ rotate: '0deg' }] },
  '100%': { transform: [{ rotate: '8deg' }] },
});
const curtainAnimations = css.create({
  curtain: {
    animationName: [rotateIn, rotateOut],
    animationDuration: ['0.8s', '0.8s'],
    animationTimingFunction: ['ease-in-out', 'ease-in-out'],
    animationDelay: ['0s', '1.7s'],
    animationFillMode: ['both', 'forwards'],
  },
  block1: {
    animationName: [blockOut, blockIn],
    animationDuration: ['0.7s', '0.7s'],
    animationTimingFunction: ['ease-in-out', 'ease-in-out'],
    animationDelay: ['0.2s', '1.9s'],
    animationFillMode: ['both', 'forwards'],
  },
  block2: {
    animationName: [blockOut, blockIn],
    animationDuration: ['0.7s', '0.7s'],
    animationTimingFunction: ['ease-in-out', 'ease-in-out'],
    animationDelay: ['0.1s', '1.8s'],
    animationFillMode: ['both', 'forwards'],
  },
  block3: {
    animationName: [blockOut, blockIn],
    animationDuration: ['0.7s', '0.7s'],
    animationTimingFunction: ['ease-in-out', 'ease-in-out'],
    animationDelay: ['0s', '1.7s'],
    animationFillMode: ['both', 'forwards'],
  },
});

function CurtainHalf({ mirrored = false }: { mirrored?: boolean }) {
  return (
    <View style={[styles.curtainHalf, mirrored ? styles.curtainRight : styles.curtainLeft]}>
      <Animated.View style={[styles.curtainBlocks, curtainAnimations.curtain]}>
        <Animated.View style={[styles.curtainBlock, mirrored ? styles.sandDark : styles.sandLight, curtainAnimations.block1]} />
        <Animated.View style={[styles.curtainBlock, mirrored ? styles.sandLight : styles.sandDark, curtainAnimations.block2]} />
        <Animated.View style={[styles.curtainBlock, mirrored ? styles.sandDark : styles.sandLight, curtainAnimations.block3]} />
      </Animated.View>
    </View>
  );
}

function PaywallCurtain({ onCovered, onFinished }: { onCovered: () => void; onFinished: () => void }) {
  useEffect(() => {
    const covered = setTimeout(onCovered, 1_200);
    const finished = setTimeout(onFinished, 2_700);
    return () => {
      clearTimeout(covered);
      clearTimeout(finished);
    };
  }, [onCovered, onFinished]);

  return (
    <View pointerEvents="none" style={styles.curtainWrapper}>
      <CurtainHalf />
      <CurtainHalf mirrored />
    </View>
  );
}

const INTERESTS: OnboardingChoice[] = [
  { icon: require('../../../assets/onboarding/expedition/mammals.webp'), label: "ui_copy_218", value: 'mammals' },
  { icon: require('../../../assets/onboarding/expedition/birds.webp'), label: "ui_copy_219", value: 'birds' },
  { icon: require('../../../assets/onboarding/expedition/bugs.webp'), label: "ui_copy_220", value: 'bugs' },
  { icon: require('../../../assets/onboarding/expedition/marine.webp'), label: "ui_copy_221", value: 'marine' },
  { icon: require('../../../assets/onboarding/expedition/reptiles.webp'), label: "ui_copy_222", value: 'reptiles' },
  { icon: require('../../../assets/onboarding/expedition/everything.webp'), label: "ui_copy_223", value: 'everything' },
];
const HABITATS: OnboardingChoice[] = [
  { icon: require('../../../assets/onboarding/expedition/city.webp'), label: "ui_copy_224", value: 'city' },
  { icon: require('../../../assets/onboarding/expedition/park.webp'), label: "ui_copy_225", value: 'park' },
  { icon: require('../../../assets/onboarding/expedition/water.webp'), label: "ui_copy_226", value: 'water' },
  { icon: require('../../../assets/onboarding/expedition/travel.webp'), label: "ui_copy_227", value: 'travel' },
];
const SOURCES: OnboardingChoice[] = [
  { brandIcon: 'app-store-ios', icon: require('../../../assets/onboarding/expedition/app-store.webp'), label: 'App Store', value: 'app_store' },
  { brandIcon: 'tiktok', icon: require('../../../assets/onboarding/expedition/tiktok.webp'), label: 'TikTok', value: 'tiktok' },
  { brandIcon: 'instagram', icon: require('../../../assets/onboarding/expedition/instagram.webp'), label: 'Instagram', value: 'instagram' },
  { brandIcon: 'youtube', icon: require('../../../assets/onboarding/expedition/youtube.webp'), label: 'YouTube', value: 'youtube' },
  { icon: require('../../../assets/onboarding/expedition/friend.webp'), label: "ui_copy_228", value: 'friend' },
  { icon: require('../../../assets/onboarding/expedition/other.webp'), label: "ui_copy_229", value: 'other' },
];

const FLOW = [
  'meet',
  // AVANT TOUT LE RESTE APRÈS L'ACCUEIL : ce qui suit s'adresse à quelqu'un, et
  // « Explorer » n'est pas quelqu'un. Voir `NameStep` pour le cas Apple, qui
  // rend le défaut illisible plutôt que générique.
  'name',
  'world', 'mission',
  // ANNONCE LES QUESTIONS AVANT DE LES POSER. Trois écrans de questions qui
  // tombent sans prévenir se lisent comme un formulaire ; annoncés, ils se
  // lisent comme une préparation. Même mise en page que `meet` — c'est le même
  // geste, un pas d'histoire.
  'personalize',
  'interests', 'habitats', 'source', 'setup',
  'tutorial-find', 'tutorial-scan', 'tutorial-identify', 'permission', 'camera',
  // APRÈS `camera`, ET C'EST LE POINT. La position se demande une fois la
  // première carte vue — avant, « où tu l'as vu » ne veut rien dire et brûle
  // la seule cartouche d'iOS. Après, c'est une question qui a un objet.
  'location',
  'mastery', 'paywall', 'notifications', 'ready',
] as const;
type Step = (typeof FLOW)[number];

function HeroStep({ onStart }: { onStart: () => void }) {
  const { t: copy } = useUiTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.hero}>
      <AnimalMarquee />
      <View style={[styles.heroCopy, { paddingBottom: insets.bottom + 20 }]}>
        <Animated.View entering={FadeInDown.duration(450)}>
          <Text style={styles.brand}>{APP_NAME}</Text>
        </Animated.View>
        <Text style={styles.heroTitle}>{copy("ui_copy_170")}</Text>
        <Text style={styles.heroSubtitle}>
          {copy("ui_copy_171")}</Text>
        <PrimaryButton label={copy("ui_copy_172")} onPress={onStart} />
      </View>
    </View>
  );
}


/** Taille de la mascotte dans le bandeau — voir `styles.headerMascot`. */
const BANDEAU_MASCOTTE = { hauteur: 64, largeur: 59 };
/** La marge horizontale de la page — voir `styles.page`. */
const MARGE_PAGE = 22;

type Cadre = { hauteur: number; largeur: number; x: number; y: number };

/**
 * LA MASCOTTE QUI REJOINT SON PERCHOIR.
 *
 * Entre « Préparons ton expédition » et la première question, elle passe du
 * centre de l'écran au coin du bandeau. Sans ce vol, elle DISPARAÎT d'un écran
 * pour RÉAPPARAÎTRE minuscule ailleurs, et rien ne dit que c'est la même — le
 * lien entre l'annonce et les questions se perd dans la coupure.
 *
 * POURQUOI UNE COUCHE À LA RACINE
 *
 * Les deux écrans ne coexistent jamais : `content` est remplacé d'un coup. Un
 * élément partagé ne peut donc pas être porté par l'un des deux. Cette copie
 * vit au-dessus des deux, part du cadre MESURÉ par `StoryStep` et atterrit sur
 * la position calculée du bandeau.
 *
 * POURQUOI `translate` + `scale` ET NON `width`/`height`
 *
 * Les transformations tournent sur le fil d'interface ; animer la taille
 * repasse par la mise en page à chaque image. Sur une mascotte de 290 px de
 * haut, la différence se voit.
 */
function VolMascotte({ depart, onFini }: { depart: Cadre; onFini: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const avance = useSharedValue(0);

  // L'arrivée est CALCULÉE et non mesurée : la mascotte du bandeau n'est pas
  // encore montée au moment où le vol part — on la fait apparaître seulement
  // quand il se pose.
  const arriveeCx = width - MARGE_PAGE - BANDEAU_MASCOTTE.largeur / 2;
  const arriveeCy = insets.top + 10 + BANDEAU_MASCOTTE.hauteur / 2;
  const departCx = depart.x + depart.largeur / 2;
  const departCy = depart.y + depart.hauteur / 2;
  const echelle = BANDEAU_MASCOTTE.hauteur / depart.hauteur;

  useEffect(() => {
    avance.value = withTiming(1, { duration: 620, easing: Easing.inOut(Easing.cubic) },
      (fini) => { if (fini) runOnJS(onFini)(); });
  }, [avance, onFini]);

  const style = useAnimatedStyle(() => {
    const t = avance.value;
    return {
      // Un léger arc plutôt qu'une ligne droite : la mascotte monte un peu
      // avant de se poser, ce qui se lit comme un saut et non comme un
      // glissement.
      transform: [
        { translateX: (arriveeCx - departCx) * t },
        { translateY: (arriveeCy - departCy) * t - Math.sin(t * Math.PI) * 46 },
        { scale: 1 + (echelle - 1) * t },
        { rotate: `${Math.sin(t * Math.PI) * 9}deg` },
      ],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          height: depart.hauteur,
          left: depart.x,
          position: 'absolute',
          top: depart.y,
          width: depart.largeur,
        },
        style,
      ]}
    >
      <Image contentFit="contain" source={MASCOT} style={styles.fill} />
    </Animated.View>
  );
}

function ProgressHeader({
  index,
  onBack,
  showNotes = false,
  showBack = true,
}: {
  index: number;
  onBack: () => void;
  showNotes?: boolean;
  showBack?: boolean;
}) {
  const { t: copy } = useUiTranslation();
  return (
    <View style={styles.header}>
      {showBack ? <Pressable
        accessibilityLabel={copy("ui_copy_173")}
        accessibilityRole="button"
        hitSlop={10}
        onPress={onBack}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <SymbolView name="chevron.left" size={19} tintColor="#27211A" weight="bold" />
      </Pressable> : <View style={styles.back} />}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${((index + 1) / FLOW.length) * 100}%` }]} />
      </View>
      {/* L'EMPLACEMENT EST TOUJOURS RÉSERVÉ, seule l'opacité change.
          En le retirant du bandeau, la barre — qui est en `flex: 1` — gagnait
          la largeur libérée : son remplissage, exprimé en POURCENTAGE, s'allongeait
          d'un coup, puis rétrécissait au retour de la mascotte. On voyait donc la
          progression avancer puis reculer, alors que l'étape, elle, n'avait pas
          bougé. Une barre de progression qui recule est pire qu'une barre figée. */}
      <Image
        contentFit="contain"
        source={MASCOT}
        style={[styles.headerMascot, !showNotes && styles.invisible]}
      />
    </View>
  );
}

function PrimaryButton({ disabled = false, label, onPress }: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Press3D
      accessibilityLabel={label}
      borderRadius={22}
      disabled={disabled}
      faceStyle={[styles.buttonFace, disabled && styles.buttonDisabled]}
      onPress={onPress}
      shadowColor={disabled ? '#D8D3CA' : GOLD_DARK}
      style={styles.button}
    >
      <Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>{label}</Text>
    </Press3D>
  );
}

function labelFor(step: Step) {
  if (step === 'meet') return translate("ui_copy_211");
  if (step === 'world') return translate("ui_copy_212");
  if (step === 'mission') return translate("ui_copy_213");
  if (step === 'personalize') return translate("ui_copy_214");
  if (step === 'tutorial-identify') return translate("ui_copy_215");
  if (step === 'mastery') return translate("ui_copy_216");
  if (step === 'ready') return translate("ui_copy_217");
  return translate("auth_continue");
}

export default function OnboardingScreen() {
  const { t: copy } = useUiTranslation();
  const { resume } = useLocalSearchParams<{ resume?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { completeOnboarding, markIntroSeen } = useOnboarding();
  const { isSignedIn } = useBackendAuth();
  const saveSource = useMutation(api.profile.setAcquisitionSource);
  const [index, setIndex] = useState(() => resume ? FLOW.indexOf(resume as Step) : -1);
  const [interests, setInterests] = useState<string[]>([]);
  const [habitats, setHabitats] = useState<string[]>([]);
  const [source, setSource] = useState<string[]>([]);
  const [firstCaptureId, setFirstCaptureId] = useState<string | null>(null);
  const firstCapture = useQuery(api.animals.getCapture, firstCaptureId ? { id: firstCaptureId } : 'skip');
  const reduceMotion = useReducedMotion();
  const [bridgingToPaywall, setBridgingToPaywall] = useState(false);
  const revealPaywall = useCallback(() => setIndex(FLOW.indexOf('paywall')), []);
  // Le cadre de la mascotte sur l'écran d'annonce, et le vol en cours.
  const cadreMascotte = useRef<Cadre | null>(null);
  const [vol, setVol] = useState<Cadre | null>(null);
  const finishPaywallTransition = useCallback(() => setBridgingToPaywall(false), []);
  const openPaywall = useCallback(() => {
    if (reduceMotion) revealPaywall();
    else setBridgingToPaywall(true);
  }, [reduceMotion, revealPaywall]);

  const next = () => setIndex((value) => Math.min(value + 1, FLOW.length - 1));
  const back = () => setIndex((value) => Math.max(value - 1, -1));
  const step = index >= 0 ? FLOW[index] : null;
  const paywallCurtain = bridgingToPaywall ? (
    <PaywallCurtain
      key="paywall-curtain"
      onCovered={revealPaywall}
      onFinished={finishPaywallTransition}
    />
  ) : null;

  if (!step) return <HeroStep onStart={() => {
    markIntroSeen();
    if (isSignedIn) next();
    else router.replace('/(auth)/sign-in');
  }} />;

  if (step === 'paywall') {
    return <View style={styles.full}><PaywallScreen onClose={next} />{paywallCurtain}</View>;
  }
  if (step === 'camera') {
    return (
      <OnboardingCamera
        onClose={back}
        onCaptureComplete={(captureId) => {
          setFirstCaptureId(captureId ?? null);
          // VERS `location`, PAS `mastery`. Ce saut court-circuitait l'ordre du
          // FLOW : la caméra rendait la main plus loin dans la liste, donc
          // toute étape posée juste après elle était enjambée sans trace.
          setIndex(FLOW.indexOf('location'));
        }}
      />
    );
  }

  const shell = (content: ReactNode) => (
    <View style={[styles.page, { paddingBottom: insets.bottom + 16, paddingTop: insets.top + 10 }]}>
      <ProgressHeader index={index} onBack={back} showBack={step !== 'permission' && step !== 'location'} />
      <View style={styles.body}>{content}</View>
    </View>
  );
  if (step === 'notifications') return shell(<NotificationsStep onDone={next} />);
  if (step === 'setup') return shell(<SetupStep onDone={next} />);
  if (step === 'name') return shell(<NameStep onDone={next} />);
  if (step === 'permission') return shell(<CameraPermissionStep onDone={next} />);
  if (step === 'location') return shell(<LocationPermissionStep onDone={next} />);

  let content: ReactNode;
  if (step === 'meet') content = (
    <StoryStep
      image={GUIDE_WELCOME}
      subtitle={copy("ui_copy_174")}
      title={copy("ui_copy_175")}
    />
  );
  else if (step === 'personalize') content = (
    <StoryStep
      image={MASCOT_PREPARE}
      onFrame={(cadre) => { cadreMascotte.current = cadre; }}
      subtitle={copy("ui_copy_176")}
      title={copy("ui_copy_177")}
    />
  );
  else if (step === 'world') content = <WorldStep />;
  else if (step === 'mission') content = <MissionCardsStep />;
  else if (step === 'interests') content = <QuestionStep choices={INTERESTS} multiple onChange={setInterests} selected={interests} title={copy("ui_copy_178")} />;
  else if (step === 'habitats') content = <QuestionStep choices={HABITATS} multiple onChange={setHabitats} selected={habitats} title={copy("ui_copy_179")} />;
  else if (step === 'source') content = <QuestionStep choices={SOURCES} onChange={setSource} selected={source} title={copy("ui_copy_180")} />;
  else if (step === 'tutorial-find') content = <TutorialStep phase="find" />;
  else if (step === 'tutorial-scan') content = <TutorialStep phase="scan" />;
  else if (step === 'tutorial-identify') content = <TutorialStep phase="identify" />;
  else if (step === 'mastery') content = <MasteryStep capture={firstCapture} />;
  else content = <ReadyStep />;

  const disabled = (step === 'interests' && interests.length === 0)
    || (step === 'habitats' && habitats.length === 0)
    || (step === 'source' && source.length === 0);
  const advance = () => {
    // Le vol part AVANT le changement d'écran : `content` est remplacé d'un
    // coup, donc la mascotte d'origine aura disparu à l'image suivante.
    // Rien ne vole quand le système demande moins de mouvement : la mascotte
    // du bandeau apparaît simplement, ce qu'elle faisait avant ce vol.
    if (step === 'personalize' && cadreMascotte.current && !reduceMotion) setVol(cadreMascotte.current);
    if (step === 'source') void saveSource({ source: source[0] }).catch(() => undefined);
    if (step === 'mastery') {
      openPaywall();
    }
    else if (step === 'ready') completeOnboarding();
    else next();
  };

  return (
    <View style={styles.full}>
      <Animated.View style={[styles.page, { paddingBottom: insets.bottom + 16, paddingTop: insets.top + 10 }]}>
        <ProgressHeader
          index={index}
          onBack={back}
          showNotes={!vol && (step === 'interests' || step === 'habitats' || step === 'source')}
        />
        <Animated.View entering={FadeIn.duration(240)} key={step} style={styles.body}>{content}</Animated.View>
        <PrimaryButton disabled={disabled || bridgingToPaywall} label={labelFor(step)} onPress={advance} />
      </Animated.View>
      {vol ? (
        <VolMascotte
          depart={vol}
          onFini={() => {
            // La retombée se sent au moment où l'image se pose. C'est ce qui
            // relie le mouvement au corps ; sans elle le vol reste décoratif.
            claquement();
            setVol(null);
          }}
        />
      ) : null}
      {paywallCurtain}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  full: { flex: 1 },
  fill: { height: '100%', width: '100%' },
  invisible: { opacity: 0 },
  page: { backgroundColor: theme.colors.background, flex: 1, paddingHorizontal: 22 },
  hero: { backgroundColor: theme.colors.background, flex: 1 },
  heroCopy: { alignItems: 'center', gap: 10, paddingHorizontal: 22 },
  brand: { color: theme.colors.foreground, fontFamily: theme.fonts.brand, fontSize: 25 },
  heroTitle: { color: theme.colors.foreground, fontFamily: theme.fonts.brand, fontSize: 31, lineHeight: 35, textAlign: 'center' },
  heroSubtitle: { color: theme.colors.muted, fontFamily: theme.fonts.medium, fontSize: 15, lineHeight: 21, marginBottom: 8, textAlign: 'center' },
  // BANDEAU RELEVÉ SUR LA RÉFÉRENCE, pas réglé à l'œil : capture 1170 px de
  // large, soit 3 px/pt sur un écran de 390. Bouton 44, barre 12 de haut,
  // écart 12, mascotte 76 × 82.
  header: { alignItems: 'center', flexDirection: 'row', gap: 12, height: 64 },
  back: { alignItems: 'center', backgroundColor: theme.colors.surfaceMuted, borderCurve: 'continuous', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  progressTrack: { backgroundColor: theme.colors.surfaceMuted, borderRadius: 6, flex: 1, height: 12, overflow: 'hidden' },
  progressFill: { backgroundColor: GOLD, borderRadius: 6, height: '100%' },
  // CALÉE SUR LA HAUTEUR DU BANDEAU, ratio d'origine conservé (76/82). À 82
  // dans un bandeau de 64 elle débordait en haut et en bas — d'où l'impression
  // de trop-plein.
  headerMascot: { height: 64, width: 59 },
  body: { flex: 1 },
  button: { marginTop: 12, width: '100%' },
  buttonFace: { backgroundColor: GOLD, height: 58 },
  buttonDisabled: { backgroundColor: theme.colors.surfaceMuted },
  buttonText: { color: '#ffffff', fontFamily: theme.fonts.bold, fontSize: 18 },
  buttonTextDisabled: { color: theme.colors.faint },
  curtainWrapper: {
    height: '130%',
    left: 0,
    position: 'absolute',
    top: 0,
    width: '100%',
    zIndex: 100,
  },
  curtainHalf: {
    height: '100%',
    position: 'absolute',
    width: '50%',
  },
  curtainLeft: { left: 0 },
  curtainRight: { right: 0, transform: [{ scaleX: -1 }] },
  curtainBlocks: {
    flexDirection: 'row',
    height: '100%',
    left: 0,
    position: 'absolute',
    top: 0,
    transformOrigin: 'top right',
    width: '100%',
  },
  curtainBlock: { height: '100%', position: 'relative', width: 0 },
  sandLight: { backgroundColor: '#E6BB61' },
  sandDark: { backgroundColor: '#D39A32' },
  pressed: { opacity: 0.72 },
}));
