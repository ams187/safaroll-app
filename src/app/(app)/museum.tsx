import { uiLocaleTag } from '@/i18n/current';
import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { translate } from '@/i18n';
import { CardTile } from '@/components/cards/card-tile';
import { ThinkingLoader } from '@/components/ui/thinking-loader';
import { MonthRangeSlider } from '@/components/ui/month-range-slider';
import type { HoloCardData } from '@/components/cards/holo-card';
import { api } from '@/lib/supabase/api';
import type { Id } from '@/lib/supabase/api';
import { useBackendAuth, useQuery } from '@/lib/supabase/backend';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

type Capture = NonNullable<ReturnType<typeof useMuseumCaptures>['data']>[number];

function useMuseumCaptures() {
  const { isAuthenticated } = useBackendAuth();
  return { data: useQuery(api.animals.listCaptures, isAuthenticated ? {} : 'skip') };
}

/**
 * The museum builds itself from the visitor's real life: halls are the
 * families of their collection, plaques are auto-written from their own
 * encounters. The only curated part is the Vitrine — and that lives on Home.
 * No furniture, no currency: the data is the decoration.
 */
export default function MuseumScreen() {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { data: captures } = useMuseumCaptures();
  const decks = useQuery(api.decks.listMine, captures ? {} : 'skip');
  const [months, setMonths] = useState(12);
  const [periodOpen, setPeriodOpen] = useState(false);

  const halls = useMemo(() => {
    if (!captures) return [];
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const bySpecies = new Map<string, Capture[]>();
    for (const capture of captures) {
      if (capture.status !== 'ready' && capture.status !== 'needs_review') continue;
      if (capture.capturedAt < cutoff.getTime()) continue;
      const key = capture.scientificName ?? capture.commonName;
      if (!key) continue;
      const existing = bySpecies.get(key);
      if (existing) existing.push(capture);
      else bySpecies.set(key, [capture]);
    }

    const byFamily = new Map<string, { species: Capture; encounters: Capture[] }[]>();
    for (const encounters of bySpecies.values()) {
      // The plaque tells the story of the FIRST encounter.
      const first = encounters.reduce((oldest, capture) =>
        capture.capturedAt < oldest.capturedAt ? capture : oldest,
      );
      const family = first.taxonomy?.family ?? t('museum_unknown_room');
      const hall = byFamily.get(family);
      const entry = { species: first, encounters };
      if (hall) hall.push(entry);
      else byFamily.set(family, [entry]);
    }

    return [...byFamily.entries()]
      .map(([family, species]) => ({ family, species }))
      .sort((a, b) => b.species.length - a.species.length);
  }, [captures, months, t]);

  if (!captures) {
    return (
      <View style={styles.center}>
        <ThinkingLoader label={t('museum_loading')} state="shaping" />
      </View>
    );
  }

  const tileWidth = (width - 32 - 2 * 10) / 3;
  const speciesTotal = halls.reduce((sum, hall) => sum + hall.species.length, 0);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.intro}>
        <Text style={styles.eyebrow}>{copy("ui_copy_182")}</Text>
        <Text style={styles.subtitle}>
          {copy('museum_species', { count: speciesTotal })} ·{' '}
          {halls.length} {' '}{copy("ui_copy_184")}{halls.length > 1 ? 's' : ''}
          {decks?.length ? ` · vitrine « ${decks[0].name} »` : ''}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: periodOpen }}
          onPress={() => setPeriodOpen((open) => !open)}
          style={styles.periodTrigger}
        >
          <Text style={styles.periodTriggerText}>{months} {' '}{copy("ui_copy_185")}</Text>
          <Text style={styles.periodChevron}>{periodOpen ? '−' : '+'}</Text>
        </Pressable>
        {periodOpen ? (
          <View style={styles.periodPanel}>
            <MonthRangeSlider
              onChange={setMonths}
              size={Math.min(width - 64, 250)}
              value={months}
            />
            <Text style={styles.periodHint}>{copy("ui_copy_186")}</Text>
          </View>
        ) : null}
      </View>

      {halls.length === 0 ? (
        <Text style={styles.empty}>
          {copy("ui_copy_187")}</Text>
      ) : null}

      {halls.map((hall) => (
        <View key={hall.family} style={styles.hall}>
          <Text style={styles.hallName}>{copy("ui_copy_188")}{' '}{hall.family}</Text>
          <View style={styles.hallGrid}>
            {hall.species.map(({ species, encounters }) => (
              <View key={species._id} style={{ width: tileWidth }}>
                <CardTile
                  data={species as HoloCardData}
                  onPress={() =>
                    router.push({
                      pathname: '/(app)/(tabs)/(home)/[id]',
                      params: { id: species._id as Id<'animalCaptures'> },
                    })
                  }
                  width={tileWidth}
                />
                <Text numberOfLines={3} style={styles.plaque}>
                  {plaqueFor(species, encounters.length)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

/** The plaque: their story, not Wikipedia's. */
function plaqueFor(first: Capture, encounterCount: number) {
  const date = new Date(first.capturedAt).toLocaleDateString(uiLocaleTag(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return [
    translate('museum_first_met', { date }),
    encounterCount > 1 ? translate('museum_encounters', { count: encounterCount }) : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

const styles = StyleSheet.create((theme) => ({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 140,
    gap: 28,
  },
  intro: {
    gap: 5,
    paddingTop: 8,
  },
  eyebrow: {
    color: theme.colors.primaryText,
    fontFamily: theme.fonts.bold,
    fontSize: 10,
    letterSpacing: 1.7,
  },
  subtitle: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 13,
  },
  periodTrigger: {
    minHeight: 42,
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 999,
    paddingHorizontal: 15,
    backgroundColor: theme.colors.primarySoft,
  },
  periodTriggerText: {
    color: theme.colors.primaryText,
    fontFamily: theme.fonts.bold,
    fontSize: 12,
  },
  periodChevron: {
    color: theme.colors.primaryText,
    fontFamily: theme.fonts.bold,
    fontSize: 17,
  },
  periodPanel: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
  },
  periodHint: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 12,
  },
  empty: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 14,
    lineHeight: 21,
  },
  hall: {
    gap: 12,
  },
  hallName: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 22,
  },
  hallGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  plaque: {
    marginTop: 5,
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 10,
    lineHeight: 14,
  },
}));
