import { marque } from '@/lib/boot-trace';
import { requestExpandableCamera } from '@/components/navigation/expandable-camera-state';
import { useUser } from '@clerk/expo';
import * as QuickActions from 'expo-quick-actions';
import { useQuickActionCallback } from 'expo-quick-actions/hooks';
import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { useCaptureQueue } from '@/lib/animals/use-capture-queue';
import { useSeasonNudge } from '@/lib/animals/use-season-nudge';
import { useProgressNotifications } from '@/lib/animals/use-progress-notifications';
import {
  configureNotifications,
  observeNotificationNavigation,
  refreshNotificationPermission,
} from '@/lib/notifications';
import { syncEmailSubscription, oneSignalLogin, syncEngagementTags } from '@/lib/onesignal';
import { useEmailConsent } from '@/lib/email-consent';
import { useOnboarding } from '@/lib/onboarding';
import { useRevenueCatIdentity } from '@/lib/purchases';
import { usePremium } from '@/lib/premium';
import { DeckWidgetPainter } from '@/components/widget/deck-widget-painter';
import { setWidgetLabels, setWidgetPremium } from '@/lib/widget-storage';
import { backendQuery, useBackendAuth } from '@/lib/supabase/backend';
import { api } from '@/lib/supabase/api';
import { queryClient } from '@/lib/query-client';
import { Redirect, Stack, usePathname, useRouter } from 'expo-router';
import { memo, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

export default function AppLayout() {
  const { isSignedIn, isLoaded } = useBackendAuth();
  const { onboarded } = useOnboarding();
  const { theme } = useUnistyles();
  const pathname = usePathname();

  if (!isLoaded) {
    marque('(app) rend null — Clerk pas encore chargé');
    return null;
  }
  marque(`(app) monte — connecté=${isSignedIn} onboardé=${onboarded}`);

  if (!isSignedIn) {
    if (pathname !== '/onboarding') return <Redirect href="/(auth)/sign-in" />;
    return <AppStack background={theme.colors.background} onboarded={false} primary={theme.colors.primary} />;
  }

  return (
    <>
      <OnboardingCameraRecovery onboarded={onboarded} />
      <AppSideEffects />
      <AppStack background={theme.colors.background} onboarded={onboarded} primary={theme.colors.primary} />
    </>
  );
}

/**
 * Une promesse photo vit seulement en mémoire. Après un reload ou un passage
 * en arrière-plan, restaurer `/camera` ne peut donc produire qu'une analyse
 * infinie : on reprend au vrai viseur de l'onboarding.
 *
 * Le changement de route normal vers `/camera` reste intact. On ne répare que
 * la route trouvée au montage et celle reprise après une interruption système.
 */
function OnboardingCameraRecovery({ onboarded }: { onboarded: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const firstRender = useRef(true);

  useEffect(() => {
    if (!firstRender.current) return;
    firstRender.current = false;
    if (!onboarded && pathname === '/camera') {
      router.replace({ pathname: '/onboarding', params: { resume: 'camera' } });
    }
  }, [onboarded, pathname, router]);

  useEffect(() => {
    let interrupted = AppState.currentState !== 'active';
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        interrupted = true;
        return;
      }
      if (!interrupted) return;
      interrupted = false;
      if (!onboarded && pathname === '/camera') {
        router.replace({ pathname: '/onboarding', params: { resume: 'camera' } });
      }
    });
    return () => subscription.remove();
  }, [onboarded, pathname, router]);

  return null;
}

/**
 * LES RACCOURCIS DE L'APPUI LONG SUR L'ICÔNE.
 *
 * Trois, pas quatre : Apple en accepte quatre, mais un menu qu'on parcourt
 * n'est plus un raccourci. On garde le geste central — capturer — et les deux
 * destinations qu'on rouvre le plus.
 *
 * IL VIT DANS CE SOUS-LAYOUT, PAS DANS LA RACINE.
 *
 * Le paquet le dit noir sur blanc : « should be used inside of a sub-layout
 * route and not inside the root layout route as it will attempt a navigation ».
 * Depuis la racine, la navigation part avant que la pile de `(app)` existe.
 * Ici, elle ne part qu'une fois l'utilisateur authentifié et les onglets montés.
 *
 * ON NE SE SERT PAS DE `useQuickActionRouting`.
 *
 * Il POUSSE sur `params.href`. Déclenché depuis le paywall, il empilait donc
 * les onglets PAR-DESSUS le modal ouvert — l'app s'ouvrait sur `(tabs)` en
 * présentation modale, paywall toujours dessous. Un raccourci ne navigue pas
 * depuis l'endroit où l'on était : il remet l'app à zéro. D'où `dismissTo`,
 * qui fait tomber ce qui est empilé au lieu d'y ajouter — le même geste que
 * la caméra utilise pour se refermer.
 *
 * POURQUOI LE GUIDE PEUT Y FIGURER : `/guide` porte sa propre garde SafaRoll+
 * (voir `(app)/guide.tsx`). La garde vit sur la route, pas chez l'appelant —
 * et une action rapide n'est pas un appelant.
 *
 * Les libellés se relisent à chaque changement de langue : ils sont posés par
 * le SYSTÈME dans le menu de l'icône, donc ils ne se retraduisent pas seuls
 * au prochain rendu comme le ferait un `<Text>`.
 */
