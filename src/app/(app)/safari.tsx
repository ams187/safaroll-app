import { ExpeditionsScreen } from '@/components/expeditions-screen';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Pressable, ActivityIndicator, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { safariRequest, type SafariOffer, type SafariStatus } from '@/lib/safaris';
import { useBackendAuth } from '@/lib/supabase/backend';
import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect } from 'react';

export default function SafariPage() {
  const { userId } = useBackendAuth();
  return <SafariPageContent key={userId} />;
}

function SafariPageContent() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { siteId } = useLocalSearchParams<{ siteId?: string }>();
  const { userId, isAuthenticated } = useBackendAuth();
  const validSite = siteId === undefined || (typeof siteId === 'string' && /^[1-9]\d{0,11}$/.test(siteId));
  const status = useQuery({ queryKey: ['safaris', userId], queryFn: () => safariRequest<SafariStatus>('status'),
    enabled: isAuthenticated && Boolean(siteId) && validSite, staleTime: 0, retry: false, networkMode: 'always' });
  useEffect(() => {
    // Consume the zoo link once a run exists; finishing it must not reopen that zoo's offer.
    if (siteId && status.data?.active) router.setParams({ siteId: undefined });
  }, [router, siteId, status.data?.active]);
  const offer = useQuery({ queryKey: ['map-zoo-offer', userId, siteId],
    queryFn: () => safariRequest<SafariOffer>('offer', { mode: 'zoo', siteId }),
    enabled: isAuthenticated && Boolean(siteId) && validSite && status.isSuccess && !status.data.active,
    staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false, networkMode: 'always' });
  const error = !validSite ? t('safari_invalid_site') : status.error?.message ?? offer.error?.message;
  return <><Stack.Screen options={{ title: t('profile_expeditions'), headerShown: true,
    headerStyle: { backgroundColor: theme.colors.background }, headerTintColor: theme.colors.foreground,
    headerShadowVisible: false, headerBackVisible: false,
    headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel={t('reveal_close')}
      hitSlop={4} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(app)/(tabs)/(home)'); }}>
      <SymbolView name="xmark" size={18} weight="semibold" tintColor={theme.colors.foreground} /></Pressable>,
  }} />{isAuthenticated && validSite && (!siteId || status.data?.active || (status.isSuccess && offer.data)) ?
    <ExpeditionsScreen key={`${userId}:${siteId ?? 'home'}`} initialOffer={status.data?.active ? undefined : offer.data} initialSiteId={siteId} bottomInset={insets.bottom} />
    : <View style={{ flex: 1, padding: 24, gap: 20, justifyContent: 'center', backgroundColor: theme.colors.background }}>
      {error ? <><Text accessibilityRole="alert" style={{ color: theme.colors.foreground }}>{error}</Text>
        <Pressable accessibilityRole="button" style={{ paddingVertical: 16 }} onPress={() => {
          if (!validSite) router.setParams({ siteId: undefined });
          else if (status.error) void status.refetch(); else void offer.refetch();
        }}><Text style={{ color: theme.colors.foreground }}>{t('safari_retry')}</Text></Pressable></>
        : <ActivityIndicator color={theme.colors.primary} />}
    </View>}</>;
}
