import { uiLocaleTag } from '@/i18n/current';
// Le profil.
//
// LA FORME VIENT DE LA RÉFÉRENCE, LE MONDE EST LE NÔTRE
//
// De haut en bas, l'ordre de la maquette validée :
//
//   IDENTITÉ         avatar large, pseudo, e-mail — centrés, et seuls. C'est la
//                    seule chose de la page qui parle de la PERSONNE ; tout le
//                    reste parle du jeu.
//   EXPÉDITION       le bandeau coloré : le niveau et la marche en cours. Seul
//                    aplat saturé du haut — il dit « ici c'est toi ». Il occupe
//                    la place que la maquette donnait à son bloc « Premium ».
//                    Aucune barre de titre au-dessus : un écran d'onglet n'a
//                    pas à se nommer, et la roue crantée doublonnait avec la
//                    ligne « Préférences » qui ouvre la même feuille.
//   SECTIONS         des rectangles blancs arrondis groupant des lignes, chaque
//                    ligne portant sa tuile d'icône colorée — la forme de la
//                    page réglages de ~/VoyageMakerSDK54.
//                    ABONNEMENT vient EN PREMIER : c'est la seule ligne de la
//                    page qui rapporte quelque chose, et elle ne se négocie pas
//                    au milieu des quêtes. Puis COMPTE, puis RÉGLAGES.
//                    La rangée d'amis en pastilles a disparu : « Mon cercle »
//                    ouvre la même feuille, et deux portes vers un même endroit
//                    n'en font pas un endroit plus visité.
//                    Les écussons ne sont PAS ici : une collection montrée à
//                    deux endroits n'est plus un endroit où l'on va.
//
// POURQUOI LA COULEUR REVIENT ICI ALORS QUE LE THÈME L'INTERDIT
//
// `unistyles.ts` réserve l'encre comme unique accent, et c'est juste LÀ OÙ IL Y
// A DES CARTES : une LÉGENDAIRE est déjà dorée, un second or dans le chrome ne
// voudrait plus rien dire. Cette page ne montre aucune carte à collectionner —
// elle montre une progression. Sans couleur, elle se lit comme un tableur.
// Voir `safari-palette.ts` pour la frontière entre les deux régimes.

import { ChallengesScreen } from '@/components/challenges/challenges-screen';
import { NotificationsExplainer } from '@/components/notifications-explainer';
import { useEmailConsent } from '@/lib/email-consent';
import { CircleSheet } from '@/components/community/circle-sheet';
import { TAB_BAR_COLLAPSED_HEIGHT } from '@/components/navigation/expandable-camera-tab-bar';
import { NativeSheet } from '@/components/ui/native-sheet';
import { badgeStates, groupForClass } from '@/lib/animals/badges';
import { CERCLE_ACTIF, LEADERBOARD_ACTIF, LIVRE_ACTIF } from '@/lib/launch-flags';
import { APP_STORE_LOCALIZATIONS } from '@/i18n/languages';
import { toast } from '@/lib/notify';
import {
  setCaptureExportPreference,
  useCaptureExportPreferences,
  type CaptureExportKind,
} from '@/lib/capture-export';
import { supabase } from '@/lib/supabase/client';
import { getDeckProgress } from '@/lib/animals/progression';
import { SEASON_REGIONS, regionLabel } from '@/lib/animals/region';
import { useRegion } from '@/lib/animals/use-region';
import { SAFARI } from '@/lib/safari-palette';
import { api } from '@/lib/supabase/api';
import { useClerk, useUser } from '@clerk/expo';
import { useBackendAuth, useMutation, useQuery } from '@/lib/supabase/backend';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { usePremium } from '@/lib/premium';
import { getIcon, isSupported as iconesSupportees, setIcon } from 'expo-quick-actions/icon';
import { DAILY_CAPTURE_ENERGY, remainingCaptureEnergy } from '@/lib/animals/capture-energy';
import { useOnboarding } from '@/lib/onboarding';
import {
  cancelSafaRollNotifications,
  setLiveActivitiesEnabled,
  setNotificationsEnabled,
  useLiveActivitiesEnabled,
  useNotificationsEnabled,
} from '@/lib/notifications';
import { PlayerAvatar } from '@/components/ui/player-avatar';
import { ActivityFlipCard } from '@/components/profile/activity-flip-card';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, Share, Switch, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

/** Le portrait d'identité, tel que `styles.avatar` le posait. */
const AVATAR_SIZE = 92;

