// Menu radial garé dans card-radial-menu.tsx : un tap ouvre désormais la fiche.
import { cardMetrics, HoloCard } from '@/components/cards/holo-card';
import { CLASH } from '@/lib/clash-palette';
import type { HoloCardData } from '@/components/cards/holo-card';
import { api } from '@/lib/supabase/api';
import type { Id } from '@/lib/supabase/api';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useMutation } from '@/lib/supabase/backend';
import { useCallback, useMemo, useRef, useState, type RefObject } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';
import Sortable, {
  type SortableGridDragEndCallback,
  type SortableGridRenderItem,
} from 'react-native-sortables';
import { StyleSheet } from 'react-native-unistyles';

import {
  DECK_COLUMNS,
  DECK_GAP,
  DECK_SLOT_COUNT,
  compactDeckSlotsAfterRemoval,
  deckCaptureSetKey,
  deckSlotKey,
} from './deck-slot-geometry';
import type { DeckTrash } from './use-deck-trash';
// Type-only, so the runtime dependency stays one-way: use-deck-carry imports
// `deckSlotMetrics` from here, never the reverse.
import type { DeckCarrySignals } from './use-deck-carry';

export type { DeckCarrySignals };

const SLOT_COUNT = DECK_SLOT_COUNT;
const COLUMNS = DECK_COLUMNS;
const GAP = DECK_GAP;

/**
 * The library's default indicator, minus its hardcoded corner — passing
 * `dropIndicatorStyle` replaces the default wholesale rather than merging, so
 * the rest of it has to be restated here.
 */
const DROP_INDICATOR = {
  backgroundColor: 'rgba(0, 0, 0, 0.1)',
  borderColor: 'black',
  borderStyle: 'dashed',
  borderWidth: 2,
  flex: 1,
} as const;

/** The slot box for a deck grid of this width. The only source of it. */
export function deckSlotMetrics(width: number) {
  return cardMetrics((width - (COLUMNS - 1) * GAP) / COLUMNS);
}

type DeckCard = HoloCardData & { _id: Id<'animalCaptures'> };
type GridContent = { kind: 'card'; card: DeckCard } | { kind: 'empty' };
type GridItem = GridContent & { id: string };

function putInSlots(items: readonly GridContent[], order: readonly string[]): GridItem[] {
  return items.map((item, index) => ({ ...item, id: order[index] ?? deckSlotKey(index) }));
}

function captureSetKey(items: readonly GridItem[]): string {
  return deckCaptureSetKey(
    items.flatMap((item) => (item.kind === 'card' ? [item.card._id] : [])),
  );
}

const keyOfGridItem = (item: GridItem) => item.id;

