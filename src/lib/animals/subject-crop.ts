// Où couper la photo avant de l'envoyer à BioCLIP.
//
// Module PUR — aucun Skia, aucun react-native — pour que
// `scripts/check-subject-crop.ts` le vérifie sous `bun`, sans simulateur.
// Même règle que `location-rules.ts`.
//
// POURQUOI RECADRER
//
// BioCLIP encode TOUTE l'image en un seul vecteur. Un oiseau qui occupe un
// dixième du cadre y pèse un dixième, sous neuf dixièmes de ciel et de
// feuillage — et le portail « est-ce un animal ? », qui lit ce même vecteur,
// se dilue exactement pareil. Cadrer sur l'animal, c'est poser la bonne
// question au modèle.
//
// Les quatre nombres viennent de `subject-lift`, qui les calcule déjà pour
// découper le détourage et qu'on jetait ensuite.

/** La boîte du sujet, en fractions de l'image, origine en HAUT À GAUCHE. */
export type SubjectCrop = { height: number; width: number; x: number; y: number };

/**
 * Marge autour du sujet, en fraction de la BOÎTE — pas de l'image.
 *
 * Pas de coupe au ras : BioCLIP a été entraîné sur des photos, où l'animal a
 * toujours un peu de son monde autour de lui. Un roseau, une écorce, une vasque
 * sont des indices d'espèce, pas du bruit. Et la boîte n'est pas parfaite : une
 * queue fine ou une antenne passent sous le seuil d'alpha du masque, la marge
 * les rattrape.
 *
 * En fraction de la boîte, un moineau minuscule et un cerf plein cadre gardent
 * la même proportion d'air autour d'eux — ce que l'œil et le modèle attendent.
 */
export const CROP_MARGIN = 0.15;

/** Au-delà, le sujet remplit déjà le cadre : couper ne ferait que jeter du contexte. */
export const CROP_MAX_COVERAGE = 0.8;

/**
 * En deçà, la boîte est plus probablement une poussière accrochée par le masque
 * qu'un animal. Zoomer dessus fabriquerait une identification très confiante à
 * partir d'un grain de capteur.
 */
export const CROP_MIN_COVERAGE = 0.004;

/**
 * Le rectangle à découper, en pixels, borné à l'image.
 *
 * `null` quand recadrer n'a pas de sens — l'appelant envoie alors la photo
 * entière, exactement comme avant.
 */
export function cropRect(
  crop: SubjectCrop,
  imageWidth: number,
  imageHeight: number,
): { height: number; width: number; x: number; y: number } | null {
  const coverage = crop.width * crop.height;
  if (!Number.isFinite(coverage) || coverage <= 0) return null;
  if (coverage >= CROP_MAX_COVERAGE || coverage < CROP_MIN_COVERAGE) return null;

  const padX = crop.width * CROP_MARGIN;
  const padY = crop.height * CROP_MARGIN;
  const left = Math.max(0, crop.x - padX);
  const top = Math.max(0, crop.y - padY);
  const right = Math.min(1, crop.x + crop.width + padX);
  const bottom = Math.min(1, crop.y + crop.height + padY);
  if (right <= left || bottom <= top) return null;

  return {
    x: Math.round(left * imageWidth),
    y: Math.round(top * imageHeight),
    width: Math.max(1, Math.round((right - left) * imageWidth)),
    height: Math.max(1, Math.round((bottom - top) * imageHeight)),
  };
}