export default function ProfileScreen() {
  const { t: copy } = useUiTranslation();
  const { user } = useUser();
  const { t } = useTranslation();
  const { isPremium } = usePremium();

  const { theme } = useUnistyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const overlays = useRef<ProfileOverlaysHandle>(null);

  const { isAuthenticated } = useBackendAuth();
  const captures = useQuery(api.animals.listCaptures, isAuthenticated ? {} : 'skip');
  const handle = useQuery(api.community.myHandle, isAuthenticated ? {} : 'skip');
  const friends = useQuery(api.community.friends, isAuthenticated ? {} : 'skip');
  const region = useRegion();

  const progress = useMemo(() => getDeckProgress(captures ?? []), [captures]);
  // Distinct local days with at least one camera capture: the app's promise is
  // going outside, so this counts outings — imported photos don't.
  const daysOutside = useMemo(
    () => new Set((captures ?? [])
      .filter((c) => (c.status === 'ready' || c.status === 'needs_review') && c.captureSource !== 'library')
      .map((c) => new Date(c.capturedAt).toDateString())).size,
    [captures],
  );
  /**
   * LES CAPTURES RESTANTES VIVENT ICI, PLUS DANS LE VISEUR.
   *
   * Elles y tenaient une pastille en permanence, pour une information qu'on
   * regarde une fois par jour — le viseur doit montrer l'animal, pas un solde.
   *
   * Ici elles arrivent au bon moment : la bannière est la page « où j'en suis »,
   * et la ligne d'abonnement est juste en dessous. Le joueur qui lit qu'il lui
   * reste deux captures a la réponse à portée de pouce.
   *
   * `null` pour un abonné : illimité, il n'y a rien à compter. `undefined` tant
   * que les captures chargent — on n'affiche pas un faux zéro.
   */
  const capturesRestantes = useMemo(
    () => (__DEV__ || isPremium
      ? null
      : captures === undefined
        ? undefined
        : remainingCaptureEnergy(captures, false)),
    [captures, isPremium],
  );
  // Bornée : une donnée aberrante ne doit pas dessiner une barre qui déborde.
  const filled = Math.max(0, Math.min(1, progress.progress));

  const badges = useMemo(
    () =>
      badgeStates(
        (captures ?? [])
          .filter((capture) => capture.status === 'ready' || capture.status === 'needs_review')
          .map((capture) => ({
            group: groupForClass(capture.taxonomy?.class),
            rarity: capture.rarity,
            scientificName: capture.scientificName ?? capture.commonName,
          })),
      ).map((badge) => ({ ...badge, label: t(`badge_${badge.key}`) })),
    [captures, t],
  );
  const earned = badges.filter((badge) => badge.earned).length;

  const accepted = (friends ?? []).filter((friend) => friend.direction === 'friend');
  const email = user?.primaryEmailAddress?.emailAddress;
  // JAMAIS l'e-mail en repli : il occupe déjà la ligne du dessous, et un compte
  // sans pseudo affichait donc son adresse deux fois — une fois précédée d'un
  // « @ » qui ne voulait rien dire. Le vrai nom Clerk passe devant le pseudo :
  // c'est celui que la personne a écrit elle-même.
  const name = user?.fullName ?? handle ?? user?.username ?? t('profile_default_name');
  // Le « @ » n'appartient qu'au pseudo. « @Jane Doe » se lirait comme une
  // adresse, alors que c'est un nom.
  const isHandle = !user?.fullName && Boolean(handle ?? user?.username);
  const initial = name.replace(/^@/, '').charAt(0).toUpperCase();

  async function pickAvatar() {
    const picked = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      base64: true,
      mediaTypes: ['images'],
      quality: 0.8,
    });
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset?.base64) return;
    // Clerk porte l'avatar : c'est déjà lui qui sert `user.imageUrl` partout
    // ailleurs. Pas de second stockage à tenir synchronisé.
    await user?.setProfileImage({ file: `data:image/jpeg;base64,${asset.base64}` });
  }

  return (
    <>
      <ScrollView
        // La barre d'onglets FLOTTE au-dessus de la page — elle ne lui prend pas
        // de place dans la mise en page. Sans ce dégagement, la dernière rangée
        // finit dessous et n'est jamais atteignable.
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: insets.bottom + TAB_BAR_COLLAPSED_HEIGHT + 24,
            // La barre de titre retirée, plus rien ne tenait l'avatar à
            // distance de l'encoche.
            paddingTop: theme.gap(2),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* L'IDENTITÉ, CENTRÉE ET SEULE.
            Elle occupait une rangée partagée avec un titre et une roue : un
            avatar de 46 px coincé entre deux éléments d'interface. Les deux ont
            disparu — un écran d'onglet n'a pas à se nommer — et elle ouvre
            maintenant la page seule. C'est la seule chose ici qui parle de la
            personne ; tout le reste parle du jeu. */}
        <View style={styles.identity}>
          {/* Le sceau apparaît ici aussi, et pas seulement chez les autres :
              ce qu'on a payé doit se voir de là où on le regarde le plus. */}
          <Pressable onPress={pickAvatar} style={({ pressed }) => pressed && styles.pressed}>
            <PlayerAvatar
              name={initial}
              premium={isPremium}
              size={AVATAR_SIZE}
              url={user?.imageUrl ?? null}
            />
          </Pressable>
          <Text numberOfLines={1} style={styles.name}>
            {isHandle && !name.startsWith('@') ? `@${name}` : name}
          </Text>
          {email ? (
            <Text numberOfLines={1} style={styles.email}>
              {email}
            </Text>
          ) : null}
        </View>

        {/* L'EXPÉDITION. Le seul aplat saturé du haut de page. Le niveau y est
            en gros parce que c'est le chiffre que tout le reste fait monter. */}
        <ActivityFlipCard captures={captures ?? []} style={styles.bannerFlip}>
          <PelageBanner style={styles.banner}>
            <View style={styles.bannerRow}>
              <View style={styles.levelRing}>
                <Text style={styles.levelValue}>{progress.level}</Text>
              </View>
              <View style={styles.grow}>
                <Text style={[styles.bannerTitle, { color: SAFARI.savane.on }]}>
                  {t(progress.titleKey)}
                </Text>
                <Text style={[styles.bannerCopy, { color: SAFARI.savane.on }]}>
                  {progress.xpToNextLevel.toLocaleString(uiLocaleTag())} {' '}{copy("ui_copy_054")}{' '}
                  {progress.level + 1}
                </Text>
                <View style={styles.bannerTrack}>
                  <View style={[styles.bannerFill, { width: `${Math.max(filled * 100, 4)}%` }]} />
                </View>
              </View>
            </View>

            <View style={styles.bannerStats}>
              <BannerStat
                label={t('profile_stat_species')}
                value={String(progress.speciesCount)}
              />
              <View style={styles.bannerDivider} />
              <BannerStat label={t('profile_stat_captures')} value={String(progress.captureCount)} />
              <View style={styles.bannerDivider} />
              <BannerStat
                label={t('profile_stat_days_outside')}
                value={String(daysOutside)}
              />
            </View>

            {/* Rien pour un abonné : « illimité » sous un compteur, c'est une
                ligne qui n'apprend rien et qui rappelle un plafond qu'il a
                justement payé pour ne plus voir. */}
            {capturesRestantes !== null && capturesRestantes !== undefined ? (
              <Text style={[styles.bannerQuota, { color: SAFARI.savane.on }]}>
                {capturesRestantes === 0
                  ? t('profile_quota_none', { limit: DAILY_CAPTURE_ENERGY })
                  : t('profile_quota_left', { count: capturesRestantes })}
              </Text>
            ) : null}
          </PelageBanner>
        </ActivityFlipCard>

        <SectionLabel title={t('profile_section_subscription')} />
        <ProfileSection>
          {/* L'icône de l'app plutôt que des étincelles : cette ligne ne vend
              pas une fonctionnalité, elle vend l'app entière. */}
          <ProfileRow
            image={require('../../../assets/icon.png')}
            last
            onPress={() => router.push('/paywall')}
            title={t('profile_upgrade')}
          />
        </ProfileSection>

        {/* UNE SEULE SECTION, ET C'EST COHÉRENT.
            « DÉCOUVRIR » et « COMPTE » se partageaient trois lignes à deux : un
            libellé de section pour deux entrées, ce n'est plus un classement,
            c'est du bruit. Les trois qui restent vont ensemble — le Guide dit ce
            qu'est une espèce, les quêtes disent quoi chercher, la région décide
            de ce qu'on peut trouver. Les fonctions coupées reviendront dedans si
            leurs drapeaux se rallument ; si la liste regrossit, on redécoupera à
            ce moment-là, pas avant. */}
        <SectionLabel title={t('profile_section_discover')} />
        <ProfileSection>
          {/* LA GARDE EST ICI, PAS DANS LE GUIDE.
              Un non-abonné ne doit jamais MONTER l'écran du Guide : ouvrir une
              feuille pour la refermer aussitôt par redirection empile un plein
              écran sur une feuille, et ça gèle le fil JS (bisecté : ni la vidéo
              Skia, ni le balayage du bouton, ni RevenueCat n'étaient en cause).
              On envoie donc directement au paywall, plein écran, depuis un
              écran qui n'est pas une feuille. Le menu d'une carte fait déjà
              pareil (`card-morph-overlay`). */}
          <ProfileRow
            icon="sparkles"
            onPress={() => router.push(isPremium ? '/guide' : '/paywall')}
            title={t('profile_guide')}
            tone={ROBE.sable}
          />
          {LEADERBOARD_ACTIF ? (
            <ProfileRow
              icon="person.3.fill"
              onPress={() => router.push('/community')}
              title={t('profile_leaderboard')}
              tone={ROBE.ambre}
            />
          ) : null}
          {LIVRE_ACTIF ? (
            <ProfileRow
              icon="book.closed.fill"
              onPress={() => router.push('/book')}
              title={t('profile_book')}
              tone={ROBE.cuivre}
            />
          ) : null}
          <ProfileRow
            icon="trophy.fill"
            onPress={() => overlays.current?.openQuests()}
            title={t('profile_quests')}
            tone={ROBE.paille}
            value={`${earned}/${badges.length}`}
          />
          {/* SOUS LES QUÊTES, ET C'EST SA PLACE. Les deux se ressemblent :
              on les ouvre exprès, avant ou après une sortie, jamais en
              passant. Sur la collection, la bannière occupait le haut de
              l'écran en permanence pour un geste hebdomadaire. */}
          <ProfileRow
            icon="figure.walk"
            onPress={() => overlays.current?.openExpeditions()}
            title={t('profile_expeditions')}
            tone={ROBE.ambre}
          />
          <ProfileRow
            icon="globe.europe.africa.fill"
            last={!CERCLE_ACTIF}
            onPress={() => overlays.current?.openSettings(true)}
            title={t('profile_region')}
            tone={ROBE.miel}
            value={regionLabel(region.code)}
          />
          {CERCLE_ACTIF ? (
            <ProfileRow
              icon="person.2.fill"
              last
              onPress={() => overlays.current?.openCircle()}
              title={t('profile_circle')}
              tone={ROBE.ecorce}
              value={String(accepted.length)}
            />
          ) : null}
        </ProfileSection>

        <SectionLabel title={t('profile_section_settings')} />
        <ProfileSection>
          <ProfileRow
            icon="square.and.arrow.up"
            onPress={() =>
              void Share.share({
                message: t('profile_share_message', { level: progress.level, title: t(progress.titleKey), count: progress.speciesCount }),
              })
            }
            title={t('profile_share_progress')}
            tone={ROBE.terre}
          />
          <ProfileRow
            icon="gearshape.fill"
            last
            onPress={() => overlays.current?.openSettings()}
            title={t('profile_preferences')}
            tone={ROBE.encre}
          />
        </ProfileSection>
      </ScrollView>

      <ProfileOverlays bottomInset={insets.bottom} progress={progress} ref={overlays} />
    </>
  );
}

