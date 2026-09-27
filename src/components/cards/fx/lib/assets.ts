import type { SkImage } from '@shopify/react-native-skia';

import { useCardImage } from '../../card-image';

// Shared foil/pattern textures from pokemon-cards-css/public/img — the
// NO-MASK fallbacks every effect stylesheet references. SafaRoll cards are
// generated, not scanned, so there are no per-card foils/masks: `cardImages`,
// `foilImages` and `maskImages` from the source port are deliberately absent
// and every effect runs its NO-MASK branch.
export const textureImages: Record<string, number> = {
  'cosmos-bottom': require('../../../../../assets/fx/cosmos-bottom.png'),
  'cosmos-middle-trans': require('../../../../../assets/fx/cosmos-middle-trans.png'),
  'cosmos-top-trans': require('../../../../../assets/fx/cosmos-top-trans.png'),
  glitter: require('../../../../../assets/fx/glitter.png'),
  foilbg: require('../../../../../assets/fx/foilbg.png'),
  grain: require('../../../../../assets/fx/grain.webp'),
  illusion: require('../../../../../assets/fx/illusion.png'),
  prismbg: require('../../../../../assets/fx/prismbg.jpg'),
  ancient: require('../../../../../assets/fx/ancient.png'),
  'illusion-mask': require('../../../../../assets/fx/illusion-mask.png'),
  geometric: require('../../../../../assets/fx/geometric.png'),
};

/**
 * Les textures épinglées : décodées une fois, gardées pour toute la session.
 *
 * POURQUOI ELLES NE PEUVENT PAS VIVRE DANS LE CACHE DES ILLUSTRATIONS
 *
 * `card-image.ts` tient un cache borné à 64 Mo qui évince en LRU. C'est le bon
 * comportement pour des die-cuts : il y en a des milliers, ils pèsent plusieurs
 * mégaoctets chacun, et on ne peut pas tous les garder.
 *
 * Les planches de foil sont l'exact contraire : onze fichiers, les MÊMES pour
 * toutes les cartes du jeu, minuscules à côté d'une illustration plein écran.
 * Mises dans le même budget, elles entraient en concurrence avec les
 * illustrations et se faisaient évincer dès qu'on scrollait la collection ou
 * qu'on ouvrait quelques cartes — le commentaire du cache le dit lui-même :
 * il tient « ~11 full-size ones ».
 *
 * Effet visible : `useTexture` rendait `null`, la couche de paillettes ne se
 * dessinait pas, et l'effet shiny perdait ses points jusqu'au décodage suivant.
 * Un légendaire scintillait ou non selon ce qu'on venait de regarder avant.
 * C'est la régression introduite en passant de `useImage` à ce cache : `useImage`
 * gardait sa propre référence et n'était évincé par rien.
 *
 * Onze images retenues pour toujours, c'est borné par construction — pas une
 * fuite. Le cache partagé reste utilisé pour le décodage et la déduplication ;
 * on ne fait qu'empêcher l'éviction de reprendre ce qu'il a rendu.
 */
const pinned = new Map<number, SkImage>();

export const useTexture = (source: number) => {
  const loaded = useCardImage(source);
  // Épinglé pendant le rendu, comme `useCardImage` lit son cache pendant le
  // rendu : différer d'une frame ferait clignoter les paillettes au montage,
  // ce qui est la moitié du défaut qu'on corrige ici. L'écriture est
  // idempotente — même clé, même image.
  if (loaded && !pinned.has(source)) pinned.set(source, loaded);
  return pinned.get(source) ?? loaded;
};