export function SortableDeckGrid({
  cards,
  carry,
  deckId,
  onEnlarge,
  onSlotPress,
  trash,
  width,
}: {
  cards: DeckCard[];
  /**
   * Set while a collection card is being dragged over this grid. Every slot
   * dims to `inactiveItemOpacity` — the same 0.5 sortables uses when you drag a
   * card *inside* the deck — and the one under the finger lights back up.
   */
  carry?: DeckCarrySignals;
  deckId: Id<'decks'>;
  /**
   * Receives the slot's own view, because the opening morph *measures* it —
   * handed a ref with a null current it bails out and the card never opens.
   */
  onEnlarge?: (card: HoloCardData, cardRef: RefObject<View | null>) => void;
  /**
   * Placement mode. When set, every slot becomes a target: tapping one hands
   * back its position and the caller decides what lands there — an empty slot
   * fills, an occupied one is replaced, a card already in the deck moves.
   */
  onSlotPress?: (position: number) => void;
  /**
   * Le geste de retrait. Tirer une carte sous le plateau lève la poubelle, la
   * lâcher dedans retire la carte. L'état et le calque vivent dans
   * `useDeckTrash` — dessiné à la racine de l'écran, pas ici : dans l'en-tête
   * d'une liste, il passerait sous les rangées de la collection.
   */
  trash?: DeckTrash;
  width: number;
}) {
  const reorderCards = useMutation(api.decks.reorderCards);
  // Sortables owns the order during a drag. Reusing that order for the next
  // deck keeps its eight native gesture cells alive without fighting the
  // layout the library just committed.
  const [slotOrder, setSlotOrder] = useState(
    Array.from({ length: SLOT_COUNT }, (_, index) => deckSlotKey(index)),
  );
  const sourceItems = useMemo<GridItem[]>(
    () =>
      putInSlots(
        [
          ...cards.slice(0, SLOT_COUNT).map((card) => ({ kind: 'card' as const, card })),
          ...Array.from({ length: Math.max(0, SLOT_COUNT - cards.length) }, () => ({
            kind: 'empty' as const,
          })),
        ],
        slotOrder,
      ),
    [cards, slotOrder],
  );
  const [optimistic, setOptimistic] = useState<{
    deckId: Id<'decks'>;
    items: GridItem[];
  } | null>(null);
  const sourceKeys = captureSetKey(sourceItems);
  const optimisticKeys = optimistic ? captureSetKey(optimistic.items) : undefined;
  const items =
    optimistic?.deckId === deckId && optimisticKeys === sourceKeys
      ? optimistic.items
      : sourceItems;
  // The empty slot has to be the same box as a card, down to the corner
  // radius — a hardcoded radius disagreed with CardTile's computed one and the
  // row read as two different card sizes.
  const metrics = useMemo(() => deckSlotMetrics(width), [width]);
  const cardWidth = metrics.width;
  const dropIndicatorStyle = useMemo(
    () => ({ ...DROP_INDICATOR, borderRadius: metrics.radius }),
    [metrics.radius],
  );

  const renderItem = useCallback<SortableGridRenderItem<GridItem>>(
    ({ item, index }) => (
      <Pressable
        disabled={!onSlotPress}
        onPress={() => onSlotPress?.(index)}
        style={[
          { height: metrics.height, width: metrics.width },
          onSlotPress ? styles.targetable : undefined,
        ]}
      >
        <CarrySlot carry={carry} index={index} metrics={metrics}>
          {item.kind === 'card' ? (
            <Sortable.Handle>
              {/* Same miniature and same tap-to-open as the collection grid. */}
              <DeckSlotCard
                card={item.card}
                cardWidth={cardWidth}
                onEnlarge={onSlotPress ? undefined : onEnlarge}
              />
            </Sortable.Handle>
          ) : (
            /* Explicit box rather than `flex: 1`. The card branch sits under an
               extra Sortable.Handle wrapper, so the two children were not being
               stretched by the same parent and the empty slot came out taller. */
            <View
              style={[
                styles.emptySlot,
                { borderRadius: metrics.radius, height: metrics.height, width: metrics.width },
              ]}
            >
              <SymbolView name="plus" size={15} tintColor="rgba(255,255,255,0.45)" />
            </View>
          )}
        </CarrySlot>
      </Pressable>
    ),
    [cardWidth, carry, metrics, onEnlarge, onSlotPress],
  );

  const onDragEnd = useCallback<SortableGridDragEndCallback<GridItem>>(
    ({ data, key }) => {

      // Lâchée dans la poubelle : la carte quitte le deck, pas sa position.
      const dropped = data.find(
        (item): item is Extract<GridItem, { kind: 'card' }> => item.kind === 'card' && item.id === key,
      );
      if (trash?.onRemove && dropped && trash.overBin.get() === 1) {
        // La grille sans elle, reconstruite comme `sourceItems` la construira
        // quand le serveur aura confirmé. Les clés suivent l'ordre déjà validé
        // par Sortables ; aucune seconde synchronisation ne peut clignoter.
        const nextItems = compactDeckSlotsAfterRemoval(data, key, {
          id: key,
          kind: 'empty' as const,
        });
        setSlotOrder(nextItems.map((item) => item.id));
        setOptimistic({
          deckId,
          items: nextItems,
        });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        trash.onRemove(dropped.card._id);
        // Le geste vient d'être exécuté : l'indice n'a plus rien à enseigner.
        trash.markLearned();
        trash.settle();
        return;
      }
      trash?.settle();

      setSlotOrder(data.map((item) => item.id));
      setOptimistic({ deckId, items: data });
      const captureIds = data
        .filter((item): item is Extract<GridItem, { kind: 'card' }> => item.kind === 'card')
        .map((item) => item.card._id);
      void reorderCards({ deckId, captureIds }).catch((error: unknown) => {
        // Dropping the optimistic order is right — the server did not take it.
        // Saying so is what was missing: a silent snap-back reads as a broken
        // drag, and it hid a dead `reorder_deck_cards` for a full day.
        console.warn('deck reorder rejected', error);
        setOptimistic(null);
      });
    },
    [deckId, reorderCards, trash],
  );

  return (
    <View>
      {/* Mesurée au début de chaque portage : c'est son bord bas qui décide à
          partir d'où la poubelle commence à se lever, et où elle se place. */}
      <View collapsable={false} ref={trash?.gridRef}>
        <Sortable.Grid
          activeItemScale={1.08}
          columnGap={GAP}
          columns={COLUMNS}
          customHandle
          data={items}
          dragActivationDelay={140}
          dropAnimationDuration={trash?.dropAnimationDuration}
          // The library's own default is a flat `borderRadius: 10`, which is
          // what made the hole under a lifted card rounder than the card. It is
          // the card's corner now, by construction.
          dropIndicatorStyle={dropIndicatorStyle}
          hapticsEnabled
          keyExtractor={keyOfGridItem}
          onDragEnd={onDragEnd}
          onDragMove={trash?.enabled ? trash.onDragMove : undefined}
          onDragStart={trash?.enabled ? trash.onDragStart : undefined}
          // « vertical » et plus « none » : la poubelle vit SOUS le plateau, et
          // une carte bridée aux bords de la grille ne pourrait jamais
          // l'atteindre — ni la révéler.
          overDrag={trash?.enabled ? 'vertical' : 'none'}
          renderItem={renderItem}
          rowGap={GAP}
          showDropIndicator
        />
      </View>
    </View>
  );
}