type ProfileOverlaysHandle = {
  openCircle: () => void;
  openExpeditions: () => void;
  openQuests: () => void;
  openSettings: (pickRegion?: boolean) => void;
};

const ProfileOverlays = forwardRef<
  ProfileOverlaysHandle,
  { bottomInset: number; progress: ReturnType<typeof getDeckProgress> }
>(function ProfileOverlays({ bottomInset, progress }, ref) {
  const { t: copy } = useUiTranslation();
  const { i18n: i18nInstance, t } = useTranslation();
  const { signOut } = useClerk();
  const [suppression, setSuppression] = useState(false);
  const deletingRef = useRef(false);
  const signOutCleanly = useCallback(async () => {
    await cancelSafaRollNotifications();
    await signOut();
  }, [signOut]);

  /**
   * L'ALERTE SYSTÈME, ET DEUX TEMPS.
   *
   * C'est la deuxième action irréversible de l'app après brûler une carte, et
   * de loin la plus grave. Le premier écran énumère ce qui part — un joueur ne
   * doit pas découvrir après coup que ses cartes en faisaient partie ; le
   * second demande de confirmer une fois de plus, parce que le premier bouton
   * rouge se tape parfois par réflexe.
   *
   * Déconnecter uniquement après confirmation du serveur. En cas d'échec,
   * conserver la session pour que l'utilisateur puisse réessayer.
   */
  const supprimerLeCompte = useCallback(() => {
    Alert.alert(
      t('profile_delete_title'),
      t('profile_delete_body'),
      [
        { style: 'cancel', text: t('common_cancel') },
        {
          onPress: () => Alert.alert(
            t('profile_delete_confirm_title'),
            t('profile_delete_confirm_body'),
            [
              { style: 'cancel', text: t('common_cancel') },
              {
                onPress: () => {
                  if (deletingRef.current) return;
                  deletingRef.current = true;
                  setSuppression(true);
                  void supabase.functions
                    .invoke('delete-account', { body: {} })
                    .then(async ({ data, error }) => {
                      if (error || data?.ok !== true) throw error ?? new Error('Account deletion not confirmed');
                      await signOutCleanly();
                      Alert.alert(t('profile_delete_done'));
                    })
                    .catch(() => {
                      toast.fail(t('profile_delete_failed'), t('profile_delete_failed_body'));
                    })
                    .finally(() => {
                      setSuppression(false);
                      deletingRef.current = false;
                    });
                },
                style: 'destructive',
                text: t('common_delete'),
              },
            ],
          ),
          style: 'destructive',
          text: t('common_delete'),
        },
      ],
    );
  }, [signOutCleanly, suppression, t]);
  const { devToggle, isPremium } = usePremium();
  const { user } = useUser();
  const userId = user?.id;
  const verifiedEmail = user?.primaryEmailAddress?.verification.status === 'verified'
    ? user.primaryEmailAddress.emailAddress : null;
  const emailConsent = useEmailConsent(userId, verifiedEmail);
  const notificationsEnabled = useNotificationsEnabled();
  const liveActivitiesOn = useLiveActivitiesEnabled();
  const captureExport = useCaptureExportPreferences(userId);
  const { resetOnboarding } = useOnboarding();
  const { theme } = useUnistyles();
  const router = useRouter();
  const [circleOpen, setCircleOpen] = useState(false);
  const [questsOpen, setQuestsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickingRegion, setPickingRegion] = useState(false);
  const [pickingExport, setPickingExport] = useState(false);
  const [pickingIcon, setPickingIcon] = useState(false);
  const [iconeCourante, setIconeCourante] = useState<string | null>(null);
  useEffect(() => {
    if (!iconesSupportees || !getIcon) return;
    void getIcon().then(setIconeCourante).catch(() => undefined);
  }, []);
  const { isAuthenticated } = useBackendAuth();
  const serverVisible = useQuery(api.community.myVisibility, isAuthenticated ? {} : 'skip');
  const setVisibleMutation = useMutation(api.community.setVisible);
  const [visibleOverride, setVisibleOverride] = useState<boolean | null>(null);
  const region = useRegion();
  const setRegionMutation = useMutation(api.profile.setRegion);
  const visible = visibleOverride ?? serverVisible ?? true;
  const toggleCaptureExport = async (kind: CaptureExportKind, enabled: boolean) => {
    try {
      const saved = await setCaptureExportPreference(userId, kind, enabled);
      if (!saved) {
        toast.fail(t('settings_capture_export_permission_title'), t('settings_capture_export_permission_body'));
      }
    } catch {
      toast.fail(t('settings_capture_export_permission_title'), t('settings_capture_export_permission_body'));
    }
  };
  const openRegionSettings = useCallback(() => {
    setQuestsOpen(false);
    setSettingsOpen(true);
    setPickingRegion(true);
  }, []);

  useImperativeHandle(ref, () => ({
    openCircle: () => setCircleOpen(true),
    openExpeditions: () => router.push('/(app)/safari'),
    openQuests: () => setQuestsOpen(true),
    openSettings: (pickRegion = false) => {
      setPickingRegion(pickRegion);
      setSettingsOpen(true);
    },
  }), [router]);

  return (
    <>
      {/* Hors du ScrollView : une feuille présentée par le système ne peut pas
          vivre dans un conteneur qui défile — elle est au-dessus de l'écran,
          pas dedans. */}
      {CERCLE_ACTIF && circleOpen ? <CircleSheet onClose={() => setCircleOpen(false)} open /> : null}

      {questsOpen ? (
        <NativeSheet detents={['large']} onClose={() => setQuestsOpen(false)} open>
          <ChallengesScreen
            bottomInset={bottomInset}
            onRegionPress={openRegionSettings}
          />
        </NativeSheet>
      ) : null}

      {/* LES RÉGLAGES, DERRIÈRE LA ROUE. Ils pesaient autant que le jeu quand
          ils étaient empilés dans la page ; personne n'ouvre son profil pour
          changer sa région. */}
      {/* MI-HAUTEUR, ET UN SEUL PALIER.
          Ouvrir en plein écran pour changer sa région, c'est une page déguisée
          en feuille : le profil disparaît derrière et on ne sait plus d'où l'on
          vient. La moitié basse suffit, le reste défile.
          Ce qui coupait le contenu sous « Partager ma progression » n'était pas
          le palier mais le `ScrollView` : sans hauteur FINIE au-dessus de lui
          il se dimensionnait sur son propre contenu, donc il n'avait rien à
          faire défiler. `styles.grow` et la hauteur calculée par `NativeSheet`
          règlent ça à n'importe quel palier.
          Un seul palier, pas `['medium', 'large']` : `NativeSheet` fige la
          hauteur du contenu sur le PREMIER, donc tirer la feuille plus haut
          laisserait une bande vide sous la liste. */}
      {settingsOpen ? <NativeSheet detents={['medium']} onClose={() => setSettingsOpen(false)} open>
        {/* Même raison que la page des quêtes : borné par la feuille, sinon
            il prend la hauteur de son contenu et ne défile pas. */}
        <ScrollView contentContainerStyle={styles.settings} showsVerticalScrollIndicator={false} style={styles.grow}>
          <Text style={styles.settingsTitle}>{t('settings_title')}</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: suppression, busy: suppression }}
            disabled={suppression}
            onPress={supprimerLeCompte}
            style={({ pressed }) => [styles.deleteAccount, pressed && styles.pressed]}
          >
            <Text style={styles.deleteAccountText}>{copy("profile_delete_title")}</Text>
          </Pressable>

          <SettingRow
            icon="globe.europe.africa.fill"
            label={t('profile_region')}
            onPress={() => setPickingRegion((open) => !open)}
            trailing={pickingRegion ? 'chevron.up' : 'chevron.down'}
            value={regionLabel(region.code)}
          />
          {pickingRegion
            ? SEASON_REGIONS.map((item) => (
                <Pressable
                  key={item.code}
                  onPress={() => {
                    setPickingRegion(false);
                    void setRegionMutation({ region: item.code });
                  }}
                  style={({ pressed }) => [styles.regionRow, pressed && styles.pressed]}
                >
                  <Text
                    style={[styles.regionText, region.code === item.code && styles.regionTextOn]}
                  >
                    {item.label}
                  </Text>
                  {region.code === item.code ? (
                    <SymbolView name="checkmark" size={13} tintColor={theme.colors.primary} weight="bold" />
                  ) : null}
                </Pressable>
              ))
            : null}

          <SettingRow
            icon="character.bubble.fill"
            label={t('profile_language')}
            onPress={() => {
              void Linking.openSettings().catch(() => toast.fail(t('common_error'), t('settings_open_failed')));
            }}
            trailing="chevron.right"
            value={
              APP_STORE_LOCALIZATIONS.find(
                (item) => item.code === i18nInstance.language,
              )?.nativeName ?? ''
            }
          />

          <SettingRow
            icon="square.and.arrow.down"
            label={t('settings_capture_export')}
            onPress={() => {
              if (!isPremium) {
                setSettingsOpen(false);
                router.push('/paywall');
                return;
              }
              setPickingExport((open) => !open);
            }}
            trailing={!isPremium ? 'lock.fill' : pickingExport ? 'chevron.up' : 'chevron.down'}
            value={
              isPremium
                ? `${Object.values(captureExport).filter(Boolean).length}/3`
                : 'SafaRoll+'
            }
          />
          {isPremium && pickingExport
            ? ([
                ['card', 'settings_capture_export_card'],
                ['sticker', 'settings_capture_export_sticker'],
                ['photo', 'settings_capture_export_photo'],
              ] as const).map(([kind, label]) => (
                <View key={kind} style={styles.regionRow}>
                  <Text style={[styles.regionText, captureExport[kind] && styles.regionTextOn]}>
                    {t(label)}
                  </Text>
                  <Switch
                    onValueChange={(enabled) => void toggleCaptureExport(kind, enabled)}
                    thumbColor={theme.colors.surface}
                    trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                    value={captureExport[kind]}
                  />
                </View>
              ))
            : null}

          {/* LES ICÔNES ALTERNATIVES.
              La ligne est VISIBLE pour tout le monde, contrairement au reste des
              portails premium : ici le produit se montre. Un cadenas sur trois
              vignettes vend mieux qu'une ligne absente — on voit ce qu'on rate,
              et le tap mène au paywall au lieu de ne rien faire.
              `isSupported` est faux tant que le build natif n'a pas les
              catalogues : la ligne disparaît alors plutôt que de lever. */}
          {iconesSupportees ? (
            <>
              <SettingRow
                icon="app.badge"
                label={t('settings_app_icon')}
                onPress={() => setPickingIcon((open) => !open)}
                trailing={pickingIcon ? 'chevron.up' : 'chevron.down'}
                value={t(iconeCourante ? `app_icon_${iconeCourante}` : 'app_icon_default')}
              />
              {pickingIcon ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  // Marge négative = la bande file d'un bord à l'autre de la
                  // feuille au lieu de s'arrêter à son padding. Le padding est
                  // rendu au contenu pour que la première vignette reste alignée.
                  style={styles.iconStrip}
                  contentContainerStyle={styles.iconStripContent}
                >
                  {ICONES_APP.map((item) => {
                    const verrouille = !!item.code && !isPremium && !__DEV__;
                    const actif = iconeCourante === item.code;
                    return (
                      <Pressable
                        key={item.code ?? 'defaut'}
                        onPress={() => {
                          if (verrouille) {
                            setPickingIcon(false);
                            router.push('/paywall');
                            return;
                          }
                          if (!setIcon) return;
                          // iOS affiche sa propre alerte « Icône changée ». On
                          // pose l'état AVANT la promesse : elle ne se résout
                          // qu'après le passage en arrière-plan.
                          setIconeCourante(item.code);
                          void setIcon(item.code).catch(() => setIconeCourante((c) => c));
                        }}
                        style={({ pressed }) => [styles.iconTile, pressed && styles.pressed]}
                      >
                        <View>
                          <Image
                            source={item.source}
                            style={[styles.iconThumb, actif && styles.iconThumbOn]}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                          />
                          {verrouille ? (
                            <View style={styles.iconLock}>
                              <SymbolView name="lock.fill" size={13} tintColor="#fff8e5" />
                            </View>
                          ) : actif ? (
                            <View style={styles.iconCheck}>
                              <SymbolView name="checkmark" size={11} tintColor={theme.colors.onPrimary} weight="bold" />
                            </View>
                          ) : null}
                        </View>
                        <Text style={[styles.iconLabel, actif && styles.regionTextOn]} numberOfLines={1}>
                          {t(item.labelKey)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}
            </>
          ) : null}

          <SettingRow
            icon="chart.bar.fill"
            label={t('profile_wild_year')}
            onPress={() => {
              setSettingsOpen(false);
              router.push('/wild-year');
            }}
          />
          <SettingRow
            icon="hand.raised.slash"
            label={t('profile_blocked')}
            onPress={() => {
              setSettingsOpen(false);
              router.push('/blocked');
            }}
          />
          <SettingRow
            icon="square.and.arrow.up"
            label={t('profile_share_progress')}
            onPress={() =>
              void Share.share({
                message: t('profile_share_message', { level: progress.level, title: t(progress.titleKey), count: progress.speciesCount }),
              })
            }
          />

          <View style={styles.settingRow}>
            <SymbolView name="bell.fill" size={17} tintColor={theme.colors.muted} />
            <Text style={styles.settingLabel}>{t('settings_notifications')}</Text>
            <Switch
              onValueChange={(enabled) => void setNotificationsEnabled(enabled)}
              thumbColor={theme.colors.surface}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              value={notificationsEnabled}
            />
          </View>

          {/* L'EXPLICATION SUIT LES DEUX INTERRUPTEURS, ELLE NE LES PRÉCÈDE PAS.
              Quelqu'un qui vient couper cherche un bouton ; le lui faire lire
              d'abord serait un péage. Placée après, elle répond à la question
              qu'on se pose UNE FOIS le doigt sur l'interrupteur : « au fait,
              c'est quoi ces messages ? » */}
          {notificationsEnabled ? <NotificationsExplainer /> : null}

          <View style={styles.settingRow}>
            <SymbolView name="envelope.fill" size={17} tintColor={theme.colors.muted} />
            <Text style={styles.settingLabel}>{t('settings_monthly_email', { defaultValue: 'Recevoir mon bilan mensuel par e-mail' })}</Text>
            <Switch
              accessibilityLabel={t('settings_monthly_email', { defaultValue: 'Recevoir mon bilan mensuel par e-mail' })}
              disabled={!emailConsent.loaded || emailConsent.isPending || (!verifiedEmail && !emailConsent.enabled)}
              value={emailConsent.enabled}
              onValueChange={(enabled) => emailConsent.mutate(enabled, {
                onError: () => toast.fail(t('common_error'), t('settings_email_save_failed')),
              })}
              thumbColor={theme.colors.surface}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
            />
          </View>

          {/* SÉPARÉ DES NOTIFICATIONS, ET CE N'EST PAS UN DÉTAIL DE RANGEMENT.
              Une notification interrompt une fois ; une activité en direct
              OCCUPE l'écran verrouillé pendant toute une sortie. Les deux
              consentements ne sont pas le même, et iOS les traite d'ailleurs
              séparément dans ses propres réglages. */}
          {Platform.OS === 'ios' ? (
            <View style={styles.settingRow}>
              <SymbolView name="lock.iphone" size={17} tintColor={theme.colors.muted} />
              <Text style={styles.settingLabel}>{t('settings_live_activities')}</Text>
              <Switch
                onValueChange={setLiveActivitiesEnabled}
                thumbColor={theme.colors.surface}
                trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                value={liveActivitiesOn}
              />
            </View>
          ) : null}

          {/* Un interrupteur, pas une matrice : coupé = hors du classement,
              profil invisible, plus rien n'alimente la commu. */}
          <View style={styles.settingRow}>
            <SymbolView name="person.2.fill" size={17} tintColor={theme.colors.muted} />
            <Text style={styles.settingLabel}>{copy("ui_copy_162")}</Text>
            <Switch
              onValueChange={(next) => {
                setVisibleOverride(next);
                void setVisibleMutation({ visible: next });
              }}
              thumbColor={theme.colors.surface}
              trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
              value={visible}
            />
          </View>

          {/* L'abonnement, à la main, et SEULEMENT en développement.
              `devToggle` existait dans `naturalist.ts` depuis le début sans
              qu'aucun écran ne l'appelle : impossible de voir ce que débloque
              l'abonnement sans passer par un vrai achat. Le garde `__DEV__`
              n'est pas une politesse — sans lui, l'interrupteur part en
              production et l'abonnement devient un bouton gratuit. */}
          {__DEV__ ? (
            <View style={styles.settingRow}>
              <SymbolView name="hammer.fill" size={17} tintColor={theme.colors.muted} />
              <Text style={styles.settingLabel}>SafaRoll+ (dev)</Text>
              <Switch
                onValueChange={devToggle}
                thumbColor={theme.colors.surface}
                trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                value={isPremium}
              />
            </View>
          ) : null}
          {/* La clé de l'onboarding vit dans le trousseau, donc désinstaller
              l'app ne suffit pas toujours à la reprendre à zéro sur iOS. */}
          {__DEV__ ? (
            <SettingRow
              icon="arrow.counterclockwise"
              label={t('profile_replay_onboarding')}
              onPress={resetOnboarding}
              trailing="arrow.counterclockwise"
            />
          ) : null}

          <Pressable
            onPress={() => void signOutCleanly()}
            style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
          >
            <Text style={styles.signOutText}>{copy("ui_copy_163")}</Text>
          </Pressable>

        </ScrollView>
      </NativeSheet> : null}
    </>
  );
});

function BannerStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.bannerStat}>
      <Text adjustsFontSizeToFit numberOfLines={1} style={styles.bannerStatValue}>
        {value}
      </Text>
      <Text style={styles.bannerStatLabel}>{label}</Text>
    </View>
  );
}

