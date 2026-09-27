import { currentLanguage } from '@/i18n/languages';
import { marque } from '@/lib/boot-trace';
import { speciesName } from '@/lib/animals/species-name';
import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { ReportIdentificationSheet } from '@/components/animals/report-identification-sheet';
import { BurningCard } from '@/components/cards/burning-card';
import { setCardOverlayOpen } from '@/components/cards/card-overlay-state';
import { PRESS_DEPTH, Press3D } from '@/components/ui/press-3d';
import { cardInk, type CardInk } from '@/lib/card-ink';
import { CardMorphOverlay } from '@/components/cards/card-morph-overlay';
// Menu radial garé dans card-radial-menu.tsx : un tap ouvre désormais la fiche.
import { CardTile } from '@/components/cards/card-tile';
import { CARD_RATIO, HoloCard, type HoloCardData } from '@/components/cards/holo-card';
import { prewarmCardImage } from '@/components/cards/card-image';
import { cardSceneFor } from '@/components/cards/card-scenes';
import { DECK_TAB_GAP, DECK_TAB_HEIGHT } from '@/components/decks/deck-slot-geometry';
import { deckSlotMetrics, SortableDeckGrid } from '@/components/decks/sortable-deck-grid';
import { DeckTrashBin, useDeckTrash } from '@/components/decks/use-deck-trash';
import { CLASH } from '@/lib/clash-palette';
import { DeckCarryPreview, useDeckCarry } from '@/components/decks/use-deck-carry';
import { toast } from '@/lib/notify';
import type { Id } from '@/lib/supabase/api';
import { useCardMorph } from '@/components/cards/use-card-morph';
import { takeFreshCapture } from '@/lib/animals/fresh-capture';
import { speciesMasteries, speciesMastery } from '@/lib/animals/progression';
import { GROUP_LABELS, silhouetteFor } from '@/lib/animals/silhouettes';
import { CircularAvatars, EMPTY_ORBIT } from '@/components/ui/circular-avatars';
import { CollectionCategoryPicker } from '@/components/animals/collection-category-picker';
import { getPinnedCaptureId, usePinnedVersion } from '@/lib/animals/pinned-capture';
import { collectionGrid } from '@/components/animals/collection-grid';
import { requestExpandableCamera } from '@/components/navigation/expandable-camera-state';
import { api } from '@/lib/supabase/api';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { FlashList, type FlashListRef, type ViewToken } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { backendQuery, useBackendAuth, useMutation, useQuery as useBackendQuery } from '@/lib/supabase/backend';
import { SymbolView } from 'expo-symbols';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Alert,
  InteractionManager,
  PixelRatio,
  Platform,
  Pressable,
  StyleSheet as RNStyleSheet,
  Text,
  useWindowDimensions,
  View,
  type View as RNView,
} from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, {
  // FadeIn/FadeOut come back with the parked status line.
  FadeInDown,
  FadeOutUp,
  LinearTransition,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

/**
 * Trois par ligne, comme la collection d'un profil visité (`player/[id].tsx`).
 * À quatre, la carte tombe sous les 90pt : les effets holo n'ont plus la place
 * de se lire et le nom passe sur deux lignes. La collection est ce qu'on est
 * venu regarder, pas un index.
 */
/**
 * ESSAI — anime AUSSI les reprises. À remettre à `false`.
 *
 * La règle veut qu'une deuxième prise du même animal ne déclenche rien : la
 * carte ne bouge pas de place, elle gagne une étoile. C'est juste — mais ça
 * rend le mécanisme impossible à tester sans aller trouver une espèce jamais
 * capturée, et trois essais de suite sont tombés sur des animaux déjà au
 * carnet.
 *
 * Ce drapeau sépare les deux questions : « l'animation fonctionne-t-elle ? »
 * et « se déclenche-t-elle au bon moment ? ». On répond à la première d'abord.
 */
const ESSAI_ANIMER_TOUTE_CAPTURE = true;

const COLUMN_COUNT = 3;
const DECK_COUNT = 5;
type DeckMembershipStore = StoreApi<{ captureIds: ReadonlySet<string> }>;
/**
 * Every inset between the screen's edge and a deck slot, named — because the
 * grid width is derived from them and a hardcoded total goes stale the moment
 * one of them moves. It already had: the sum said 52 while the styles said 54.
 */
const DECK_SECTION_MARGIN = 12;
const DECK_SECTION_BORDER = 3;
const DECK_SECTION_PADDING = 12;
const DECK_SECTION_RADIUS = 20;
const DECK_GRID_INSET = DECK_SECTION_MARGIN + DECK_SECTION_BORDER + DECK_SECTION_PADDING;
const CARD_DETAIL_VIEWABILITY = { itemVisiblePercentThreshold: 60 };
const CATEGORY_ORDER = [
  'mammiferes',
  'oiseaux',
  'reptiles',
  'amphibiens',
  'poissons',
  'insectes',
  'arachnides',
  'mollusques',
  'crustaces',
  'invertebres',
] as const;
/**
 * Les fonctions que la liste consulte, au niveau du MODULE.
 *
 * Portées de la grille Google Photos d'adithyavis/awesome-mobile-app-animations,
 * qui les sort toutes du composant. Écrites en flèches dans le JSX, elles
 * changent d'identité à chaque rendu de l'écran : la liste reçoit alors ce
 * qu'elle lit comme de nouvelles consignes de clé et de type, pour un
 * comportement rigoureusement identique.
 */
/** Une rangée s'identifie par sa première case, et se recycle par sa nature. */
const keyOfRow = (row: Slot[]) => row[0]?.id ?? 'vide';
/**
 * Le type de recyclage d'une rangée : les silhouettes verrouillées et les
 * cartes révélées ne coûtent pas la même chose à dessiner, donc elles ne
 * doivent pas se réutiliser entre elles. Une rangée de frontière — la dernière
 * découverte, la première verrouillée — porte les deux, et son propre bassin.
 */
const typeOfRow = (row: Slot[]) =>
  row.every((slot) => slot.state === 'discovered')
    ? 'discovered'
    : row.every((slot) => slot.state === 'locked')
      ? 'locked'
      : 'mixed';

type Capture = NonNullable<ReturnType<typeof useCaptures>['data']>[number];
type DiscoveredCapture = Capture & HoloCardData;
type CatalogEntry = NonNullable<ReturnType<typeof useCatalog>>[number];
type Slot =
  | {
      id: string;
      number: number;
      state: 'discovered';
      entry?: CatalogEntry;
      capture: DiscoveredCapture;
      /** La PREMIÈRE fois qu'on a vu l'espèce. C'est elle qui classe. */
      discoveredAt: number;
    }
  | { id: string; number: number; state: 'locked'; entry: CatalogEntry };

function useCaptures(isAuthenticated = true) {
  return useQuery({ ...backendQuery(api.animals.listCaptures, {}), enabled: isAuthenticated });
}

/**
 * L'atlas entier, le même pour tout le monde.
 *
 * Il a été filtré par région un temps. C'est la collection : un objectif commun,
 * comparable, et un classement n'a de sens que si la course est la même pour
 * tous. Ce que la région décide, c'est l'écran Défis — quoi chercher ce mois-ci
 * près de soi, parmi ces mêmes espèces.
 */
function useCatalog(isAuthenticated: boolean) {
  return useBackendQuery(api.catalog.listAll, isAuthenticated ? {} : 'skip');
}

marque('module de la collection évalué');

export default function CollectionScreenRoute() {
  const { isAuthenticated } = useBackendAuth();
  const { species } = useLocalSearchParams<{ species?: string }>();
  const [announced, setAnnounced] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      const fresh = takeFreshCapture();
      if (fresh) setAnnounced(fresh);
    }, []),
  );
  return <CollectionScreen announced={announced} focusSpecies={species} isAuthenticated={isAuthenticated} />;
}

