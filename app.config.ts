import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'SafaRoll',
  slug: 'safaroll',
  scheme: 'safaroll',
  version: '1.0.1',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#faf6ee',
  ios: {
    supportsTablet: false,
    // Pose l'entitlement `com.apple.developer.applesignin`, sans lequel
    // `expo-apple-authentication` ne peut pas ouvrir la feuille native : c'est
    // lui qui autorise le binaire à parler à AuthenticationServices.
    //
    // NÉCESSITE UN REBUILD NATIF. Un entitlement est signé dans le binaire, pas
    // servi par Metro — le dev client actuel ne l'a pas et lèvera
    // « Apple Authentication is not available on this device ».
    usesAppleSignIn: true,
    // CES CHAÎNES SONT LE REPLI, PAS LA VÉRITÉ.
    //
    // `locales` plus bas fournit une version par langue ; ce bloc n'est lu que
    // pour une langue qu'on ne livre pas. Il est donc en ANGLAIS, comme
    // `CFBundleDevelopmentRegion` — les écrire en français ici ferait tomber un
    // Allemand ou un Espagnol sur des dialogues français.
    infoPlist: {
      NSCameraUsageDescription:
        'SafaRoll uses the camera to photograph the animals you meet.',
      NSMicrophoneUsageDescription:
        'SafaRoll listens locally for nearby wildlife sounds when you enable Wild Listening.',
      NSPhotoLibraryUsageDescription:
        'SafaRoll opens your photo library only when you choose to import a picture.',
      NSPhotoLibraryAddUsageDescription:
        'SafaRoll saves an image to your Photos when you ask it to.',
      CFBundleLocalizations: ['en', 'fr'],
      CFBundleDevelopmentRegion: 'en',
      ITSAppUsesNonExemptEncryption: false,
      // L'EXPÉDITION VIT SUR L'ÉCRAN VERROUILLÉ.
      //
      // Sans ce drapeau, ActivityKit refuse silencieusement de démarrer :
      // l'appel réussit, rien ne s'affiche. Il autorise l'app à porter une
      // Live Activity ; la déclaration du rendu vit dans l'extension widget
      // (`targets/widget/ExpeditionActivity.swift`).
      NSSupportsLiveActivities: true,
      // Une sortie d'une heure met à jour à chaque capture — bien plus que le
      // budget parcimonieux d'iOS. Ce second drapeau demande la cadence
      // fréquente ; sans lui, le système finit par ignorer nos mises à jour.
      NSSupportsLiveActivitiesFrequentUpdates: true,
    },
    bundleIdentifier: 'com.example.safaroll',
    appleTeamId: process.env.APPLE_TEAM_ID ?? 'YOUR_APPLE_TEAM_ID',
  },
  android: {
    // Déclaré alors que la v1 est iOS-only : `prebuild` génère les deux
    // plateformes par défaut et refuse d'écrire dans une config dynamique,
    // donc son absence bloque un `--clean` au lieu de simplement sauter
    // Android. Même identifiant que le bundle iOS.
    package: 'com.example.safaroll',
    adaptiveIcon: {
      backgroundColor: '#FAF6EE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: [
      'android.permission.CAMERA',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_CALENDAR',
      'android.permission.WRITE_CALENDAR',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_VISUAL_USER_SELECTED',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_AUDIO',
    ],
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    // PREMIER DU TABLEAU, exigence documentée du plugin : il ajoute la cible
    // Notification Service Extension et doit passer avant tout plugin qui
    // touche le projet Xcode, sinon erreurs de headers au prebuild.
    // `mode` pilote l'entitlement `aps-environment` ; EAS pose
    // NODE_ENV=production sur les builds de prod.
    [
      'onesignal-expo-plugin',
      {
        mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
        // ON RÉUTILISE L'APP GROUP EXISTANT, ON N'EN CRÉE PAS UN.
        //
        // Par défaut le plugin invente `group.<bundleId>.onesignal`. Cet
        // identifiant n'existe pas chez Apple, donc le profil de
        // provisionnement ne le porte pas et la signature échoue sur les DEUX
        // cibles — « doesn't support the group... App Group ». Il faudrait
        // l'enregistrer au portail puis régénérer les profils.
        //
        // `group.com.example.safaroll` est déjà provisionné et déjà partagé par le
        // widget et l'extension de partage. Un App Group peut servir à
        // plusieurs extensions : rien à provisionner, un identifiant de moins
        // à maintenir.
        appGroupName: 'group.com.example.safaroll',
        // NSE RALLUMÉE — LE BLOCAGE EST LEVÉ.
        //
        // Elle avait été coupée parce qu'Apple n'avait pas d'App ID explicite
        // pour `com.example.safaroll.OneSignalNotificationServiceExtension` :
        // Xcode retombait sur un profil JOKER, qui par règle Apple ne peut
        // jamais porter d'App Group, et la signature échouait sur cette cible
        // seule.
        //
        // Vérifié le 2026-09-01 : l'App ID existe (GZ7ACN4RXM) et porte bien
        // la capacité APP_GROUPS. Le profil n'est donc plus un joker.
        //
        // CE QU'ELLE REND POSSIBLE, et les trois comptent :
        //   · les IMAGES dans les notifications — montrer l'animal dont on
        //     parle plutôt que d'en écrire le nom ;
        //   · le badge ;
        //   · les « confirmed deliveries » — savoir qu'un message est ARRIVÉ,
        //     et pas seulement qu'il est parti.
        //
        // Si la signature retombe en échec sur cette cible, remettre `true` :
        // le push, les Journeys, les tags et la Live Activity n'en dépendent
        // pas, on ne perdrait que ces trois-là.
        disableNSE: false,
        // PAS DE `liveActivities` ICI, ET C'EST UNE CONTRAINTE SUBIE.
        //
        // Le plugin sait fabriquer sa propre cible Live Activity. Essayé :
        // `@bacons/apple-targets`, qui tourne ensuite, cherche SA cible par
        // nom de produit et, quand il ne la trouve pas encore, retombe sur
        // `targets[0]` — c'est-à-dire une cible OneSignal — puis tente de
        // réécrire sa liste de configurations. Le prebuild meurt sur
        // « Cannot read properties of undefined (reading 'removeFromProject') ».
        //
        // Avec la seule NSE, le hasard de l'ordre le sauvait. Une DEUXIÈME
        // cible OneSignal a fait tomber la pièce du mauvais côté.
        //
        // La Live Activity vit donc dans la cible widget existante, avec
        // `./plugins/with-widget-live-activities` pour lier le sous-pod.
      },
    ],
    // Sans lui, `Pods.xcodeproj` sort sans objet projet — la dépendance Swift
    // Package de Clerk vole l'identifiant du projet — et Xcode déclare « The
    // project 'Pods' is damaged ». Les erreurs affichées désignent alors un
    // xcconfig, un modulemap ou un symbole rnmapbox, jamais la cause. Le
    // déclencheur est l'ajout de n'importe quelle dépendance native.
    './plugins/with-pods-uuid-collision-fix',
    // Le sous-spec Live Activities sur la cible widget. Doit passer APRÈS le
    // correctif d'UUID : celui-ci réécrit `Pods.xcodeproj`, et un bloc pod
    // ajouté avant serait résolu sur un projet que l'autre va reconstruire.
    './plugins/with-widget-live-activities',
    // APRÈS le plugin OneSignal, qui vient de poser l'App Group sur la NSE.
    './plugins/with-nse-no-app-group',
    [
      'expo-font',
      {
        fonts: [
          './assets/fonts/ExposureTrial-0.otf',
          './assets/fonts/Satoshi-Regular.otf',
          './assets/fonts/Satoshi-Medium.otf',
          './assets/fonts/Satoshi-Bold.otf',
          './assets/fonts/delete-icon.ttf',
        ],
        android: {
          fonts: [
            {
              fontFamily: 'Baloo2-ExtraBold',
              fontDefinitions: [
                {
                  path: './node_modules/@expo-google-fonts/baloo-2/800ExtraBold/Baloo2_800ExtraBold.ttf',
                  weight: 800,
                },
              ],
            },
          ],
        },
        ios: {
          fonts: [
            './node_modules/@expo-google-fonts/baloo-2/800ExtraBold/Baloo2_800ExtraBold.ttf',
          ],
        },
      },
    ],
    'expo-image',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#e6dfc4',
        image: './assets/splash/safaroll-face-open.png',
        imageWidth: 230,
        resizeMode: 'contain',
        dark: {
          backgroundColor: '#e6dfc4',
          image: './assets/splash/safaroll-face-open.png',
        },
      },
    ],
    // Les sons de SafaRoll ne nécessitent pas de lecture en arrière-plan.
    ['react-native-audio-api', { iosBackgroundMode: false }],
    'expo-router',
    'expo-status-bar',
    [
      'expo-notifications',
      {
        color: '#E3A93C',
        defaultChannel: 'safaroll-reminders',
      },
    ],
    '@clerk/expo',
    'expo-secure-store',
    'expo-web-browser',
    [
      'expo-location',
      {
        // CE QUE CETTE CHAÎNE PROMET DOIT ÊTRE VRAI.
        //
        // Elle disait « améliorer l'identification et estimer la fréquence
        // d'observation locale ». Le reclassement par la position a été COUPÉ
        // (voir `services/animal-id/modal_app.py` : mesuré, il dégradait la
        // réponse). La position ne sert donc plus qu'à poser la capture sur la
        // carte — et une chaîne de permission qui décrit une fonctionnalité
        // retirée est une fausse déclaration, relue à chaque revue Apple.
        locationWhenInUsePermission:
          'SafaRoll records where each capture was made, to place it on your world map. You can continue without: identification does not change.',
      },
    ],
    [
      'expo-calendar',
      {
        calendarPermission:
          'SafaRoll accède au calendrier uniquement lorsque tu demandes d’ajouter un événement.',
      },
    ],
    [
      'expo-media-library',
      {
        photosPermission:
          'SafaRoll opens your photo library only when you choose a picture.',
        savePhotosPermission:
          'SafaRoll saves an image to your Photos when you ask it to.',
      },
    ],
    [
      'expo-sharing',
      {
        ios: {
          enabled: true,
          appGroupId: 'group.com.example.safaroll',
          activationRule: {
            supportsImageWithMaxCount: 10,
            supportsWebUrlWithMaxCount: 1,
            supportsText: true,
          },
        },
        android: {
          enabled: true,
          singleShareMimeTypes: ['image/*', 'text/*'],
          multipleShareMimeTypes: ['image/*'],
        },
      },
    ],
    'expo-quick-actions',
    // LA CIBLE WIDGET, DÉCRITE DANS `targets/widget/`.
    //
    // Ce plugin lit ce dossier au prebuild et fabrique l'extension Xcode :
    // Swift, Info.plist, entitlements, catalogue d'assets. Rien n'est écrit à
    // la main dans `ios/`, qui reste jetable.
    //
    // Le pont app ↔ widget est l'App Group `group.com.example.safaroll`, déjà posé sur
    // l'app principale par le plugin `expo-sharing` : une extension est un
    // binaire séparé, elle ne voit ni la mémoire ni le bundle JS de l'app.
    '@bacons/apple-targets',
    // LES ICÔNES ALTERNATIVES, RÉSERVÉES À SAFAROLL+.
    //
    // PNG et pas Icon Composer : Apple ne supporte PAS les fichiers `.icon`
    // pour les icônes alternatives (`CFBundleAlternateIcons`) — rapport
    // FB18233873, toujours ouvert. Icon Composer ne vaut que pour l'icône
    // principale. Les trois PNG sont des variantes de la mascotte SafaRoll.
    //
    // Les clés historiques restent celles passées à `setIcon()` afin qu'une
    // préférence déjà enregistrée continue de fonctionner. Les noms visibles
    // sont Pirate, Photographe et Naturaliste.
    //
    // CECI EXIGE UN REBUILD NATIF : le catalogue d'assets et
    // `CFBundleAlternateIcons` sont signés dans le binaire, Metro ne les sert pas.
    [
      'expo-quick-actions/icon/plugin',
      {
        epique: { image: './assets/icons/epique.png' },
        mythique: { image: './assets/icons/mythique.png' },
        rare: { image: './assets/icons/rare.png' },
      },
    ],
    [
      'expo-updates',
      {
        username: 'your-expo-account',
      },
    ],
    'expo-maps',
    ['@rnmapbox/maps', { RNMapboxMapsImpl: 'mapbox' }],
    'expo-localization',
    [
      '@sentry/react-native/expo',
      {
        organization: 'ams-12',
        project: 'safaroll',
        // L'INIT NATIF NE S'ARME QUE S'IL A SON DSN, ET C'EST VITAL.
        //
        // `useNativeInit` fait injecter `RNSentrySDK.start()` dans
        // l'AppDelegate. Ce démarrage lit son DSN dans `sentry.options.json`,
        // que ce plugin écrit à partir des options ci-dessous — PAS depuis
        // `process.env`, contrairement à `Sentry.init()` côté JS (voir
        // `index.ts`).
        //
        // Sans `dsn` ici, le SDK natif démarrait donc à vide :
        //
        //   [Sentry] Failed to initialize SentryOptions: Invalid DSN URL
        //   [Sentry] [fatal] Failed to create Sentry SDK working directory: (null)
        //   App terminated due to signal 11.
        //
        // Soit un SIGSEGV au lancement, AVANT le moindre écran — et sans
        // rapport de plantage, puisque c'est le rapporteur lui-même qui mourait.
        // Le défaut est resté invisible jusqu'à ce qu'un `expo prebuild`
        // régénère `ios/` et réinjecte cet appel.
        //
        // D'où la garde : pas de DSN, pas d'init natif. On perd la capture des
        // plantages de démarrage, on ne perd pas l'application.
        // `options` EST UN SOUS-OBJET, ET LE PLUGIN NE LIT QUE LUI.
        //
        //   const pluginOptions = props?.options ? { ...props.options } : {};
        //
        // Un `dsn` posé à la racine des props est donc ignoré en silence :
        // `sentry.options.json` n'est même pas écrit, et l'init natif redémarre
        // à vide. `useNativeInit`, lui, se lit bien à la racine.
        ...(process.env.EXPO_PUBLIC_SENTRY_DSN
          ? {
              options: { dsn: process.env.EXPO_PUBLIC_SENTRY_DSN },
              useNativeInit: true,
            }
          : {}),
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    tsconfigPaths: true,
  },
  /**
   * LES MISES À JOUR SANS PASSER PAR APPLE.
   *
   * Tout ce qui est JavaScript — un texte, une couleur, un drapeau de
   * lancement, une garde d'abonnement — part en quelques minutes au lieu de
   * deux jours de revue. Ce qui touche au natif (subject-lift, VisionCamera,
   * le flash) exige toujours un vrai build : c'est exactement ce que
   * `runtimeVersion` protège.
   *
   * POURQUOI `fingerprint` ET PAS `appVersion`
   *
   * `appVersion` lie la compatibilité au numéro de version, donc à une
   * discipline humaine : oublier de l'incrémenter après avoir touché un module
   * natif envoie du JS qui appelle une API absente du binaire installé. Le
   * plantage arrive alors chez l'utilisateur, à distance, sans rollback
   * possible côté client.
   *
   * `fingerprint` calcule une empreinte du natif : le canal se sépare tout
   * seul dès qu'une dépendance native bouge, sans que personne ait à y penser.
   *
   * `fallbackToCacheTimeout: 0` — on ne bloque jamais le lancement pour
   * attendre une mise à jour. Elle se télécharge en fond et s'applique au
   * lancement suivant. Une app qui met deux secondes à ouvrir parce qu'un
   * serveur répond lentement, c'est un joueur qui rate l'animal.
   */
  runtimeVersion: {
    policy: 'fingerprint',
  },
  updates: {
    url: 'https://u.expo.dev/YOUR_EAS_PROJECT_ID',
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,
  },
  /**
   * LES CHAÎNES NATIVES, PAR LANGUE.
   *
   * Ce sont les dialogues de permission d'iOS et le nom sous l'icône — rien à
   * voir avec `src/locales`, qui traduit l'interface. Ceux-là sont lus par le
   * SYSTÈME, avant même que le JavaScript ne démarre, donc `i18next` ne peut
   * rien pour eux.
   *
   * Sans ce bloc, un anglophone lisait « SafaRoll utilise la caméra pour
   * photographier les animaux que tu rencontres » dans la boîte d'iOS.
   */
  locales: {
    en: './locales/en.json',
    fr: './locales/fr.json',
  },
  extra: {
    router: {},
    eas: {
      projectId: 'YOUR_EAS_PROJECT_ID',
    },
  },
  owner: 'your-expo-account',
});