/**
 * Une section : la carte blanche arrondie qui groupe des lignes d'un même sujet.
 *
 * Reprise de `SettingsSection` (~/VoyageMakerSDK54, page réglages) : fond plein,
 * grand rayon, ombre portée douce. La hauteur y était passée en props, ligne par
 * ligne — ici elle se déduit du contenu, sinon ajouter une entrée oblige à
 * recompter des pixels à la main.
 */
function ProfileSection({ children }: { children: React.ReactNode }) {
  return <View style={styles.section}>{children}</View>;
}

/**
 * Une ligne : tuile d'icône colorée, titre, chevron, filet de séparation.
 *
 * Le filet saute sur la DERNIÈRE ligne — sinon la carte se termine sur un trait
 * flottant à un cheveu de son bord. VoyageMaker testait la couleur de l'icône
 * pour deviner la fin (`iconColor !== "#FF00C4"`), ce qui casse dès qu'on réutilise
 * une teinte ; ici la position est déclarée.
 */
/**
 * UNE SEULE TEINTE POUR TOUTES LES PASTILLES.
 *
 * Chaque ligne portait la sienne — cinq familles SAFARI pour six entrées, donc
 * un nuancier là où il n'y a aucun code à lire : rien ne reliait le vert du
 * Leaderboard au bleu de Ma région.
 *
 * `savane` pour tout le monde : c'est la couleur de la bannière juste au-dessus
 * et, d'après la palette elle-même, « la couleur de l'app ». La page garde donc
 * sa chaleur — un profil monochrome se lit comme un tableur — mais elle n'a
 * plus qu'un accent, et la liste redevient une liste.
 */
