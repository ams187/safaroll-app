import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';
import { Platform } from 'react-native';

import {
  withCaptureQualityDecision,
  type CaptureQualityAssessment,
  type CaptureQualityMetrics,
} from './capture-quality';

export { withCaptureQualityDecision } from './capture-quality';
export type { CaptureQualityAssessment, CaptureQualityIssue } from './capture-quality';

export type LiftResult = {
  /** file:// path to the generated transparent PNG sticker. */
  uri: string;
  width: number;
  height: number;
  /** false when Vision found no foreground subject in the photo. */
  hasSubject: boolean;
  /** Subject without the white sticker border, aligned to the sticker canvas. */
  subjectUri?: string;
  /** Normalized source/sticker geometry used by the extraction animation. */
  subjectBounds?: StickerSubjectBounds;
};

export type StickerSubjectBounds = {
  height: number;
  imageHeight: number;
  imageWidth: number;
  stickerHeight: number;
  stickerWidth: number;
  stickerX: number;
  stickerY: number;
  width: number;
  x: number;
  y: number;
};

/**
 * Le verdict d'Apple sur « est-ce un animal ».
 *
 * Voir `classifyAnimal` côté Swift pour le pourquoi. En deux mots : le portail
 * CLIP côté serveur donnait 1.000 « animal » à une voiture, et aucune liste de
 * phrases ne pouvait le réparer. Ici c'est le classifieur d'Apple qui répond,
 * avec ses propres étiquettes et ses propres seuils calibrés.
 */
export type AnimalVerdict = {
  /** Confiance de la meilleure étiquette de haut niveau (animal, bird, insect…). */
  animalConfidence: number;
  /** Laquelle a gagné. Vide si aucune. */
  animalLabel: string;
  /**
   * La plus forte étiquette « ce n'est pas une rencontre » — peluche, jouet,
   * figurine, écran, peinture. Cherchée sur TOUTES les observations, jamais
   * dans le top 5 : la taxonomie d'Apple propage la confiance de la feuille à
   * la racine, donc un seul animal reconnu remplit les cinq places.
   */
  fakeConfidence: number;
  /** Laquelle. Vide si aucune. */
  fakeLabel: string;
  /**
   * La seule valeur à laquelle se fier pour DÉCIDER : Apple a mesuré la courbe
   * précision/rappel de chaque classe, et celle-ci dit « ce résultat tient à
   * 90 % de précision ». Une confiance brute, elle, ne se compare à rien.
   */
  meetsApplePrecision: boolean;
  /** Les cinq premières étiquettes, pour rendre un faux positif lisible. */
  top: { confidence: number; identifier: string }[];
};

export type WildlifeSoundKind =
  | 'big_cat'
  | 'bird'
  | 'canid'
  | 'farm'
  | 'feline'
  | 'frog'
  | 'insect'
  | 'wildlife';

export type WildlifeSoundEvent = {
  confidence: number;
  kind: WildlifeSoundKind;
};

export type RangerHorizonEvent = {
  angle: number;
  level: boolean;
};

type SubjectLiftEvents = {
  onHorizonChange: (event: RangerHorizonEvent) => void;
  onWildlifeSound: (event: WildlifeSoundEvent) => void;
};

type SubjectLiftNativeModule = {
  addListener<EventName extends keyof SubjectLiftEvents>(
    eventName: EventName,
    listener: SubjectLiftEvents[EventName],
  ): EventSubscription;
  assessCaptureQuality?: (uri: string) => Promise<CaptureQualityMetrics>;
  appGroupPath: (group: string) => string | null;
  classifierVocabulary: () => Promise<string[]>;
  classifyAnimal: (uri: string) => Promise<AnimalVerdict>;
  classifySubject: (uri: string) => Promise<{ confidence: number; identifier: string }[]>;
  liftSubject: (uri: string) => Promise<LiftResult>;
  startRangerHorizon?: () => Promise<boolean>;
  stopRangerHorizon?: () => Promise<boolean>;
  startWildlifeSoundAnalysis?: () => Promise<boolean>;
  stopWildlifeSoundAnalysis?: () => Promise<boolean>;
};

const nativeModule = requireOptionalNativeModule<SubjectLiftNativeModule>('SubjectLift');

function iosMajorVersion(): number {
  const major = parseInt(String(Platform.Version), 10);
  return Number.isFinite(major) ? major : 0;
}

/**
 * Subject lifting uses VNGenerateForegroundInstanceMaskRequest, which is iOS 17+.
 * The module also has to be linked into the native build (a dev-client rebuild),
 * hence the null check on the native module.
 */
export const isAvailable =
  Platform.OS === 'ios' && nativeModule != null && iosMajorVersion() >= 17;

/**
 * Lifts the foreground subject out of `uri`, bakes a white die-cut outline around
 * its silhouette, and writes a transparent PNG. Resolves with the new file path,
 * its pixel dimensions, and whether a subject was actually found.
 */
export async function liftSubject(uri: string): Promise<LiftResult> {
  if (!nativeModule) {
    throw new Error('SubjectLift native module is unavailable on this platform/build.');
  }
  return nativeModule.liftSubject(uri);
}