function QuickActionsBridge() {
  const { i18n: instance, t } = useTranslation();
  const router = useRouter();
  const { isPremium: estPremium } = usePremium();

  useQuickActionCallback((action) => {
    // D'abord faire tomber ce qui est ouvert — paywall, fiche, guide.
    // `canDismiss` évite de jeter quand la pile est déjà à la racine.
    if (router.canDismiss()) router.dismissTo('/(tabs)/(home)');

    if (action.id === 'capture') requestExpandableCamera();
    // Le Guide est payant, et une action rapide n'est pas un composant : sans
    // cette garde elle ouvrait une porte gratuite depuis l'icône de l'app.
    // C'est la TROISIÈME entrée du Guide — les deux autres sont la ligne du
    // profil et le menu d'une carte, toutes deux gardées de la même façon.
    else if (action.id === 'guide') {
      router.push(estPremium ? '/guide' : '/paywall');
    }
  });

  useEffect(() => {
    const actions: QuickActions.Action[] = [
      {
        icon: 'symbol:camera.fill',
        id: 'capture',
        subtitle: t('quick_capture_subtitle'),
        title: t('quick_capture_title'),
      },
      {
        icon: 'symbol:square.grid.2x2.fill',
        id: 'collection',
        subtitle: t('quick_collection_subtitle'),
        title: t('quick_collection_title'),
      },
      {
        icon: 'symbol:sparkles',
        id: 'guide',
        subtitle: t('quick_guide_subtitle'),
        title: t('quick_guide_title'),
      },
    ];
    QuickActions.setItems(actions).catch((error) => {
      if (__DEV__) console.warn('[quick-actions] setItems a échoué :', error);
    });
  }, [instance.language, t]);

  return null;
}

function AppSideEffects() {
  const { userId } = useBackendAuth();
  const { user } = useUser();
  // Peut être une adresse relais `@privaterelay.appleid.com` quand le joueur a
  // masqué son e-mail via Connexion avec Apple. Elle fonctionne pour l'envoi —
  // Apple relaie — et c'est la seule que l'app ait le droit de connaître.
  const courriel = user?.primaryEmailAddress?.emailAddress ?? null;
  const emailConsent = useEmailConsent(userId);
  const router = useRouter();
  const { isPremium } = usePremium();
  const { i18n } = useTranslation();
  useSeasonNudge();
  useProgressNotifications();
  useCaptureQueue();
  useRevenueCatIdentity(userId);
  useWidgetPremiumMirror();
  useWidgetLabelMirror();
  useEffect(() => {
    void configureNotifications();
    return observeNotificationNavigation((url) => router.push(url as never));
  }, [router]);
  useEffect(() => {
    // Même identité que RevenueCat : l'id Clerk. Un joueur, un destinataire.
    oneSignalLogin(userId);
    // Remove legacy automatic subscriptions; never auto-resubscribe on login.
    if (userId && emailConsent.loaded && !emailConsent.enabled) {
      syncEmailSubscription(userId, courriel, false);
    }
  }, [courriel, userId, emailConsent.loaded, emailConsent.enabled]);
  useEffect(() => {
    syncEngagementTags({
      locale: i18n.language === 'fr' ? 'fr' : 'en',
      premium: isPremium,
    });
  }, [i18n.language, isPremium]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshNotificationPermission();
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!userId) return;
    // Les trois sources de l'accueil partent ensemble. TanStack déduplique si
    // l'onglet les a déjà demandées : aucun second appel, juste une avance.
    void Promise.allSettled([
      queryClient.prefetchQuery(backendQuery(api.animals.listCaptures, {})),
      queryClient.prefetchQuery(backendQuery(api.catalog.listAll, {})),
      queryClient.prefetchQuery(backendQuery(api.decks.listMineWithCards, {})),
    ]);
  }, [userId]);
  return (
    <>
      <QuickActionsBridge />
      {/* LE PEINTRE DU WIDGET DECK, MONTÉ ICI ET PAS AILLEURS.
          Il photographie une vue réellement montée, donc il doit vivre dans un
          arbre qui ne se démonte pas quand on change d'onglet — sinon l'image
          ne serait refaite qu'en visitant l'écran des decks, c'est-à-dire
          presque jamais. Il ne rend rien de visible : sa scène est posée à
          4 000 pt au-dessus de l'écran. */}
      <DeckWidgetPainter />
    </>
  );
}

