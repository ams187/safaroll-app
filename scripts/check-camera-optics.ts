import { ANIMAL_COUPE_ACTIF } from '../src/lib/launch-flags';
import { formatZoom, opticalZoomOptions } from '../src/lib/camera/optics';
import { liveCaptureGuidance } from '../src/lib/camera/live-capture-guidance';
import {
  consumeExpandableCameraRequest,
  requestExpandableCamera,
} from '../src/components/navigation/expandable-camera-state';

const zooms = opticalZoomOptions({ minZoom: 0.5, maxZoom: 15, zoomLensSwitchFactors: [1, 3] });
if (JSON.stringify(zooms) !== JSON.stringify([0.5, 1, 3])) throw new Error(`Unexpected optical zooms: ${zooms}`);
if (formatZoom(0.5) !== '0.5×' || formatZoom(3) !== '3×') throw new Error('Unexpected zoom label');
if (liveCaptureGuidance(null, false) !== 'idle') throw new Error('Empty frame should stay idle');
// LE SUJET COUPÉ SUIT SON DRAPEAU DE LANCEMENT.
//
// `ANIMAL_COUPE_ACTIF` éteint cette détection pour la v1. Le test exigeait
// `clipped` sans condition : il est devenu rouge le jour où le drapeau est
// tombé, et il a bloqué toute la chaîne `bun run check` derrière lui — donc
// tous les garde-fous suivants, qui ne s'exécutaient plus.
//
// Un contrôle doit vérifier le comportement ATTENDU dans la configuration
// COURANTE, pas un comportement qu'on a délibérément désactivé. Les deux
// branches sont donc décrites ici : le jour où le drapeau se rallume, le test
// bascule tout seul et continue de protéger.
const bordDuCadre = liveCaptureGuidance({ x: 0, y: 0.2, width: 0.3, height: 0.3 }, true);
if (ANIMAL_COUPE_ACTIF) {
  if (bordDuCadre !== 'clipped') throw new Error('Edge subject should be reported as clipped');
} else if (bordDuCadre !== 'ready') {
  // Drapeau éteint : un sujet au bord reste un sujet valable, assez grand et
  // stable — il doit donc passer, pas être refusé pour une raison qu'on a
  // choisi de ne plus appliquer.
  throw new Error(`Flag off: edge subject should stay usable, got ${bordDuCadre}`);
}
if (liveCaptureGuidance({ x: 0.3, y: 0.3, width: 0.1, height: 0.1 }, true) !== 'too_far') {
  throw new Error('Tiny subject should be reported as too far');
}
if (liveCaptureGuidance({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, true) !== 'ready') {
  throw new Error('Stable framed subject should be ready');
}
requestExpandableCamera();
if (!consumeExpandableCameraRequest()) throw new Error('Expandable camera request was lost');
if (consumeExpandableCameraRequest()) throw new Error('Expandable camera request was consumed twice');

console.log('camera optics checks passed');
