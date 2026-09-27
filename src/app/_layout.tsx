import * as Sentry from '@sentry/react-native';
import '@/i18n';
import { garderLesFonctionsDistantes } from '@/lib/worklets-remote-function-fix';
import { OnboardingProvider } from '@/lib/onboarding';
import { SafaRollSplash } from '@/components/launch/safaroll-splash';
import { ForceUpdateGate } from '@/components/update/force-update-gate';
// Menu radial garé : réimporter RadialMenuProvider et restaurer son wrapper
// ci-dessous si cette interaction revient un jour.
// import { RadialMenuProvider } from '@/components/cards/card-radial-menu';
import { persister, queryClient } from '@/lib/query-client';
import { BackendAuthProvider, invalidateFamilies } from '@/lib/supabase/backend';
import { setSupabaseAccessTokenProvider, supabase } from '@/lib/supabase/client';
import { ClerkProvider, useSession, useUser } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { defaultShouldDehydrateQuery } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Image as ExpoImage } from 'expo-image';
import { DarkTheme, DefaultTheme, Slot, ThemeProvider, useRouter } from 'expo-router';
import { configureOneSignal, observeOneSignalNavigation, oneSignalLogin } from '@/lib/onesignal';
import { refreshNotificationPermission } from '@/lib/notifications';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useUnistyles } from 'react-native-unistyles';
import { KeyboardProvider } from 'react-native-keyboard-controller';

/**
 * UN PLAFOND SUR LE CACHE MÉMOIRE D'EXPO IMAGE.
 *
 * Par défaut il n'y en a AUCUN : `maxMemoryCost` et `maxMemoryCount` valent 0,
 * ce qui veut dire « pas de limite ». La collection est une grille virtualisée
 * de plusieurs milliers de cases, et chaque vignette décodée y reste. Le
 * téléphone chauffe, puis iOS tue l'app — sans que rien dans le code n'ait
 * fuité, juste parce qu'on n'a jamais dit stop.
 *
 * C'EST UN PLAFOND, PAS UN RÉGLAGE FIN. Trop serré, il rejetterait des
 * vignettes que la grille redemande au demi-tour — exactement le flash blanc
 * que `SceneImage` et `card-image` ont coûté cher à supprimer. La valeur est
 * donc large ; la resserrer demande de MESURER au profileur, pas de deviner.
 *
 * Le pendant Skia existe déjà : `card-image.ts` borne ses décodes à 64 Mo. Les
 * deux magasins sont indépendants et ne se voient pas.
 */
try {
  ExpoImage.configureCache({
    maxMemoryCost: 192 * 1024 * 1024,
    maxMemoryCount: 400,
  });
} catch {
  // Un plafond qu'on ne sait pas poser ne doit pas empêcher l'app de démarrer :
  // ce fichier est la racine du routeur, tout ce qui lève ici tombe l'app
  // entière. Sans plafond on revient au comportement d'avant, rien de plus.
}

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

void SplashScreen.preventAutoHideAsync();

if (!publishableKey) {
  throw new Error('Add your Clerk Publishable Key to the .env file');
}

// Single source of truth for the native route background. The navigator paints
// every screen's container with the navigation theme's `background`, so setting
// it here — instead of a `contentStyle` on each screen — themes all nested
// stacks at once and paints the screen container before JS content mounts (no
// white flash on push / zoom transitions). `useColorScheme` is the reliable
// system-appearance signal; the palette comes from Unistyles.
/**
 * OneSignal s'arme À LA RACINE, pas dans `(app)`.
 *
 * Il y était, et c'était un trou : `(app)/_layout` ne monte que si Clerk a fini
 * de charger ET que le joueur est connecté. Quelqu'un qui installe l'app et ne
 * se connecte pas n'aurait jamais été abonné — c'est-à-dire précisément la
 * personne qu'un rappel doit aller chercher. L'abonnement de l'appareil ne
 * dépend d'aucune session. L'identité reste ici pour traiter aussi le logout,
 * tandis que les tags liés aux captures restent dans `(app)`.
 *
 * Le composant vit sous `<Slot />`, dans l'arbre du routeur, parce que le clic
 * navigue. Il ne rend rien.
 */