/** Le sable de la robe. */
const PELAGE = '#EBD297';

/**
 * LA GAMME DES PASTILLES : une robe qui fonce en descendant la page.
 *
 * Les cinq familles SAFARI ne conviennent pas ici — leur vert, leur bleu et
 * leur violet sont faits pour des bannières pleine largeur qui se voient une à
 * la fois, et alignés en colonne ils donnent un nuancier d'école. Mais tout
 * mettre à la même teinte, c'est retirer au regard le moyen de retrouver une
 * ligne qu'il a déjà vue.
 *
 * D'où cette gamme, tirée de la robe du guépard de l'icône : du sable de la
 * bannière jusqu'à l'encre de ses taches. Huit valeurs, une seule famille
 * chaude — chaque ligne se distingue de sa voisine, aucune ne sort de la DA.
 *
 * L'ORDRE EST LA RÈGLE : on descend la page, la robe fonce. Un dégradé sur
 * toute la hauteur se lit comme voulu ; des teintes tirées au hasard se lisent
 * comme un accident.
 */
/**
 * LES PASTILLES SONT EN PIGMENTS, PAS EN RARETÉS.
 *
 * Elles ont porté deux mauvaises palettes avant celle-ci.
 *
 * D'ABORD huit variantes du même brun, du sable à l'encre. Techniquement
 * irréprochable, et mort : rien ne distinguait une ligne d'une autre, la page
 * se lisait comme un tableur beige.
 *
 * ENSUITE les huit paliers de rareté, en se disant que le joueur les connaît
 * déjà par cœur. L'idée tenait sur le papier et s'est effondrée à l'écran :
 * `rarity.ts` peint pour une CARTE — fond sombre, cadre net — donc ses accents
 * sont froids et saturés. #9aa4b4 gris-bleu, #54d0c8 turquoise, #c995ff lavande,
 * #6bffae vert menthe. Posés sur du parchemin crème, ils n'appartiennent à rien.
 *
 * D'OÙ CELLE-CI. Les six couleurs de l'icône de l'app, plus deux tons de
 * `unistyles`. Rien d'inventé, rien d'importé : ce sont les pigments que
 * SafaRoll utilise déjà partout ailleurs. On descend de l'or au brun, ce qui
 * donne au regard de quoi retrouver une ligne — la variation est de VALEUR,
 * pas de teinte, et c'est ce qui manquait au premier dégradé de bruns : lui
 * variait trop peu pour se voir.
 *
 * `on` est l'encre du glyphe. Elle bascule sur l'ivoire pour les deux pigments
 * sombres — un brun foncé sur brun foncé ne se lit pas.
 */
