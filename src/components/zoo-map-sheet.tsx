import { NativeSheet } from './ui/native-sheet';
import type { ZooMapSite } from '@/lib/zoo-map';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { safariRequest, type SafariStatus } from '@/lib/safaris';
import { useBackendAuth } from '@/lib/supabase/backend';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useTranslation } from 'react-i18next';

export function ZooMapSheet({ site, onClose }: { site: ZooMapSite | null; onClose: () => void }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { userId, isAuthenticated } = useBackendAuth();
  const pending = useRef<{ siteId?: string } | null>(null);
  const inFlight = useRef(false);
  const currentSite = useRef(site);
  const generation = useRef<object | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previousSite, setPreviousSite] = useState(site);
  if (previousSite !== site) { setPreviousSite(site); setError(null); setChecking(false); }
  useEffect(() => { currentSite.current = site; generation.current = {}; return () => { currentSite.current = null; generation.current = null; }; }, [site]);
  const status = useQuery({ queryKey: ['safaris', userId], queryFn: () => safariRequest<SafariStatus>('status'),
    enabled: isAuthenticated && Boolean(site), staleTime: 0, retry: false, networkMode: 'always' });
  const active = status.data?.active;
  const navigate = () => {
    const destination = pending.current;
    pending.current = null;
    if (destination) router.push({ pathname: '/(app)/safari', params: destination });
  };
  return <NativeSheet open={Boolean(site)} onClose={onClose} onDismiss={navigate}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>ZOO · {site?.country}</Text>
      <Text style={styles.title}>{site?.name}</Text>
      <Text style={styles.body}>{t('zoo_map_description')}</Text>
      <Text style={styles.body}>{t('safari_capture_rules', { radius: 5 })}</Text>
      <Text style={styles.note}>{t('zoo_map_source', { date: site?.inventory_at?.slice(0, 10) })}</Text>
      {active && <Text accessibilityRole="alert" style={styles.body}>{t('safari_already_active', { title: active.title })}</Text>}
      {(error || status.error) && <Text accessibilityRole="alert" style={styles.body}>{error ?? t('safari_error')}</Text>}
      <Pressable accessibilityRole="button" disabled={checking || status.isPending || !isAuthenticated}
        accessibilityState={{ disabled: checking || status.isPending || !isAuthenticated }} style={styles.button} onPress={async () => {
          if (!site || pending.current || inFlight.current) return;
          const selected = site.id;
          const requestGeneration = generation.current;
          inFlight.current = true; setChecking(true); setError(null);
          try {
            // Recheck on press: a teammate/device may have changed the session since opening.
            const result = await status.refetch();
            if (generation.current !== requestGeneration || currentSite.current?.id !== selected) return;
            if (result.error || !result.data) { setError(t('safari_error')); return; }
            pending.current = result.data.active ? {} : { siteId: selected };
            onClose();
            if (Platform.OS !== 'ios') navigate();
          } finally { inFlight.current = false; if (currentSite.current) setChecking(false); }
        }}>
        {checking || status.isPending ? <ActivityIndicator /> : <Text style={styles.buttonText}>{t(active ? 'safari_view_active' : status.error ? 'safari_retry' : 'zoo_map_prepare')}</Text>}
      </Pressable>
    </ScrollView>
  </NativeSheet>;
}
const styles = StyleSheet.create(theme => ({
  content: { padding: 24, gap: 16, paddingBottom: 40 },
  eyebrow: { color: theme.colors.muted, fontFamily: theme.fonts.bold, fontSize: 12 },
  title: { color: theme.colors.foreground, fontFamily: theme.fonts.display, fontSize: 28 },
  body: { color: theme.colors.foreground, fontFamily: theme.fonts.regular, fontSize: 16, lineHeight: 23 },
  note: { color: theme.colors.muted, fontSize: 12 },
  button: { backgroundColor: theme.colors.primary, padding: 18, borderRadius: 20, alignItems: 'center' },
  buttonText: { color: theme.colors.onPrimary, fontFamily: theme.fonts.bold, fontSize: 17 },
}));
