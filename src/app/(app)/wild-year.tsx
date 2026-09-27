import { uiLocaleTag } from '@/i18n/current';
import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { CardTile } from '@/components/cards/card-tile';
import { speciesName } from '@/lib/animals/species-name';
import { ThinkingLoader } from '@/components/ui/thinking-loader';
import type { HoloCardData } from '@/components/cards/holo-card';
import type { LocalEncounterRarity } from '@/lib/animals/progression';
import { cardRarity, RARITY_ORDER, tierFor, type Rarity } from '@/lib/animals/rarity';
import { usePremium } from '@/lib/premium';
import { api } from '@/lib/supabase/api';
import { useBackendAuth, useQuery } from '@/lib/supabase/backend';
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

/**
 * « Votre année sauvage » — the yearly story, computed from the collection.
 * The strongest Naturalist feature: intimate value, not just social. Free
 * users see the story teased; the full narrative sits behind the entitlement.
 */
export default function WildYearScreen() {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { isAuthenticated } = useBackendAuth();
  const captures = useQuery(api.animals.listCaptures, isAuthenticated ? {} : 'skip');
  const { isPremium } = usePremium();

  const year = new Date().getFullYear();
  const story = useMemo(() => {
    if (!captures) return undefined;
    const done = captures.filter(
      (capture) =>
        (capture.status === 'ready' || capture.status === 'needs_review') &&
        new Date(capture.capturedAt).getFullYear() === year,
    );
    if (done.length === 0) return null;

    const bySpecies = new Map<string, typeof done>();
    for (const capture of done) {
      const key = capture.scientificName ?? capture.commonName ?? capture._id;
      const list = bySpecies.get(key);
      if (list) list.push(capture);
      else bySpecies.set(key, [capture]);
    }

    const first = done.reduce((oldest, capture) =>
      capture.capturedAt < oldest.capturedAt ? capture : oldest,
    );
    const mostMet = [...bySpecies.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    // La rareté de la CARTE, pas le compteur d'observations sauvages autour de
    // la capture : celui-ci comptait zéro pour un lion au zoo et faisait de lui
    // la plus belle trouvaille de l'année.
    const rankOf = (capture: { localEncounterRarity?: LocalEncounterRarity; rarity?: Rarity }) =>
      RARITY_ORDER.indexOf(cardRarity(capture) ?? 'common');
    const rarest = done.reduce((best, capture) =>
      rankOf(capture) > rankOf(best) ? capture : best,
    );
    return {
      captureCount: done.length,
      speciesCount: bySpecies.size,
      first,
      mostMet: { capture: mostMet[1][0], count: mostMet[1].length },
      rarest,
    };
  }, [captures, year]);

  if (story === undefined) {
    return (
      <View style={styles.center}>
        <ThinkingLoader
          label={t('year_loading')}
          state="composing"
          theme="dark"
        />
      </View>
    );
  }

  const tileWidth = Math.min(width * 0.36, 150);

  return (
    <View style={styles.screen}>
      <Pressable
        accessibilityLabel={copy("reveal_close")}
        accessibilityRole="button"
        onPress={() => router.back()}
        style={[styles.close, { top: insets.top + 8 }]}
      >
        <SymbolView name="xmark" size={16} tintColor="#fff" weight="semibold" />
      </Pressable>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 48 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>{copy("ui_copy_142")}</Text>
        <Text style={styles.title}>{year}</Text>

        {story === null ? (
          <Text style={styles.empty}>
            {copy("ui_copy_143")}</Text>
        ) : (
          <>
            <View style={styles.stats}>
              <Stat label={copy("ui_copy_144")} value={String(story.captureCount)} />
              <Stat label={copy("ui_copy_056")} value={String(story.speciesCount)} />
            </View>

            <Chapter
              title={t('year_first')}
              body={t('year_first_body', { name: speciesName(story.first) ?? story.first.scientificName, date: new Date(story.first.capturedAt).toLocaleDateString(uiLocaleTag(), { day: 'numeric', month: 'long' }) })}
            >
              <CardTile data={story.first as HoloCardData} width={tileWidth} />
            </Chapter>

            {isPremium ? (
              <>
                <Chapter
                  title={t('year_most_seen')}
                  body={t('year_most_seen_body', { name: speciesName(story.mostMet.capture) ?? story.mostMet.capture.scientificName, count: story.mostMet.count })}
                >
                  <CardTile data={story.mostMet.capture as HoloCardData} width={tileWidth} />
                </Chapter>
                <Chapter
                  title={t('year_rarest')}
                  body={
t('year_rarest_tier_body', { name: speciesName(story.rarest) ?? story.rarest.scientificName, rarity: tierFor(cardRarity(story.rarest)).label.toLowerCase() })
                  }
                >
                  <CardTile data={story.rarest as HoloCardData} width={tileWidth} />
                </Chapter>
              </>
            ) : (
              <View style={styles.paywall}>
                <SymbolView name="sparkles" size={26} tintColor="#2b2418" />
                <Text style={styles.paywallTitle}>{copy("ui_copy_145")}</Text>
                <Text style={styles.paywallBody}>
                  {copy("ui_copy_146")}</Text>
                <Pressable accessibilityRole="button" onPress={() => router.push('/paywall')} style={styles.paywallButton}>
                  <Text style={styles.paywallButtonText}>{copy("ui_copy_147")}</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Chapter({
  body,
  children,
  title,
}: {
  body: string;
  children?: React.ReactNode;
  title: string;
}) {
  return (
    <View style={styles.chapter}>
      <Text style={styles.chapterTitle}>{title}</Text>
      {children ? <View style={styles.chapterCard}>{children}</View> : null}
      <Text style={styles.chapterBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: '#100b04' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  close: {
    position: 'absolute',
    right: 16,
    zIndex: 5,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  content: { alignItems: 'center', paddingHorizontal: 24 },
  eyebrow: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.bold,
    fontSize: 10,
    letterSpacing: 1.8,
  },
  title: {
    marginTop: 4,
    color: '#fff8e5',
    fontFamily: theme.fonts.display,
    fontSize: 52,
  },
  empty: {
    marginTop: 24,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: theme.fonts.regular,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
  },
  stats: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 26,
    alignSelf: 'stretch',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 18,
    paddingVertical: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  statValue: {
    color: '#fff8e5',
    fontFamily: theme.fonts.display,
    fontSize: 26,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.5)',
    fontFamily: theme.fonts.medium,
    fontSize: 11,
  },
  chapter: {
    alignSelf: 'stretch',
    alignItems: 'center',
    marginTop: 36,
    gap: 12,
  },
  chapterTitle: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.bold,
    fontSize: 10,
    letterSpacing: 1.8,
  },
  chapterCard: {
    marginVertical: 4,
  },
  chapterBody: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: theme.fonts.regular,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  paywall: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 10,
    marginTop: 36,
    borderRadius: 24,
    padding: 24,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  paywallTitle: {
    color: '#fff8e5',
    fontFamily: theme.fonts.display,
    fontSize: 21,
    textAlign: 'center',
  },
  paywallBody: {
    color: 'rgba(255,255,255,0.62)',
    fontFamily: theme.fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  paywallButton: {
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 6,
    borderRadius: 999,
    paddingHorizontal: 24,
    backgroundColor: '#2b2418',
  },
  paywallButtonText: {
    color: '#241a04',
    fontFamily: theme.fonts.bold,
    fontSize: 14,
  },
}));
