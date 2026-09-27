// LE PONT ENTRE L'APP ET SES WIDGETS.
//
// Une extension iOS est un BINAIRE SÉPARÉ. Elle ne partage ni la mémoire, ni
// MMKV, ni le cache TanStack, ni le bundle JS. Tout ce que le widget sait de
// l'utilisateur passe par un `UserDefaults` posé sur l'App Group — écrit ici,
// lu côté Swift par `UserDefaults(suiteName:)`.
//
// POURQUOI LE DRAPEAU PREMIUM DOIT ÊTRE ÉCRIT À CHAQUE CHANGEMENT
//
// Le widget ne peut pas interroger Supabase ni RevenueCat : pas de session, pas
// de jeton, pas de réseau à lui. Il ne connaît que ce qu'on a déposé. Si l'app
// oublie d'écrire après un achat, le widget reste verrouillé pour quelqu'un qui
// VIENT DE PAYER — le pire bug possible sur cette fonctionnalité, et il ne se
// voit pas depuis l'app.
//
// `usePremium` fait un OU sur trois sources (serveur, RevenueCat, local) : on
// recopie donc son résultat, jamais l'une des sources.

import { Platform } from 'react-native';

/** Le même groupe que l'extension de partage, déjà provisionné. */
const APP_GROUP = 'group.com.example.safaroll';

export const WIDGET_KEYS = {
  /** '1' ou '0'. Décide entre le deck et le cadenas. */
  premium: 'safaroll.premium',
  /** Chemin d'un PNG dans le conteneur partagé, ou '' si rien n'est prêt. */
  deckImage: 'safaroll.deckImage',
  /** Nom du deck épinglé, affiché sous la carte. */
  deckName: 'safaroll.deckName',
  /**
   * LES LIBELLÉS DU WIDGET, DANS LA LANGUE CHOISIE DANS L'APP.
   *
   * L'extension a ses propres `.lproj`, mais ils suivent la langue du SYSTÈME.
   * Or la préférence de langue de SafaRoll vit en MMKV, côté JavaScript, et
   * ne touche jamais le natif : quelqu'un qui force l'anglais sur un iPhone
   * français obtenait une app en anglais et un widget resté en français.
   *
   * L'app dépose donc ici les deux libellés DÉJÀ TRADUITS, et le widget les
   * préfère à ses propres chaînes quand ils existent. Les `.lproj` gardent
   * deux rôles qu'aucun App Group ne peut tenir : la galerie de widgets, lue
   * par iOS avant que l'extension ne tourne, et le tout premier lancement,
   * avant que l'app n'ait rien écrit.
   */
  cameraTitle: 'safaroll.widget.cameraTitle',
  cameraSubtitle: 'safaroll.widget.cameraSubtitle',
} as const;

// Chargé paresseusement : le module natif n'existe pas sur Android ni dans
// Expo Go, et un `import` sec ferait tomber le bundle entier au démarrage.
let stockage: { set: (k: string, v?: string) => void } | null = null;
let recharger: ((nom?: string) => void) | null = null;

if (Platform.OS === 'ios') {
  try {
    // Chargement paresseux volontaire : un `import` statique ferait tomber le
    // bundle sur Android et dans Expo Go, où le module natif n'existe pas.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ExtensionStorage } = require('@bacons/apple-targets') as {
      ExtensionStorage: {
        new (groupe: string): { set: (k: string, v?: string) => void };
        reloadWidget: (nom?: string) => void;
      };
    };
    stockage = new ExtensionStorage(APP_GROUP);
    recharger = ExtensionStorage.reloadWidget;
  } catch {
    // Pas de cible widget dans ce binaire : les widgets n'existent tout
    // simplement pas, il n'y a rien à signaler.
  }
}

/** Redessine les widgets. Sans cet appel, iOS garde son rendu précédent. */
export function reloadWidgets() {
  try {
    recharger?.();
  } catch {
    // Un widget qu'on ne peut pas rafraîchir n'est pas une raison de casser
    // l'écran qui a déclenché l'écriture.
  }
}

/** À appeler dès que le droit premium change, dans les DEUX sens. */
export function setWidgetPremium(premium: boolean) {
  if (!stockage) return;
  try {
    stockage.set(WIDGET_KEYS.premium, premium ? '1' : '0');
    reloadWidgets();
  } catch {
    // idem
  }
}

/** Le deck à afficher : une image déjà rendue, et son nom. */
export function setWidgetDeck(cheminImage: string | null, nom: string | null) {
  if (!stockage) return;
  try {
    stockage.set(WIDGET_KEYS.deckImage, cheminImage ?? '');
    stockage.set(WIDGET_KEYS.deckName, nom ?? '');
    reloadWidgets();
  } catch {
    // idem
  }
}

/** Recopie les libellés du widget caméra dans la langue courante de l'app. */
export function setWidgetLabels(title: string, subtitle: string) {
  if (!stockage) return;
  try {
    stockage.set(WIDGET_KEYS.cameraTitle, title);
    stockage.set(WIDGET_KEYS.cameraSubtitle, subtitle);
    reloadWidgets();
  } catch {
    // Un widget qu'on ne peut pas retraduire garde ses chaînes compilées, qui
    // sont justes dans la langue du système. Jamais une raison de lever.
  }
}
