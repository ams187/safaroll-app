import { cardMetrics, HoloCard, type HoloCardData } from '@/components/cards/holo-card';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { View } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

import { deckSlotAt, deckTabAt } from './deck-slot-geometry';
import { deckSlotMetrics } from './sortable-deck-grid';

/**
 * Hold-and-drag a collection card into a deck slot.
 *
 * The hold is short on purpose: 220ms is long enough that a tap still opens the
 * radial menu, short enough that the card feels like it comes off the grid the
 * moment you lean on it.
 */
const CARRY_LONG_PRESS_MS = 220;

export interface DeckCarry<T> {
  active: SharedValue<number>;
  /**
   * 1 when the open deck already holds this card, so it refuses every slot.
   * The refusal is per deck, not per card: sliding onto another deck number
   * clears it, which is how a card moves from one deck to another.
   */
  blocked: SharedValue<number>;
  /** The card in the air, for the floating preview. Null when nothing is held. */
  card: T | null;
  /** Builds the drag gesture for one collection card. Stable across renders. */
  gestureFor: (card: T) => ReturnType<typeof Gesture.Pan>;
  /**
   * Id of the card being carried, so its tile in the grid can hide itself
   * without the screen re-rendering — the preview is the card, and two copies
   * of it on screen is the thing that reads as a bug.
   */
  heldId: SharedValue<string | null>;
  /** Where the carried card already sits in the open deck, or -1. */
  homeSlot: SharedValue<number>;
  hover: SharedValue<number>;
  /** Deck number under the finger, or -1. */
  hoverTab: SharedValue<number>;
  /**
   * The signals the deck grid reads, and nothing else. Stable forever, so
   * handing it down does not rebuild the grid's renderItem on every render of
   * the screen — `card` changing would.
   */
  signals: DeckCarrySignals;
  /** Finger position, relative to `rootRef`. */
  x: SharedValue<number>;
  y: SharedValue<number>;
}

export interface DeckCarrySignals {
  active: SharedValue<number>;
  blocked: SharedValue<number>;
  homeSlot: SharedValue<number>;
  hover: SharedValue<number>;
}