/** Les quatre icônes, dans l'ordre de la bande. `code: null` = celle par défaut. */
const ICONES_APP: { code: string | null; labelKey: string; source: number }[] = [
  { code: null, labelKey: 'app_icon_default', source: require('../../../assets/icon.png') },
  { code: 'epique', labelKey: 'app_icon_epique', source: require('../../../assets/icons/epique.png') },
  { code: 'mythique', labelKey: 'app_icon_mythique', source: require('../../../assets/icons/mythique.png') },
  { code: 'rare', labelKey: 'app_icon_rare', source: require('../../../assets/icons/rare.png') },
];

const ROBE = {
  /** #e6c379 — l'or de l'icône. La teinte la plus saturée, pour la ligne phare. */
  sable: { from: '#e6c379', on: '#33281a' },
  /** #ebd294 — l'or clair de l'icône. */
  paille: { from: '#ebd294', on: '#33281a' },
  /** #e2d5b5 — le beige de l'icône. */
  miel: { from: '#e2d5b5', on: '#33281a' },
  /** #e6dfc4 — le parchemin de `unistyles.primarySoft`. */
  ambre: { from: '#e6dfc4', on: '#33281a' },
  /** #f3ecdd — `unistyles.surfaceMuted`, le plus pâle qui se détache encore
   *  de la surface d'une ligne (#fffdf8). */
  cuivre: { from: '#f3ecdd', on: '#33281a' },
  /** #695a45 — le brun de l'icône. Glyphe ivoire. */
  terre: { from: '#695a45', on: '#f1ecea' },
  /** Le pas entre #695a45 et #33281a — le seul ton dérivé, pour éviter que les
   *  deux pigments sombres se confondent quand ils se suivent. */
  ecorce: { from: '#4c3e2d', on: '#f1ecea' },
  /** #33281a — le brun profond de l'icône, celui du glyphe partout ailleurs. */
  encre: { from: '#33281a', on: '#f1ecea' },
} as const;
/** L'encre des taches ET du glyphe : la même, comme sur un vrai pelage. */
const TACHE = '#241a08';