type CardMorphHandle = {
  close: () => void;
  open: (stickerRef: React.RefObject<RNView | null>, data: HoloCardData) => void;
};

/**
 * Owns the detail transition state so opening a card does not re-render the
 * 5,576-entry collection, its deck, and its category picker.
 */
const CollectionCardMorph = memo(forwardRef<CardMorphHandle, {
  onDelete: (card: HoloCardData, cardRef: React.RefObject<RNView | null>) => void;
}>(function CollectionCardMorph({ onDelete }, ref) {
  const morph = useCardMorph();
  useImperativeHandle(ref, () => ({ close: morph.close, open: morph.open }), [morph.close, morph.open]);

  return (
    <CardMorphOverlay
      animation={morph.animation}
      cardTop={morph.layout.cardTop}
      cardWidth={morph.layout.cardWidth}
      onClose={morph.close}
      onDelete={onDelete}
      origin={morph.origin}
      selection={morph.selection}
      settled={morph.settled}
    />
  );
}));

const CollectionScreen = memo(function CollectionScreen({
  announced,
  focusSpecies,
  isAuthenticated,
}: {
  announced: string | null;
  focusSpecies?: string;
  isAuthenticated: boolean;
}) {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { theme } = useUnistyles();
  const { data: captures } = useCaptures(isAuthenticated);
  useEffect(() => {
    if (!captures?.length) return;
    const urls = [
      ...new Set(
        captures.flatMap((capture) => {
          if (capture.status !== 'ready' && capture.status !== 'needs_review') return [];
          const url = cardSceneFor(capture.scientificName, capture.rarity, {
            sceneSlug: capture.sceneSlug,
            size: 'grid',
          });
          return url ? [url] : [];
        }),
      ),
    ];
    let cancelled = false;
    const idle = requestIdleCallback(() => {
      void (async () => {
        for (let at = 0; at < urls.length && !cancelled; at += 12) {
          await Image.prefetch(urls.slice(at, at + 12), { cachePolicy: 'memory-disk' }).catch(
            () => undefined,
          );
        }
      })();
    });
    return () => {
      cancelled = true;
      cancelIdleCallback(idle);
    };
  }, [captures]);
  const catalog = useCatalog(isAuthenticated);
  const catalogBySpecies = useMemo(() => {
    const entries = new Map<string, CatalogEntry>();
    for (const entry of catalog ?? []) {
      entries.set(entry.canonicalName, entry);
      entries.set(entry.scientificName, entry);
    }
    return entries;
  }, [catalog]);
  const masteryBySpecies = useMemo(
    () => speciesMasteries(captures ?? []),
    [captures],
  );
  const enrichCard = useCallback(
    (card: HoloCardData): HoloCardData => {
      const entry = card.scientificName ? catalogBySpecies.get(card.scientificName) : undefined;
      const key = card.scientificName ?? card.commonName;
      const mastery = (key ? masteryBySpecies.get(key) : undefined) ?? speciesMastery([card], key);
      if (!entry) return { ...card, mastery };
      return {
        ...card,
        commonName: entry.vernacularNameEn ?? card.commonName,
        commonNameLocale: entry.vernacularName ?? card.commonNameLocale,
        inAtlas: true,
        mastery,
        rarity: entry.rarity ?? card.rarity,
      };
    },
    [catalogBySpecies, masteryBySpecies],
  );
  const morphRef = useRef<CardMorphHandle>(null);

  // Clerk authenticates a beat after mount, so a query fired on the first
  // render reaches the server anonymous and `requireUserId` throws.
  const ensureDefaultDecks = useMutation(api.decks.ensureDefaults);
  const toggleDeckCard = useMutation(api.decks.toggleCard);
  const [activeDeckIndex, setActiveDeckIndex] = useState(0);
  /** The card currently on fire, or null. Held by value: the row is about to
   *  stop existing, so nothing here may look it up again by id. */
  /** The card's own photograph, taken the instant Delete was confirmed. Held
   *  by value: the row is about to stop existing, so nothing may look it up. */
  const [burning, setBurning] = useState<{
    /** False while it is only warming up behind the confirmation. */
    armed: boolean;
    id: Id<'animalCaptures'>;
    ink: CardInk;
    /** Carried, not looked up: by the time this is read the row is gone. */
    name: string;
  } | null>(null);
  const deleteCapture = useMutation(api.animals.deleteCapture);
  /**
   * The sheet is ash — now make it true.
   *
   * The row is destroyed AFTER the burn, never before: deleting first would
   * pull the card out of this very list while the fire was still running on top
   * of it. It also means an app killed mid-burn deletes nothing, which is the
   * right way round for something with no undo.
   */

  /**
   * Delete, from the enlarged card.
   *
   * The card is photographed FIRST, while it is still on screen and still the
   * thing the player is looking at — that snapshot is what the sheet is printed
   * with, and it is the whole reason the burn destroys *this* card rather than
   * a drawing of one. Only then does the confirmation rise.
   */
  const askDelete = useCallback(
    async (card: HoloCardData, cardRef: React.RefObject<RNView | null>) => {
      const id = card._id as Id<'animalCaptures'> | undefined;
      if (!id) return;
      const ink = await cardInk(cardRef).catch(() => null);
      if (!ink) return;
      const name = speciesName(card) ?? card.scientificName ?? '';
      // The dialog goes up FIRST, and the burner is mounted after the
      // interaction settles — building the WebGPU device, the pipelines and
      // the shader modules all run on the JS thread, so doing it in the same
      // tick as the dialog put the compile on top of the dialog's own frames.
      InteractionManager.runAfterInteractions(() => {
        setBurning({ armed: false, id, ink, name });
      });
      // LA SEULE ALERTE SYSTÈME QUI RESTE DANS L'APP. Tout le reste passe par
      // `@/lib/notify` — mais ni SPIndicator ni AlertKit ne posent de question,
      // ils annoncent. Or c'est la seule action de l'app qui détruit quelque
      // chose sans retour, et iOS a déjà le langage pour ça : le rouge
      // `destructive`, l'annulation en gras, le focus volé au reste de l'écran.
      Alert.alert(t('delete_confirm_title'), t('delete_confirm_body', { name }), [
        {
          onPress: () => setBurning(null),
          style: 'cancel',
          text: t('delete_confirm_cancel'),
        },
        {
          onPress: () => {
            morphRef.current?.close();
            // The warm-up may not have landed yet if the button was pressed
            // fast; arming a null state would drop the burn entirely, so it
            // falls back to mounting armed.
            setBurning((current) =>
              current ? { ...current, armed: true } : { armed: true, id, ink, name },
            );
          },
          style: 'destructive',
          text: t('detail_delete_action'),
        },
      ]);
    },
    [t],
  );
  /**
   * All five decks, in one subscription — so switching tabs is an array index
   * and nothing else. It used to be a per-deck query keyed on the active tab,
   * which meant every tap opened a new subscription and showed the skeleton
   * until it came back, every single time.
   */
  const myDecks = useBackendQuery(api.decks.listMineWithCards, isAuthenticated ? {} : 'skip');
  const currentDeck = myDecks?.[activeDeckIndex];
  /** The summaries, straight off the same subscription. */
  const decks = myDecks?.map((entry) => entry.deck);
  const [group, setGroup] = useState('Tous');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const placeCard = useMutation(api.decks.placeCard);
  // The fire holds the tab bar down on its own. Confirming a delete closes the
  // card in the same tick as it arms the burn, so the card's own hold ends
  // while the flames are still on screen.
  useEffect(() => {
    setCardOverlayOpen('burn', burning !== null);
  }, [burning]);
  useEffect(() => () => setCardOverlayOpen('burn', false), []);

  const burnt = useCallback(() => {
    if (!burning) return;
    const { id, name } = burning;
    setBurning(null);
    void deleteCapture({ id }).catch(() => undefined);
    // The fire is over and the screen is back — say what happened. A toast
    // rather than an Alert: a native modal on top of the ash would be a brake
    // on the one animation in the app that has just finished making its point.
    toast.done(t('delete_done', { name }));
  }, [burning, deleteCapture, t, toast]);
  const [reporting, setReporting] = useState<{
    id: Id<'animalCaptures'>;
    name?: string;
  } | null>(null);

  useEffect(() => {
    if (isAuthenticated && decks !== undefined && decks.length < DECK_COUNT) {
      void ensureDefaultDecks({}).catch(() => undefined);
    }
  }, [decks, ensureDefaultDecks, isAuthenticated]);

  // Une seule valeur pour tout : marge extérieure, écart horizontal, écart
  // vertical. Elle vaut la marge du plateau, donc les bords de la grille
  // tombent sur ceux du deck, et la grille respire pareil dans les deux sens.
  const grid = useMemo(
    () => collectionGrid(width, COLUMN_COUNT, DECK_SECTION_MARGIN),
    [width],
  );
  const { cardWidth, cellWidth } = grid;
  const detailEdgeRef = useRef(0);
  useEffect(() => {
    detailEdgeRef.current = PixelRatio.getPixelSizeForLayoutSize(Math.min(width - 42, 370) / CARD_RATIO);
  }, [width]);
  const detailPrewarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prewarmVisibleDetails = useCallback(({ viewableItems }: { viewableItems: ViewToken<Slot[]>[] }) => {
    if (detailPrewarmTimer.current) clearTimeout(detailPrewarmTimer.current);
    const visible = viewableItems.filter((token) => token.isViewable);
    const row = visible[Math.floor(visible.length / 2)]?.item;
    if (!row) return;
    // Un bref arrêt, puis seulement la rangée au centre : un fling ne
    // télécharge pas des dizaines de pleines planches que personne n'ouvrira.
    detailPrewarmTimer.current = setTimeout(() => {
      for (const slot of row) {
        if (slot.state !== 'discovered') continue;
        const capture = slot.capture;
        prewarmCardImage(capture.stickerUrl, detailEdgeRef.current);
        prewarmCardImage(
          cardSceneFor(capture.scientificName, capture.rarity, { sceneSlug: capture.sceneSlug }),
          detailEdgeRef.current,
        );
      }
    }, 220);
  }, []);
  useEffect(() => () => {
    if (detailPrewarmTimer.current) clearTimeout(detailPrewarmTimer.current);
  }, []);
  // Hors du JSX pour la même raison que `keyOfRow` : une flèche neuve à chaque
  // rendu, c'est une consigne de taille qui change à chaque rendu.
  const deckGridWidth = width - DECK_GRID_INSET * 2;
  const deckSlot = deckSlotMetrics(deckGridWidth);
  const deckSkeletonCardWidth = deckSlot.width;

  // Hold a collection card and drop it on a deck slot. The deck lives in the
  // list header, so the drag brings it back into view first and then keeps
  // re-measuring it — otherwise the drop targets would be wherever the deck was
  // when the finger went down.
  const rootRef = useRef<RNView | null>(null);
  const deckRef = useRef<RNView | null>(null);
  const tabsRef = useRef<RNView | null>(null);
  const listRef = useRef<FlashListRef<Slot[]>>(null);
  // The drop lands in whichever deck is open when the finger lifts, and the
  // finger can change that mid-drag by crossing a number. Read through a ref:
  // a callback that changed identity would rebuild the gesture underneath the
  // drag that is using it.
  const openDeckRef = useRef<Id<'decks'> | undefined>(undefined);
  useEffect(() => {
    openDeckRef.current = decks?.[activeDeckIndex]?._id;
  }, [activeDeckIndex, decks]);

  const handleCarryDrop = useCallback(
    (card: { _id: string }, position: number) => {
      const deckId = openDeckRef.current;
      if (!deckId) return;
      void placeCard({
        captureId: card._id as Id<'animalCaptures'>,
        deckId,
        position,
      })
        .then(() => toast.done(t('deck_placed')))
        .catch(() => toast.fail(t('deck_place_failed')));
    },
    [placeCard, t, toast],
  );
  const handleCarryStart = useCallback(() => {
    void listRef.current?.scrollToOffset({ animated: true, offset: 0 });
  }, []);
  const resolveCarryCard = useCallback(
    (id: string) => {
      // ponytail: O(n) only after a real hold; add an id index if this ever
      // becomes measurable with thousands of owned captures.
      const capture = captures?.find((candidate) => String(candidate._id) === id);
      return capture
        ? (enrichCard(capture) as HoloCardData & { _id: string })
        : undefined;
    },
    [captures, enrichCard],
  );
  const carry = useDeckCarry<HoloCardData & { _id: string }>({
    deckRef,
    deckWidth: deckGridWidth,
    onDrop: handleCarryDrop,
    resolveCard: resolveCarryCard,
    onStart: handleCarryStart,
    onTab: setActiveDeckIndex,
    rootRef,
    tabsRef,
  });
  const deckCaptureIds = useMemo(
    () => new Set<string>(currentDeck?.captureIds ?? []),
    [currentDeck?.captureIds],
  );
  const [deckMembership] = useState<DeckMembershipStore>(() =>
    createStore(() => ({ captureIds: new Set<string>() })),
  );
  useLayoutEffect(() => {
    deckMembership.setState({ captureIds: deckCaptureIds });
  }, [deckCaptureIds, deckMembership]);

  // A card already in the open deck cannot be dropped into it again — there is
  // nothing to do. Recomputed on every deck switch, so crossing a number
  // mid-drag is exactly what unlocks the card: that is how it moves decks.
  const carriedId = carry.card?._id;
  useEffect(() => {
    const home = carriedId ? (currentDeck?.captureIds ?? []).indexOf(carriedId as never) : -1;
    carry.homeSlot.set(home);
    carry.blocked.set(home >= 0 ? 1 : 0);
    if (home >= 0) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [carriedId, carry.blocked, carry.homeSlot, currentDeck?.captureIds]);

  const toggleCaptureInActiveDeck = useCallback(
    (captureId: Id<'animalCaptures'>) => {
      const deckId = openDeckRef.current;
      if (!deckId) return;
      void toggleDeckCard({ deckId, captureId }).catch(() =>
        toast.fail(t('collection_deck_full_title'), t('collection_deck_full')),
      );
    },
    [t, toggleDeckCard],
  );
  // Le geste de retrait du deck. L'état vit ici parce que le calque se dessine
  // à la racine de l'écran : dans l'en-tête de la liste, il passerait sous les
  // rangées de la collection.
  const trash = useDeckTrash(toggleCaptureInActiveDeck);
  const pinDeck = useMutation(api.decks.pin);

  /**
   * La dernière capture de chaque espèce — la collection est une liste
   * d'espèces, pas une pellicule.
   *
   * La comparaison est EXPLICITE sur `capturedAt`, elle ne se repose plus sur
   * l'ordre d'arrivée. Le serveur trie par `created_at`, or ce n'est pas la
   * même chose : une capture prise hors réseau est créée à la reconnexion, donc
   * elle arrivait en tête alors qu'elle est la plus ancienne. Garder « la
   * première vue » donnait la mauvaise photo, et sans jamais lever d'erreur.
   */
  // Un compteur, pas la table : `useSyncExternalStore` exige un instantané
  // stable, et il ne sert qu'à refaire ce calcul quand une épingle bouge.
  const pinVersion = usePinnedVersion();
  const bySpecies = useMemo(() => {
    const map = new Map<string, Capture>();
    for (const capture of captures ?? []) {
      if (capture.status !== 'ready' && capture.status !== 'needs_review') continue;
      const key = capture.scientificName ?? capture.commonName;
      if (!key) continue;
      // UNE ÉPINGLE BAT LA RÉCENCE, ET ELLE SEULE.
      //
      // Par défaut la case montre la dernière rencontre — lecture naturelle,
      // mais elle écrase en silence la photo qu'on préférait. Épingler est le
      // seul moyen de figer un visage à l'espèce, et c'est un geste délibéré
      // posé en regardant ses rencontres (voir `@/lib/animals/pinned-capture`).
      if (getPinnedCaptureId(key) === String(capture._id)) {
        map.set(key, capture);
        continue;
      }
      const held = map.get(key);
      if (held && getPinnedCaptureId(key) === String(held._id)) continue;
      if (!held || (capture.capturedAt ?? 0) > (held.capturedAt ?? 0)) map.set(key, capture);
    }
    return map;
  }, [captures, pinVersion]);

  /**
   * LA DATE DE DÉCOUVERTE, ET C'EST UNE AUTRE DATE QUE CELLE DE LA CARTE.
   *
   * La carte montre la capture la plus RÉCENTE de l'espèce — c'est la bonne
   * photo à montrer. Mais le classement, lui, doit lire la PREMIÈRE : la tête
   * de liste est réservée aux nouvelles espèces.
   *
   * Confondre les deux faisait remonter une bête déjà possédée dès qu'on la
   * rephotographiait pour la faire monter de niveau. Le joueur qui soigne son
   * Merle noir voyait sa collection se réordonner autour de lui, et une
   * découverte de la veille se faire pousser hors de l'écran par une espèce
   * qu'il avait déjà depuis un mois.
   */
  const discoveredAt = useMemo(() => {
    const first = new Map<string, number>();
    for (const capture of captures ?? []) {
      if (capture.status !== 'ready' && capture.status !== 'needs_review') continue;
      const key = capture.scientificName ?? capture.commonName;
      if (!key) continue;
      const at = capture.capturedAt ?? 0;
      const held = first.get(key);
      if (held === undefined || at < held) first.set(key, at);
    }
    return first;
  }, [captures]);

  const groups = useMemo(() => {
    const present = new Set((catalog ?? []).map((entry) => entry.group));
    const ordered = CATEGORY_ORDER.filter((item) => present.delete(item));
    return ['Tous', ...ordered, ...[...present].sort()];
  }, [catalog]);

  /**
   * The grid is the global encyclopedia, not the camera roll: every launch or
   * community-promoted species
   * gets a slot, discovered ones show their card, the rest stay silhouettes.
   */
  const slots = useMemo<Slot[]>(() => {
    const entries = (catalog ?? []).filter((entry) => group === 'Tous' || entry.group === group);
    const atlasSlots = entries
      .map((entry, index) => {
        const capture = bySpecies.get(entry.canonicalName) ?? bySpecies.get(entry.scientificName);
        return capture
          ? {
              id: entry.canonicalName,
              number: index + 1,
              state: 'discovered' as const,
              entry,
              capture: enrichCard(capture) as DiscoveredCapture,
              discoveredAt:
                discoveredAt.get(entry.canonicalName) ??
                discoveredAt.get(entry.scientificName) ??
                0,
            }
          : {
              id: entry.canonicalName,
              number: index + 1,
              state: 'locked' as const,
              entry,
            };
      })
      ;
    const known = new Set(entries.flatMap((entry) => [entry.canonicalName, entry.scientificName]));
    const bonus = [...bySpecies.entries()]
      .filter(([name]) => !known.has(name))
      .map(([name, capture], index) => ({
        id: `bonus:${capture._id}`,
        number: entries.length + index + 1,
        state: 'discovered' as const,
        capture: enrichCard(capture) as DiscoveredCapture,
        discoveredAt: discoveredAt.get(name) ?? 0,
      }));

    /**
     * UN SEUL TRI, SUR LA LISTE ENTIÈRE.
     *
     * Deux critères : ce qu'on possède d'abord, et parmi ce qu'on possède, la
     * DÉCOUVERTE la plus récente en tête — la première fois qu'on a vu
     * l'espèce, pas la dernière. Rephotographier une bête déjà possédée la fait
     * monter de niveau ; ça ne la fait pas monter dans la liste.
     *
     * Le défaut d'origine tenait en une ligne — `[...bonus, ...atlasSlots]`.
     * Les espèces hors catalogue étaient collées DEVANT, sans être triées avec
     * les autres. Un joueur qui en a quatre voyait donc sa capture du moment
     * arriver en cinquième position, quel que soit le tri appliqué à l'atlas.
     * Trier les deux moitiés séparément puis les concaténer ne trie rien.
     *
     * Le champ `number` ne bouge pas : c'est le numéro d'atlas de l'espèce, pas
     * sa place à l'écran.
     */
    const ordered = (group === 'Tous' ? [...bonus, ...atlasSlots] : atlasSlots).sort((a, b) => {
      if (a.state !== b.state) return a.state === 'discovered' ? -1 : 1;
      if (a.state !== 'discovered' || b.state !== 'discovered') return 0;
      return b.discoveredAt - a.discoveredAt;
    });
    return ordered;
  }, [bySpecies, catalog, discoveredAt, enrichCard, group]);
  /**
   * LA LISTE COMPTE EN RANGÉES, PLUS EN CASES.
   *
   * `numColumns={3}` laissait la liste gérer trois fois plus d'éléments qu'il
   * n'y a de lignes à l'écran : trois conteneurs, trois mesures, trois entrées
   * de recyclage par rangée. La grille Google Photos d'adithyavis, dont le
   * scroll ne bronche pas sur des centaines de photos, fait l'inverse — elle
   * construit ses rangées elle-même et n'en donne qu'UNE à la liste, qui dessine
   * ses trois images à l'intérieur.
   *
   * Le regroupement se fait ici, avec le tri, parce que c'est la seule fois où
   * l'on parcourt déjà la liste entière. Le faire au rendu la reparcourrait à
   * chaque image.
   */
  const rows = useMemo(() => {
    const grouped: Slot[][] = [];
    for (let at = 0; at < slots.length; at += COLUMN_COUNT) {
      grouped.push(slots.slice(at, at + COLUMN_COUNT));
    }
    return grouped;
  }, [slots]);

  useEffect(() => {
    if (!focusSpecies || rows.length === 0) return;
    const row = rows.findIndex((items) => items.some((item) =>
      item.entry?.scientificName === focusSpecies || item.entry?.canonicalName === focusSpecies));
    if (row >= 0) void listRef.current?.scrollToIndex({ animated: true, index: row, viewPosition: 0.5 });
  }, [focusSpecies, rows]);

  const discoveredCount = useMemo(() => {
    let count = 0;
    for (const entry of catalog ?? []) {
      if (bySpecies.has(entry.canonicalName) || bySpecies.has(entry.scientificName)) count += 1;
    }
    return count;
  }, [bySpecies, catalog]);
  // Le TOTAL par groupe se calculait ici et ne sert plus : le sélecteur ne
  // montre plus de fraction (voir `collection-category-picker.ios`). Seul le
  // nombre de découvertes est compté, et la boucle ne parcourt le catalogue
  // que pour lui.
  const categoryStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of catalog ?? []) {
      if (!bySpecies.has(entry.canonicalName) && !bySpecies.has(entry.scientificName)) continue;
      counts.set(entry.group, (counts.get(entry.group) ?? 0) + 1);
    }
    return groups.slice(1).map((key) => ({
      discovered: counts.get(key) ?? 0,
      icon: silhouetteFor(key),
      key,
      label: GROUP_LABELS[key] ?? key,
    }));
  }, [bySpecies, catalog, groups]);
  /**
   * L'ESPÈCE QUI VIENT D'ENTRER AU CARNET — ET ELLE SEULE.
   *
   * L'identifiant vient de la CAMÉRA, qui l'a déposé en quittant la révélation
   * (`fresh-capture.ts`). Ce n'est pas un délai deviné : c'est un événement.
   *
   * Réclamé À LA PRISE DE FOCUS, jamais au montage. La caméra est une modale
   * plein écran présentée PAR-DESSUS l'onglet : cette page n'est jamais
   * démontée, donc une lecture au montage ne se ferait qu'au lancement de
   * l'app, bien avant la moindre capture. Le focus, lui, revient à chaque
   * fermeture de la modale — et comme la clé se consomme à la lecture, les
   * focus suivants ne rejouent rien.
   */
  /**
   * Combien de fois chaque espèce a été capturée.
   *
   * Un COMPTE plutôt qu'une comparaison de dates. La version précédente
   * vérifiait que `capturedAt` était égal à la première date vue pour cette
   * espèce — une égalité stricte entre deux nombres qui traversent
   * `enrichCard`, la sérialisation du cache et le tri. Une seule de ces étapes
   * qui arrondit ou recompose la valeur, et la condition tombe en silence.
   * « Cette espèce n'a qu'une capture » dit la même chose sans rien comparer.
   */
  const captureCountBySpecies = useMemo(() => {
    const map = new Map<string, number>();
    for (const capture of captures ?? []) {
      if (capture.status !== 'ready' && capture.status !== 'needs_review') continue;
      const key = capture.scientificName ?? capture.commonName;
      if (key) map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [captures]);

  const landingId = useMemo(() => {
    if (!announced) return null;
    const slot = slots.find(
      (item) => item.state === 'discovered' && String(item.capture._id) === announced,
    );
    if (slot?.state !== 'discovered') return null;
    const key = slot.capture.scientificName ?? slot.capture.commonName;
    // Reprendre en photo un animal déjà au carnet ne fait que gagner une étoile
    // de maîtrise : la carte ne change pas de place, il n'y a rien à montrer.
    if (!key) return null;
    if (!ESSAI_ANIMER_TOUTE_CAPTURE && (captureCountBySpecies.get(key) ?? 0) !== 1) return null;
    return announced;
  }, [announced, captureCountBySpecies, slots]);

  useEffect(() => {
    if (!landingId) return;
    // La nouvelle carte est toujours en tête de liste. Si le joueur était en
    // bas de la collection avant de dégainer, elle serait hors écran et il
    // chercherait ce qui vient de se passer.
    void listRef.current?.scrollToOffset({ animated: true, offset: 0 });
  }, [landingId]);

  // Every callback the grid hands down is memoised, and so is `renderItem`.
  // `CollectionCell` is wrapped in `memo`, but a new arrow function on any of
  // its props defeats that completely — and with an inline `renderItem` the
  // comparison could never hold, so every render of this screen re-rendered all
  // sixty-odd mounted cells.
  //
  // `enrichCard` PASSE PAR UNE RÉFÉRENCE, ET C'EST LE NŒUD.
  //
  // Il dépend de `masteryBySpecies`, donc de `captures` : il change à CHAQUE
  // arrivée de capture. En dépendance directe, il faisait changer `openCapture`,
  // donc `renderItem`, donc toute la grille se redessinait — la sonde comptait
  // 629 rendus de cellule. Or `openCapture` n'est appelé qu'au TAP : il n'a
  // aucun besoin de sa valeur pendant le rendu, seulement au moment du geste.
  // Une référence lui donne toujours la dernière version sans jamais changer
  // d'identité.
  // Mise à jour dans un EFFET, pas pendant le rendu : le React Compiler
  // interdit le second, et l'effet suffit — il s'exécute au commit, donc bien
  // avant qu'un doigt puisse toucher une carte.
  const enrichRef = useRef(enrichCard);
  useEffect(() => {
    enrichRef.current = enrichCard;
  }, [enrichCard]);
  const openCapture = useCallback(
    (stickerRef: React.RefObject<RNView | null>, capture: HoloCardData) => {
      morphRef.current?.open(stickerRef, enrichRef.current(capture));
    },
    [],
  );
  const currentDeckCards = useMemo(
    () =>
      (currentDeck?.cards.map(enrichCard) ?? []) as (HoloCardData & {
        _id: Id<'animalCaptures'>;
      })[],
    [currentDeck?.cards, enrichCard],
  );
  const enlargeDeckCard = useCallback(
    (card: HoloCardData, cardRef: React.RefObject<RNView | null>) =>
      openCapture(cardRef, card),
    [openCapture],
  );

  /**
   * CE QUE LA LISTE NE PEUT PAS DEVINER.
   *
   * `recycleItems` ne redessine une cellule que si SON item change. Une
   * information n'appartient à aucun item et doit donc être annoncée ici,
   * sinon la cellule garde la valeur d'hier :
   *
   * `landingId`, la carte qui vient d'arriver et doit respirer.
   *
   * C'est exactement le piège décrit dans le commentaire d'`extraData` — et je
   * suis tombé dedans : `landingId` traversait bien `renderItem`, mais la
   * cellule n'était jamais redessinée pour le recevoir. La trace le disait
   * sans ambiguïté, `[SafaRoll landing]` s'affichait et `[SafaRoll sway]`
   * jamais.
   */
  /**
   * UNE RANGÉE, TROIS CASES.
   *
   * La liste ne connaît plus que des rangées ; c'est ce composant qui pose les
   * trois cartes à l'intérieur, avec le décalage propre à chaque colonne. Un
   * seul conteneur par ligne au lieu de trois — c'est le gain du regroupement.
   */
  const renderItem = useCallback(
    ({ item }: { item: Slot[] }) => (
      <View style={styles.row}>
        {/* La rangée est recyclée : la colonne reste, l'espèce change. Une clé
            d'espèce détruisait et remontait les trois cartes à chaque scroll. */}
        {item.map((slot, column) =>
          slot.state === 'locked' ? (
            <LockedCollectionCell
              cardWidth={cardWidth}
              cellOffset={grid.offsetFor(column)}
              cellWidth={cellWidth}
              item={slot}
              key={column}
            />
          ) : (
            <DiscoveredCollectionCell
              cardWidth={cardWidth}
              cellOffset={grid.offsetFor(column)}
              cellWidth={cellWidth}
              deckMembership={deckMembership}
              gestureFor={carry.gestureFor}
              heldId={carry.heldId}
              item={slot}
              key={column}
              landing={String(slot.capture._id) === landingId}
              onOpen={openCapture}
              onToggleDeck={toggleCaptureInActiveDeck}
            />
          ),
        )}
      </View>
    ),
    [
      cardWidth,
      carry.gestureFor,
      carry.heldId,
      cellWidth,
      deckMembership,
      grid,
      landingId,
      openCapture,
      toggleCaptureInActiveDeck,
    ],
  );

  return (
    <View collapsable={false} ref={rootRef} style={styles.screen}>
      <FlashList
        ref={listRef}
        // Des RANGÉES, pas des cases : `numColumns` a disparu avec elles.
        data={rows}
        // Au niveau du module : une flèche neuve à chaque rendu redonne une
        // identité neuve à la liste, qui la traite comme une consigne changée.
        keyExtractor={keyOfRow}
        // Les silhouettes verrouillées et les cartes révélées ne coûtent pas la
        // même chose : des bassins de recyclage séparés empêchent l'une d'être
        // réutilisée comme l'autre.
        getItemType={typeOfRow}
        // The badge on a tile ("this one is in the open deck") depends on state
        // the list knows nothing about. With `recycleItems` a cell is only
        // redrawn when its own item changes, so placing a card left every tile
        // showing yesterday's answer until the app was reloaded. This is the
        // list's own escape hatch for exactly that.
        extraData={landingId}
        // Les rangées ont une taille fixe et les données ne mutent pas pendant
        // le scroll : aucun ancrage ni correction de position n'est nécessaire.
        maintainVisibleContentPosition={{ disabled: true }}
        // FlashList gère déjà lui-même les vues hors fenêtre. Le clipping natif
        // reparcourait récursivement toute la carte à chaque pixel de scroll.
        removeClippedSubviews={false}
        onViewableItemsChanged={prewarmVisibleDetails}
        viewabilityConfig={CARD_DETAIL_VIEWABILITY}
        contentContainerStyle={{ paddingBottom: 128 }}
        ListHeaderComponent={
          // zIndex : la poubelle du deck — et la carte qu'on porte au-dessus
          // d'elle — dépassent sous l'en-tête, et les rangées de la collection
          // viennent APRÈS lui dans l'arbre. Sans ceci, elles peindraient
          // par-dessus.
          <View style={{ paddingTop: insets.top + 14, zIndex: 10 }}>
            <View style={styles.heading}>
              <View>
                <Text style={styles.title}>{copy("quick_collection_title")}</Text>
              </View>
              <CollectionCategoryPicker
                categories={categoryStats}
                discovered={discoveredCount}
                onSelect={setGroup}
                selected={group}
              />
            </View>


            {captures !== undefined && bySpecies.size === 0 ? (
              /* First-launch state: the showcase has nothing to show yet, so
                 point straight at the camera instead of eight empty slots. */
              <View style={[styles.deckSection, styles.emptyState]}>
                <CircularAvatars captures={EMPTY_ORBIT} size={190} />
                <Text style={styles.emptyTitle}>{copy("ui_copy_087")}</Text>
                <Text style={styles.emptyMessage}>
                  {copy("ui_copy_088")}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={requestExpandableCamera}
                  style={({ pressed }) => [styles.emptyCta, pressed && { opacity: 0.85 }]}
                >
                  <SymbolView name="camera.fill" size={15} tintColor="#fff" />
                  <Text style={styles.emptyCtaText}>{copy("ui_copy_089")}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.deckSection}>
                {/* Also a drop target: dragging a card across a number opens
                  that deck, so one gesture reaches any of the five. */}
                <View style={styles.deckTabBar}>
                  <View collapsable={false} ref={tabsRef} style={styles.deckTabs}>
                    {Array.from({ length: DECK_COUNT }, (_, index) => {
                      const selected = index === activeDeckIndex;
                      return (
                        <Press3D
                          accessibilityLabel={`Deck ${index + 1}`}
                          borderRadius={11}
                          faceStyle={[styles.deckTab, selected ? styles.deckTabSelected : null]}
                          key={index}
                          onPress={() => setActiveDeckIndex(index)}
                          selected={selected}
                          shadowColor={selected ? CLASH.tabLipOn : CLASH.tabLip}
                          style={styles.deckTabSlot}
                          testID={`deck-tab-${index + 1}`}
                        >
                          <Text style={[styles.deckTabText, selected && styles.deckTabTextSelected]}>{index + 1}</Text>
                          {selected ? <View style={styles.deckTabPointer} /> : null}
                        </Press3D>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.sectionHeading}>
                  {/* Le numéro n'est PAS répété ici. Il est déjà sur l'onglet
                      juste au-dessus, allumé et fléché — et le titre retombe sur
                      « Deck 2 » quand aucun nom n'a été donné, ce qui affichait
                      « DECK 2 » puis « Deck 2 », deux fois la même chose. */}
                  <View style={styles.sectionHeadingText}>
                    <Text numberOfLines={1} style={styles.sectionTitle} testID="active-deck-title">
                      {decks?.[activeDeckIndex]?.name ?? `Deck ${activeDeckIndex + 1}`}
                    </Text>
                  </View>

                  {/* L'épingle : quel plateau on montre quand quelqu'un ouvre
                      notre profil. Un seul à la fois — réépingler ailleurs
                      dépingle celui-ci, c'est la colonne qui l'impose et non un
                      accord entre deux boutons.

                      Elle vit ici, sur l'en-tête du deck actif, parce que c'est
                      le seul endroit où l'on regarde déjà un deck en particulier
                      — une liste de cinq cases à cocher ailleurs demanderait de
                      se rappeler lequel est lequel. */}
                  {currentDeck ? (
                    <Pressable
                      accessibilityLabel={
                        currentDeck.deck.pinned ? t('collection_unpin') : t('collection_pin')
                      }
                      accessibilityRole="button"
                      hitSlop={10}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                          () => undefined,
                        );
                        void pinDeck({
                          deckId: currentDeck.deck.pinned ? null : currentDeck.deck._id,
                        }).catch(() => undefined);
                      }}
                      style={({ pressed }) => [
                        styles.pin,
                        currentDeck.deck.pinned && styles.pinOn,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <SymbolView
                        name={currentDeck.deck.pinned ? 'pin.fill' : 'pin'}
                        size={13}
                        tintColor={currentDeck.deck.pinned ? CLASH.tabInk : theme.colors.muted}
                        weight="semibold"
                      />
                      <Text
                        style={[styles.pinText, currentDeck.deck.pinned && styles.pinTextOn]}
                      >
                        {currentDeck.deck.pinned ? t('collection_pinned') : t('collection_pin_short')}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>

                {/* The measured drop zone. Its own view, so the section's
                  padding and the headings never leak into the slot
                  arithmetic. */}
                <View collapsable={false} ref={deckRef}>
                  {currentDeck ? (
                    <SortableDeckGrid
                      cards={currentDeckCards}
                      carry={carry.signals}
                      deckId={currentDeck.deck._id}
                      onEnlarge={enlargeDeckCard}
                      trash={trash}
                      width={deckGridWidth}
                    />
                  ) : (
                    <View style={styles.deckSkeleton}>
                      {Array.from({ length: 8 }, (_, index) => (
                        <View
                          key={index}
                          style={[
                            styles.deckSkeletonSlot,
                            {
                              height: deckSlot.height,
                              width: deckSkeletonCardWidth,
                            },
                          ]}
                        />
                      ))}
                    </View>
                  )}
                </View>
                <DeckDropHalo active={carry.active} />
              </View>
            )}

            {/* PLUS DE SURTITRE AU-DESSUS DU TITRE.
                Il disait « ESPÈCES DE TA RÉGION », ce qui était faux : l'atlas
                est le MÊME pour tout le monde, et c'est ce qui rend deux
                collections comparables — seul l'écran Défis regarde la région
                (voir `useCatalog`). Corrigé en « Toutes les espèces », il
                répétait alors le titre juste en dessous, « Tous les animaux ».
                Un surtitre qui redit la ligne suivante n'est pas un surtitre,
                c'est du bruit. Le titre porte déjà la portée affichée. */}
            <View style={styles.collectionHeading}>
              <View>
                <Text style={styles.collectionTitle}>
                  {group === 'Tous' ? t('collection_all_animals') : (GROUP_LABELS[group] ?? group)}
                </Text>
              </View>
            </View>


            {Platform.OS !== 'ios' ? (
              <Animated.View layout={LinearTransition.springify().damping(20)} style={styles.filterShell}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: filtersOpen }}
                onPress={() => setFiltersOpen((open) => !open)}
                style={styles.filterTrigger}
              >
                <SymbolView name="line.3.horizontal.decrease" size={14} tintColor={theme.colors.primaryText} />
                <Text style={styles.filterTriggerText}>
                  {group === 'Tous' ? t('collection_all_families') : (GROUP_LABELS[group] ?? group)}
                </Text>
                <SymbolView
                  name={filtersOpen ? 'chevron.up' : 'chevron.down'}
                  size={11}
                  tintColor={theme.colors.muted}
                />
              </Pressable>
              {filtersOpen ? (
                <Animated.View
                  entering={FadeInDown.duration(180)}
                  exiting={FadeOutUp.duration(130)}
                  style={styles.filters}
                >
                  {groups.map((item) => (
                    <Pressable
                      key={item}
                      accessibilityRole="button"
                      accessibilityState={{ selected: item === group }}
                      onPress={() => {
                        setGroup(item);
                        setFiltersOpen(false);
                      }}
                      style={[styles.filter, item === group && styles.filterSelected]}
                    >
                      <Text style={[styles.filterText, item === group && styles.filterTextSelected]}>
                        {item === 'Tous' ? t('collection_filter_all_f') : (GROUP_LABELS[item] ?? item)}
                      </Text>
                    </Pressable>
                  ))}
                </Animated.View>
              ) : null}
              </Animated.View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          catalog === undefined ? null : (
            <Text style={styles.empty}>{copy("ui_copy_090")}</Text>
          )
        }
        renderItem={renderItem}
      />

      {/* La poubelle du deck : ici, à la racine, et pas dans l'en-tête de la
          liste. C'est sa place dans l'arbre qui la met au-dessus des rangées de
          la collection — un zIndex posé sur l'en-tête ne franchit pas les
          conteneurs que la liste met autour de ses cellules. */}
      <DeckTrashBin trash={trash} />

      <DeckCarryPreview carry={carry} width={deckSlot.width} />

      <CollectionCardMorph
        onDelete={askDelete}
        ref={morphRef}
      />

      {/* Full-screen and over everything. No confirmation here — the dialog
          already asked, and this is the answer. */}
      {burning ? (
        <View
          // Invisible and untouchable until it is armed — it is only on screen
          // early so the engine can build behind the dialog.
          pointerEvents={burning.armed ? 'auto' : 'none'}
          style={[
            RNStyleSheet.absoluteFill,
            styles.burning,
            burning.armed ? null : styles.burningWarmup,
          ]}
        >
          <BurningCard armed={burning.armed} ink={burning.ink} onBurnt={burnt} />
        </View>
      ) : null}

      <ReportIdentificationSheet
        captureId={reporting?.id ?? null}
        onClose={() => setReporting(null)}
        predictedName={reporting?.name}
        visible={reporting !== null}
      />
    </View>
  );
});

/**
 * One atlas slot. Extracted from the list body so it can be memoised and so it
 * can read the list's adaptive-render signal — a hook that only means anything
 * inside a recycled list row.
 */
const LockedCollectionCell = memo(function LockedCollectionCell({
  cardWidth,
  cellOffset,
  cellWidth,
  item,
}: {
  cardWidth: number;
  cellOffset: number;
  cellWidth: number;
  item: Extract<Slot, { state: 'locked' }>;
}) {
  return (
    <View pointerEvents="none" style={[styles.cell, { paddingLeft: cellOffset, width: cellWidth }]}>
      <CardTile
        locked
        lockedHint={GROUP_LABELS[item.entry.group] ?? '???'}
        lockedShape={silhouetteFor(item.entry.group, item.entry.family)}
        number={item.number}
        width={cardWidth}
      />
    </View>
  );
});

const DiscoveredCollectionCell = memo(function DiscoveredCollectionCell({
  cardWidth,
  cellOffset,
  cellWidth,
  deckMembership,
  gestureFor,
  heldId,
  item,
  landing,
  onOpen,
  onToggleDeck,
}: {
  cardWidth: number;
  /** Décalage de la carte dans sa cellule — dépend de la colonne. */
  cellOffset: number;
  cellWidth: number;
  deckMembership: DeckMembershipStore;
  /** Hold-to-carry into the deck. */
  gestureFor: (card: HoloCardData & { _id: string }) => GestureType;
  heldId: SharedValue<string | null>;
  item: Extract<Slot, { state: 'discovered' }>;
  /**
   * Cette tuile porte la capture qui vient d'être prise : elle se POSE au lieu
   * d'apparaître.
   *
   * C'est la seconde moitié de la sortie de caméra. Là-bas la carte rétrécit et
   * s'en va ; ici elle retombe dans sa case avec le même écrasement que la
   * fermeture d'une fiche (`use-card-morph`). Bout à bout, l'œil suit un seul
   * objet — alors qu'avant, la carte disparaissait avec la modale et la grille
   * surgissait sans rapport.
   */
  landing?: boolean;
  onOpen: (stickerRef: React.RefObject<View | null>, capture: HoloCardData) => void;
  onToggleDeck: (id: Id<'animalCaptures'>) => void;
}) {
  const cardRef = useRef<View | null>(null);
  const captureId = String(item.capture._id);
  const holdGesture = useMemo(
    () => gestureFor(item.capture as HoloCardData & { _id: string }),
    [gestureFor, item.capture],
  );
  // The preview *is* the card. Leaving the tile visible underneath is what
  // read as two identical cards the last time an overlay lifted something.
  const tapGesture = useMemo(() => Gesture.Native(), []);
  const cardGesture = useMemo(
    () => Gesture.Exclusive(holdGesture, tapGesture),
    [holdGesture, tapGesture],
  );
  const { t } = useTranslation();
  const discoveredCapture = item.capture as HoloCardData;
  const inDeck = useStore(deckMembership, (state) => state.captureIds.has(captureId));
  const card = (
    <>
      <GestureDetector gesture={cardGesture}>
        <Pressable accessibilityRole="button" onPress={() => onOpen(cardRef, discoveredCapture)}>
          {/* Exactly the same face as a deck slot. It stays mounted instead of
              being swapped for CardTile during a fling, which caused the
              visible blur and reload on the way back up. */}
          <View collapsable={false} ref={cardRef}>
            <HoloCard data={discoveredCapture} interactive={false} width={cardWidth} />
          </View>
        </Pressable>
      </GestureDetector>
      <Pressable
        accessibilityLabel={inDeck ? t('collection_remove_from_deck') : t('collection_add_to_deck')}
        accessibilityRole="button"
        onPress={() => onToggleDeck(item.capture._id)}
        style={[styles.deckToggle, inDeck && styles.deckToggleSelected]}
      >
        <SymbolView
          name={inDeck ? 'checkmark' : 'plus'}
          size={12}
          tintColor="#fff8e5"
          weight="bold"
        />
      </Pressable>
    </>
  );
  return (
    <View style={[styles.cell, { paddingLeft: cellOffset, width: cellWidth }]}>
      {landing ? (
        <LandingCollectionCardShell captureId={captureId} heldId={heldId}>
          {card}
        </LandingCollectionCardShell>
      ) : (
        <CollectionCardShell captureId={captureId} heldId={heldId}>
          {card}
        </CollectionCardShell>
      )}
    </View>
  );
});

function useHeldCardStyle(heldId: SharedValue<string | null>, captureId: string) {
  return useAnimatedStyle(() => ({
    opacity: withTiming(heldId.get() === captureId ? 0 : 1, { duration: 120 }),
  }));
}

function CollectionCardShell({
  captureId,
  children,
  heldId,
}: {
  captureId: string;
  children: ReactNode;
  heldId: SharedValue<string | null>;
}) {
  const heldStyle = useHeldCardStyle(heldId, captureId);
  return <Animated.View style={[styles.discoveredCard, heldStyle]}>{children}</Animated.View>;
}

function LandingCollectionCardShell({
  captureId,
  children,
  heldId,
}: {
  captureId: string;
  children: ReactNode;
  heldId: SharedValue<string | null>;
}) {
  const heldStyle = useHeldCardStyle(heldId, captureId);
  const sway = useSharedValue(0);
  useEffect(() => {
    sway.set(1);
    sway.set(withSpring(0, { damping: 11, stiffness: 140, mass: 0.9 }));
  }, [sway]);
  const dropStyle = useAnimatedStyle(() => ({
    zIndex: Math.abs(sway.get()) > 0.01 ? 10 : 0,
    opacity: 1 - Math.max(0, sway.get()) * 0.35,
    transform: [
      { translateY: sway.get() * -26 },
      { scale: 1 - sway.get() * 0.16 },
    ],
  }));
  return (
    <Animated.View style={[styles.discoveredCard, heldStyle, dropStyle]}>
      {children}
    </Animated.View>
  );
}

/**
 * The deck lighting up as a drop zone. Its own component so the ring animates
 * off a shared value without the screen re-rendering mid-drag.
 */
function DeckDropHalo({ active }: { active: SharedValue<number> }) {
  const glow = useDerivedValue(() => withTiming(active.get(), { duration: 180 }));
  const style = useAnimatedStyle(() => ({ opacity: glow.get() }));
  return <Animated.View pointerEvents="none" style={[styles.deckHalo, style]} />;
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  title: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 34,
    lineHeight: 38,
  },
  // The deck's outline: the exact rectangle the old black panel filled — tabs,
  // title and slots inside it — except the fill is gone and only the line is
  // left. A theme colour and not a fixed cream: the app follows the system and
  // this screen is normally read in LIGHT mode, where a near-white line at 42%
  // on a #faf6ee page is not a subtle frame, it is no frame at all.
  deckSection: {
    marginHorizontal: DECK_SECTION_MARGIN,
    borderRadius: DECK_SECTION_RADIUS,
    borderWidth: DECK_SECTION_BORDER,
    // The same parchment as the selected tab: the frame and the tab that sits
    // in it are one object, so they are one colour.
    borderColor: CLASH.deckFrame,
    paddingHorizontal: DECK_SECTION_PADDING,
    paddingTop: 8,
    paddingBottom: 14,
  },
  deckHalo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: '#f5c653',
    // Inside the section's border box, so it needs the inner radius.
    borderRadius: DECK_SECTION_RADIUS - DECK_SECTION_BORDER,
    // The frame is gold too, so the halo cannot announce itself with the hue —
    // the wash is what changes when a card is over the deck.
    backgroundColor: 'rgba(245,198,83,0.2)',
  },
  // The spacing lives here and NOT on `deckTabs`, because that view is the one
  // `use-deck-carry` measures to hit-test a card dragged over a deck number —
  // padding inside it would offset every tab.
  deckTabBar: {
    paddingTop: 4,
    // Room for the selected tab's pointer to hang below it.
    paddingBottom: 20,
    marginBottom: 6,
  },
  deckTabs: {
    flexDirection: 'row',
    gap: DECK_TAB_GAP,
    // The shadow layer hangs PRESS_DEPTH below each face and is not laid out,
    // so the row has to reserve that height itself or the deck grid sits on it.
    marginBottom: PRESS_DEPTH,
  },
  // Three tones make the thickness: lit top bevel, face, darker lip under it.
  // Drop the lip and the button goes flat, which is most of what separates a
  // game control from a segmented list.
  // `flex` lives on the slot; the face fills it. Splitting them is what lets
  // the shadow layer be a sibling of the face rather than a border on it.
  deckTabSlot: {
    flex: 1,
  },
  deckTab: {
    height: DECK_TAB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    // No bottom lip any more: the thickness under this is a real view the face
    // presses down onto, not a thick border pretending to be one.
    borderWidth: 2,
    borderColor: CLASH.tabLip,
    backgroundColor: CLASH.tabFace,
  },
  deckTabSelected: {
    borderColor: CLASH.tabLipOn,
    backgroundColor: CLASH.tabFaceOn,
  },
  // The pointer under the open deck's number. Clash's is the reason you never
  // have to ask which of the five you are editing.
  deckTabPointer: {
    position: 'absolute',
    bottom: -13,
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: CLASH.tabFaceOn,
  },
  deckTabText: {
    // No text shadow. It existed to lift white type off a mid-blue face; black
    // ink on white and on yellow needs nothing behind it, and a shadow under
    // it only muddies the yellow.
    color: CLASH.tabInk,
    fontFamily: theme.fonts.display,
    fontSize: 19,
  },
  deckTabTextSelected: {
    color: CLASH.tabInkOn,
  },
  emptyState: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 22,
  },
  emptyTitle: {
    color: '#fff8e5',
    fontFamily: theme.fonts.display,
    fontSize: 22,
    textAlign: 'center',
  },
  emptyMessage: {
    maxWidth: 260,
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: theme.radius.md,
    borderCurve: 'continuous',
    backgroundColor: theme.colors.primary,
  },
  emptyCtaText: {
    color: '#fff',
    fontFamily: theme.fonts.bold,
    fontSize: 15,
  },
  // Le titre et l'épingle sur une ligne : le titre cède, l'épingle garde sa
  // largeur — un nom de deck long ne doit pas pousser l'action hors de l'écran.
  sectionHeadingText: { flex: 1 },
  pin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: CLASH.slotWellEdge,
  },
  pinOn: {
    borderColor: CLASH.tabLipOn,
    backgroundColor: CLASH.tabFaceOn,
  },
  pinText: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bold,
    fontSize: 11,
  },
  pinTextOn: { color: CLASH.tabInk },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  // These two print on the page now, not on a dark panel — so they follow the
  // theme like every other heading instead of assuming a dark backdrop.
  sectionTitle: {
    marginTop: 2,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 24,
  },
  deckSkeleton: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  deckSkeletonSlot: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: CLASH.slotWellEdge,
    borderRadius: 8,
    backgroundColor: CLASH.slotWell,
  },
  discoveredCard: {
    position: 'relative',
  },
  deckToggle: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 27,
    height: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#1c1509',
    borderRadius: 14,
    backgroundColor: '#383227',
  },
  deckToggleSelected: {
    backgroundColor: '#2b2418',
  },
  collectionHeading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 28,
    paddingBottom: Platform.OS === 'ios' ? 15 : 0,
  },
  collectionTitle: {
    marginTop: 2,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 27,
  },
  filterShell: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 15,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
  },
  filterTrigger: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
  },
  filterTriggerText: {
    flex: 1,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 12,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  filter: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 15,
    backgroundColor: theme.colors.surface,
  },
  filterSelected: {
    backgroundColor: theme.colors.foreground,
  },
  filterText: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 11,
  },
  filterTextSelected: {
    color: theme.colors.background,
  },
  empty: {
    padding: 24,
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 14,
    textAlign: 'center',
  },
  // Alignée à gauche, pas centrée : c'est `cellOffset` qui place la carte, et
  // c'est ce qui permet à l'écart horizontal d'égaler l'écart vertical au lieu
  // d'en valoir le double.
  cell: {
    alignItems: 'flex-start',
    paddingBottom: DECK_SECTION_MARGIN,
  },
  // La rangée : un seul conteneur pour trois cases. C'est ce que `numColumns`
  // fabriquait auparavant, en trois éléments de liste au lieu d'un.
  row: {
    flexDirection: 'row',
  },
  // Above the deck's own drop halo and the morph overlay's z-index of 100.
  burning: {
    zIndex: 200,
  },
  burningWarmup: {
    opacity: 0,
  },
}));
