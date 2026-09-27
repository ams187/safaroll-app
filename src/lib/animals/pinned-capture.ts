// QUELLE PHOTO REPRÉSENTE UNE ESPÈCE DANS LA COLLECTION.
//
// La grille n'affiche qu'une case par espèce, et elle montrait TOUJOURS la
// capture la plus récente. C'est une lecture défendable — « ta dernière
// rencontre » — mais elle remplace la précédente en silence : la photo qu'on
// aimait disparaît derrière celle d'aujourd'hui sans qu'on ait rien demandé.
//
// POURQUOI ON NE DEMANDE PAS AU MOMENT DE LA CAPTURE
//
// Le chemin entre le déclencheur et la carte est un budget de latence : c'est
// le moment où l'on regarde un animal trembler. Y planter « garder l'ancienne
// ou la nouvelle ? » casse exactement ce que toute l'app construit — et il
// faudrait y répondre à CHAQUE capture d'une espèce déjà prise, donc de plus
// en plus souvent à mesure que la collection grandit. Une question posée au
// mauvais moment devient une taxe.
//
// L'épinglage se fait donc là où l'on REGARDE, pas là où l'on shoote.
//
// POURQUOI C'EST LOCAL
//
// C'est une préférence d'affichage, pas une donnée de jeu : rien ne se calcule
// dessus, rien ne se partage. MMKV suffit, fonctionne hors ligne, et n'exige ni
// migration, ni politique RLS, ni synchronisation. Le jour où l'on voudra que
// le choix suive le compte d'un appareil à l'autre, une colonne `pinned_capture`
// sur `profiles` prendra le relais sans rien changer ici.

import { useSyncExternalStore } from 'react';
import { createMMKV } from 'react-native-mmkv';

const store = createMMKV({ id: 'pinned-captures' });

/** La clé d'une espèce, alignée sur celle de la grille (`bySpecies`). */
export function speciesKey(capture: {
  scientificName?: string;
  commonName?: string;
}): string | null {
  return capture.scientificName ?? capture.commonName ?? null;
}

const abonnes = new Set<() => void>();

/** Un jeton qui change à chaque écriture : c'est lui que React observe. */
let version = 0;

function souscrire(abonne: () => void) {
  abonnes.add(abonne);
  return () => {
    abonnes.delete(abonne);
  };
}

function publier() {
  version += 1;
  for (const abonne of abonnes) abonne();
}

/** L'identifiant de capture épinglé pour cette espèce, s'il y en a un. */
export function getPinnedCaptureId(espece: string): string | null {
  return store.getString(espece) ?? null;
}

/** Épingle une capture, ou retire l'épingle si `captureId` est nul. */
export function setPinnedCapture(espece: string, captureId: string | null) {
  if (captureId) store.set(espece, captureId);
  else store.remove(espece);
  publier();
}

/**
 * S'abonne aux épinglages.
 *
 * Rend un simple compteur plutôt que la table : `useSyncExternalStore` exige un
 * instantané STABLE, et reconstruire un objet à chaque appel ferait boucler
 * React indéfiniment. Les lecteurs appellent `getPinnedCaptureId` avec ce
 * compteur en dépendance.
 */
export function usePinnedVersion(): number {
  return useSyncExternalStore(souscrire, () => version, () => version);
}

/**
 * Cette capture est-elle celle qui représente son espèce ?
 *
 * IL N'Y A PAS DE « DÉCHOISIR ». Une espèce montre toujours une photo — la
 * choisie, ou la plus récente à défaut. Proposer de retirer son choix laissait
 * croire qu'on pouvait n'en avoir aucune : le geste inverse n'existe pas, il
 * consiste à en choisir une autre. `setPinnedCapture(espece, null)` reste là
 * pour le jour où une capture épinglée est supprimée.
 */
export function usePinnedCapture(espece: string | null, captureId: string | null) {
  const v = usePinnedVersion();
  const epingle = espece != null && captureId != null && getPinnedCaptureId(espece) === captureId;
  // `v` n'est pas lu ici : il ne sert qu'à provoquer le rendu au changement.
  void v;
  return { epingle };
}