/**
 * LE DROIT PREMIUM, RECOPIÉ POUR LES WIDGETS.
 *
 * Une extension iOS ne peut interroger ni Supabase ni RevenueCat : pas de
 * session, pas de jeton, pas de réseau à elle. Elle ne connaît que ce que l'app
 * a déposé dans l'App Group. Sans cette recopie, le widget de deck resterait
 * verrouillé pour quelqu'un qui VIENT DE PAYER — un bug invisible depuis l'app.
 *
 * On recopie le résultat de `usePremium`, jamais l'une de ses trois sources :
 * lui seul fait le OU qui ouvre l'accès dès que la plus rapide répond.
 */
function useWidgetPremiumMirror() {
  const { isPremium } = usePremium();
  useEffect(() => {
    setWidgetPremium(isPremium);
  }, [isPremium]);
}

/**
 * LES LIBELLÉS DU WIDGET, RECOPIÉS DANS LA LANGUE DE L'APP.
 *
 * L'extension a ses propres fichiers de langue, mais ils suivent le SYSTÈME.
 * La préférence de SafaRoll, elle, vit en MMKV côté JavaScript et ne touche
 * jamais le natif : forcer l'anglais dans l'app laissait le widget en français
 * sur un iPhone français.
 *
 * On recopie donc les deux libellés traduits à chaque changement de langue.
 * `i18n.language` change quand `changeLanguage` est appelée — c'est elle la
 * dépendance, pas la préférence brute, parce que c'est elle qui dit ce que
 * `t()` rend RÉELLEMENT à cet instant.
 */
function useWidgetLabelMirror() {
  const { i18n, t } = useTranslation();
  useEffect(() => {
    setWidgetLabels(t('widget_camera_title'), t('widget_camera_subtitle'));
  }, [i18n.language, t]);
}