function OneSignalBridge() {
  const router = useRouter();
  const { isLoaded, user } = useUser();
  const userId = user?.id;
  // Reste monté après la déconnexion ; avant les effets de tags des écrans.
  useLayoutEffect(() => {
    configureOneSignal();
    if (!isLoaded) return;
    oneSignalLogin(userId);
    if (userId) void refreshNotificationPermission();
  }, [isLoaded, userId]);
  useEffect(() => {
    return observeOneSignalNavigation((url) => router.push(url as never));
  }, [router]);
  return null;
}

function NavThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const { theme } = useUnistyles();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;

  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: theme.colors.background,
      card: theme.colors.background,
      text: theme.colors.foreground,
      border: theme.colors.border,
      primary: theme.colors.primary,
    },
  };

  // Keep the native root view / window (behind the routes: launch, overscroll
  // bounce, transparent sheets) in sync with the theme too.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.background);
  }, [theme.colors.background]);

  return <ThemeProvider value={navTheme}>{children}</ThemeProvider>;
}

/**
 * CE QU'UN ÉVÉNEMENT REALTIME A LE DROIT DE PÉRIMER.
 *
 * C'était `queryClient.invalidateQueries()` — sans filtre — pour chacune de ces
 * tables. Un like de N'IMPORTE QUI faisait refetcher à CHAQUE appareil en ligne
 * la totalité de ses requêtes actives, catalogue de 5 576 espèces compris :
 * c'est à la fois le gel qu'on sentait en parcourant la collection et, à mille
 * joueurs, une tempête de refetch en N² sur le backend.
 *
 * Chaque table ne périme plus que les familles qu'elle nourrit, et jamais le
 * catalogue ni les saisons — ils ne changent qu'aux imports serveur.
 */
const REALTIME_SCOPES: Record<string, string[]> = {
  deck_cards: ['decks.'],
  deck_likes: ['decks.'],
  decks: ['decks.'],
  expeditions: ['expeditions.'],
  items: ['items.', 'spaces.'],
  profiles: ['community.', 'profile.'],
  space_items: ['spaces.', 'items.'],
  spaces: ['spaces.', 'items.'],
};

/**
 * Une rafale (réordonner un deck écrit une ligne par carte) ne doit compter
 * que pour une : chaque table attend 1,5 s de silence avant d'invalider.
 */
const realtimeTimers = new Map<string, ReturnType<typeof setTimeout>>();
function invalidateForTable(table: string) {
  const held = realtimeTimers.get(table);
  if (held) clearTimeout(held);
  realtimeTimers.set(
    table,
    setTimeout(() => {
      realtimeTimers.delete(table);
      void invalidateFamilies(REALTIME_SCOPES[table] ?? []);
    }, 1500),
  );
}

function SupabaseClerkBridge({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const { user } = useUser();
  const [bridgeError, setBridgeError] = useState<Error | null>(null);
  const getToken = useCallback(() => session?.getToken() ?? Promise.resolve(null), [session]);

  // Child queries start in passive effects. Install their token source in the
  // preceding layout phase, without blanking the whole tree for an extra
  // render whenever Clerk refreshes the session.
  useLayoutEffect(() => {
    setSupabaseAccessTokenProvider(getToken);
  }, [getToken]);

  useEffect(() => {
    let channel = supabase.channel('app-data');
    for (const table of Object.keys(REALTIME_SCOPES)) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => invalidateForTable(table),
      );
    }

    let cancelled = false;
    /**
     * A Clerk token can reach Postgres before it is valid.
     *
     * Clerk stamps `nbf` from the DEVICE clock and PostgREST checks it against
     * the SERVER clock, with no leeway. A phone a couple of seconds ahead mints
     * a token from the future, and the very first query comes back
     * `JWT not yet valid` — which used to throw straight out of this bridge and
     * take the whole app down to an error screen, permanently, for a condition
     * that fixes itself in a second.
     *
     * So: wait out the skew rather than die of it. Anything else still throws.
     */
    const isNotYetValid = (error: unknown) =>
      error instanceof Error && /not yet valid|JWSError|JWTIssuedAtFuture/i.test(error.message);

    void (async () => {
      try {
        const token = await getToken();
        if (token && !user) return;
        if (token && user) {
          const emailName = user.primaryEmailAddress?.emailAddress.split('@')[0];
          const displayName = (user.fullName || user.username || emailName || 'Explorer').slice(0, 40);
          const username = user.username && user.username.length >= 2 ? user.username.slice(0, 32) : null;
          const avatarUrl = user.imageUrl?.slice(0, 2048) || null;
          const upsertProfile = async () => {
            // Lire avant d'écrire : un upsert inconditionnel à chaque
            // lancement diffusait un événement `profiles` en realtime à tous
            // les appareils en ligne — qui invalidaient chacun leurs requêtes
            // communauté pour un profil qui n'avait pas bougé.
            const { data: held, error: readError } = await supabase
              .from('profiles')
              .select('display_name, username, avatar_url')
              .eq('user_id', user.id)
              .maybeSingle();
            if (!readError && held && held.display_name === displayName
              && held.username === username && held.avatar_url === avatarUrl) {
              return { error: null };
            }
            return supabase.from('profiles').upsert({
              user_id: user.id,
              display_name: displayName,
              username,
              avatar_url: avatarUrl,
            }, { onConflict: 'user_id' });
          };

          let { error } = await upsertProfile();
          // Two seconds, then five: past any plausible phone-vs-server skew,
          // and short enough that a real failure is still reported promptly.
          for (const delay of [2000, 5000]) {
            if (!error || !isNotYetValid(new Error(error.message))) break;
            await new Promise((resolve) => setTimeout(resolve, delay));
            if (cancelled) return;
            ({ error } = await upsertProfile());
          }
          if (error) throw new Error(error.message);
          await supabase.realtime.setAuth(token);
          channel.subscribe();
        }
        if (!cancelled) setBridgeError(null);
      } catch (error) {
        if (!cancelled) {
          setBridgeError(error instanceof Error ? error : new Error('Supabase initialization failed'));
        }
      }
    })();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [getToken, user]);

  if (bridgeError) throw bridgeError;
  return children;
}