/**
 * One occupied slot. It exists to own a ref: the opening morph measures the
 * card's frame to know where to fly from, so every card that can be enlarged
 * needs a real view of its own — exactly as the collection cell does.
 */
function DeckSlotCard({
  card,
  cardWidth,
  onEnlarge,
}: {
  card: DeckCard;
  cardWidth: number;
  onEnlarge?: (card: HoloCardData, cardRef: RefObject<View | null>) => void;
}) {
  const cardRef = useRef<View | null>(null);
  const face = (
    <View collapsable={false} ref={cardRef}>
      <HoloCard data={card} interactive={false} width={cardWidth} />
    </View>
  );

  if (!onEnlarge) return face;
  return (
    <Pressable accessibilityRole="button" onPress={() => onEnlarge(card, cardRef)}>
      {face}
    </Pressable>
  );
}

/**
 * A slot's answer to a card flying over the deck. Nothing here re-renders: both
 * signals are shared values, so the whole grid stays still while the finger
 * moves.
 */
function CarrySlot({
  carry,
  children,
  index,
  metrics,
}: {
  carry?: DeckCarrySignals;
  children: React.ReactNode;
  index: number;
  metrics: ReturnType<typeof deckSlotMetrics>;
}) {
  // withTiming inside a derived value restarts only when its inputs change,
  // which is what we want — the same expression inside useAnimatedStyle would
  // restart on every frame of the drag.
  const dim = useDerivedValue(() =>
    withTiming(carry && carry.active.get() === 1 ? 1 : 0, { duration: 140 }),
  );
  const hot = useDerivedValue(() =>
    withTiming(carry && carry.active.get() === 1 && carry.hover.get() === index ? 1 : 0, {
      duration: 110,
    }),
  );
  // The slot the carried card already occupies in this deck. It stays lit for
  // the whole drag — not only under the finger — because it is the answer to
  // "why can I not drop here": the card is already there, and that is it.
  const home = useDerivedValue(() =>
    withTiming(carry && carry.active.get() === 1 && carry.homeSlot.get() === index ? 1 : 0, {
      duration: 160,
    }),
  );

  const slotStyle = useAnimatedStyle(() => ({
    // 1 at rest, 0.5 dimmed, back to 1 under the finger. 0.5 is sortables'
    // own `inactiveItemOpacity`, so a card carried in from the collection
    // greys the deck exactly like a card dragged inside it. Its own slot never
    // dims — the one card in the deck you must be able to see is that one.
    opacity: 1 - dim.get() * 0.5 + hot.get() * 0.5 + home.get() * 0.5,
    transform: [{ scale: 1 - dim.get() * 0.04 + hot.get() * 0.1 + home.get() * 0.04 }],
  }));

  const ringStyle = useAnimatedStyle(() => ({ opacity: hot.get() }));
  const homeRingStyle = useAnimatedStyle(() => ({ opacity: home.get() }));

  return (
    <Animated.View style={slotStyle}>
      {children}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.dropRing,
          { borderRadius: metrics.radius, height: metrics.height, width: metrics.width },
          ringStyle,
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.homeRing,
          { borderRadius: metrics.radius, height: metrics.height, width: metrics.width },
          homeRingStyle,
        ]}
      >
        <SymbolView name="checkmark" size={17} tintColor="#fff8e5" weight="bold" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create(() => ({
  targetable: {
    opacity: 0.92,
  },
  dropRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderWidth: 2.5,
    borderColor: '#f5c653',
    backgroundColor: 'rgba(245,198,83,0.16)',
  },
  // Deliberately not the amber of a drop target: this one says "already here",
  // and a player must never read it as "release to place".
  homeRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,248,229,0.85)',
    backgroundColor: 'rgba(10,8,4,0.45)',
  },
  // A hole punched in the board, not a pale card. On the blue field a light
  // fill read as an eighth card you could not identify.
  emptySlot: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: CLASH.slotWellEdge,
    borderStyle: 'dashed',
    backgroundColor: CLASH.slotWell,
  },
}));