/**
 * Les taches, en fractions de la boîte — donc valables à n'importe quelle
 * taille de pastille.
 *
 * Posées à la main et non tirées au hasard : le centre reste libre pour que le
 * symbole se lise, et trois d'entre elles débordent volontairement du cadre
 * (valeurs négatives ou > 1) pour être coupées par le `overflow: hidden`. Une
 * robe dont toutes les taches tiennent entièrement dans le carré ressemble à un
 * motif ; celles qu'on coupe font croire à un morceau d'animal.
 */
const TACHES = [
  // Haut : trois taches coupées par le bord supérieur.
  { h: 0.1, left: 0.06, rotate: '-16deg', top: -0.05, w: 0.07 },
  { h: 0.08, left: 0.4, rotate: '10deg', top: -0.04, w: 0.05 },
  { h: 0.11, left: 0.83, rotate: '-6deg', top: -0.06, w: 0.075 },
  // Coin haut droit, la seule zone franchement libre.
  { h: 0.13, left: 0.9, rotate: '18deg', top: 0.14, w: 0.085 },
  { h: 0.09, left: 0.79, rotate: '-12deg', top: 0.3, w: 0.055 },
  // Bord gauche, à gauche de l'anneau de niveau.
  { h: 0.12, left: -0.03, rotate: '24deg', top: 0.34, w: 0.07 },
  { h: 0.09, left: 0.02, rotate: '-8deg', top: 0.66, w: 0.05 },
  // Bas : coupées par le bord inférieur, sous la rangée de chiffres.
  { h: 0.1, left: 0.22, rotate: '14deg', top: 0.95, w: 0.06 },
  { h: 0.12, left: 0.63, rotate: '-20deg', top: 0.93, w: 0.075 },
  { h: 0.09, left: 0.93, rotate: '6deg', top: 0.78, w: 0.06 },
] as const;

/**
 * La bannière du profil, en robe de guépard — celle de l'icône de l'app.
 *
 * Un aplat et non un dégradé : `SafariGradient` faisait glisser l'orange vers
 * le rouge, et sur un fond qui bouge des taches noires deviennent du bruit.
 *
 * Elle se mesure elle-même parce que les taches sont exprimées en FRACTIONS de
 * la boîte : le même motif tient sur toutes les largeurs d'écran, et il n'y a
 * aucun nombre en dur à reprendre le jour où la bannière change de hauteur.
 */
function PelageBanner({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const [size, setSize] = useState({ height: 0, width: 0 });

  return (
    <View
      onLayout={(event) => {
        const { height, width } = event.nativeEvent.layout;
        // Comparé avant d'écrire : `onLayout` refire à chaque passe, et poser
        // un objet neuf relancerait un rendu à l'infini.
        setSize((current) =>
          current.width === width && current.height === height ? current : { height, width },
        );
      }}
      style={[styles.pelage, style]}
    >
      {size.width > 0
        ? TACHES.map((tache) => {
            const w = tache.w * size.width;
            const h = tache.h * size.height;
            return (
              <View
                key={`${tache.left}:${tache.top}`}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: tache.left * size.width,
                  top: tache.top * size.height,
                  width: w,
                  height: h,
                  // Un ovale, pas un disque : le rayon vaut la moitié du grand côté.
                  borderRadius: Math.max(w, h) / 2,
                  backgroundColor: TACHE,
                  transform: [{ rotate: tache.rotate }],
                }}
              />
            );
          })
        : null}
      {children}
    </View>
  );
}
function ProfileRow({
  icon,
  image,
  last = false,
  onPress,
  title,
  tone = ROBE.sable,
  value,
}: {
  icon?: SFSymbol;
  /** Une vraie image à la place du symbole : elle porte sa propre couleur, donc
   *  pas de pastille derrière. Voir la ligne SafaRoll+. */
  image?: number;
  last?: boolean;
  onPress: () => void;
  title: string;
  /** Un cran de `ROBE`, jamais une couleur écrite à la main. */
  tone?: { from: string; on: string };
  value?: string;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {image ? (
        <Image contentFit="cover" source={image} style={styles.rowImage} />
      ) : (
        <View style={[styles.rowIcon, { backgroundColor: tone.from }]}>
          {icon ? <SymbolView name={icon} size={17} tintColor={tone.on} weight="semibold" /> : null}
        </View>
      )}
      <Text numberOfLines={1} style={styles.rowTitle}>{title}</Text>
      {value ? <Text numberOfLines={1} style={styles.rowValue}>{value}</Text> : null}
      <SymbolView name="chevron.right" size={13} tintColor={theme.colors.faint} weight="semibold" />
      {last ? null : <View style={styles.rowDivider} />}
    </Pressable>
  );
}