// SAFAROLL-7 : empêche `~RNOriginProxy` d'effacer des fonctions distantes
// encore utilisées. Voir le fichier pour le détail du bug worklets 0.10.0.
garderLesFonctionsDistantes();


function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
      <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
        <BackendAuthProvider>
          <SupabaseClerkBridge>
            <PersistQueryClientProvider
            client={queryClient}
            // `buster` monte à v4 : les installs existantes gardent en MMKV un
            // catalogue tronqué à 1000 espèces (le plafond `max_rows` que
            // `catalog.listAll` contournait mal — voir `backend.ts`). Sans ce
            // coup de balai, ce cache resterait servi jusqu'à 24 h, et la
            // correction serait invisible sur exactement les appareils qui en
            // ont besoin.
            persistOptions={{
              persister,
              maxAge: 1000 * 60 * 60 * 24,
              buster: 'supabase-v4',
              // Le catalogue a son propre tiroir MMKV (voir `backend.ts`) : le
              // laisser ici ferait resérialiser ses ~3 Mo à chaque frappe du
              // persister, pour des données qui ne changent qu'une fois par jour.
              dehydrateOptions: {
                shouldDehydrateQuery: (query) =>
                  defaultShouldDehydrateQuery(query) && query.queryKey[1] !== 'catalog.listAll',
              },
            }}
          >
            <OnboardingProvider>
              <NavThemeProvider>
                {/* Menu radial garé : <RadialMenuProvider> enveloppait ce bloc. */}
                {/* Les notifications ne vivent plus dans l'arbre : Burnt les
                    pose dans sa propre fenêtre UIKit, au-dessus des modales.
                    Voir `@/lib/notify`. */}
                <SafaRollSplash>
                  <ForceUpdateGate>
                    <Slot />
                    <OneSignalBridge />
                    <StatusBar style="auto" />
                  </ForceUpdateGate>
                </SafaRollSplash>
              </NavThemeProvider>
            </OnboardingProvider>
            </PersistQueryClientProvider>
          </SupabaseClerkBridge>
        </BackendAuthProvider>
      </ClerkProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

/**
 * `Sentry.wrap` autour de la racine — l'assistant l'a réclamé deux fois sans
 * pouvoir le poser lui-même : il cherche un `App.js`, et expo-router n'en a pas.
 *
 * Ce n'est pas décoratif. L'enveloppe pose la frontière d'erreur qui attrape ce
 * qui casse pendant le RENDU d'un composant — la classe de plantage la plus
 * fréquente et la seule qu'un `Sentry.init()` seul ne voit pas. Elle branche
 * aussi le suivi de navigation, donc un rapport dit sur quel écran on était.
 */
export default Sentry.wrap(RootLayout);
