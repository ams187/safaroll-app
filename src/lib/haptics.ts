// LE RETOUR HAPTIQUE PARTAGÉ.
//
// POURQUOI UN MODULE À PART
//
// `reveal-haptics.ts` porte le vocabulaire de LA RÉVÉLATION — le tremblement
// qui monte, l'impact selon la rareté. Le chargement prudent de Pulsar, lui,
// n'appartient pas à la révélation : il vaut pour tout l'app. Il vit donc ici,
// et la révélation le lit comme les autres.
//
// LE `require` EST GARDÉ, ET CE N'EST PAS DE LA PRUDENCE DÉCORATIVE
//
// `NativeRNPulsar` appelle `getEnforcing` au chargement du module : sur un
// client de développement où le natif n'est pas encore relié, l'import LÈVE —
// à l'import, pas à la première vibration. Sans ce garde, l'app ne démarre
// plus après un simple `git pull`.
import * as Haptics from 'expo-haptics';

// LE TYPE EST RECOPIÉ DE `react-native-pulsar/lib/typescript/src/Presets.d.ts`,
// PAS ÉCRIT DE MÉMOIRE.
//
// Il l'avait été, avec `system` en minuscule. `Presets.system` valant
// `undefined`, l'appel levait — et le `catch` qui protège l'haptique avalait
// l'erreur. Résultat : aucune vibration, aucun message, rien à quoi se
// raccrocher. Un garde qui masque une faute de frappe coûte plus qu'il ne
// protège ; d'où les noms vérifiés dans le paquet.
type Presets = Record<string, () => void> & {
  System: {
    impactHeavy: () => void;
    impactLight: () => void;
    impactMedium: () => void;
    impactRigid: () => void;
    impactSoft: () => void;
    notificationError: () => void;
    notificationSuccess: () => void;
    notificationWarning: () => void;
    selection: () => void;
  };
};

type Module = {
  Presets: Presets;
  useRealtimeComposer: () => {
    set: (amplitude: number, frequency: number, startIfNeeded?: boolean) => void;
    start: () => void;
    stop: () => void;
  };
};

let charge: Module | null = null;
try {
  charge = require('react-native-pulsar') as Module;
} catch {
  charge = null;
}

/** Le module, ou `null` sur un binaire qui ne l'a pas encore. */
export const pulsar = charge;


/**
 * LE PLUS PETIT RETOUR POSSIBLE — pour une sélection, et rien d'autre.
 *
 * C'est le seul geste répété de l'onboarding : trois écrans de questions, une
 * dizaine de touches. Tout ce qui est plus lourd que ça y devient du bruit au
 * troisième tap.
 */
export function toucheLegere() {
  try {
    // `System.selection` est le tick de sélection d'iOS lui-même, pas un
    // impact léger qui lui ressemble.
    if (pulsar) pulsar.Presets.System.selection();
    else void Haptics.selectionAsync().catch(() => undefined);
  } catch {
    // Le retour haptique est un assaisonnement, jamais une panne.
  }
}

/** Une brève retombée : quelque chose vient de se poser. */
export function claquement() {
  try {
    if (pulsar) pulsar.Presets.snap();
    else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  } catch {
    // idem
  }
}

/** Une éclosion douce : quelque chose vient d'aboutir. Rare, par construction. */
export function eclosion() {
  try {
    if (pulsar) pulsar.Presets.bloom();
    else void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  } catch {
    // idem
  }
}

/**
 * LE CRAN D'UNE ROUE — un déclic par carte qui passe devant soi.
 *
 * POURQUOI UN ÉTRANGLEMENT
 *
 * Le cran se déclenche au PASSAGE, pas à l'arrêt : c'est ce qui donne à la
 * roue son poids. Mais une projection rapide traverse une dizaine de cartes en
 * quelques dixièmes de seconde, et dix impulsions dans ce laps ne se sentent
 * plus comme des crans — elles se sentent comme un défaut. Quarante-cinq
 * millisecondes est le plancher sous lequel la main cesse de compter.
 */
let dernierCran = 0;
export function crantRoue() {
  const maintenant = Date.now();
  if (maintenant - dernierCran < 45) return;
  dernierCran = maintenant;
  toucheLegere();
}
