import { uiLanguage } from '@/i18n/current';
import { MASTERY_DAY_THRESHOLDS, type SpeciesMastery } from '@/lib/animals/progression';
import { Text, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { MasteryStarsPopover } from './mastery-stars-popover';

/** Mastery tops out at five levels, so the row is always five slots wide. */
const SLOTS = MASTERY_DAY_THRESHOLDS.common.length;

/**
 * Gold, and only gold — never the rarity's accent.
 *
 * The two axes were just pulled apart on purpose: rarity lives on the card's
 * edge, mastery lives inside it. Tinting the stars per rarity would tie them
 * back together and you would be reading one thing again.
 */
const EARNED = '#ffd447';
const NEXT = 'rgba(255, 212, 71, 0.85)';
const LOCKED = 'rgba(255, 255, 255, 0.28)';

/**
 * How far this species has been mastered, as a row of five stars.
 *
 * It replaces the "Niveau 2 · 2/3" lockup on card faces. Five levels and five
 * stars is an exact mapping, which the numbers never were: `2/3` borrowed the
 * shape of Clash's `325/3500` for a scale a hundred times shorter, and on a
 * fresh card the banner filled a third of the art to say "Niveau 1" — which
 * every card you own already is.
 *
 * The star after the last earned one is drawn hollow rather than absent. That
 * is what the ratio was actually for: not the count, the *nearly*.
 */
export function MasteryStars({ interactive, mastery, size }: { interactive?: boolean; mastery: SpeciesMastery; size: number }) {
  const level = mastery.level;
  const stars = (
    <View
      accessibilityLabel={uiLanguage() === 'fr' ? `Niveau ${level} sur ${SLOTS}` : `Level ${level} of ${SLOTS}`}
      style={[styles.row, { gap: size * 0.1 }]}
    >
      {Array.from({ length: SLOTS }, (_, index) => {
        const earned = index < level;
        // `index === level` is the one being worked toward — unless the row is
        // full, where there is no next and nothing should look pending.
        const next = index === level;
        return (
          <Text
            key={index}
            style={[
              styles.star,
              {
                color: earned ? EARNED : next ? NEXT : LOCKED,
                fontSize: size,
                lineHeight: size * 1.15,
                textShadowRadius: earned ? size * 0.35 : 0,
              },
            ]}
          >
            {earned ? '★' : '☆'}
          </Text>
        );
      })}
    </View>
  );

  return interactive ? <MasteryStarsPopover mastery={mastery}>{stars}</MasteryStarsPopover> : stars;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  star: {
    // The art behind can be anything from a snowfield to a night sky, so every
    // star carries its own contrast rather than trusting the card.
    textShadowColor: 'rgba(3, 8, 20, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
  },
});