const AppStack = memo(function AppStack({
  background,
  onboarded,
  primary,
}: {
  background: string;
  onboarded: boolean;
  primary: string;
}) {
  const { t: copy } = useUiTranslation();
  return (
    <Stack
      screenOptions={{
        freezeOnBlur: true,
        headerTransparent: true,
        headerShadowVisible: false,
        headerTintColor: primary,
      }}
    >
      <Stack.Protected guard={onboarded}>
        <Stack.Screen
          name="(tabs)"
          options={{ animation: 'fade', animationDuration: 450, headerShown: false }}
        />
        <Stack.Screen name="share" options={{ headerShown: false }} />
        <Stack.Screen
          name="blocked"
          options={{ headerShown: true, presentation: 'formSheet', title: copy("profile_blocked") }}
        />
        <Stack.Screen name="guide" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen
          name="community"
          options={{
            title: 'Leaderboard',
            presentation: 'modal',
            headerBackButtonDisplayMode: 'minimal',
            headerTransparent: false,
            headerStyle: { backgroundColor: background },
          }}
        />
        <Stack.Screen
          name="item/[id]"
          options={{
            // Transparent native header over the full-bleed hero; the screen
            // fills in the toolbar buttons (share/delete) once the item loads.
            title: '',
            headerBackButtonDisplayMode: 'minimal',
          }}
        />
        <Stack.Screen
          name="space/[id]"
          options={{
            title: '',
            headerBackButtonDisplayMode: 'minimal',
          }}
        />
        <Stack.Screen
          name="player/[id]"
          options={{
            // Pas de header natif : il se dessine par-dessus l'overlay de
            // carte, donc sa flèche doublait la croix de fermeture. Et le
            // masquer à l'ouverture faisait sauter le scroll — l'encart
            // automatique se recalcule quand la hauteur du header change.
            // L'écran dessine son propre retour, qui passe sous l'overlay.
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="map"
          options={{
            // En modal, pas en page poussée : on l'ouvre depuis la fiche d'une
            // carte pour aller voir UN point, puis on revient à la carte qu'on
            // était en train de lire. Une page dans la pile mettrait une flèche
            // de retour et ferait oublier d'où on vient ; le modal se referme
            // d'un glissement vers le bas et laisse la fiche derrière.
            presentation: 'modal',
            // Le geste de fermeture du modal reste actif, mais il ne suffit
            // pas : Mapbox pose son propre gestionnaire de panoramique sur
            // toute la vue, donc un glissement vers le bas déplace la carte au
            // lieu de la refermer. La croix de `map.tsx` est la vraie sortie.
            headerShown: false,
            contentStyle: { backgroundColor: '#100b04' },
          }}
        />
        <Stack.Screen
          name="add"
          options={{
            presentation: 'formSheet',
            headerShown: true,
            headerTransparent: false,
            headerStyle: { backgroundColor: background },
            sheetGrabberVisible: true,
            sheetAllowedDetents: 'fitToContents',
            contentStyle: { backgroundColor: background },
          }}
        />
        <Stack.Screen
          name="new-space"
          options={{
            presentation: 'formSheet',
            headerShown: false,
            sheetGrabberVisible: true,
            sheetAllowedDetents: 'fitToContents',
            contentStyle: { backgroundColor: background },
          }}
        />
        <Stack.Screen
          name="manage-spaces"
          options={{
            presentation: 'formSheet',
            headerShown: false,
            sheetGrabberVisible: true,
            sheetAllowedDetents: 'fitToContents',
            contentStyle: { backgroundColor: background },
          }}
        />
        <Stack.Screen
          name="profile"
          options={{
            presentation: 'formSheet',
            headerShown: false,
            sheetGrabberVisible: true,
            // Plus `fitToContents` : le profil fait maintenant une page pleine
            // (portrait, niveau, rangées, réglages), et « ajuste-toi au
            // contenu » sur un contenu plus haut que l'écran donne une feuille
            // qui déborde par le haut.
            sheetAllowedDetents: [1],
            contentStyle: { backgroundColor: background },
          }}
        />
        <Stack.Screen
          name="paywall"
          options={{
            // Plein écran, pas une feuille : une feuille laisse voir la carte
            // posée derrière et invite à balayer vers le bas plutôt qu'à lire
            // le prix. Le glissement de fermeture part avec elle — l'écran
            // dessine sa propre croix, seule sortie, toujours à l'écran.
            presentation: 'fullScreenModal',
            // Fondu plutôt que montée : la glissade verticale est le geste des
            // feuilles, et elle promet un écran qu'on renvoie d'un revers de
            // pouce. Le paywall se pose, il ne se présente pas.
            animation: 'fade',
            headerShown: false,
            // Le paywall vit sur la page crème comme les onglets, pas sur la
            // plaque sombre de la caméra et de la carte.
            contentStyle: { backgroundColor: background },
          }}
        />
        <Stack.Screen
          name="flappy-bird"
          options={{ presentation: 'fullScreenModal', headerShown: false }}
        />
        <Stack.Screen
          name="safari"
          options={{ presentation: 'modal', headerShown: true }}
        />
        <Stack.Screen
          name="expedition/[id]"
          options={{ presentation: 'fullScreenModal', headerShown: false }}
        />
        <Stack.Screen
          name="museum"
          options={{ title: copy("spaces_museum_title"), headerBackButtonDisplayMode: 'minimal' }}
        />
        <Stack.Screen
          name="wild-year"
          options={{ presentation: 'fullScreenModal', headerShown: false }}
        />
        <Stack.Screen
          name="book"
          options={{
            presentation: 'fullScreenModal',
            headerShown: false,
            contentStyle: { backgroundColor: background },
          }}
        />
      </Stack.Protected>
      {/* L'onboarding doit précéder la caméra parmi les routes disponibles.
          Quand `(tabs)` est protégé, Expo Router choisit la première route
          autorisée comme ancre : caméra en premier lançait une identification
          vide dès une installation neuve. */}
      <Stack.Protected guard={!onboarded}>
        <Stack.Screen
          name="onboarding"
          options={{ animation: 'fade', animationDuration: 450, headerShown: false }}
        />
      </Stack.Protected>
      {/* La même révélation sert à la vraie app ET au premier essai de
          l'onboarding. Elle reste hors du garde pour que ce dernier puisse la
          pousser après une photo. */}
      <Stack.Screen
        name="camera"
        options={{
          presentation: 'fullScreenModal',
          headerShown: false,
          contentStyle: { backgroundColor: background },
        }}
      />
    </Stack>
  );
});