export function useDeckCarry<T extends { _id: string }>({
  deckRef,
  deckWidth,
  onDrop,
  resolveCard,
  onStart,
  onTab,
  rootRef,
  tabsRef,
}: {
  /** The deck grid's own view — measured live so a scroll can't stale it. */
  deckRef: RefObject<View | null>;
  deckWidth: number;
  /**
   * Must be stable. It is closed over by the gesture, and a new identity would
   * rebuild that gesture mid-drag — read changing values through a ref instead.
   */
  onDrop: (card: T, position: number) => void;
  /** Resolves the full card only after a hold actually activates. */
  resolveCard: (id: string) => T | undefined;
  /** Called as the card lifts: the screen brings the deck into view here. */
  onStart?: () => void;
  /** The finger crossed a deck number: open that deck. Must be stable. */
  onTab?: (index: number) => void;
  rootRef: RefObject<View | null>;
  /** The row of deck numbers, the second drop target. */
  tabsRef: RefObject<View | null>;
}): DeckCarry<T> {
  const active = useSharedValue(0);
  const blocked = useSharedValue(0);
  const heldId = useSharedValue<string | null>(null);
  const homeSlot = useSharedValue(-1);
  const hover = useSharedValue(-1);
  const hoverTab = useSharedValue(-1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  // Every frame in window coordinates, so the finger's absoluteX/Y compares
  // against them directly and only the preview needs the root's origin.
  const deckX = useSharedValue(0);
  const deckY = useSharedValue(0);
  const rootX = useSharedValue(0);
  const rootY = useSharedValue(0);
  const tabsX = useSharedValue(0);
  const tabsY = useSharedValue(0);

  const [card, setCard] = useState<T | null>(null);
  const slot = useMemo(() => deckSlotMetrics(deckWidth), [deckWidth]);

  /**
   * CES DEUX FONCTIONS NE DOIVENT JAMAIS CHANGER D'IDENTITÉ. C'EST VITAL.
   *
   * Elles sont capturées par les worklets des gestes, un geste étant créé PAR
   * CARTE (`gestureFor`). Quand elles changeaient d'identité — ce qui arrivait
   * dès que `onDrop` ou `onStart` bougeait, et `handleCarryDrop` dépend de la
   * traduction et du toast — `gestureFor` se reconstruisait, donc TOUS les
   * gestes de TOUTES les cartes.
   *
   * L'ancienne génération de gestes restait référencée par le fil d'animation
   * pendant que les fonctions qu'elle emprisonnait devenaient collectables côté
   * JS. Le fil finissait par vouloir déballer une fonction disparue :
   *
   *   JSIWorkletsModuleProxy.cpp:455
   *     remoteFunction->toJSValue(rt).getObject(rt)  → assertion, SIGABRT
   *
   * Un plantage sans message, quelques minutes après le lancement, en scrollant
   * la collection — c'est-à-dire pendant que les cellules se recyclent et que
   * les gestes se créent et se jettent en continu.
   *
   * La valeur à jour passe donc par une RÉFÉRENCE, lue au moment du geste et
   * jamais capturée. L'identité de `begin` et `end`, elle, est figée pour la
   * durée de vie de l'écran.
   */
  const onStartRef = useRef(onStart);
  const onDropRef = useRef(onDrop);
  const resolveCardRef = useRef(resolveCard);
  useEffect(() => {
    onStartRef.current = onStart;
    onDropRef.current = onDrop;
    resolveCardRef.current = resolveCard;
  }, [onDrop, onStart, resolveCard]);

  const begin = useCallback((id: string) => {
    const held = resolveCardRef.current(id);
    if (!held) return;
    setCard(held);
    onStartRef.current?.();
  }, []);

  const end = useCallback((id: string, position: number) => {
    setCard(null);
    const held = resolveCardRef.current(id);
    if (held && position >= 0) onDropRef.current(held, position);
  }, []);

  // The list is still gliding when the drag starts, and the deck sits in its
  // header — so re-read every frame while the card is in the air rather than
  // trusting one measurement taken mid-scroll. Switching decks mid-drag reflows
  // the header too, which is the second reason this cannot be measured once.
  useEffect(() => {
    if (!card) return;
    let frame: number;
    const track = () => {
      rootRef.current?.measureInWindow((mx, my) => {
        rootX.set(mx);
        rootY.set(my);
      });
      deckRef.current?.measureInWindow((mx, my) => {
        deckX.set(mx);
        deckY.set(my);
      });
      tabsRef.current?.measureInWindow((mx, my) => {
        tabsX.set(mx);
        tabsY.set(my);
      });
      frame = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frame);
  }, [card, deckRef, deckX, deckY, rootRef, rootX, rootY, tabsRef, tabsX, tabsY]);

  // One tick per slot crossed, like sortables does when a card passes another.
  useAnimatedReaction(
    () => hover.get(),
    (value, previous) => {
      if (previous != null && value !== previous && value >= 0) {
        runOnJS(Haptics.selectionAsync)();
      }
    },
  );

  // Crossing a deck number opens that deck, so one uninterrupted drag can go
  // collection → deck 3 → slot. The tab is a waypoint, never a drop target:
  // releasing on it places nothing.
  useAnimatedReaction(
    () => hoverTab.get(),
    (value, previous) => {
      if (previous != null && value !== previous && value >= 0 && onTab) {
        runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Light);
        runOnJS(onTab)(value);
      }
    },
  );

  const gestureFor = useCallback(
    (held: T) => {
      // Capturing the whole card here serialized every URL, name and mastery
      // field into every recycled worklet. The gesture only needs its id; the
      // full object crosses to JS once, and only after a real long press.
      const cardId = held._id;
      return Gesture.Pan()
        .maxPointers(1)
        // A scroll is decided by movement, a carry by stillness. Fail this
        // child recognizer as soon as the finger clearly travels so the list
        // never waits out the 220 ms hold before it starts moving.
        .failOffsetX([-8, 8])
        .failOffsetY([-8, 8])
        // Matches the grid's own scroll: below this the list still scrolls
        // normally, above it the card comes off in your hand.
        .activateAfterLongPress(CARRY_LONG_PRESS_MS)
        .onStart((event) => {
          'worklet';
          active.set(1);
          heldId.set(cardId);
          hover.set(-1);
          hoverTab.set(-1);
          x.set(event.absoluteX - rootX.get());
          y.set(event.absoluteY - rootY.get());
          runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
          runOnJS(begin)(cardId);
        })
        .onUpdate((event) => {
          'worklet';
          x.set(event.absoluteX - rootX.get());
          y.set(event.absoluteY - rootY.get());
          hoverTab.set(deckTabAt(event.absoluteX, event.absoluteY, { x: tabsX.get(), y: tabsY.get() }, deckWidth));
          // A deck that already holds this card takes no drop. It still lights
          // up the slot the card sits in — see `CarrySlot` — so the answer is
          // "it is already there", not "nothing happened".
          hover.set(
            blocked.get() === 1
              ? -1
              : deckSlotAt(event.absoluteX, event.absoluteY, { x: deckX.get(), y: deckY.get() }, slot),
          );
        })
        // onFinalize, not onEnd: a hold that never travels far enough to
        // activate still has to clear the state it armed.
        .onFinalize(() => {
          'worklet';
          if (active.get() === 0) return;
          const position = hover.get();
          active.set(0);
          heldId.set(null);
          hover.set(-1);
          hoverTab.set(-1);
          if (position >= 0) runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Rigid);
          runOnJS(end)(cardId, position);
        });
    },
    [
      active,
      begin,
      blocked,
      deckWidth,
      deckX,
      deckY,
      end,
      heldId,
      hover,
      hoverTab,
      rootX,
      rootY,
      slot,
      tabsX,
      tabsY,
      x,
      y,
    ],
  );

  const signals = useMemo(
    () => ({ active, blocked, homeSlot, hover }),
    [active, blocked, homeSlot, hover],
  );

  return { active, blocked, card, gestureFor, heldId, homeSlot, hover, hoverTab, signals, x, y };
}

/**
 * The card under the finger. Rendered at the *deck's* slot size, not the
 * collection's, so the card visibly becomes a deck card while it is still in
 * the air. Put it last inside the same view `rootRef` points at.
 */
export function DeckCarryPreview<T extends HoloCardData>({
  carry,
  width,
}: {
  carry: DeckCarry<T>;
  width: number;
}) {
  const { height } = cardMetrics(width);
  const style = useAnimatedStyle(() => ({
    opacity: carry.active.get(),
    transform: [
      { translateX: carry.x.get() - width / 2 },
      { translateY: carry.y.get() - height / 2 },
      { scale: 1.08 },
    ],
  }));

  if (!carry.card) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.preview, style]}>
      <HoloCard data={carry.card} interactive={false} width={width} />
    </Animated.View>
  );
}

const styles = StyleSheet.create(() => ({
  preview: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
  },
}));
