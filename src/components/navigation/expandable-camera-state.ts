import { useSyncExternalStore } from 'react';

import type { Image as PreviewImage } from 'react-native-nitro-image';

import type { CapturedPhoto } from '@/lib/animals/capture-photo';
import type { ExifLocation } from '@/lib/exif';
import type { StickerSubjectBounds } from 'subject-lift';

const listeners = new Set<() => void>();
let pending = false;
let version = 0;

// L'écran de révélation s'ouvre À L'APPUI, pas quand le fichier est écrit :
// un paramètre de route ne peut porter qu'une valeur déjà connue, donc le
// cliché encore en cours d'écriture voyage ici, en promesses. La tab bar les
// dépose, pousse la route immédiatement, et l'écran caméra les consomme.
export type PendingCapture = {
  startedAt: number;
  /** L'image de prévisualisation, dès que le capteur la livre — le gel
   *  d'écran. `null` si le capteur n'en produit pas. */
  preview: Promise<PreviewImage | null>;
  shot: Promise<CapturedPhoto>;
  /** Démarrée dès l'ouverture du viseur, résolue pendant le cadrage. */
  location: Promise<ExifLocation | undefined>;
  /** Retourne dans l'onboarding après une vraie identification, sans créer un
   * second pipeline de capture juste pour le tutoriel. */
  onboarding?: {
    complete: (captureId?: string) => void;
    demoSubjectBounds?: StickerSubjectBounds;
  };
};

let pendingShot: PendingCapture | null = null;

export function stashPendingCapture(capture: PendingCapture) {
  pendingShot = capture;
}

export function consumePendingCapture() {
  const shot = pendingShot;
  pendingShot = null;
  return shot;
}

export function requestExpandableCamera() {
  pending = true;
  version += 1;
  for (const listener of listeners) listener();
}

export function consumeExpandableCameraRequest() {
  if (!pending) return false;
  pending = false;
  return true;
}

export function useExpandableCameraRequest() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => version,
  );
}
