import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { CardTile } from '@/components/cards/card-tile';
import { CARD_RATIO, type HoloCardData } from '@/components/cards/holo-card';
import { api } from '@/lib/supabase/api';
import type { Id } from '@/lib/supabase/api';
import { backendQuery } from '@/lib/supabase/backend';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { StyleSheet } from 'react-native-unistyles';

/** A deck is a showcase of eight pieces — empty slots render locked. */
const SLOTS = 8;

type DeckSummary = {
  _id: Id<'decks'>;
  name: string;
  cardCount: number;
};

/**
 * Apple Wallet-style pile: the eight cards of a deck fanned vertically, name
 * plates peeking. Tapping the pile squeezes it, then the cards spring apart —
 * deeper cards travel with more energy, wallet-fashion. The header opens the
 * deck itself.
 */
export function DeckStack({
  deck,
  onOpen,
  width,
}: {
  deck: DeckSummary;
  onOpen: () => void;
  width: number;
}) {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const { data } = useQuery(backendQuery(api.decks.get, { id: deck._id }));
  const [expanded, setExpanded] = useState(false);

  const cardWidth = Math.min(Math.round(width * 0.62), 210);
  const cardHeight = Math.round(cardWidth / CARD_RATIO);
  const collapsedPeek = Math.round(cardHeight * 0.14);
  const expandedPeek = Math.round(cardHeight * 0.62);
  const slots = Array.from({ length: SLOTS }, (_, i) => data?.cards[i]);

  const toggle = () => {
    if (process.env.EXPO_OS === 'ios') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setExpanded((prev) => !prev);
  };

  const pileStyle = useAnimatedStyle(() => ({
    height: withTiming(
      cardHeight + (SLOTS - 1) * (expanded ? expandedPeek : collapsedPeek),
      { duration: 460, easing: Easing.bezier(0.22, 1, 0.36, 1) },
    ),
  }));

  return (
    <View style={styles.root}>
      <Pressable accessibilityRole="button" style={styles.header} onPress={onOpen}>
        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.name}>{deck.name}</Text>
          <Text style={styles.meta}>{deck.cardCount} / {SLOTS} {' '}{copy("ui_copy_093")}</Text>
        </View>
        <SymbolView name="chevron.right" size={14} tintColor="#2b2418" weight="semibold" />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={expanded ? t('deck_collapse') : t('deck_spread')}
        onPress={toggle}
      >
        <Animated.View style={[styles.pile, { width: cardWidth }, pileStyle]}>
          {slots.map((card, index) => (
            <StackCard
              card={card}
              cardHeight={cardHeight}
              cardWidth={cardWidth}
              collapsedPeek={collapsedPeek}
              expanded={expanded}
              expandedPeek={expandedPeek}
              index={index}
              key={card?._id ?? `slot-${index}`}
            />
          ))}
        </Animated.View>
      </Pressable>
    </View>
  );
}

function StackCard({
  card,
  cardHeight,
  cardWidth,
  collapsedPeek,
  expanded,
  expandedPeek,
  index,
}: {
  card: HoloCardData | undefined;
  cardHeight: number;
  cardWidth: number;
  collapsedPeek: number;
  expanded: boolean;
  expandedPeek: number;
  index: number;
}) {
  const { t } = useTranslation();
  const collapsedY = index * collapsedPeek;
  const expandedY = index * expandedPeek;
  // Alternating tilt gives the collapsed pile its hand-stacked fan look.
  const fanAngle = (index % 2 === 0 ? 1 : -1) * Math.min(index, 3) * 0.7;
  const depth = SLOTS - index;

  const translateY = useSharedValue(collapsedY);
  const rotate = useSharedValue(fanAngle);

  useEffect(() => {
    if (expanded) {
      translateY.set(
        withSequence(
          withTiming(collapsedY + cardHeight * 0.025 * depth, {
            duration: 220,
            easing: Easing.out(Easing.quad),
          }),
          withSpring(expandedY, { damping: 13, mass: 0.9, stiffness: 150 - index * 8 }),
        ),
      );
      rotate.set(withTiming(0, { duration: 260 }));
    } else {
      translateY.set(withDelay(index * 40, withSpring(collapsedY, { damping: 15, stiffness: 170 })));
      rotate.set(withDelay(index * 40, withSpring(fanAngle)));
    }
  }, [cardHeight, collapsedY, depth, expanded, expandedY, fanAngle, index, rotate, translateY]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.get() }, { rotateZ: `${rotate.get()}deg` }],
  }));

  return (
    <Animated.View style={[styles.card, { width: cardWidth, zIndex: depth }, cardStyle]}>
      <CardTile data={card} locked={!card} number={index + 1} width={cardWidth} />
    </Animated.View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    gap: 14,
    padding: 16,
    borderRadius: 24,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 18,
  },
  meta: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.medium,
    fontSize: 12,
  },
  pile: {
    alignSelf: 'center',
  },
  card: {
    position: 'absolute',
    top: 0,
  },
}));