/**
 * Demande à Apple si la photo montre un animal.
 *
 * `VNClassifyImageRequest` existe depuis iOS 13 — bien avant le détourage —
 * donc ce portail fonctionne même là où `isAvailable` est faux. D'où le test
 * séparé sur le module natif seul.
 */
export const isClassifierAvailable = Platform.OS === 'ios' && nativeModule != null;

// Optionnelle pour rester compatible avec un dev client construit avant
// l'ajout du Coach Safari : l'ancien binaire continue simplement sans contrôle.
export const isCaptureQualityAvailable =
  Platform.OS === 'ios' && typeof nativeModule?.assessCaptureQuality === 'function';

export async function assessCaptureQuality(uri: string): Promise<CaptureQualityAssessment> {
  if (!nativeModule?.assessCaptureQuality) {
    throw new Error('Capture quality assessment is unavailable on this platform/build.');
  }
  return withCaptureQualityDecision(await nativeModule.assessCaptureQuality(uri));
}

export async function classifyAnimal(uri: string): Promise<AnimalVerdict> {
  if (!nativeModule) {
    throw new Error('SubjectLift native module is unavailable on this platform/build.');
  }
  return nativeModule.classifyAnimal(uri);
}

/**
 * CE QU'APPLE VOIT SUR LE SUJET DÉTOURÉ.
 *
 * SÉPARÉ DE `classifyAnimal`, ET CE N'EST PAS UN DÉTAIL. Le détourage coûte
 * quelques centaines de millisecondes. Placé dans le portail, il l'a fait
 * dépasser `DELAI_PORTAIL_MS` (634 ms mesurés contre 600 de budget) : la course
 * était perdue, le verdict rendu `null`, et les refus « peluche » et « aucun
 * animal » ne s'appliquaient plus — sans un seul message d'erreur.
 *
 * Cet appel-ci ne bloque rien : son résultat n'est lu qu'au moment de créer la
 * capture, après le téléversement, où il y a plus d'une seconde de battement.
 *
 * Rend une liste vide sous iOS 16 ou quand la photo n'a pas de sujet.
 */
export async function classifySubject(uri: string) {
  // Silencieux et non bloquant : un binaire d'avant cette fonction, un iOS 16,
  // une photo sans sujet — trois cas ordinaires qui donnent la même liste vide.
  if (!nativeModule?.classifySubject) return [];
  return nativeModule.classifySubject(uri).catch(() => []);
}

/**
 * Le vocabulaire réel du classifieur sur CET iOS.
 *
 * Sert au réglage, pas à la production : il dit quelles étiquettes de haut
 * niveau existent vraiment, au lieu de les supposer. À appeler une fois depuis
 * un écran de développement, puis à comparer avec la liste `racines` du Swift.
 */
export async function classifierVocabulary(): Promise<string[]> {
  if (!nativeModule) return [];
  return nativeModule.classifierVocabulary();
}

export const isWildlifeSoundAvailable =
  Platform.OS === 'ios' &&
  typeof nativeModule?.startWildlifeSoundAnalysis === 'function' &&
  typeof nativeModule?.stopWildlifeSoundAnalysis === 'function';

export async function startWildlifeSoundAnalysis(): Promise<boolean> {
  return nativeModule?.startWildlifeSoundAnalysis?.() ?? false;
}

export async function stopWildlifeSoundAnalysis(): Promise<boolean> {
  return nativeModule?.stopWildlifeSoundAnalysis?.() ?? false;
}

export function addWildlifeSoundListener(
  listener: (event: WildlifeSoundEvent) => void,
): EventSubscription | null {
  return isWildlifeSoundAvailable
    ? nativeModule?.addListener('onWildlifeSound', listener) ?? null
    : null;
}

export const isRangerHorizonAvailable =
  Platform.OS === 'ios' &&
  typeof nativeModule?.startRangerHorizon === 'function' &&
  typeof nativeModule?.stopRangerHorizon === 'function';

export async function startRangerHorizon(): Promise<boolean> {
  return nativeModule?.startRangerHorizon?.() ?? false;
}

export async function stopRangerHorizon(): Promise<boolean> {
  return nativeModule?.stopRangerHorizon?.() ?? false;
}

export function addRangerHorizonListener(
  listener: (event: RangerHorizonEvent) => void,
): EventSubscription | null {
  return isRangerHorizonAvailable
    ? nativeModule?.addListener('onHorizonChange', listener) ?? null
    : null;
}

/**
 * Le dossier partagé avec les extensions, ou `null`.
 *
 * C'est le SEUL endroit où l'app et un widget peuvent se passer un fichier :
 * chacun a son bac à sable, et l'extension ne voit pas celui de l'app. Le
 * chemin porte un identifiant tiré par le système, il ne se devine pas.
 *
 * `null` sur un binaire où le groupe n'est pas provisionné — l'appelant doit
 * traiter ce cas, pas le supposer impossible.
 */
export function appGroupPath(group: string): string | null {
  if (!nativeModule?.appGroupPath) return null;
  try {
    return nativeModule.appGroupPath(group) ?? null;
  } catch {
    return null;
  }
}
