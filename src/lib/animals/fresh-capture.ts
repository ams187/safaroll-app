// Le relais entre la caméra et la collection.
//
// POURQUOI UN RELAIS, ET PAS UNE FENÊTRE DE TEMPS
//
// La collection doit savoir qu'une carte vient d'arriver, pour la faire
// balancer et remonter la liste jusqu'à elle. Deux façons de le déduire, et la
// première était fausse :
//
//   PAR L'HEURE DE CAPTURE   « moins de trente secondes » — mais `capturedAt`
//                            date la PHOTO, pas le moment où le joueur quitte
//                            la révélation. Il peut rester à regarder sa carte,
//                            refaire une prise, être interrompu. Passé le
//                            délai, plus rien ne se déclenchait, et l'attente
//                            était punie.
//   PAR L'ÉVÉNEMENT          la caméra SAIT qu'elle vient de capturer. Elle le
//                            dit, au lieu de laisser deviner.
//
// POURQUOI PAS UN PARAMÈTRE DE ROUTE
//
// La caméra ferme par `router.dismissTo`, qui remonte l'écran de collection —
// tout état local y est perdu. MMKV est synchrone : la valeur est lisible dès
// le premier rendu suivant, sans course entre l'écriture et le montage.
//
// LA CLÉ SE CONSOMME
//
// `takeFreshCapture` lit ET efface. Sans ça, revenir sur l'onglet rejouerait
// l'animation à chaque fois — et une carte qui sautille sans raison se lit
// comme un bug, pas comme une fête.

import { createMMKV } from 'react-native-mmkv';

const store = createMMKV({ id: 'fresh-capture' });
const KEY = 'id';
const AT = 'at';

/**
 * Au-delà, on considère que la session est finie.
 *
 * Ce n'est pas la fenêtre qu'on vient de retirer : elle ne borne plus le temps
 * de contemplation, elle évite juste qu'une capture oubliée en mémoire fasse
 * sautiller une carte au lancement du lendemain.
 */
const STALE_MS = 10 * 60 * 1000;

/** La caméra annonce la carte qu'elle vient de poser. */
export function markFreshCapture(id: string) {
  store.set(KEY, id);
  store.set(AT, Date.now());
}

/** La collection la réclame — une seule fois. */
export function takeFreshCapture(): string | null {
  const id = store.getString(KEY);
  const at = store.getNumber(AT);
  store.remove(KEY);
  store.remove(AT);
  if (!id || at === undefined || Date.now() - at > STALE_MS) return null;
  return id;
}
