// LE FLASH, ET POURQUOI IL EST ÉTEINT PAR DÉFAUT.
//
// Les applis photo mettent « auto » par défaut, et c'est le bon choix quand le
// sujet est un plat ou un visage. Ici le sujet est un animal.
//
// Un flash à trois mètres d'un oiseau au crépuscule, c'est un éblouissement
// brutal sur un œil adapté à la nuit — et nos propres conditions d'utilisation
// disent « n'approche pas, n'appâte pas, ne dérange pas un animal pour obtenir
// une carte ». Déclencher un flash sans que personne ne l'ait demandé serait
// exactement ça, décidé à la place du joueur.
//
// Donc : ÉTEINT par défaut, et le cycle commence par « auto » pour que le geste
// suivant reste doux. Celui qui veut le flash l'aura en un tap, et il saura
// qu'il l'a allumé.
//
// LE RÉGLAGE SURVIT À LA SESSION. Une préférence photo qui se réinitialise à
// chaque ouverture est une préférence qu'on doit reposer à chaque fois — et
// dans une app où la caméra s'ouvre en deux secondes pour attraper une bête qui
// s'enfuit, c'est deux secondes de trop.

import { useCallback, useSyncExternalStore } from 'react';
import { createMMKV } from 'react-native-mmkv';

/** Aligné sur `FlashMode` de react-native-vision-camera. */
export type FlashMode = 'off' | 'auto' | 'on';

const store = createMMKV({ id: 'camera-flash' });
const KEY = 'mode';

/** L'ordre du cycle : le premier tap propose « auto », jamais « on » d'emblée. */
const CYCLE: FlashMode[] = ['off', 'auto', 'on'];

function lire(): FlashMode {
  const brut = store.getString(KEY);
  return brut === 'auto' || brut === 'on' ? brut : 'off';
}

let courant: FlashMode = lire();
const abonnes = new Set<() => void>();

function publier(suivant: FlashMode) {
  if (suivant === courant) return;
  courant = suivant;
  store.set(KEY, suivant);
  for (const abonne of abonnes) abonne();
}

function souscrire(abonne: () => void) {
  abonnes.add(abonne);
  return () => {
    abonnes.delete(abonne);
  };
}

export function setFlashMode(mode: FlashMode) {
  publier(mode);
}

export function nextFlashMode(mode: FlashMode): FlashMode {
  return CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length]!;
}

/**
 * Le mode courant, et le geste qui le fait tourner.
 *
 * `getServerSnapshot` rend la même valeur : il n'y a pas de rendu serveur ici,
 * mais `useSyncExternalStore` le réclame et l'omettre plante en mode strict.
 */
export function useFlashMode() {
  const mode = useSyncExternalStore(souscrire, () => courant, () => courant);
  const cycle = useCallback(() => publier(nextFlashMode(courant)), []);
  return { cycle, mode };
}

/** Le symbole SF correspondant, pour ne pas le recopier à deux endroits. */
export function flashSymbol(mode: FlashMode): 'bolt.slash.fill' | 'bolt.badge.a.fill' | 'bolt.fill' {
  if (mode === 'on') return 'bolt.fill';
  if (mode === 'auto') return 'bolt.badge.a.fill';
  return 'bolt.slash.fill';
}

/**
 * La CLÉ du libellé lu par VoiceOver, pas le libellé lui-même : ce module est
 * une réserve d'état, hors de tout composant, donc `t()` n'y est pas appelable.
 * C'est `FlashButton` qui traduit.
 */
export function flashLabelKey(mode: FlashMode): 'flash_on' | 'flash_auto' | 'flash_off' {
  if (mode === 'on') return 'flash_on';
  if (mode === 'auto') return 'flash_auto';
  return 'flash_off';
}
