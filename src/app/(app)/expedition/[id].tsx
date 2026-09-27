import { uiLocaleTag } from '@/i18n/current';
import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { speciesName } from '@/lib/animals/species-name';
import { api } from '@/lib/supabase/api';
import { ThinkingLoader } from '@/components/ui/thinking-loader';
import type { Id } from '@/lib/supabase/api';
import { useQuery } from '@/lib/supabase/backend';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native-unistyles';

function formatDuration(startedAt: number, endedAt: number | null) {
  const minutes = Math.max(1, Math.round(((endedAt ?? Date.now()) - startedAt) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * The closing card: the object a walk leaves behind. Peak-end — the reveal is
 * the peak, this is the end, and it is the thing worth sharing.
 */
export default function ExpeditionScreen() {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: Id<'expeditions'> }>();
  const expedition = useQuery(api.expeditions.get, id ? { id } : 'skip');
  const router = useRouter();
  const insets = useSafeAreaInsets();

  if (expedition === undefined) {
    return (
      <View style={styles.center}>
        <ThinkingLoader label={t('expedition_loading')} state="searching" theme="dark" />
      </View>
    );
  }
  if (expedition === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.missing}>{copy("ui_copy_207")}</Text>
      </View>
    );
  }

  const { summary, captures } = expedition;
  const date = new Date(summary.startedAt);
  const title = date.toLocaleDateString(uiLocaleTag(), { day: 'numeric', month: 'long' });

  const share = () => {
    void Share.share({
      message:
        copy('expedition_share_head', { title, duration: formatDuration(summary.startedAt, summary.endedAt) }) +
        copy('expedition_share_species', { count: summary.speciesCount }) +
        (summary.newSpeciesCount > 0 ? copy('expedition_share_new', { count: summary.newSpeciesCount }) : '') +
        ' — SafaRoll',
    });
  };

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
          { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>{copy("ui_copy_208")}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>
          {formatDuration(summary.startedAt, summary.endedAt)}
          {summary.endedAt === null ? ' · en cours' : ''}
        </Text>

        <View style={styles.stats}>
          <Stat label={copy("ui_copy_056")} value={String(summary.speciesCount)} />
          <Stat label={copy("ui_copy_209")} value={String(summary.newSpeciesCount)} />
          <Stat label={copy("ui_copy_057")} value={String(summary.captureCount)} />
        </View>

        <View style={styles.grid}>
          {captures.map((capture) => (
            <View key={capture._id} style={styles.cell}>
              {capture.stickerUrl ? (
                <Image
                  accessibilityLabel={speciesName(capture) ?? capture.scientificName}
                  source={{ uri: capture.stickerUrl }}
                  contentFit="contain"
                  style={styles.sticker}
                />
              ) : null}
              <Text numberOfLines={1} style={styles.cellName}>
                {speciesName(capture) ?? capture.scientificName ?? '…'}
              </Text>
            </View>
          ))}
          {captures.length === 0 ? (
            <Text style={styles.empty}>{copy("ui_copy_210")}</Text>
          ) : null}
        </View>

        <Pressable accessibilityRole="button" onPress={share} style={styles.shareButton}>
          <SymbolView name="square.and.arrow.up" size={16} tintColor="#241a04" />
          <Text style={styles.shareText}>{copy("card_action_share")}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
  missing: { color: theme.colors.foreground, fontFamily: theme.fonts.medium, fontSize: 15 },
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
  content: { alignItems: 'center', paddingHorizontal: 20 },
  eyebrow: {
    color: theme.colors.primary,
    fontFamily: theme.fonts.bold,
    fontSize: 10,
    letterSpacing: 1.8,
  },
  title: {
    marginTop: 5,
    color: '#fff8e5',
    fontFamily: theme.fonts.display,
    fontSize: 34,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: theme.fonts.regular,
    fontSize: 13,
  },
  stats: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 24,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  cell: { width: 96, alignItems: 'center' },
  sticker: { width: 84, height: 84 },
  cellName: {
    marginTop: 4,
    maxWidth: 96,
    color: 'rgba(255,255,255,0.72)',
    fontFamily: theme.fonts.medium,
    fontSize: 11,
    textAlign: 'center',
  },
  empty: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: theme.fonts.regular,
    fontSize: 13,
  },
  shareButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 32,
    borderRadius: 999,
    paddingHorizontal: 22,
    backgroundColor: '#2b2418',
  },
  shareText: { color: '#241a04', fontFamily: theme.fonts.bold, fontSize: 14 },
}));
