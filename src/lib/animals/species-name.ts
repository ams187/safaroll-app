import { currentLanguage, type AppLanguage } from '@/i18n/languages';
import { resolveSpeciesName, type NamedCapture } from './species-name-chain';

export type { NamedCapture };

/**
 * What to call this animal on screen.
 *
 * BioCLIP answers in English and only in English, so a French player was being
 * shown "Rock Pigeon". Les noms sont résolus côté serveur à l'identification et
 * rangés sur la capture — jamais cherchés au rendu, parce que la grille en
 * dessine des dizaines à la fois.
 *
 * La règle elle-même est dans `species-name-chain.ts`, sans dépendance native,
 * pour que `check:names` la vérifie hors simulateur. Ici il ne reste que la
 * langue par défaut.
 */
export function speciesName(
  capture: NamedCapture | undefined,
  language: AppLanguage = currentLanguage(),
): string | undefined {
  return resolveSpeciesName(capture, language);
}
