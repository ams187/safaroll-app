import { uiLanguage } from '@/i18n/current';
import { AnimalCard, type AnimalCardData } from '@/components/animals/animal-card';
import { SubjectLiftReveal } from '@/components/capture/subject-lift-reveal';
import { identityFor } from '@/components/cards/card-identity';
import { CardReveal } from '@/components/cards/card-reveal';
import { MoltenBackdrop } from '@/components/cards/molten-backdrop';
import { accentOn, inkOn } from '@/components/cards/color';
import { CARD_RATIO } from '@/components/cards/holo-card';
import { AnimatedView } from '@/components/ui/animated-view';
import { consumePendingCapture, requestExpandableCamera } from '@/components/navigation/expandable-camera-state';
import type { ExifLocation } from '@/lib/exif';
import { consumeForcedCaptureQualityAssessment } from '@/lib/camera/capture-quality-debug';
import { enqueue } from '@/lib/animals/capture-queue';
import { beginCaptureAttempt, cancelCaptureAttempt } from '@/lib/animals/capture-attempt';
import { dominantColorFor } from '@/lib/animals/dominant-color';
import { shrinkForIdentification } from '@/lib/animals/photo-payload';
import {
  assessScreenCapture,
  SCREEN_WARN_THRESHOLD,
  type ScreenSuspicion,
} from '@/lib/animals/screen-capture-guard';
import { lumaSampleFor } from '@/lib/animals/screen-sample';
import { markFreshCapture } from '@/lib/animals/fresh-capture';
import { cardRarity } from '@/lib/animals/rarity';
import { masteryProgressEvent, speciesMastery } from '@/lib/animals/progression';
import { usePremium } from '@/lib/premium';
import {
  exportCaptureAssets,
  useCaptureExportPreferences,
  type CaptureExportPreferences,
} from '@/lib/capture-export';
import { useCreateAnimalCapture } from '@/lib/animals/use-create-capture';
import { ANIMAL_COUPE_ACTIF, GARDE_ECRAN_ACTIF, REFUS_CONTREFACON_ACTIF } from '@/lib/launch-flags';
import { announce, toast } from '@/lib/notify';
import { api } from '@/lib/supabase/api';
import type { Id } from '@/lib/supabase/api';
import { backendQuery, useAction, useMutation, useQuery as useBackendQuery } from '@/lib/supabase/backend';
import { supabase } from '@/lib/supabase/client';
import { uploadImage } from '@/lib/supabase/storage';
import { queryClient } from '@/lib/query-client';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@clerk/expo';
import { Asset } from 'expo-asset';
import * as Haptics from 'expo-haptics';
import { File } from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image as NativeImage,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import type { Image as PreviewImage } from 'react-native-nitro-image';
import { Canvas, ColorMatrix, Image as SkiaImage, useImage } from '@shopify/react-native-skia';
import {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  runOnJS,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';
import { assessCaptureQuality, classifyAnimal, classifySubject, isAvailable as subjectLiftAvailable, isCaptureQualityAvailable, isClassifierAvailable, liftSubject, type CaptureQualityAssessment, type CaptureQualityIssue, type StickerSubjectBounds, withCaptureQualityDecision } from 'subject-lift';

type Phase = 'extracting' | 'identifying';

/**
 * The reveal is lit by the animal's own colour. Until one has been sampled it
 * falls back to a cold moon-silver rather than the brand gold: "not coloured
 * yet" should look like waiting, not like a decision.
 */
const NEUTRAL_ACCENT = '#9fb4d0';
/** Neutral void — the cards carry the colour, the stage never competes. */
const STAGE_BACKGROUND = '#05060a';
/**
 * Longest the lift may hold the screen AFTER the identification has landed.
 * The flight itself takes ~600ms; this only catches a completion callback
 * that never fires (no sticker ever produced, component churn), so the card
 * still appears — on the raw photo if it must.
 */
const LIFT_CEILING_MS = 2500;
/** Le délai entre la carte posée et la feuille de position qui monte. */
/** Laisse d'abord vivre la photo, comme le temps réel pris par le détourage Vision. */
const ONBOARDING_LIFT_DELAY_MS = 450;
const ONBOARDING_CHEETAH_MODULE = require('../../../assets/onboarding/expedition/cheetah-sticker.webp');
const ONBOARDING_CHEETAH_OUTLINE_MODULE = require('../../../assets/onboarding/expedition/cheetah-sticker-outline.webp');
const ONBOARDING_CHEETAH = NativeImage.resolveAssetSource(ONBOARDING_CHEETAH_MODULE).uri;
const ONBOARDING_CHEETAH_OUTLINE = NativeImage.resolveAssetSource(ONBOARDING_CHEETAH_OUTLINE_MODULE).uri;
const ONBOARDING_CAPTURE: AnimalCardData = {
  get commonName() { return uiLanguage() === 'fr' ? 'Guépard' : 'Cheetah'; },
  get commonNameLocale() { return uiLanguage() === 'fr' ? 'Guépard' : 'Cheetah'; },
  dominantColor: '#D69A25',
  inAtlas: true,
  rarity: 'very_rare',
  sceneSlug: 'acinonyx-jubatus',
  scientificName: 'Acinonyx jubatus',
  status: 'ready',
  stickerUrl: ONBOARDING_CHEETAH_OUTLINE,
  taxonomy: {
    kingdom: 'Animalia',
    phylum: 'Chordata',
    class: 'Mammalia',
    order: 'Carnivora',
    family: 'Felidae',
    genus: 'Acinonyx',
  },
};
const NO_CAPTURE_EXPORT: CaptureExportPreferences = { card: false, photo: false, sticker: false };

async function saveOnboardingCheetah(
  userId: string,
  uri: string,
  width: number,
  height: number,
): Promise<Id<'animalCaptures'>> {
  const { data: existing, error: lookupError } = await supabase
    .from('animal_captures')
    .select('id')
    .eq('user_id', userId)
    .eq('is_onboarding_capture', true)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (existing?.id) {
    await queryClient.invalidateQueries({ queryKey: ['supabase', 'animals.listCaptures'] });
    return existing.id as Id<'animalCaptures'>;
  }

  const [photo, stickerAsset] = await Promise.all([
    shrinkForIdentification(uri),
    Asset.fromModule(ONBOARDING_CHEETAH_OUTLINE_MODULE).downloadAsync(),
  ]);
  const stickerUri = stickerAsset.localUri ?? stickerAsset.uri;
  const [originalPath, stickerPath] = await Promise.all([
    uploadImage('capture-originals', userId, photo.uri, photo.contentType),
    uploadImage('capture-stickers', userId, stickerUri, 'image/png'),
  ]);
  const { data: captureId, error } = await supabase.rpc('create_onboarding_cheetah_capture', {
    p_aspect_ratio: (width || 1) / (height || 1),
    p_original_path: originalPath,
    p_sticker_path: stickerPath,
  });
  if (error || !captureId) throw new Error(error?.message ?? 'Onboarding capture creation failed');
  await queryClient.invalidateQueries({ queryKey: ['supabase', 'animals.listCaptures'] });
  return captureId as Id<'animalCaptures'>;
}

/**
 * En dessous, le classifieur d'Apple ne voit AUCUN animal — et on refuse avant
 * le moindre envoi.
 *
 * Repère mesuré : une manette de PS5 rend 0.001, avec `cord`, `art` et
 * `decoration` en tête. Ce n'est pas « peu sûr », c'est un zéro. Le seuil reste
 * donc collé au plancher : il ne coupe que ce qui n'a rien d'un animal, et
 * laisse passer tout le reste — y compris les prises douteuses, que BioCLIP et
 * le seuil `needs_review` du serveur trient ensuite.
 */
const SEUIL_AUCUN_ANIMAL = 0.02;

/**
 * LA PELUCHE, LA FIGURINE, L'ÉCRAN — CE QUI A LA FORME D'UN ANIMAL SANS EN ÊTRE UN.
 *
 * Le portail au-dessus ne sait dire que « il n'y a aucun animal là-dedans ».
 * Devant une peluche il n'a rien à redire : c'est bien la forme d'un animal.
 * Apple, lui, sait la nommer — son vocabulaire porte `stuffed_animals`, `toy`,
 * `doll`, `figurine`, `puppet`, `statue`, et `screenshot`, `television`,
 * `painting` pour l'image d'une image.
 *
 * MESURÉ SUR LES DEUX CAS, avec le même sujet — un guépard :
 *
 *            étiquette animale        contrefaçon
 *   peluche       0.029  (précision non)   0.618  toy / stuffed_animals 0.62
 *   vivant        0.888  (précision OUI)   0.094  television
 *
 * D'où deux conditions, et la seconde est celle qui protège les rencontres :
 * la contrefaçon doit être FRANCHE (au-dessus du plancher) ET dominer nettement
 * l'étiquette animale. Un vrai animal à 0.888 devrait afficher plus de 1.7 de
 * « jouet » pour être refusé — impossible. La peluche, elle, sort à 21× son
 * propre score animal.
 *
 * Le sens de l'erreur est le même que partout sur ce chemin : laisser passer un
 * objet coûte une carte à supprimer, refuser une vraie rencontre coûte un
 * moment qui ne reviendra pas.
 */
const SEUIL_CONTREFACON = 0.35;
const FACTEUR_CONTREFACON = 2;

/** Plafond d'attente du portail. Il répond normalement en quelques dizaines de ms. */
const DELAI_PORTAIL_MS = 600;

/**
 * Ce qu'on accepte d'attendre pour l'avis d'Apple sur le sujet, à la création
 * de la capture. Il a normalement fini depuis longtemps — il démarre ~1 s plus
 * tôt, pendant le détourage et le téléversement. Cette borne n'est là que pour
 * qu'un cas pathologique ne se paie pas sur le temps que l'utilisateur passe à
 * regarder un animal trembler.
 */
const DELAI_SUJET_MS = 150;
/** Le coach ne doit jamais rallonger sensiblement le rituel s'il déraille. */
const DELAI_QUALITE_MS = 700;

const QUALITY_COPY: Record<CaptureQualityIssue, { body: string; title: string }> = {
  low_quality: { body: 'reveal_body_low_quality', title: 'reveal_title_low_quality' },
  subject_clipped: { body: 'reveal_body_subject_clipped', title: 'reveal_title_subject_clipped' },
  subject_too_far: { body: 'reveal_body_subject_too_far', title: 'reveal_title_subject_too_far' },
  too_dark: { body: 'reveal_body_too_dark', title: 'reveal_title_too_dark' },
};
const DELAI_POSITION_MS = 700;

/**
 * Sépia intégral : le cliché sans animal est un tirage raté du carnet, pas une
 * capture. La photo perd sa couleur pour dire « rien de vivant ici » — la
 * couleur, dans toute l'app, appartient aux animaux.
 */
const SEPIA_MATRIX = [
  0.393, 0.769, 0.189, 0, 0,
  0.349, 0.686, 0.168, 0, 0,
  0.272, 0.534, 0.131, 0, 0,
  0, 0, 0, 1, 0,
];

// Le view natif du gel d'écran. Import gardé, comme tous les modules natifs :
// un build sans NitroImage tourne quand même, le gel retombe sur le spinner.
type FrozenViewProps = { image: PreviewImage; style?: StyleProp<ViewStyle> };
let FrozenImageView: ComponentType<FrozenViewProps> | null = null;
try {
  FrozenImageView = (require('react-native-nitro-image') as { NativeNitroImage: ComponentType<FrozenViewProps> })
    .NativeNitroImage;
} catch {
  FrozenImageView = null;
}

/** Le tirage sépia posé de travers sur la table, bord de papier compris. */
function MissedPrint({ uri, width: printWidth }: { uri: string; width: number }) {
  const photo = useImage(uri);
  const printHeight = printWidth * (4 / 3);
  return (
    <View style={styles.missedPrint}>
      <View style={{ width: printWidth, height: printHeight, borderRadius: 5, overflow: 'hidden' }}>
        <Canvas style={{ width: printWidth, height: printHeight }}>
          {photo ? (
            <SkiaImage fit="cover" height={printHeight} image={photo} width={printWidth} x={0} y={0}>
              <ColorMatrix matrix={SEPIA_MATRIX} />
            </SkiaImage>
          ) : null}
        </Canvas>
      </View>
    </View>
  );
}

export default function CameraScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { cameraSource, pendingCapture } = useLocalSearchParams<{
    cameraSource?: string;
    pendingCapture?: string;
  }>();
  const insets = useSafeAreaInsets();
  const createAnimalCapture = useCreateAnimalCapture();
  // Ouvert par la tab bar à l'appui du déclencheur : la photo est encore en
  // cours d'écriture, cet écran n'a pas à montrer son propre viseur — il est
  // déjà la scène de révélation.
  // CETTE ROUTE NE MONTRE PLUS DE VISEUR. ELLE NE FAIT QUE LA RÉVÉLATION.
  //
  // Il y avait ici un deuxième appareil photo, plein écran, avec sa propre
  // en-tête « VISE · CAPTURE · COLLECTIONNE ». Deux viseurs pour une app qui
  // n'a qu'un geste de capture : celui de la barre d'onglets, qui se déplie
  // sous le pouce. Le doublon n'était atteignable que par trois portes — deux
  // écrans Amber hors navigation et une action rapide — et chacune renvoyait
  // l'utilisateur sur une caméra qui n'était pas la vraie.
  //
  // On n'entre donc plus ici que porté par un cliché en vol (`pendingCapture`).
  // Sans lui, la route se referme et rouvre la vraie caméra.
  const [phase, setPhase] = useState<Phase>('extracting');
  // Le gel d'écran : l'image de prévisualisation que le capteur livre dès le
  // début de la capture. La scène l'affiche à la place d'un spinner jusqu'à
  // ce que la vraie photo soit écrite et que le lift prenne le relais.
  const [frozenFrame, setFrozenFrame] = useState<PreviewImage | null>(null);
  /** Non nul quand le garde a reconnu un écran : la capture n'est jamais créée. */
  const [screenSuspicion, setScreenSuspicion] = useState<ScreenSuspicion | null>(null);


  /** Non nul quand le classifieur d'Apple ne voit aucun animal : aucune ligne créée. */
  const [aucunAnimal, setAucunAnimal] = useState(false);
  /** Le serveur a refusé la capture — plafond quotidien. Voir le `catch` plus bas. */
  const [energieEpuisee, setEnergieEpuisee] = useState(false);
  /** L'étiquette d'Apple quand la photo montre un objet à forme d'animal. */
  const [contrefacon, setContrefacon] = useState<string | null>(null);
  /** Conseil bloquant avant création ; « garder » reprend exactement le même pipeline. */
  const [qualityWarning, setQualityWarning] = useState<CaptureQualityAssessment | null>(null);
  const qualityDecision = useRef<((decision: 'keep' | 'retake') => void) | null>(null);
  const [originalUri, setOriginalUri] = useState<string | null>(null);
  const [stickerUri, setStickerUri] = useState<string | null>(null);
  const [stickerDataUri, setStickerDataUri] = useState<string | null>(null);
  const [subjectUri, setSubjectUri] = useState<string | null>(null);
  const [subjectBounds, setSubjectBounds] = useState<StickerSubjectBounds | null>(null);
  // The in-place cutout owns the screen until it hands off; the card ritual
  // only starts once the sticker has flown onto its waiting spot.
  const [lifted, setLifted] = useState(false);
  const [sampledColor, setSampledColor] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [captureId, setCaptureId] = useState<Id<'animalCaptures'> | null>(null);
  const handledInitialCapture = useRef(false);
  const captureAttempt = useRef(0);
  const onboardingComplete = useRef<((captureId?: string) => void) | null>(null);
  const demoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [demoCapture, setDemoCapture] = useState<AnimalCardData | null>(null);
  const { data: storedCapture } = useQuery({
    ...backendQuery(api.animals.getCapture, { id: captureId! }),
    enabled: captureId !== null,
    // Realtime makes the happy path instant, but it must never be the only way
    // out of the reveal. A missed database event previously left the animal
    // vibrating forever even though BioCLIP had already finished server-side.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === undefined || status === 'processing' ? 1_000 : false;
    },
  });
  const capture = demoCapture ?? storedCapture;
  const warmup = useAction(api.animalId.warmup);
  const { isPremium } = usePremium();
  const { user } = useUser();
  const captureExport = useCaptureExportPreferences(user?.id);

  // Boot the GPU while the shot is being framed, not after the shutter.
  useEffect(() => {
    void warmup().catch(() => undefined);
  }, [warmup]);

  useEffect(() => {
    if (capture?.status === 'ready' && process.env.EXPO_OS === 'ios') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [capture?.status]);

  const deleteCapture = useMutation(api.animals.deleteCapture);

  const cancelIdentification = () => {
    cancelCaptureAttempt(captureAttempt);
    const id = captureId;
    if (id) void deleteCapture({ id }).catch(() => undefined);
    retake();
  };

  const retake = () => {
    if (demoTimer.current) clearTimeout(demoTimer.current);
    qualityDecision.current?.('retake');
    qualityDecision.current = null;
    setQualityWarning(null);
    // Plus de repli `reset()` vers le viseur autonome : il n'existe plus.
    if (cameraSource !== 'onboarding') requestExpandableCamera();
    router.back();
  };

  const keepQualityWarning = () => {
    qualityDecision.current?.('keep');
    qualityDecision.current = null;
    setQualityWarning(null);
  };

  useEffect(
    () => () => {
      if (demoTimer.current) clearTimeout(demoTimer.current);
      handledInitialCapture.current = false;
      qualityDecision.current?.('retake');
      qualityDecision.current = null;
    },
    [],
  );

  const leaveStaleCameraRoute = useCallback(() => {
    if (cameraSource === 'onboarding') {
      router.replace({ pathname: '/onboarding', params: { resume: 'camera' } });
      return;
    }
    router.replace('/(tabs)/(home)');
  }, [cameraSource, router]);

  // iOS ne tue pas forcément l'app quand on la ferme : le modal et son état
  // `identifying` peuvent rester suspendus tels quels. Une analyse onboarding
  // interrompue ne reprend donc jamais au retour ; elle repart du viseur.
  useEffect(() => {
    if (
      cameraSource !== 'onboarding'
      || capture?.status === 'ready'
      || capture?.status === 'needs_review'
    ) return;
    const abort = () => {
      cancelCaptureAttempt(captureAttempt);
      if (captureId) void deleteCapture({ id: captureId }).catch(() => undefined);
      leaveStaleCameraRoute();
    };
    const timeout = setTimeout(abort, 12_000);
    let interrupted = AppState.currentState !== 'active';
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        interrupted = true;
        return;
      }
      if (!interrupted) return;
      interrupted = false;
      abort();
    });
    return () => {
      clearTimeout(timeout);
      subscription.remove();
    };
  }, [capture?.status, cameraSource, captureId, deleteCapture, leaveStaleCameraRoute]);

  /** Cette route n'est qu'une révélation. Un reload détruit la promesse photo
   * en mémoire : on remplace alors la route au lieu d'appeler `back()` sur une
   * pile vide et de laisser réapparaître l'ancien viseur supprimé. */
  useEffect(() => {
    if (pendingCapture === '1') return;
    leaveStaleCameraRoute();
  }, [leaveStaleCameraRoute, pendingCapture]);

  const processPhoto = useCallback(
    async (
      uri: string,
      width: number,
      height: number,
      capturedAt?: number,
      location?: ExifLocation,
      captureSource: 'camera' | 'library' = 'camera',
    ) => {
      const cancelled = beginCaptureAttempt(captureAttempt);
      setOriginalUri(uri);
      setPhase('extracting');
      // The wait between the shutter and the card is the app's worst number, and
      // it has already been misdiagnosed once from a stale code comment. Each
      // stage prints what it actually cost, so the next slow capture names its
      // own culprit instead of inviting another guess.
      const started = Date.now();
      let mark = started;
      const lap = (stage: string) => {
        const now = Date.now();
        // Gardé : `console.log` traverse le pont natif, et ce chemin est un
        // budget de latence. Hermes élimine le bloc entier en release.
        if (__DEV__) console.log(`[capture] ${stage} ${now - mark}ms (total ${now - started}ms)`);
        mark = now;
      };
      // One decode, three consumers. Vision's segmentation model works at its own
      // low resolution and upscales the mask, but everything CoreImage does after
      // it — matte, outline, crop, PNG encode — is paid per pixel, which is why
      // the cut-out lagged behind a 12 MP capture. Handing it a 1600px copy is
      // most of the delay gone, and the same file is what gets uploaded and what
      // the colour is sampled from.
      const photo = await shrinkForIdentification(uri);
      if (cancelled()) return;
      lap(`shrink (${photo.contentType})`);

      // Démarré tôt et attendu tard : Vision travaille pendant les deux gardes
      // existants, il n'ajoute donc normalement aucune attente perceptible.
      // Tout échec ou dépassement du plafond laisse passer la rencontre.
      const forcedQuality = __DEV__ && captureSource === 'camera'
        ? consumeForcedCaptureQualityAssessment()
        : null;
      // Une seule vignette sert au garde anti-écran ET à la luminosité. Les
      // deux analyses démarrent avec Vision afin de ne rien sérialiser.
      const lumaCheck = lumaSampleFor(photo.uri);
      const qualityCheck: Promise<CaptureQualityAssessment | null> = forcedQuality
        ? Promise.resolve(forcedQuality)
        : captureSource === 'camera' && isCaptureQualityAvailable
          ? Promise.race([
              assessCaptureQuality(photo.uri).catch(() => null),
              new Promise<null>((resolve) => setTimeout(resolve, DELAI_QUALITE_MS)),
            ])
          : Promise.resolve(null);

      // « Ça, c'est un écran. » Une photo de photo n'est pas une prise : toute
      // la promesse du jeu est d'y avoir été. Le contrôle passe AVANT
      // `createCapture` — refuser après coup laisserait une ligne à nettoyer et
      // un appel serveur pour rien. C'est un décodage local, pas un envoi : il
      // ne remet pas de réseau devant la capture. `lap` mesure son vrai coût,
      // comme chaque étape de ce chemin.
      //
      // On ne lui donne PAS d'EXIF : `writeUprightCapture` réencode la photo et
      // les données d'objectif ne survivent pas. Prétendre qu'elles manquent
      // serait une charge contre chaque capture réelle — le garde répond
      // « aucune preuve » sur un EXIF absent, ce qui est la bonne réponse. Le
      // moiré, lui, est le signal qui marche sur une VRAIE photo d'écran.
      // Le garde ne tourne pas en dev : tester l'app depuis son canapé avec un
      // animal à l'écran est un besoin de développement, pas une triche. Même
      // porte que `unlimitedCaptures` plus haut — `__DEV__` seul, jamais un
      // réglage exposé au joueur : une case « accepter les écrans » en prod
      // viderait le garde de tout son sens.
      if (GARDE_ECRAN_ACTIF && !__DEV__) {
        const sample = await lumaCheck;
        lap('screen-guard');
        const suspicion = assessScreenCapture({ ...(sample ?? {}) });
        if (cancelled()) return;
        if (suspicion.score >= SCREEN_WARN_THRESHOLD) {
          setScreenSuspicion(suspicion);
          return;
        }
      }

      /**
       * LE PORTAIL D'APPLE.
       *
       * Le portail CLIP côté serveur s'est révélé inutilisable : mesuré sur
       * quarante images, il donne 1.000 « animal » à une VOITURE et 0.945 à un
       * tube de dentifrice. D'où ce second avis, rendu par le classifieur
       * d'Apple — un modèle entraîné, multi-étiquettes, avec ses propres seuils
       * calibrés — plutôt que par des phrases écrites à la main.
       *
       * IL NE REFUSE QUE L'ÉVIDENT. `SEUIL_AUCUN_ANIMAL` est délibérément
       * minuscule : mesuré sur une manette de PS5, Apple rend 0.001 — il ne
       * voit pas « peu d'animal », il n'en voit AUCUN. Un vrai animal, même
       * photographié de loin, de nuit ou de dos, ne descend pas là.
       *
       * Le sens de l'erreur est choisi : laisser passer un objet coûte une
       * carte à supprimer ; refuser un vrai animal coûte une rencontre que le
       * joueur ne refera pas. Le portail penche donc franchement vers
       * l'acceptation.
       *
       * ET IL NE FAIT JAMAIS ATTENDRE. Au-delà de `DELAI_PORTAIL_MS`, on passe
       * — le classifieur tourne sur le Neural Engine en quelques dizaines de
       * millisecondes, ce plafond n'est là que pour qu'une anomalie ne coûte
       * jamais une capture.
       *
       * Il refuse AVANT `createCapture` : pas d'envoi, pas de ligne en base à
       * nettoyer, pas d'appel Modal facturé.
       */
      // DÉCLARÉ HORS DU `if` PARCE QU'IL SERT DEUX FOIS.
      //
      // Le portail ci-dessous s'en sert pour REFUSER ; `createCapture`, plus
      // bas, s'en sert pour ARBITRER — Apple tranche quand BioCLIP répond une
      // espèce sauvage sur un animal domestique. Deux usages, un seul calcul :
      // le classifieur ne tourne pas deux fois.
      let verdict: Awaited<ReturnType<typeof classifyAnimal>> | null = null;
      let etiquettesSujet: Promise<{ confidence: number; identifier: string }[]> = Promise.resolve([]);
      if (isClassifierAvailable) {
        verdict = await Promise.race([
          classifyAnimal(photo.uri).catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), DELAI_PORTAIL_MS)),
        ]);
        if (cancelled()) return;
        lap('portail Apple');
        if (verdict && __DEV__) {
          const sommet = verdict.top
            .map((t) => `${t.identifier}=${t.confidence.toFixed(2)}`)
            .join('  ');
          console.log(
            `[apple] animal=${verdict.animalConfidence.toFixed(3)}` +
              ` (${verdict.animalLabel || 'aucune étiquette animale'})` +
              ` précision-apple=${verdict.meetsApplePrecision ? 'OUI' : 'non'}\n` +
              // Cherché sur TOUTES les observations, pas dans le top 5 : la
              // taxonomie d'Apple propage la confiance de la feuille à la
              // racine, donc un seul animal reconnu remplit les cinq places.
              `[apple] faux=${verdict.fakeConfidence.toFixed(3)}` +
              ` (${verdict.fakeLabel || 'aucune'})\n` +
              `[apple] top5 : ${sommet}`,
          );
        }
        // Lancé ici, JAMAIS attendu ici. Le détourage coûte quelques centaines
        // de millisecondes ; dans la course du portail il lui faisait dépasser
        // `DELAI_PORTAIL_MS` et éteignait les refus. Son résultat n'est lu qu'à
        // la création de la capture, après le téléversement.
        etiquettesSujet = classifySubject(photo.uri).catch(() => []);

        // `null` = le portail n'a pas répondu à temps ou a échoué. On accepte :
        // une capture perdue pèse plus lourd qu'un objet à supprimer.
        if (verdict && verdict.animalConfidence < SEUIL_AUCUN_ANIMAL) {
          setAucunAnimal(true);
          return;
        }
        if (
          REFUS_CONTREFACON_ACTIF
          && verdict
          && verdict.fakeConfidence >= SEUIL_CONTREFACON
          && verdict.fakeConfidence > verdict.animalConfidence * FACTEUR_CONTREFACON
        ) {
          setContrefacon(verdict.fakeLabel);
          return;
        }
      }

      const [nativeQuality, qualityLuma] = await Promise.all([qualityCheck, lumaCheck]);
      const meanLuma = qualityLuma?.luma.length
        ? qualityLuma.luma.reduce((sum, value) => sum + value, 0) / qualityLuma.luma.length
        : undefined;
      const quality = forcedQuality ?? withCaptureQualityDecision({
        ...(nativeQuality ?? {}),
        meanLuma,
        subjectClipped: ANIMAL_COUPE_ACTIF ? nativeQuality?.subjectClipped : false,
      });
      if (__DEV__ && !forcedQuality) console.log('[quality]', quality);
      if (cancelled()) return;
      lap('coach Apple');
      if (quality?.shouldRetake && quality.issue) {
        const decision = await new Promise<'keep' | 'retake'>((resolve) => {
          qualityDecision.current = resolve;
          setQualityWarning(quality);
        });
        qualityDecision.current = null;
        if (decision === 'retake' || cancelled()) return;
        setQualityWarning(null);
      }

      // Still not awaited: whatever Vision costs at this size, the upload and
      // BioCLIP have no reason to queue behind it.
      const lift = (subjectLiftAvailable ? liftSubject(photo.uri).catch(() => null) : Promise.resolve(null)).then(
        (sticker) => {
          lap('subject-lift');
          if (cancelled()) return sticker?.hasSubject ? sticker.uri : null;
          if (!sticker?.hasSubject) {
            // Nothing to lift out of the photo — go straight to the ritual.
            setLifted(true);
            return null;
          }
          setStickerUri(sticker.uri);
          setSubjectUri(sticker.subjectUri ?? null);
          setSubjectBounds(sticker.subjectBounds ?? null);
          void new File(sticker.uri)
            .base64()
            .then((base64) => {
              if (!cancelled()) setStickerDataUri(`data:image/png;base64,${base64}`);
            })
            .catch(() => undefined);
          // Sampled here purely to light the wait: the extractor caches, so the
          // artwork upload reads the same swatch for free.
          void dominantColorFor(sticker.uri).then((color) => {
            if (!cancelled() && color) setSampledColor(color);
          });
          return sticker.uri;
        },
      );

      try {
        setPhase('identifying');
        const id = await createAnimalCapture({
          onStage: lap,
          photo,
          sticker: lift,
          captureSource,
          width: width || 1,
          height: height || 1,
          capturedAt,
          location,
          // BORNÉ, comme le portail. Au moment où on arrive ici, le détourage
          // a eu tout le téléversement pour finir — mais « en général » n'est
          // pas une garantie, et ce chemin est un budget de latence. Si la
          // liste n'est pas prête, on part sans : le serveur n'arbitrera pas,
          // la capture ne ralentit pas d'une milliseconde.
          visionLabels: await Promise.race([
            etiquettesSujet,
            new Promise<never[]>((resolve) => setTimeout(() => resolve([]), DELAI_SUJET_MS)),
          ]),
        });
        if (cancelled()) {
          void deleteCapture({ id }).catch(() => undefined);
          return;
        }
        setCaptureId(id);
      } catch (error) {
        if (cancelled()) return;
        // LE SERVEUR A RÉPONDU NON : on ne met pas en file, on le dit.
        //
        // Remettre en file une capture refusée la fait repartir contre un
        // plafond qui ne bouge qu'à minuit — et pendant ce temps l'écran
        // affiche une analyse qui n'arrivera jamais, parce qu'aucune ligne
        // n'existe à interroger.
        if ((error as { refusServeur?: boolean })?.refusServeur) {
          setEnergieEpuisee(true);
          return;
        }
        // Out of range is the normal case for a wildlife app, not an error: keep
        // the capture on disk and identify it the moment Supabase is reachable.
        console.warn('Animal capture queued for later:', error);
        enqueue({
          capturedAt,
          captureSource,
          height: height || 1,
          location,
          originalUri: photo.uri,
          contentType: photo.contentType,
          stickerUri: await lift,
          width: width || 1,
        });
        setQueued(true);
      }
    },
    [createAnimalCapture, deleteCapture],
  );

  useEffect(() => {
    if (handledInitialCapture.current) return;
    if (pendingCapture !== '1') return;
    handledInitialCapture.current = true;
    const pendingShot = consumePendingCapture();
    if (
      !pendingShot
      || typeof pendingShot.startedAt !== 'number'
      || Date.now() - pendingShot.startedAt > 15_000
    ) {
      leaveStaleCameraRoute();
      return;
    }
    onboardingComplete.current = pendingShot.onboarding?.complete ?? null;
    if (!pendingShot.onboarding?.demoSubjectBounds) {
      void pendingShot.preview.then((image) => image && setFrozenFrame(image));
    }
    void (async () => {
      try {
        const written = await pendingShot.shot;
        if (pendingShot.onboarding?.demoSubjectBounds) {
          if (!user?.id) throw new Error('Not authenticated');
          setOriginalUri(written.uri);
          setPhase('identifying');
          setSampledColor('#D69A25');
          const savingCapture = saveOnboardingCheetah(user.id, written.uri, written.width, written.height);
          await new Promise<void>((resolve) => {
            demoTimer.current = setTimeout(resolve, ONBOARDING_LIFT_DELAY_MS);
          });
          setSubjectUri(ONBOARDING_CHEETAH);
          setStickerUri(ONBOARDING_CHEETAH_OUTLINE);
          setSubjectBounds({
            ...pendingShot.onboarding.demoSubjectBounds,
            imageHeight: written.height,
            imageWidth: written.width,
          });
          // `SubjectLiftReveal` prend ensuite 450 ms pour dessiner le liseré,
          // puis 2,1 s pour charger le frémissement. Livrer le résultat avant
          // ce plateau supprimerait précisément le rituel montré ailleurs.
          const captureId = await Promise.all([
            savingCapture,
            new Promise<void>((resolve) => {
              demoTimer.current = setTimeout(resolve, 4200 - ONBOARDING_LIFT_DELAY_MS);
            }),
          ]).then(([id]) => id);
          setCaptureId(captureId);
          setDemoCapture({ ...ONBOARDING_CAPTURE, _id: captureId });
          return;
        }
        const location = await Promise.race([
          pendingShot.location,
          new Promise<undefined>((resolve) => setTimeout(resolve, DELAI_POSITION_MS)),
        ]);
        await processPhoto(written.uri, written.width, written.height, undefined, location, 'camera');
      } catch (error) {
        if (__DEV__) console.error('[onboarding capture]', error);
        announce.fail(t('capture_failed_title'), t('capture_failed_photo'));
        leaveStaleCameraRoute();
      }
    })();
  }, [leaveStaleCameraRoute, pendingCapture, processPhoto, t, user?.id]);

  const reveal = (
    <View style={StyleSheet.absoluteFill}>
      <CaptureReveal
        bottomInset={insets.bottom}
        capture={capture ?? undefined}
        continueOnly={cameraSource === 'onboarding'}
        frozenFrame={frozenFrame}
        aucunAnimal={aucunAnimal}
        energieEpuisee={energieEpuisee}
        contrefacon={contrefacon}
        qualityWarning={qualityWarning}
        screenSuspicion={screenSuspicion}
        identificationStarted={phase === 'identifying'}
        isPremium={cameraSource === 'onboarding' ? false : isPremium}
        captureExport={cameraSource === 'onboarding' ? NO_CAPTURE_EXPORT : captureExport}
        // `replace` swapped the modal for a *second* tab layout instead of
        // closing it, which is why leaving the camera stacked a page on top
        // of the one already underneath. `dismissTo` pops the modal and
        // lands on the collection that was there all along.
        onClose={() => {
          if (cameraSource === 'onboarding') {
            onboardingComplete.current?.(captureId ?? capture?._id);
            router.back();
            return;
          }
          router.dismissTo('/(tabs)/(home)');
        }}
        onCancel={cancelIdentification}
        onRedo={retake}
        originalUri={originalUri}
        queued={queued}
        lifted={lifted}
        onLifted={() => setLifted(true)}
        onKeepQualityWarning={keepQualityWarning}
        sampledColor={sampledColor}
        stickerDataUri={stickerDataUri}
        stickerUri={stickerUri}
        subjectBounds={subjectBounds}
        subjectUri={subjectUri}
        topInset={insets.top}
      />
    </View>
  );

  return (
    // UNE VUE ORDINAIRE, ET C'EST UN CORRECTIF.
    //
    // C'était un second `GestureHandlerRootView`, imbriqué dans celui de
    // `src/app/_layout.tsx`. Le paquet demande qu'il enveloppe l'app UNE fois ;
    // imbriqué dans un écran qu'un autre modal vient couvrir — le paywall
    // ouvert depuis le refus d'énergie — il cessait de livrer les touches à sa
    // fermeture, et tous les boutons de l'écran mouraient sans erreur.
    //
    // Il ne servait à rien : ce fichier n'utilise aucun `GestureDetector`.
    <View style={styles.cameraRoot}>
      <View pointerEvents="none" style={styles.backgroundBubble} />
      {reveal}
    </View>
  );
}

