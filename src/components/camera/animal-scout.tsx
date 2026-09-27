import * as Haptics from 'expo-haptics';
import { useCallback, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { CameraObjectOutput, CameraRef, ScannedObject, ScannedObjectType } from 'react-native-vision-camera';
import { useObjectOutput } from 'react-native-vision-camera';
import { liveCaptureGuidance, type LiveCaptureGuidance } from '@/lib/camera/live-capture-guidance';

/**
 * Le repérage : la caméra trouve l'animal avant que le joueur ne tire.
 *
 * D'OÙ VIENT LA DÉTECTION — ET POURQUOI ELLE NE COÛTE RIEN
 * --------------------------------------------------------
 * VisionCamera 5 expose la détection d'objets d'AVFoundation comme une sortie
 * de la session de capture (`useObjectOutput`) : `salient-object` est le sujet
 * saillant au sens de Vision — exactement ce que `subject-lift` découpera au
 * moment de la capture — et iOS 17 y ajoute têtes et corps de chiens et chats.
 * C'est du pipeline natif, accéléré matériel, avec suivi d'une frame à l'autre.
 * Pas de modèle à embarquer, pas de frame processor, pas de rebuild : la
 * détection était déjà dans le binaire, personne ne l'avait branchée.
 *
 * La cohérence avec la suite de la chaîne est le vrai argument : le cadre que
 * cette réticule dessine est le sujet que Vision découpera en die-cut et que
 * BioCLIP identifiera. Cadrer « accroché », c'est garantir la carte propre.
 * C'est une attaque de la cause — la photo ratée — là où le bouton « reprendre »
 * ne traite que le symptôme.
 *
 * LES TROIS ÉTATS, ET POURQUOI PAS PLUS
 * -------------------------------------
 *   idle     rien de saillant — la réticule n'existe pas. Un cadre qui erre
 *            sans sujet apprend au joueur à l'ignorer.
 *   spotted  un sujet suit — le cadre le suit, souple, en blanc discret.
 *   locked   le sujet tient en place depuis 700 ms — le cadre se resserre,
 *            passe au beige du thème, une impulsion haptique le dit sans
 *            demander les yeux, et la mise au point se cale sur l'animal.
 *
 * Pas d'état « espèce reconnue » ici : la promesse du viseur est « il est là »,
 * pas « c'est une mésange ». Annoncer l'espèce en direct, c'est se tromper en
 * direct — l'identification a un serveur pour être juste.
 *
 * POURQUOI L'ACCROCHAGE PILOTE AUSSI LA MISE AU POINT
 * ---------------------------------------------------
 * Un animal accroché mais flou donnerait une carte floue : le verrou appelle
 * `focusTo` sur le centre du sujet en adaptatif continu, le même chemin que le
 * tap manuel. Le viseur ne se contente pas de montrer l'animal, il prépare la
 * photo.
 */

/** Détections demandées, du plus spécifique au plus générique. */
const SCOUT_TYPES: ScannedObjectType[] = ['dog-head', 'cat-head', 'dog-body', 'cat-body', 'salient-object'];

/** Sous ce déplacement relatif du centre entre deux mesures, le sujet « tient ». */
const STILLNESS = 0.045;
/** Tenue continue exigée avant le verrou. */
const LOCK_AFTER_MS = 700;
/** Une frame sans sujet ne casse pas l'accrochage ; une demi-seconde, si. */
const LOSE_AFTER_MS = 450;

export type ScoutPhase = 'idle' | 'spotted' | 'locked';

/** Priorité à la détection la plus spécifique, puis au sujet le plus proche. */
function pickSubject(objects: ScannedObject[]): ScannedObject | null {
  let best: ScannedObject | null = null;
  let bestScore = -1;
  for (const object of objects) {
    const specificity = object.type === 'salient-object' ? 0 : 1;
    const area = object.boundingBox.width * object.boundingBox.height;
    const score = specificity * 10 + area;
    if (score > bestScore) { bestScore = score; best = object; }
  }
  return best;
}

function useAnimalScoutIOS(cameraRef: React.RefObject<CameraRef | null>, supportsFocus: boolean) {
  const [phase, setPhase] = useState<ScoutPhase>('idle');
  const [guidance, setGuidance] = useState<LiveCaptureGuidance>('idle');

  // Le flux de détection arrive à la cadence de la session. Tout ce qui n'est
  // pas un CHANGEMENT DE PHASE reste dans des refs : sinon l'écran caméra
  // entier se rendrait plusieurs fois par seconde pour rien.
  const phaseRef = useRef<ScoutPhase>('idle');
  const guidanceRef = useRef<LiveCaptureGuidance>('idle');
  const stillSince = useRef<number | null>(null);
  const lastSeenAt = useRef(0);
  const lastCenter = useRef<{ x: number; y: number } | null>(null);

  const transition = useCallback((next: ScoutPhase, nextGuidance: LiveCaptureGuidance) => {
    if (guidanceRef.current !== nextGuidance) {
      guidanceRef.current = nextGuidance;
      setGuidance(nextGuidance);
    }
    if (phaseRef.current !== next) {
      phaseRef.current = next;
      setPhase(next);
      if (next === 'locked') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, []);

  const onObjectsScanned = useCallback((objects: ScannedObject[]) => {
    const now = Date.now();
    const camera = cameraRef.current;
    const subject = camera ? pickSubject(objects) : null;

    if (!subject) {
      // Une frame vide n'éteint rien : le suivi natif cligne, pas le sujet.
      if (now - lastSeenAt.current > LOSE_AFTER_MS && phaseRef.current !== 'idle') {
        stillSince.current = null;
        lastCenter.current = null;
        transition('idle', 'idle');
      }
      return;
    }
    lastSeenAt.current = now;

    // La conversion tient compte de la rotation, du miroir et du `cover` de la
    // prévisualisation — c'est exactement le travail qu'on ne veut pas refaire.
    let box: { x: number; y: number; width: number; height: number };
    try {
      box = camera!.convertScannedObjectCoordinatesToViewCoordinates(subject).boundingBox;
    } catch {
      return; // Prévisualisation pas encore prête : frame suivante.
    }

    // Le verrou se mérite : un centre qui tient en place LOCK_AFTER_MS d'affilée.
    // Le déplacement est rapporté à la taille du sujet, pas à l'écran — un
    // oiseau lointain bouge de peu de pixels même quand il saute de branche.
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const previous = lastCenter.current;
    lastCenter.current = center;
    const reference = Math.max(box.width, box.height, 1);
    const moved = previous
      ? Math.hypot(center.x - previous.x, center.y - previous.y) / reference
      : Number.POSITIVE_INFINITY;
    const normalizedBox = subject.boundingBox;

    if (moved > STILLNESS) {
      stillSince.current = now;
      transition('spotted', liveCaptureGuidance(normalizedBox, false));
      return;
    }
    if (stillSince.current === null) stillSince.current = now;
    if (now - stillSince.current >= LOCK_AFTER_MS) {
      if (phaseRef.current !== 'locked' && supportsFocus) {
        // Le même chemin que le tap manuel — voir `focusCamera`. Auto-reset
        // court : si l'animal repart, la caméra redevient libre toute seule.
        void camera!
          .focusTo(center, { responsiveness: 'snappy', adaptiveness: 'continuous', autoResetAfter: 3 })
          .catch(() => undefined);
      }
      transition('locked', liveCaptureGuidance(normalizedBox, true));
    } else {
      transition('spotted', liveCaptureGuidance(normalizedBox, false));
    }
  }, [cameraRef, supportsFocus, transition]);

  const output = useObjectOutput({ types: SCOUT_TYPES, onObjectsScanned });
  return { guidance, output, phase };
}

/** Android : la détection AVFoundation est iOS. Le viseur reste tel quel. */
function useAnimalScoutNoop(_cameraRef: React.RefObject<CameraRef | null>, _supportsFocus: boolean) {
  return {
    guidance: 'idle' as LiveCaptureGuidance,
    output: null as CameraObjectOutput | null,
    phase: 'idle' as ScoutPhase,
  };
}

// Choisi au chargement du module : la plateforme ne change pas en cours de vie,
// donc la règle des hooks reste respectée des deux côtés de la branche.
export const useAnimalScout = Platform.OS === 'ios' ? useAnimalScoutIOS : useAnimalScoutNoop;