function SectionLabel({
  onPress,
  right,
  title,
}: {
  onPress?: () => void;
  right?: string;
  title: string;
}) {
  const { theme } = useUnistyles();
  const body = (
    <View style={styles.sectionLabel}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.grow} />
      {right ? <Text style={styles.sectionRight}>{right}</Text> : null}
      {onPress ? (
        <SymbolView name="chevron.right" size={12} tintColor={theme.colors.faint} weight="bold" />
      ) : null}
    </View>
  );
  return onPress ? (
    <Pressable hitSlop={6} onPress={onPress} style={({ pressed }) => (pressed ? styles.pressed : null)}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

function SettingRow({
  icon,
  label,
  onPress,
  trailing = 'chevron.right',
  value,
}: {
  icon: SFSymbol;
  label: string;
  onPress: () => void;
  trailing?: SFSymbol;
  value?: string;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}>
      <SymbolView name={icon} size={17} tintColor={theme.colors.muted} />
      <Text style={styles.settingLabel}>{label}</Text>
      {value ? <Text style={styles.settingValue}>{value}</Text> : null}
      <SymbolView name={trailing} size={12} tintColor={theme.colors.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    paddingHorizontal: theme.gap(2.5),
    paddingTop: theme.gap(1),
    gap: theme.gap(1),
  },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },


  identity: { alignItems: 'center', gap: theme.gap(0.75), paddingBottom: theme.gap(1.5) },
  name: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 20,
  },
  email: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 12,
  },

  // LA SECTION. Fond plein, grand rayon, ombre douce — le rectangle de
  // VoyageMaker. `overflow: hidden` arrête l'aplat d'appui d'une ligne aux
  // coins arrondis ; sans lui, la première et la dernière ligne débordent.
  section: {
    backgroundColor: theme.colors.surface,
    borderCurve: 'continuous',
    borderRadius: 20,
    elevation: 2,
    overflow: 'hidden',
    paddingVertical: theme.gap(0.5),
    shadowColor: '#2b2418',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: theme.gap(1.5),
    paddingHorizontal: theme.gap(2),
    paddingVertical: theme.gap(1.5),
  },
  // Le carré arrondi coloré : c'est lui qui rend la liste lisible d'un coup
  // d'œil, chaque sujet ayant sa teinte du jour.
  /** La même boîte que `rowIcon`, sans la pastille : l'icône a la sienne. */
  rowImage: {
    borderRadius: 10,
    height: 34,
    width: 34,
  },
  rowIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    // Les taches qui dépassent sont coupées ici — c'est ce qui fait la robe
    // plutôt qu'un motif centré.
    overflow: 'hidden',
    width: 34,
  },
  rowTitle: {
    color: theme.colors.foreground,
    flex: 1,
    fontFamily: theme.fonts.bold,
    fontSize: 15,
  },
  rowValue: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 13,
    maxWidth: '40%',
  },
  // Aligné sur le TITRE, pas sur le bord : un filet qui part sous la tuile
  // d'icône coupe la colonne que l'œil suit.
  rowDivider: {
    backgroundColor: theme.colors.border,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    left: theme.gap(2) + 34 + theme.gap(1.5),
    position: 'absolute',
    right: 0,
  },

  banner: {
    height: '100%',
    padding: theme.gap(2.25),
    gap: theme.gap(2),
  },
  pelage: {
    backgroundColor: PELAGE,
    borderRadius: 28,
    // Ce qui coupe les taches au bord — c'est ça qui fait la robe plutôt qu'un
    // motif posé au milieu.
    overflow: 'hidden',
  },
  bannerFlip: { marginTop: theme.gap(0.5) },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.gap(2) },
  levelRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 4,
    borderColor: 'rgba(255,251,240,0.6)',
    backgroundColor: 'rgba(255,251,240,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelValue: {
    color: '#4A3208',
    fontFamily: theme.fonts.display,
    fontSize: 28,
    lineHeight: 32,
  },
  bannerTitle: { fontFamily: theme.fonts.bold, fontSize: 20 },
  bannerCopy: { fontFamily: theme.fonts.regular, fontSize: 12.5, opacity: 0.8, marginTop: 1 },
  bannerTrack: {
    height: 9,
    borderRadius: 5,
    marginTop: 8,
    backgroundColor: 'rgba(74,50,8,0.18)',
    overflow: 'hidden',
  },
  bannerFill: { height: '100%', borderRadius: 5, backgroundColor: '#FFFBF0' },
  bannerQuota: {
    fontFamily: theme.fonts.regular,
    fontSize: 12,
    marginTop: 10,
    opacity: 0.72,
    textAlign: 'center',
  },
  bannerStats: { flexDirection: 'row', alignItems: 'center' },
  bannerStat: { flex: 1, alignItems: 'center', gap: 1 },
  bannerStatValue: {
    color: '#4A3208',
    fontFamily: theme.fonts.display,
    fontSize: 19,
  },
  bannerStatLabel: {
    color: '#4A3208',
    opacity: 0.65,
    fontFamily: theme.fonts.medium,
    fontSize: 11,
  },
  bannerDivider: { width: 1, height: 26, backgroundColor: 'rgba(74,50,8,0.18)' },

  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: theme.gap(2),
    paddingHorizontal: theme.gap(0.5),
  },
  sectionTitle: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.bold,
    fontSize: 12,
    letterSpacing: 1.2,
  },
  sectionRight: {
    color: theme.colors.faint,
    fontFamily: theme.fonts.bold,
    fontSize: 12,
    letterSpacing: 1.2,
  },


  // fond, le rayon et la bordure. Lui laisser les siens aurait posé une carte
  // dans une carte.

  // de la page, et l'intitulé de section fournit maintenant son dégagement.

  settings: { padding: theme.gap(2.5), paddingTop: theme.gap(2) },
  // La bande déborde le padding de la feuille pour filer bord à bord ; le
  // padding est rendu au contenu, sinon la première vignette colle au bord.
  iconStrip: { marginHorizontal: -theme.gap(2.5), marginTop: theme.gap(0.5) },
  iconStripContent: { paddingHorizontal: theme.gap(2.5), gap: theme.gap(1.5) },
  iconTile: { alignItems: 'center', gap: theme.gap(0.75), width: 76 },
  iconThumb: { borderRadius: 17, height: 76, width: 76 },
  iconThumbOn: { borderColor: theme.colors.primary, borderWidth: 2.5 },
  iconLock: {
    alignItems: 'center',
    backgroundColor: 'rgba(43, 36, 24, 0.62)',
    borderRadius: 17,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  iconCheck: {
    alignItems: 'center',
    backgroundColor: theme.colors.primary,
    borderRadius: 9,
    bottom: -2,
    height: 18,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
    width: 18,
  },
  iconLabel: { color: theme.colors.muted, fontFamily: theme.fonts.medium, fontSize: 11 },
  settingsTitle: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 28,
    marginBottom: theme.gap(1.5),
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1.5),
    minHeight: 50,
    paddingVertical: theme.gap(0.75),
  },
  settingLabel: {
    flex: 1,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.medium,
    fontSize: 15,
  },
  settingValue: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.medium,
    fontSize: 14,
  },
  regionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: theme.gap(4),
    paddingVertical: 11,
  },
  regionText: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 14.5,
  },
  regionTextOn: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
  },
  deleteAccount: { minHeight: 48, justifyContent: 'center', paddingVertical: theme.gap(1.5) },
  deleteAccountText: {
    color: theme.colors.danger,
    fontFamily: theme.fonts.medium,
    fontSize: 15,
  },
  signOut: { alignItems: 'center', paddingVertical: theme.gap(2.5) },
  signOutText: {
    fontFamily: theme.fonts.bold,
    fontSize: 15,
    color: theme.colors.danger,
  },
}));