function CaptureReveal({
  aucunAnimal,
  energieEpuisee,
  contrefacon,
  bottomInset,
  capture,
  captureExport,
  continueOnly = false,
  frozenFrame,
  qualityWarning,
  screenSuspicion,
  identificationStarted,
  isPremium,
  lifted,
  onCancel,
  onClose,
  onKeepQualityWarning,
  onLifted,
  onRedo,
  originalUri,
  queued,
  sampledColor,
  stickerDataUri,
  stickerUri,
  subjectBounds,
  subjectUri,
  topInset,
}: {
  bottomInset: number;
  capture?: AnimalCardData;
  captureExport: CaptureExportPreferences;
  /** L'onboarding garde tout le rituel, mais une seule sortie : continuer. */
  continueOnly?: boolean;
  /** Le gel d'écran : la prévisualisation capteur, avant la vraie photo. */
  frozenFrame: PreviewImage | null;
  /** Le garde a reconnu un écran — aucune capture n'a été créée. */
  aucunAnimal: boolean;
  energieEpuisee: boolean;
  contrefacon: string | null;
  /** Vision juge le cliché très faible, avant toute création en base. */
  qualityWarning: CaptureQualityAssessment | null;
  screenSuspicion: ScreenSuspicion | null;
  identificationStarted: boolean;
  isPremium: boolean;
  /** The animal has finished leaving its photo. */
  lifted: boolean;
  /** Annuler pendant l'analyse : jette la capture et rouvre la caméra. */
  onCancel: () => void;
  onClose: () => void;
  onKeepQualityWarning: () => void;
  onLifted: () => void;
  /**
   * Ouvre la feuille de position. Fourni seulement quand la position manque —
   * son absence est ce qui retire l'accroche, plutôt qu'un test dans le rendu.
   */
  onRedo: () => void;
  originalUri: string | null;
  /** No connection — the capture is on disk, waiting for a signal. */
  queued: boolean;
  sampledColor: string | null;
  stickerDataUri: string | null;
  subjectBounds: StickerSubjectBounds | null;
  subjectUri: string | null;
  stickerUri: string | null;
  topInset: number;
}) {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  // `CaptureReveal` est un composant à part : il n'hérite pas du `router` de
  // l'écran caméra. Le sien lui sert à ouvrir le paywall depuis le refus
  // d'énergie, seul endroit où l'illimité répond à ce qui vient de bloquer.
  const router = useRouter();
  const allCaptures = useBackendQuery(api.animals.listCaptures, {});
  const { height: windowHeight, width } = useWindowDimensions();
  // The card is 1.4x taller than wide, so on a short phone the height budget —
  // not the width — is what decides how big it can be.
  const cardWidth = Math.min(width - 48, 340, (windowHeight - 320) * CARD_RATIO);
  const complete = capture?.status === 'ready' || capture?.status === 'needs_review';

  // Every light in the ritual is the animal's own. Once the row exists the card
  // system's own glow is authoritative — that way the wait and the card that
  // lands are literally the same colour, instead of two palettes meeting.
  const accent = useMemo(
    () => (capture?.dominantColor ? identityFor(capture).glow : accentOn(sampledColor ?? NEUTRAL_ACCENT)),
    [capture, sampledColor],
  );
  const accentInk = useMemo(() => inkOn(accent), [accent]);

  const previousCaptures = (allCaptures ?? []).filter((other) => other._id !== capture?._id);
  const isOwnedSpecies =
    complete &&
    capture.scientificName !== undefined &&
    allCaptures !== undefined &&
    previousCaptures.some(
      (other) =>
        (other.status === 'ready' || other.status === 'needs_review') &&
        other.scientificName === capture.scientificName,
    );
  // First capture of this species ever → the whole screen celebrates.
  const isNewSpecies =
    complete &&
    capture.scientificName !== undefined &&
    allCaptures !== undefined &&
    !isOwnedSpecies;

  const failed = capture?.status === 'failed';

  // The whole wait lives on the photo now: the animal frets IN its own scene,
  // dimmed around it, until the identification lands — then it flies straight
  // onto the card. The card stage only exists after that flight, with the
  // subject already exactly where CardStrike floats it, so the swap is
  // invisible and the strike fires immediately.
  const ready = complete || failed || queued;
  // CardReveal freezes this decision on mount. Never mount a successful
  // reveal while the collection is still unknown (unknown is not "owned").
  // Failed/offline captures must remain closable without fetching a collection.
  const discoveryResolved = !complete || allCaptures !== undefined;
  const showCard = identificationStarted && lifted && ready && discoveryResolved;

  /**
   * LA SORTIE DE LA CARTE, AVANT QUE LA MODALE SE FERME.
   *
   * `onClose` fermait la modale sèchement : la carte disparaissait avec elle,
   * et la grille apparaissait d'un coup. Aucun lien entre les deux images.
   *
   * Elle refait maintenant son trajet d'arrivée à l'envers — elle rétrécit et
   * remonte — puis la modale se ferme. La grille, elle, fait poser la nouvelle
   * carte dans sa première tuile (voir `collection-screen`). Chaque moitié se
   * joue là où elle est visible : viser une tuile PRÉCISE depuis ici n'aurait
   * rien donné, la collection n'est pas montée derrière cette modale et l'œil
   * ne verrait la carte voler que sur du noir.
   *
   * L'écrasement de fin est celui de `use-card-morph` : 0,82 sur 70 ms. Sans
   * lui, la carte s'arrête net et on lit une animation coupée.
   */
  const exitScale = useSharedValue(1);
  const exitY = useSharedValue(0);
  const exitOpacity = useSharedValue(1);
  const [leaving, setLeaving] = useState(false);

  const leave = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    // La collection ne peut pas deviner qu'une carte vient d'arriver : elle est
    // remontée par `dismissTo`, donc tout état local y est perdu. On le lui
    // dit — voir `fresh-capture.ts`.
    if (capture?._id) markFreshCapture(String(capture._id));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    exitScale.set(withSpring(0.26, { damping: 26, stiffness: 200, mass: 0.9 }));
    exitY.set(withSpring(-(cardWidth / CARD_RATIO) * 0.34, { damping: 26, stiffness: 200, mass: 0.9 }));
    exitOpacity.set(
      withTiming(0, { duration: 260 }, (finished) => {
        if (finished) runOnJS(onClose)();
      }),
    );
  }, [capture, cardWidth, exitOpacity, exitScale, exitY, leaving, onClose]);

  const exitStyle = useAnimatedStyle(() => ({
    opacity: exitOpacity.get(),
    transform: [{ translateY: exitY.get() }, { scale: exitScale.get() }],
  }));
  const showLift = !showCard && originalUri !== null;

  // The lift hands off on its own animation callback. The ceiling only arms
  // once the identification is in: before that, sitting on the photo IS the
  // ritual — cutting it short would skip the wait, not rescue it.
  useEffect(() => {
    if (!showLift || !ready) return;
    const timer = setTimeout(onLifted, LIFT_CEILING_MS);
    return () => clearTimeout(timer);
  }, [onLifted, ready, showLift]);
  const [struck, setStruck] = useState(false);
  const [tiltHintVisible, setTiltHintVisible] = useState(true);
  const finishStrike = useCallback(() => setStruck(true), []);
  const revealOpened = struck;
  const cardExportRef = useRef<View | null>(null);
  const exportedCapture = useRef<string | null>(null);
  const showFooter = revealOpened && ready;
  const capturesForProgress =
    capture && !allCaptures?.some((other) => other._id === capture._id)
      ? [...(allCaptures ?? []), capture]
      : (allCaptures ?? []);
  const speciesKey = capture?.scientificName ?? capture?.commonName;
  const mastery = speciesMastery(capturesForProgress, speciesKey);
  const previousMastery = speciesMastery(previousCaptures, speciesKey);
  const masteryEvent = masteryProgressEvent(previousMastery, mastery);
  // The lifted PNG is already on disk, while its uploaded copy only catches up
  // after the identification — until then the server's `stickerUrl` falls back
  // to the rectangular photo, which would un-cut the animal mid-reveal.
  const cardData: AnimalCardData = {
    ...(capture ?? { status: failed ? ('failed' as const) : ('processing' as const) }),
    mastery,
    stickerUrl: stickerDataUri ?? stickerUri ?? capture?.stickerUrl ?? originalUri,
  };

  useEffect(() => {
    const exportKey = capture?._id ? String(capture._id) : originalUri;
    if (
      !isPremium ||
      !complete ||
      !revealOpened ||
      !originalUri ||
      !exportKey ||
      exportedCapture.current === exportKey ||
      !Object.values(captureExport).some(Boolean)
    ) return;

    exportedCapture.current = exportKey;
    void exportCaptureAssets({
      cardRef: cardExportRef,
      name: capture?.commonName ?? capture?.scientificName ?? 'SafaRoll',
      originalUri,
      preferences: captureExport,
      stickerUri,
    }).catch(() => {
      toast.fail(t('capture_export_failed_title'), t('capture_export_failed_body'));
    });
  }, [capture, captureExport, complete, isPremium, originalUri, revealOpened, stickerUri, t]);

  // LES DEUX REFUS, MÊME PAGE
  //
  // « Rien de vivant ici » (le serveur n'a reconnu aucun animal) et « Ça, c'est
  // un écran » (le garde a vu un moiré) sont le même moment pour le joueur : le
  // cliché ne devient pas une carte. Une seule mise en page, deux textes — deux
  // pages jumelles auraient divergé à la première retouche.
  //
  // Sortir une carte « échec » laisserait croire que le modèle s'est trompé ;
  // ici c'est le cliché qui est en cause, et le tirage sépia le dit avant le
  // titre.
  const qualityCopy = qualityWarning?.issue ? QUALITY_COPY[qualityWarning.issue] : null;
  const refusal = qualityCopy
    ? {
        body: t(qualityCopy.body),
        eyebrow: t('reveal_eyebrow_quality'),
        quality: true,
        title: t(qualityCopy.title),
      }
    : contrefacon
    ? {
        // Refus distinct d'« aucun animal » : dire « je ne vois pas d'animal »
        // devant une peluche donnerait tort au joueur, qui en voit un. On
        // nomme ce qu'on refuse.
        body: t('reveal_body_not_alive'),
        eyebrow: t('reveal_eyebrow_missed'),
        quality: false,
        title: t('reveal_title_not_alive'),
      }
    : energieEpuisee
    ? {
        // Le refus le plus facile à mal présenter : il n'y a rien de raté dans
        // la photo. On nomme la limite, on dit quand elle tombe, et on rappelle
        // que la journée n'a pas été perdue.
        body: t('reveal_body_energy'),
        eyebrow: t('reveal_eyebrow_energy'),
        quality: false,
        title: t('reveal_title_energy'),
      }
    : aucunAnimal
    ? {
        // Le même écran que le refus du serveur — c'est la même conclusion,
        // rendue plus tôt et sans avoir rien envoyé.
        body: t('reveal_body_no_animal'),
        eyebrow: t('reveal_eyebrow_missed'),
        quality: false,
        title: t('reveal_title_no_animal'),
      }
    : screenSuspicion
    ? {
        // Le garde a des raisons, on les donne : accuser sans dire pourquoi est
        // ce qui rend un refus injuste, et il peut se tromper.
        body: `${t('reveal_body_screen')}\n${screenSuspicion.reasons.join(', ')}.`,
        eyebrow: t('reveal_eyebrow_screen'),
        quality: false,
        title: t('reveal_title_screen'),
      }
    : failed
      ? capture?.identificationIssue === 'no_animal_detected'
        ? {
            body: t('reveal_body_no_animal'),
            eyebrow: t('reveal_eyebrow_missed'),
            quality: false,
            title: t('reveal_title_no_animal'),
          }
        // TOUT échec passe par le refus, pas seulement « aucun animal ».
        //
        // Avant, un service indisponible ou une image illisible tombait dans le
        // chemin nominal : la carte s'affichait, en tier INCONNU, teintée par la
        // couleur dominante du cliché — un tube de dentifrice donnait donc une
        // carte dorée marquée « INCONNU ». Et le pied de page ne rendait son
        // bouton de sortie que si `complete || queued` : sur un échec, il ne
        // restait que « Reprendre ». Aucune porte pour fermer.
        //
        // Une carte est une récompense. Un échec n'en est pas une.
        : {
            body: t(
              capture?.identificationIssue === 'invalid_image'
                ? 'reveal_body_invalid_image'
                : capture?.identificationIssue === 'unsupported_capture'
                  ? 'reveal_body_unsupported'
                  : 'reveal_body_service_down',
            ),
            eyebrow: t('reveal_eyebrow_missed'),
            quality: false,
            title: t('reveal_title_failed'),
          }
      : null;

  if (refusal) {
    return (
      <View style={[styles.revealRoot, { paddingTop: topInset + 16, paddingBottom: bottomInset + 16 }]}>
        <AnimatedView entering={FadeIn.duration(250)} style={styles.missedRoot}>
          <View style={styles.missedStage}>
            {originalUri ? <MissedPrint uri={originalUri} width={Math.min(width - 150, 250)} /> : null}
          </View>
          <View style={styles.revealHeader}>
            <Text style={[styles.revealEyebrow, { color: accent }]}>{refusal.eyebrow}</Text>
            <Text style={styles.revealTitle}>{refusal.title}</Text>
            <Text style={styles.missedHint}>{refusal.body}</Text>
          </View>
          <View style={styles.revealActions}>
            {energieEpuisee ? (
              /* PAS DE « REPRENDRE » ICI : il ne mène qu'au même mur.
                 C'est le seul refus de l'app qui ne reproche RIEN à la photo —
                 elle était bonne, c'est la journée qui est finie. Et c'est donc
                 le seul endroit où l'illimité répond exactement à ce qui vient
                 de bloquer, au moment où le joueur le ressent. Proposer autre
                 chose serait lui faire perdre son temps. */
              <>
                <Pressable style={styles.secondaryAction} onPress={leave}>
                  <SymbolView name="xmark" size={15} tintColor="#fff" />
                  <Text style={styles.secondaryActionText}>{t('reveal_close')}</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryAction, { backgroundColor: accent }]}
                  onPress={() => router.push('/paywall')}
                >
                  <SymbolView name="infinity" size={17} tintColor={accentInk} />
                  <Text style={[styles.primaryActionText, { color: accentInk }]}>
                    {t('reveal_energy_unlimited')}
                  </Text>
                </Pressable>
              </>
            ) : continueOnly ? (
              /* REPRENDRE D'ABORD, PASSER ENSUITE.
                 Cette étape existe pour obtenir une PREMIÈRE capture. Elle
                 n'offrait qu'un « Continuer » : l'app disait « ce n'est pas un
                 animal » puis poussait en avant, sans laisser retenter. Celui
                 qui a visé de travers n'avait aucune issue vers ce qu'il était
                 venu faire.
                 « Continuer sans » reste là — bloquer l'onboarding sur une
                 photo ratée serait pire — mais en second, et il dit ce qu'il
                 fait : on continue SANS carte. */
              <>
                <Pressable style={styles.secondaryAction} onPress={leave}>
                  <Text style={styles.secondaryActionText}>{t('reveal_continue_without')}</Text>
                </Pressable>
                <Pressable style={[styles.primaryAction, { backgroundColor: accent }]} onPress={onRedo}>
                  <SymbolView name="arrow.counterclockwise" size={17} tintColor={accentInk} />
                  <Text style={[styles.primaryActionText, { color: accentInk }]}>{t('reveal_retake')}</Text>
                </Pressable>
              </>
            ) : refusal.quality ? (
              <Pressable style={styles.secondaryAction} onPress={onKeepQualityWarning}>
                <SymbolView name="checkmark" size={15} tintColor="#fff" />
                <Text style={styles.secondaryActionText}>{t('reveal_keep_anyway')}</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.secondaryAction} onPress={leave}>
                <SymbolView name="xmark" size={15} tintColor="#fff" />
                <Text style={styles.secondaryActionText}>{t('reveal_close')}</Text>
              </Pressable>
            )}
            {/* HORS DU TERNAIRE, DONC AFFICHÉ PARTOUT — et c'est le piège.
                Les branches ci-dessus posent déjà leur action principale ;
                celle-ci s'ajoutait par-dessus. Sur « plus d'énergie », elle
                proposait de reprendre une photo qui se heurterait au même
                plafond, à côté du bouton qui, lui, débloque vraiment. */}
            {energieEpuisee || continueOnly ? null : (
              <Pressable style={[styles.primaryAction, { backgroundColor: accent }]} onPress={onRedo}>
                <SymbolView name="arrow.counterclockwise" size={17} tintColor={accentInk} />
                <Text style={[styles.primaryActionText, { color: accentInk }]}>{t('reveal_retake')}</Text>
              </Pressable>
            )}
          </View>
        </AnimatedView>
      </View>
    );
  }

  return (
    <View style={[styles.revealRoot, { paddingTop: topInset + 16, paddingBottom: bottomInset + 16 }]}>
      {showCard && complete && capture && cardRarity(capture) === 'legendary' ? (
        <MoltenBackdrop color={identityFor(capture).body[1]} />
      ) : null}
      {revealOpened ? (
        <View style={styles.revealHeader}>
          <Text style={[styles.revealEyebrow, { color: accent }]}>
            {t(
              queued
                ? 'reveal_eyebrow_offline'
                : complete
                  ? isNewSpecies
                    ? 'reveal_eyebrow_discovery'
                    : 'reveal_eyebrow_mastery'
                  : failed
                    ? 'reveal_eyebrow_failed'
                    : 'reveal_eyebrow_analysing',
              { level: mastery.level },
            )}
          </Text>
          {!complete ? (
            <Text style={styles.revealTitle}>
              {t(queued ? 'reveal_title_offline' : failed ? 'reveal_title_failed' : 'reveal_title_analysing')}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.revealStage}>
        {showCard ? (
          // A quick cross-fade, not an entrance: the lift just parked the
          // sticker exactly on CardStrike's waiting rect, so the two frames
          // show the same image in the same place.
          <AnimatedView entering={FadeIn.duration(200)} style={[styles.revealCard, exitStyle]}>
            <CardReveal
              discovery={isNewSpecies}
              accent={accent}
              armed
              celebrate={complete}
              onLanded={finishStrike}
              rarity={cardRarity(capture)}
              revealed={ready}
              subjectUri={stickerDataUri ?? stickerUri ?? originalUri}
              width={cardWidth}
            >
              <View
                collapsable={false}
                onTouchStart={continueOnly ? () => setTiltHintVisible(false) : undefined}
                ref={cardExportRef}
              >
                <AnimalCard data={cardData} width={cardWidth} />
              </View>
            </CardReveal>
          </AnimatedView>
        ) : showLift ? (
          <AnimatedView exiting={FadeOut.duration(200)}>
            <SubjectLiftReveal
              cardWidth={cardWidth}
              onComplete={onLifted}
              originalUri={originalUri!}
              ready={ready}
              stageWidth={Math.min(width - 40, 420)}
              stickerUri={stickerUri}
              subjectBounds={subjectBounds}
              subjectUri={subjectUri}
            />
          </AnimatedView>
        ) : frozenFrame && FrozenImageView ? (
          // Le gel : la prévisualisation capteur, affichée exactement là où le
          // lift posera la vraie photo (même largeur, même rayon), pour que le
          // remplacement soit invisible.
          <View style={{ borderRadius: 24, overflow: 'hidden' }}>
            <FrozenImageView
              image={frozenFrame}
              style={{
                width: Math.min(width - 40, 420),
                height: Math.min(width - 40, 420) * (4 / 3),
              }}
            />
          </View>
        ) : (
          <ActivityIndicator color={accent} />
        )}
      </View>

      {/* Only the lift narrates itself. Once the booster is on screen the pack
          is the only thing to look at, and it carries its own invitation — a
          server's progress report underneath it just gets in the way. */}
      {!showFooter && !showCard ? <Text style={styles.revealStatus}>{t('reveal_status_lifting')}</Text> : null}

      {/* Delayed and quiet: available for a bad shot without competing with the reveal. */}
      {identificationStarted && !ready && !showCard ? (
        <AnimatedView entering={FadeIn.delay(1200).duration(400)}>
          <Pressable
            accessibilityLabel={t('reveal_cancel_identification')}
            accessibilityRole="button"
            hitSlop={12}
            onPress={onCancel}
            style={styles.cancelIdentification}
          >
            <SymbolView name="arrow.counterclockwise" size={12} tintColor="rgba(255,255,255,0.5)" />
            <Text style={styles.cancelIdentificationLabel}>{t('reveal_cancel_identification')}</Text>
          </Pressable>
        </AnimatedView>
      ) : null}
      {showFooter ? (
        <View style={styles.revealFooter}>
          {continueOnly && tiltHintVisible ? (
            <AnimatedView entering={FadeIn.delay(300).duration(300)} exiting={FadeOut.duration(180)}>
              <Text style={styles.tiltHint}>{copy("ui_copy_181")}</Text>
            </AnimatedView>
          ) : null}
          {continueOnly && complete && !isOwnedSpecies && capture?.inAtlas !== false ? null : (
            <Text style={styles.revealStatus}>
              {t(
                queued
                  ? 'reveal_status_offline'
                  : failed
                    ? 'reveal_status_service_down'
                    : complete
                      ? isOwnedSpecies
                        ? masteryEvent === 'level_up'
                          ? 'reveal_status_level_up'
                          : masteryEvent === 'same_day'
                            ? 'reveal_status_same_day'
                            : 'reveal_status_mastery_progress'
                        : capture?.inAtlas === false
                          ? 'reveal_status_bonus'
                          : 'reveal_status_added'
                      : stickerUri
                        ? 'reveal_status_comparing'
                        : 'reveal_status_from_original',
                { level: mastery.level, days: mastery.observationDays, remaining: mastery.daysToNextLevel },
              )}
            </Text>
          )}
          {/* PAS DE LISTE DE CANDIDATS ICI, ET C'EST LE POINT.
              Elle demandait « est-ce un zèbre des plaines ou un zèbre de
              Grévy ? » à quelqu'un qui vient précisément de photographier
              l'animal parce qu'il ne sait pas ce que c'est. La seule réponse
              qu'il pouvait donner était de reprendre le plus gros pourcentage
              — c'est-à-dire refaire le choix du modèle, en croyant décider.
              La correction existe toujours, mais sur la fiche de la carte, à
              la demande, pour celui qui sait. */}

          <View style={styles.revealActions}>
            {!continueOnly ? (
              <Pressable style={styles.secondaryAction} onPress={onRedo}>
                <SymbolView name="arrow.counterclockwise" size={17} tintColor="#fff" />
                <Text style={styles.secondaryActionText}>{t('reveal_retake')}</Text>
              </Pressable>
            ) : null}
            {/* `failed` ouvre la porte lui aussi : sans lui, un échec laissait
                l'écran sans aucun moyen d'en sortir. */}
            {continueOnly ? (
              <Pressable style={[styles.primaryAction, { backgroundColor: accent }]} onPress={leave}>
                <Text style={[styles.primaryActionText, { color: accentInk }]}>{copy("auth_continue")}</Text>
                <SymbolView name="arrow.right" size={17} tintColor={accentInk} />
              </Pressable>
            ) : complete || queued || failed ? (
              <Pressable style={[styles.primaryAction, { backgroundColor: accent }]} onPress={leave}>
                <Text style={[styles.primaryActionText, { color: accentInk }]}>
                  {t(queued ? 'reveal_understood' : 'reveal_see_collection')}
                </Text>
                <SymbolView name="arrow.right" size={17} tintColor={accentInk} />
              </Pressable>
            ) : failed ? (
              <Pressable style={[styles.primaryAction, { backgroundColor: accent }]} onPress={leave}>
                <Text style={[styles.primaryActionText, { color: accentInk }]}>{t('reveal_close')}</Text>
              </Pressable>
            ) : (
              <ActivityIndicator color={accent} />
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  cameraRoot: { flex: 1, backgroundColor: '#fff9e9' },
  backgroundBubble: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    right: -52,
    bottom: -42,
    backgroundColor: '#f6d7ce',
  },
  revealRoot: { flex: 1, backgroundColor: STAGE_BACKGROUND, paddingHorizontal: 24 },
  revealHeader: { alignItems: 'center', gap: 4 },
  revealEyebrow: { fontFamily: theme.fonts.bold, fontSize: 10, letterSpacing: 1.8 },
  revealTitle: {
    color: '#fffdf3',
    fontFamily: theme.fonts.display,
    fontSize: 25,
    textAlign: 'center',
  },
  revealStage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // The wrapper must hug the card: a full-width box left-aligns it inside the
  // stage, which is what pushed the card off-centre and past the right edge.
  revealCard: { alignSelf: 'center' },
  waitParticles: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    transform: [{ translateY: '-50%' }],
    opacity: 0.55,
  },
  originalPreview: { width: '100%', height: '72%', borderRadius: 24 },
  revealFooter: { gap: 16 },
  cancelIdentification: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: theme.gap(1.5),
    paddingVertical: theme.gap(1),
  },
  cancelIdentificationLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontFamily: theme.fonts.regular,
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  revealStatus: {
    minHeight: 20,
    color: 'rgba(255,255,255,0.64)',
    fontFamily: theme.fonts.regular,
    fontSize: 13,
    textAlign: 'center',
  },
  tiltHint: {
    color: 'rgba(255,253,243,0.76)',
    fontFamily: theme.fonts.medium,
    fontSize: 13,
    textAlign: 'center',
  },
  revealActions: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  missedRoot: { flex: 1, gap: 28 },
  missedStage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  missedHint: {
    color: 'rgba(255,253,243,0.62)',
    fontFamily: theme.fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 6,
    maxWidth: 300,
    textAlign: 'center',
  },
  // Un tirage papier posé de travers : bord parchemin, marge basse plus
  // épaisse comme un vrai tirage, et l'inclinaison qui dit « raté » avant
  // même le titre.
  missedPrint: {
    backgroundColor: '#fffdf3',
    borderRadius: 10,
    padding: 8,
    paddingBottom: 26,
    transform: [{ rotate: '-2.5deg' }],
    boxShadow: '0 18px 40px rgba(0,0,0,0.5)',
  },
  candidates: { gap: 7 },
  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  candidateName: { flex: 1, color: '#fffdf3', fontFamily: theme.fonts.medium, fontSize: 13 },
  candidateScore: { fontFamily: theme.fonts.bold, fontSize: 13 },
  primaryAction: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 20,
  },
  primaryActionText: { fontFamily: theme.fonts.bold, fontSize: 14 },
  secondaryAction: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  secondaryActionText: { color: '#fff', fontFamily: theme.fonts.medium, fontSize: 14 },
}));
