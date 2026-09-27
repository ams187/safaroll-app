// Unistyles doit être la première dépendance évaluée : les routes créent leurs
// styles au chargement du module, avant même le premier rendu.
import './src/unistyles';
// Sentry reste la première initialisation applicative après le thème.
//
// L'ESSENTIEL SE PASSE AVANT CE FICHIER
//
// `useNativeInit` (app.config.ts) arme le rapport de plantage côté NATIF, avant
// que le bundle JS ne soit évalué. C'est ce qui attrape les plantages de
// lancement — module natif manquant, bundle corrompu — que cet appel-ci, lui,
// serait bien incapable de voir puisqu'il n'aurait pas encore tourné.
//
// POURQUOI CE BLOC EXISTE ALORS QUE L'ASSISTANT SENTRY EST PASSÉ
//
// L'assistant n'a pas trouvé où l'écrire : il cherche `App.js` ou un composant
// racine classique, or expo-router n'en a pas — l'entrée est `expo-router/entry`
// et la racine est `src/app/_layout.tsx`. Il a affiché « Could not find main App
// file » puis est passé à la suite. D'où ce fichier, écrit à la main.
//
// LE DSN VIENT DE L'ENVIRONNEMENT
//
// Il vit dans `.env.local`, qui est ignoré par git. Sans lui, on n'initialise
// pas : un `Sentry.init({ dsn: undefined })` s'exécute sans rien dire et laisse
// croire que la télémétrie tourne alors que rien ne part.
import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    // On envoie AUSSI depuis le développement, et on étiquette. Couper en dev
    // paraît propre jusqu'au jour où l'on doit vérifier que la remontée marche
    // et qu'on n'a aucun moyen de le faire. L'étiquette permet de filtrer côté
    // Sentry, ce qu'un interrupteur ne permet pas.
    environment: __DEV__ ? 'development' : 'production',
    // Adresse IP, identifiants utilisateur. Choisi dans l'assistant ; à passer
    // à `false` si tu préfères ne rien collecter de nominatif.
    sendDefaultPii: true,
    enableLogs: true,
    // Session Replay parcourt puis photographie toute la hiérarchie native.
    // Sur la collection, Instruments mesure 265–364 ms de blocage du thread
    // principal par capture. Le reporting d'erreurs reste actif ; seul le film
    // de l'écran, incompatible avec un scroll sans accroc, est désactivé.
    integrations: [Sentry.feedbackIntegration()],
    // Les traces de performance coûtent cher et ne servent à rien tant qu'on
    // n'a pas de plantages à corréler.
    tracesSampleRate: 0,
  });
}

// Même chemin réseau natif que Yaqin : tout ce qui est chargé après ce bloc
// (Supabase, Clerk, les Edge Functions, etc.) récupère Cronet/URLSession au lieu
// du fetch React Native. Sentry reste volontairement premier afin de capturer
// une éventuelle erreur d'initialisation du module natif.
/* eslint-disable @typescript-eslint/no-require-imports -- l'ordre d'exécution est le contrat de cette entrée */
const {
  fetch: nitroFetch,
  Headers: NitroHeaders,
  NetworkInspector: NitroNetworkInspector,
  Request: NitroRequest,
  Response: NitroResponse,
} = require('react-native-nitro-fetch') as typeof import('react-native-nitro-fetch');

if (__DEV__) {
  // Corps coupés à zéro : on mesure latence/statut/taille sans garder les
  // photos, prompts ou réponses du Guide dans un second journal en mémoire.
  NitroNetworkInspector.enable({ maxEntries: 200, maxBodyCapture: 0 });
  NitroNetworkInspector.onEntry((entry) => {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (entry.type !== 'http' || entry.duration <= 0 || !supabaseUrl || !entry.url.startsWith(supabaseUrl)) return;
    if (!entry.error && entry.status < 400 && entry.duration < 250) return;
    const path = new URL(entry.url).pathname;
    console.log(`[Supabase] ${entry.method} ${path} → ${entry.status || 'ERREUR'} · ${Math.round(entry.duration)} ms · ${entry.responseBodySize} o`);
  });
}

// CLERK GARDE LE `fetch` DE REACT NATIVE, ET C'EST UNE EXCEPTION MESURÉE.
//
// Avec le fetch natif partout, `clerk-js` tombe au premier appel :
//
//   [ClerkProvider] Failed to sync native client state:
//   ClerkJS: Network error at "https://clerk.safaroll.com/v1/environment…"
//   TypeError: Cannot read property 'startsWith' of undefined
//
// Et une session Clerk qui ne se charge pas, c'est l'écran blanc : la garde
// `!isLoaded` de `(app)/_layout.tsx` attend quelque chose qui n'arrive jamais.
//
// L'exception est étroite EXPRÈS. Supabase, le Storage, les Edge Functions et
// Modal — tout ce qui porte le temps de chargement — passent toujours par
// Cronet/URLSession. Seul l'hôte d'authentification revient au chemin JS, et il
// ne sert que quelques appels au démarrage.
const rnFetch = globalThis.fetch;
const nitroSauf = ((input: RequestInfo | URL, init?: RequestInit) => {
  const cible =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : ((input as Request | undefined)?.url ?? '');
  return cible.includes('clerk.') ? rnFetch(input as RequestInfo, init) : nitroFetch(input, init);
}) as typeof globalThis.fetch;

Object.assign(globalThis, {
  fetch: nitroSauf,
  Headers: NitroHeaders,
  Request: NitroRequest,
  Response: NitroResponse,
});

require('expo-router/entry');
/* eslint-enable @typescript-eslint/no-require-imports */
