import { Press3D } from '@/components/ui/press-3d';
import { askLocation, readCaptureLocation, refreshLocationGate } from '@/lib/location-permission';
import { dismissLiveActivities, startSafariActivity } from '@/lib/onesignal';
import { safariRequest, type SafariOffer, type SafariRun, type SafariSite, type SafariStatus } from '@/lib/safaris';
import { safariPortraits } from '@/lib/safari-portraits';
import { fetchSafariPhoto } from '@/lib/safari-photo';
import { safariBackStep } from '@/lib/safari-back-step';
import { backendQuery, useBackendAuth } from '@/lib/supabase/backend';
import { api } from '@/lib/supabase/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, AppState, BackHandler, Keyboard, Linking, Pressable, Share, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

const READY = require('../../assets/onboarding/expedition/mascot-ready.webp');
const ZOO = require('../../assets/onboarding/mission-scenes/phoenicopterus-roseus.webp');
const NATURE = require('../../assets/onboarding/mission-scenes/lynx-lynx.webp');
const FLAMINGO = require('../../assets/onboarding/mission-stickers/phoenicopterus-roseus.webp');
const LYNX = require('../../assets/onboarding/mission-stickers/lynx-lynx.webp');

export function ExpeditionsScreen({ bottomInset = 0, initialOffer, initialSiteId }: { bottomInset?: number; initialOffer?: SafariOffer; initialSiteId?: string }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { fontScale } = useWindowDimensions();
  const navigation = useNavigation();
  const { userId, isAuthenticated } = useBackendAuth();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [offerPayload, setOfferPayload] = useState<Record<string, unknown> | null>(() => initialSiteId ? { mode: 'zoo', siteId: initialSiteId } : null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { data: captures } = useQuery({ ...backendQuery(api.animals.listCaptures, {}), enabled: isAuthenticated });
  const portraits = useMemo(() => safariPortraits(captures), [captures]);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => {
    const listener = AppState.addEventListener('change', value => setForeground(value === 'active'));
    return () => listener.remove();
  }, []);
  const status = useQuery({ queryKey: ['safaris', userId], queryFn: () => safariRequest<SafariStatus>('status'),
    enabled: isAuthenticated && foreground && focused, staleTime: 0, gcTime: 0, retry: 1,
    refetchInterval: foreground && focused ? 10_000 : false, refetchIntervalInBackground: false, networkMode: 'always' });
  const [mode, setMode] = useState<'zoo' | 'nature' | null>(null);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [offer, setOffer] = useState<SafariOffer | null>(initialOffer ?? null);
  const [selected, setSelected] = useState<string[]>(() => initialOffer?.targets.slice(0, 3).map(item => item.scientificName) ?? []);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recap, setRecap] = useState<SafariRun | null>(null);
  const [joining, setJoining] = useState(false);
  const [details, setDetails] = useState(false);
  const previous = useRef<string | null>(null);
  const active = status.data?.active;
  const backStep = safariBackStep(Boolean(active), Boolean(recap), Boolean(offer), Boolean(mode), joining);
  const returnToPrevious = useCallback(() => {
    if (!backStep || busy) return false;
    Keyboard.dismiss();
    setError(null); setDetails(false);
    if (backStep === 'recap') { setRecap(null); setMode(null); setJoining(false); }
    else if (backStep === 'offer') { setOffer(null); setSelected([]); }
    else if (backStep === 'mode') setMode(null);
    else setJoining(false);
    return true;
  }, [backStep, busy]);
  useLayoutEffect(() => {
    navigation.setOptions({ headerLeft: backStep ? () => <Pressable accessibilityRole="button"
      accessibilityLabel={t('safari_return')} disabled={busy} onPress={returnToPrevious}
      style={styles.headerBack}><SymbolView name="chevron.left" size={22} weight="semibold" tintColor={theme.colors.foreground} /></Pressable> : () => null });
  }, [navigation, backStep, busy, returnToPrevious, t, theme.colors.foreground]);
  useFocusEffect(useCallback(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', returnToPrevious);
    return () => listener.remove();
  }, [returnToPrevious]));
  useEffect(() => {
    if (!status.data) return;
    if (previous.current && !status.data.active) {
      dismissLiveActivities();
      setRecap(status.data.history.find(run => run.id === previous.current) ?? null);
    }
    previous.current = status.data.active?.id ?? null;
  }, [status.data]);
  useEffect(() => { const timer = setTimeout(() => setTerm(search.trim()), 350); return () => clearTimeout(timer); }, [search]);
  const sites = useQuery({ queryKey: ['safari-sites', userId, term], queryFn: () => safariRequest<SafariSite[]>('sites', { search: term }),
    enabled: isAuthenticated && mode === 'zoo' && term.length >= 2 && !offer && !active, staleTime: 60_000, retry: 1 });
  const execute = async (work: () => Promise<void>) => {
    if (inFlight.current || !isAuthenticated) return;
    inFlight.current = true;
    setBusy(true); setError(null);
    try { await work(); } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : t('safari_error')); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const loadOffer = (siteId?: string) => execute(async () => {
    let location;
    if (!siteId) {
      if (await refreshLocationGate() !== 'granted' && !await askLocation()) throw new Error(t('safari_location_required'));
      location = await readCaptureLocation();
      if (!location) throw new Error(t('safari_location_required'));
    }
    const payload = siteId ? { mode: 'zoo', siteId } : { mode: 'nature', ...location };
    const result = await safariRequest<SafariOffer>('offer', payload);
    if (!mounted.current) return;
    setOfferPayload(payload);
    Keyboard.dismiss();
    setOffer(result); setSelected(result.targets.slice(0, 3).map(item => item.scientificName));
  });
  const openRun = async (action: 'create' | 'join') => {
    const current = await status.refetch();
    if (!mounted.current) return;
    if (current.error || !current.data) throw new Error(t('safari_error'));
    if (current.data.active) throw new Error(t('safari_already_active', { title: current.data.active.title }));
    if (await refreshLocationGate() !== 'granted' && !await askLocation()) throw new Error(t('safari_location_required'));
    if (!mounted.current) return;
    let run: SafariRun;
    try {
      run = await safariRequest<SafariRun>(action, action === 'create' ? { offerId: offer?.id, targets: selected } : { code: code.toUpperCase() });
    } catch (error) {
      // A timed-out POST may have committed. Recover the authoritative session; never resend automatically.
      const recovered = await status.refetch();
      if (!mounted.current) return;
      if (recovered.data?.active && !recovered.error) {
        run = recovered.data.active;
      } else throw error;
    }
    if (!mounted.current) return;
    await queryClient.cancelQueries({ queryKey: ['safaris', userId], exact: true });
    if (!mounted.current) return;
    queryClient.setQueryData<SafariStatus>(['safaris', userId], old => ({ active: run, history: old?.history ?? [] }));
    if (userId) startSafariActivity(run, userId);
    setOffer(null); setMode(null); setRecap(null); setCode(''); setJoining(false); setDetails(false);
    await status.refetch();
  };
  const finish = (run: SafariRun) => Alert.alert(t('safari_finish_title'), t('safari_finish_body'), [
    { text: t('safari_cancel'), style: 'cancel' },
    { text: t(run.hostId === userId ? 'safari_finish' : 'safari_leave'), style: 'destructive', onPress: () => void execute(async () => {
      const result = await safariRequest<SafariRun>(run.hostId === userId ? 'end' : 'leave', { runId: run.id });
      dismissLiveActivities();
      if (!mounted.current) return;
      await queryClient.cancelQueries({ queryKey: ['safaris', userId], exact: true });
      if (!mounted.current) return;
      queryClient.setQueryData<SafariStatus>(['safaris', userId], old => ({
        active: old?.active?.id === run.id ? null : old?.active ?? null,
        history: [result, ...(old?.history ?? []).filter(item => item.id !== result.id)].slice(0, 10),
      }));
      setRecap(result); await status.refetch();
    }) },
  ]);
  const run = active ?? recap;
  const achieved = run?.targets.filter(target => target.foundAt).length ?? 0;
  return <View style={styles.root}><FlashList key={run?.id ?? offer?.id ?? mode ?? 'prepare'} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
    data={offer && !run ? offer.targets : []} extraData={{ selected, portraits, busy }} keyExtractor={target => target.scientificName}
    renderItem={({ item: target }) => {
      const checked = selected.includes(target.scientificName);
      const disabled = busy || (!checked && selected.length >= 6);
      return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} disabled={disabled}
        onPress={() => setSelected(old => old.includes(target.scientificName) ? old.filter(n => n !== target.scientificName) : old.length < 6 ? [...old, target.scientificName] : old)}
        style={({ pressed }) => [styles.option, styles.optionSpacing, checked && styles.optionSelected, pressed && styles.pressed, disabled && !checked && styles.disabled]}>
        <TargetPortrait name={target.scientificName} uri={portraits.get(target.scientificName.trim().toLowerCase())} />
        <View style={styles.flex}><Text style={styles.label}>{target.label}</Text><Text style={styles.meta}>{target.scientificName}</Text></View>
        <View style={[styles.check, checked && styles.checked]}>{checked ? <SymbolView name="checkmark" size={18} tintColor={theme.colors.onPrimary} /> : <SymbolView name="plus" size={16} tintColor={theme.colors.muted} />}</View>
      </Pressable>;
    }}
    ListFooterComponent={offer && !run ? <Text style={styles.meta}>{offer.evidence}</Text> : null}
    automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="automatic" showsVerticalScrollIndicator={false}
    contentContainerStyle={{ padding: 20, paddingBottom: offer && !active ? 24 : bottomInset + 36 }}
    ListHeaderComponent={<View style={styles.content}>
    {!run && !offer && !mode ? <><View style={styles.hero}><View style={styles.heroCopy}><Text style={styles.eyebrow}>{t('safari_field_note')}</Text>
      <Text style={styles.title}>{t('safari_title')}</Text>
      <Text style={styles.subtitle}>{t('safari_subtitle')}</Text>
    </View></View>
      <View style={styles.facts}>{([['clock', 'safari_duration'], ['person.2', 'safari_party'], ['camera', 'safari_goal_range']] as const).map(([icon, label]) =>
        <View key={label} style={styles.fact}><SymbolView name={icon} size={15} tintColor={theme.colors.foreground} /><Text style={styles.factText}>{t(label)}</Text></View>)}</View>
    </> : null}
    {(error || status.error) ? <View accessibilityRole="alert" style={styles.notice}><Text style={styles.body}>{error ?? t('safari_error')}</Text>
      <Pressable accessibilityRole="button" disabled={busy} style={styles.smallButton} onPress={() => { setError(null); void status.refetch(); }}>
        <Text style={styles.link}>{t('safari_retry')}</Text></Pressable></View> : null}
    {error && offer && !active && offerPayload ? <Pressable accessibilityRole="button" disabled={busy} style={styles.smallButton}
      onPress={() => void execute(async () => {
        const updated = await safariRequest<SafariOffer>('offer', offerPayload);
        if (!mounted.current) return;
        setOffer(updated); setSelected(updated.targets.slice(0, 3).map(target => target.scientificName));
      })}><Text style={styles.link}>{t('safari_refresh_offer')}</Text></Pressable> : null}
    {busy || status.isPending ? <View style={styles.loading}><ActivityIndicator color={theme.colors.foreground} /><Text style={styles.meta}>{t('safari_loading')}</Text></View> : null}
    {run ? <>
      <View style={styles.session}>
        <View style={styles.sessionTop}><SymbolView name={active ? 'binoculars' : 'book.closed'} size={20} tintColor={theme.colors.foreground} />
          <Text style={styles.eyebrow}>{t(active ? 'safari_in_progress' : run.status === 'completed' ? 'safari_completed' : 'safari_recap')}</Text></View>
        <View style={styles.sessionHeading}><View style={styles.flex}><Text style={styles.sessionTitle}>{run.title}</Text>
          <Text style={styles.meta}>{t(run.mode === 'zoo' ? 'safari_zoo' : 'safari_nature')}</Text></View>
          <Image source={READY} contentFit="contain" style={styles.mascot} accessible={false} /></View>
        <View style={styles.progressRow}><Text style={styles.score}>{achieved}<Text style={styles.outOf}> / {run.targets.length}</Text></Text>
          <Text style={styles.meta}>{t('safari_objectives')} {active ? `· ${t('safari_until')} ${new Date(run.expiresAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}</Text></View>
        <View accessibilityRole="progressbar" accessibilityLabel={t('safari_objectives')} accessibilityValue={{ min: 0, max: run.targets.length, now: achieved }} style={styles.track}>
          {run.targets.map(target => <View key={target.scientificName} style={[styles.progressStep, target.foundAt && styles.progressStepDone]} />)}</View>
        <View style={styles.team}><SymbolView name="person.2" size={18} tintColor={theme.colors.foreground} /><Text style={[styles.body, styles.flex]}>{run.members.filter(member => !member.left).map(member => member.name).join(' · ') || t('safari_recap')}</Text></View>
        {active ? <Pressable accessibilityRole="button" style={styles.code} onPress={() => void execute(async () => {
          await Share.share({ message: t('safari_invite', { code: run.code, title: run.title }) });
        })}><View style={styles.flex}><Text style={styles.meta}>{t('safari_code')}</Text><Text selectable style={styles.codeText}>{run.code}</Text></View><Text style={styles.link}>{t('safari_invite_button')}</Text>
          <SymbolView name="square.and.arrow.up" size={18} tintColor={theme.colors.foreground} /></Pressable> : null}
      </View>
      <Text style={styles.heading}>{t('safari_checklist')}</Text>
      <View style={styles.discoveries}>{run.targets.map((target, index) => <View key={target.scientificName} style={[styles.discovery, fontScale > 1.3 && styles.discoveryWide, target.foundAt && styles.discoveryFound]}>
        <View style={styles.discoveryTop}><Text style={styles.index}>{String(index + 1).padStart(2, '0')}</Text>
          <SymbolView name={target.foundAt ? 'checkmark.seal.fill' : 'viewfinder'} size={20} tintColor={theme.colors.foreground} /></View>
        <TargetPortrait name={target.scientificName} uri={portraits.get(target.scientificName.trim().toLowerCase())} large />
        <View style={styles.flex}><Text style={styles.label}>{target.label}</Text><Text style={styles.meta}>{target.foundAt ? t('safari_found_by', {
          name: run.members.find(m => m.userId === target.foundBy)?.name ?? t('safari_teammate'),
        }) : target.scientificName}</Text></View></View>)}</View>
      {active ? <>
        <Pressable accessibilityRole="button"
          onPressIn={() => { void Haptics.selectionAsync(); }}
          onPress={() => { if (userId) startSafariActivity(run, userId); }}
          style={({ pressed }) => [styles.smallButton, styles.followButton, pressed && styles.followButtonPressed]}>
          <Text style={styles.link}>{t('safari_live_activity')}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.smallButton} onPress={() => finish(run)}>
          <Text style={styles.meta}>{t(run.hostId === userId ? 'safari_finish' : 'safari_leave')}</Text></Pressable>
      </> : <Press3D accessibilityLabel={t('safari_again')} borderRadius={24} disabled={busy}
        faceStyle={styles.buttonFace} onPress={returnToPrevious} shadowColor="#aa7726" style={[styles.button, busy && styles.disabled]}>
        {busy ? <ActivityIndicator color="#fffdf8" /> : <Text style={styles.buttonText}>{t('safari_again')}</Text>}
      </Press3D>}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: details }} style={styles.detailToggle} onPress={() => setDetails(!details)}>
        <SymbolView name="info.circle" size={18} tintColor={theme.colors.foreground} /><Text style={[styles.link, styles.flex]}>{t('safari_details')}</Text><SymbolView name={details ? 'chevron.up' : 'chevron.down'} size={14} tintColor={theme.colors.foreground} /></Pressable>
      {details ? <View style={styles.notice}><Text style={styles.meta}>{t('safari_capture_rules', { radius: run.radiusKm })}</Text><Text style={styles.meta}>{run.evidence}</Text><Pressable accessibilityRole="link" style={styles.smallButton}
        onPress={() => void Linking.openURL(run.sourceUrl)}><Text style={styles.link}>{t('safari_source')}</Text></Pressable></View> : null}
    </> : <>
      {offer ? <>
        <Text style={styles.eyebrow}>{t('safari_prepare')}</Text><Text style={styles.sessionTitle}>{offer.title}</Text><Text style={styles.body}>{t('safari_pick')}</Text>
      </> : <>
        {!mode ? <>
        <View style={styles.sectionHeader}><Text style={styles.heading}>{t('safari_terrain')}</Text><SymbolView name="map" size={22} tintColor={theme.colors.foreground} /></View>
        <View style={styles.modeRow}>{([
          ['zoo', ZOO, FLAMINGO, 'safari_zoo', 'safari_zoo_hint'], ['nature', NATURE, LYNX, 'safari_nature', 'safari_nature_hint'],
        ] as const).map(([value, art, sticker, label, hint]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: mode === value }}
          style={({ pressed }) => [styles.mode, fontScale > 1.3 && styles.modeStack, mode === value && styles.modeSelected, pressed && styles.pressed]} onPress={() => { setMode(value); setError(null); }}>
          <View style={[styles.destinationCopy, fontScale > 1.3 && styles.destinationCopyWide]}><Text style={styles.modeTitle}>{t(label)}</Text><Text style={styles.meta}>{t(hint)}</Text>
            <View style={[styles.modeArrow, mode === value && styles.checked]}><SymbolView name={mode === value ? 'checkmark' : 'arrow.right'} size={20} tintColor={mode === value ? theme.colors.onPrimary : theme.colors.foreground} /></View></View>
          <View style={[styles.destinationArt, fontScale > 1.3 && styles.destinationArtWide]} pointerEvents="none"><Image source={art} contentFit="cover" style={styles.destinationScene} accessible={false} />
            <Image source={sticker} contentFit="contain" style={styles.destinationSticker} accessible={false} /></View></Pressable>)}</View>
        </> : <View style={styles.heroCopy}><Text style={styles.eyebrow}>{t('safari_prepare')}</Text>
          <Text style={styles.sessionTitle}>{t(mode === 'zoo' ? 'safari_zoo' : 'safari_nature')}</Text></View>}
        {mode === 'zoo' ? <>
          <Text style={styles.body}>{t('safari_search')}</Text>
          <View style={styles.searchField}><SymbolView name="magnifyingglass" size={20} tintColor={theme.colors.foreground} />
            <TextInput accessibilityLabel={t('safari_search')} placeholder={t('safari_search_example')} placeholderTextColor={theme.colors.foreground}
              selectionColor={theme.colors.foreground} value={search} onChangeText={setSearch} style={styles.searchInput}
              autoCorrect={false} maxLength={80} returnKeyType="search" onSubmitEditing={Keyboard.dismiss} />
          </View>
          {sites.isFetching ? <ActivityIndicator color={theme.colors.foreground} /> : null}
          {sites.error ? <Text style={styles.body} accessibilityRole="alert">{t('safari_error')}</Text> : null}
          {sites.data?.map(site => <Pressable key={site.id} accessibilityRole="button" disabled={busy} style={styles.target} onPress={() => void loadOffer(site.id)}>
            <View style={styles.flex}><Text style={styles.label}>{site.name}</Text><Text style={styles.meta}>{site.country}</Text></View>
            <SymbolView name="chevron.right" size={16} tintColor={theme.colors.muted} /></Pressable>)}
          {term.length >= 2 && sites.data?.length === 0 ? <Text style={styles.body}>{t('safari_no_zoo')}</Text> : null}
        </> : mode === 'nature' ? <View style={styles.notice}><Text style={styles.body}>{t('safari_nature_explanation')}</Text>
          <Press3D accessibilityLabel={t('safari_nearby')} borderRadius={24} disabled={busy || Boolean(status.error)}
            faceStyle={styles.buttonFace} onPress={() => void loadOffer()} shadowColor="#aa7726"
            style={[styles.button, (busy || Boolean(status.error)) && styles.disabled]}>
            {busy ? <ActivityIndicator color="#fffdf8" /> : <Text style={styles.buttonText}>{t('safari_nearby')}</Text>}
          </Press3D></View> : null}
        {!mode ? <View style={styles.joinPanel}><Pressable accessibilityRole="button" accessibilityState={{ expanded: joining }} style={styles.joinHeader} onPress={() => setJoining(!joining)}>
          <View style={styles.joinIcon}><SymbolView name="person.2" size={22} tintColor={theme.colors.foreground} /></View>
          <View style={styles.flex}><Text style={styles.label}>{t('safari_join_title')}</Text><Text style={styles.meta}>{t('safari_have_code')}</Text></View>
          <SymbolView name={joining ? 'chevron.up' : 'chevron.down'} size={16} tintColor={theme.colors.foreground} /></Pressable>
        {joining ? <><Text style={styles.body}>{t('safari_join_hint')}</Text><View style={styles.joinRow}><TextInput accessibilityLabel={t('safari_code')} placeholder="A1B2C3D4" placeholderTextColor={theme.colors.muted}
          value={code} onChangeText={value => setCode(value.toUpperCase().replace(/[^A-F0-9]/g, ''))} autoCapitalize="characters" autoCorrect={false}
          maxLength={8} style={[styles.input, styles.flex]} />
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || code.length !== 8 || Boolean(status.error) }} disabled={busy || code.length !== 8 || Boolean(status.error)} style={[styles.smallButton, (busy || code.length !== 8 || Boolean(status.error)) && styles.disabled]}
            onPress={() => void execute(() => openRun('join'))}><Text style={styles.link}>{t('safari_join')}</Text></Pressable></View>
        <Text style={styles.meta}>{t('safari_privacy')}</Text></> : null}</View> : null}
      </>}
      {!offer && !mode && status.data?.history.length ? <><Text style={styles.heading}>{t('safari_memories')}</Text>
        {status.data.history.map(past => <Pressable key={past.id} accessibilityRole="button" style={styles.target} onPress={() => setRecap(past)}>
          <SymbolView name={past.status === 'completed' ? 'checkmark.seal' : 'leaf'} size={24} tintColor={theme.colors.foreground} />
          <View style={styles.flex}><Text style={styles.label}>{past.title}</Text><Text style={styles.meta}>{new Date(past.startedAt).toLocaleDateString()} · {past.targets.filter(x => x.foundAt).length}/{past.targets.length}</Text></View>
          <SymbolView name="chevron.right" size={16} tintColor={theme.colors.muted} /></Pressable>)}</> : null}
    </>}
  </View>} />{offer && !active ? <View style={[styles.footer, { paddingBottom: Math.max(bottomInset, 16) + 6 }]}>
    <Text style={styles.footerNote}>{t('safari_selected', { count: selected.length })}</Text>
    <Press3D accessibilityLabel={t('safari_start', { count: selected.length })} borderRadius={24}
      disabled={busy || selected.length < 3 || status.isPending || Boolean(status.error)} faceStyle={styles.buttonFace}
      onPress={() => void execute(() => openRun('create'))} shadowColor="#aa7726"
      style={[styles.button, (busy || selected.length < 3 || status.isPending || Boolean(status.error)) && styles.disabled]}>
      {busy ? <ActivityIndicator color="#fffdf8" /> : <Text style={styles.buttonText}>{t('safari_start', { count: selected.length })}</Text>}
    </Press3D>
  </View> : null}</View>;
}

function TargetPortrait({ name, uri, large = false }: { name: string; uri?: string; large?: boolean }) {
  const { theme } = useUnistyles();
  const [failed, setFailed] = useState<string[]>([]);
  const { data: photo, isFetching } = useQuery({
    queryKey: ['safari-photo', name.trim().toLowerCase()],
    queryFn: ({ signal }) => fetchSafariPhoto(name, signal),
    enabled: !uri || failed.includes(uri), staleTime: 24 * 60 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000,
    retry: false, refetchOnWindowFocus: false,
  });
  const source = uri && !failed.includes(uri) ? uri : photo?.uri;
  return <View style={[styles.portrait, large && styles.portraitLarge]} accessible={false}>
    {source && !failed.includes(source) ? <Image source={source} recyclingKey={name} contentFit={source === photo?.uri ? 'cover' : 'contain'} cachePolicy="memory-disk"
      transition={150} style={[styles.portraitImage, source === photo?.uri && styles.portraitPhoto]} onError={() => setFailed(old => [...old, source])} />
      : isFetching ? <ActivityIndicator color={theme.colors.muted} />
        : <SymbolView name="photo" size={large ? 40 : 28} tintColor={theme.colors.muted} />}
    {photo && source === photo.uri && !failed.includes(source) && <Pressable style={styles.photoCredit} accessibilityRole="button"
      accessibilityLabel={`Photo : ${photo.author} — iNaturalist / GBIF`} onPress={event => {
        event.stopPropagation();
        Alert.alert(name, `© ${photo.author}\niNaturalist / GBIF\n${photo.license}\n${photo.source}`, [
          { text: 'OK', style: 'cancel' },
          { text: 'Photo', onPress: () => { void Linking.openURL(photo.source).catch(() => undefined); } },
          { text: 'Creative Commons', onPress: () => { void Linking.openURL(photo.license).catch(() => undefined); } },
        ]);
      }}><Text style={styles.photoCreditText}>© ⓘ</Text></Pressable>}
  </View>;
}

const styles = StyleSheet.create(theme => ({
  headerBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchField: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16,
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.foreground, borderRadius: 16, borderCurve: 'continuous' },
  searchInput: { flex: 1, minWidth: 0, minHeight: 60, paddingVertical: 16, color: theme.colors.foreground, fontFamily: theme.fonts.regular, fontSize: 17 },
  root: { flex: 1, backgroundColor: theme.colors.background }, content: { gap: 16, paddingBottom: 16 },
  hero: { paddingTop: 8, paddingBottom: 8 },
  heroCopy: { flex: 1, gap: 12 }, eyebrow: { color: theme.colors.foreground, fontFamily: theme.fonts.bold, fontSize: 10, letterSpacing: 2 },
  title: { color: theme.colors.foreground, fontFamily: theme.fonts.display, fontSize: 38, lineHeight: 44 },
  subtitle: { color: theme.colors.muted, fontFamily: theme.fonts.regular, fontSize: 15, lineHeight: 21 },
  mascot: { width: 72, height: 112 }, flex: { flex: 1, minWidth: 0 }, heading: { color: theme.colors.foreground, fontFamily: theme.fonts.bold, fontSize: 20 },
  body: { color: theme.colors.foreground, fontFamily: theme.fonts.regular, fontSize: 15, lineHeight: 22 },
  label: { color: theme.colors.foreground, fontFamily: theme.fonts.bold, fontSize: 16 },
  meta: { color: theme.colors.muted, fontFamily: theme.fonts.regular, fontSize: 13, lineHeight: 19 },
  modeRow: { gap: 16 }, mode: { flexDirection: 'row', borderWidth: 2, borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface, borderRadius: 24, borderCurve: 'continuous', overflow: 'hidden', minHeight: 184 },
  modeSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primarySoft },
  modeTitle: { color: theme.colors.foreground, fontFamily: theme.fonts.display, fontSize: 26 },
  modeArrow: { width: 44, height: 44, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceMuted, marginTop: 8 },
  destinationCopy: { width: '56%', padding: 20, gap: 8, justifyContent: 'center' },
  modeStack: { flexDirection: 'column' },
  destinationCopyWide: { width: '100%' },
  destinationArtWide: { width: '100%', height: 184 },
  destinationArt: { width: '44%', minHeight: 184, overflow: 'hidden' },
  destinationScene: { position: 'absolute', width: '100%', height: '100%' },
  destinationSticker: { position: 'absolute', width: '92%', height: '80%', left: '4%', top: '12%' },
  button: { width: '100%', marginVertical: 4 }, buttonFace: { minHeight: 58, backgroundColor: '#E3A93C', alignItems: 'center', justifyContent: 'center', padding: 16 },
  buttonText: { color: '#fffdf8', fontFamily: theme.fonts.bold, fontSize: 17, textAlign: 'center' },
  input: { minHeight: 56, borderRadius: 16, borderCurve: 'continuous', backgroundColor: theme.colors.surfaceMuted, borderWidth: 1,
    borderColor: theme.colors.border, paddingHorizontal: 16, color: theme.colors.foreground, fontFamily: theme.fonts.bold, fontSize: 16 },
  smallButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  followButton: { borderRadius: 14 },
  followButtonPressed: { backgroundColor: theme.colors.primary, opacity: 0.8, transform: [{ scale: 0.97 }] },
  link: { color: theme.colors.foreground, fontFamily: theme.fonts.bold, fontSize: 14 },
  notice: { borderRadius: 16, borderCurve: 'continuous', backgroundColor: theme.colors.surfaceMuted, padding: 16, gap: 12 },
  joinRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  target: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 80 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 104, borderRadius: 16, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  optionSelected: { borderColor: theme.colors.foreground, backgroundColor: theme.colors.primarySoft },
  optionSpacing: { marginBottom: 12 },
  check: { width: 40, height: 40, borderRadius: 16, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceMuted },
  checked: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  session: { padding: 24, borderRadius: 24, borderCurve: 'continuous', backgroundColor: theme.colors.primarySoft, gap: 16 },
  sessionHeading: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  progressRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 },
  score: { color: theme.colors.foreground, fontFamily: theme.fonts.bold, fontSize: 48, fontVariant: ['tabular-nums'] }, outOf: { color: theme.colors.foreground, fontSize: 24 },
  track: { flexDirection: 'row', gap: 4, height: 8 },
  progressStep: { flex: 1, borderRadius: 4, backgroundColor: theme.colors.surface },
  progressStepDone: { backgroundColor: theme.colors.foreground },
  code: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: theme.colors.border, minHeight: 64 },
  codeText: { color: theme.colors.foreground, fontFamily: theme.fonts.bold, fontSize: 20, letterSpacing: 2, fontVariant: ['tabular-nums'] },
  sessionTitle: { color: theme.colors.foreground, fontFamily: theme.fonts.display, fontSize: 30, lineHeight: 38 },
  sessionTop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  team: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  discoveries: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  discovery: { flexGrow: 1, flexBasis: '45%', minWidth: 144, borderRadius: 16, borderCurve: 'continuous', padding: 16,
    borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, gap: 12 },
  discoveryWide: { flexBasis: '100%' },
  discoveryFound: { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.primary },
  discoveryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  portrait: { width: 64, height: 80, borderRadius: 16, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: theme.colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  portraitLarge: { width: '100%', height: 120 },
  portraitImage: { width: '90%', height: '90%' },
  portraitPhoto: { width: '100%', height: '100%' },
  photoCredit: { position: 'absolute', bottom: 0, right: 0, minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'flex-end', padding: 4 },
  photoCreditText: { fontSize: 11, color: theme.colors.foreground, backgroundColor: theme.colors.surface, paddingHorizontal: 4, borderRadius: 4 },
  index: { color: theme.colors.foreground, fontFamily: theme.fonts.bold, fontSize: 14, fontVariant: ['tabular-nums'] },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingBottom: 8 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  factText: { color: theme.colors.foreground, fontFamily: theme.fonts.medium, fontSize: 12 },
  joinPanel: { gap: 16, padding: 16, marginTop: 8, borderRadius: 24, borderCurve: 'continuous', borderWidth: 1, borderColor: theme.colors.border },
  joinHeader: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12 },
  joinIcon: { width: 44, height: 44, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.primarySoft },
  detailToggle: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  footer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.background, gap: 4 },
  footerNote: { textAlign: 'center', color: theme.colors.foreground, fontFamily: theme.fonts.medium, fontSize: 12 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
}));
