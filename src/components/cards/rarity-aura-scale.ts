// L'échelle du contour de rareté, sans React ni natif.
//
// Séparée du composant pour être VÉRIFIABLE : `check-card-rarity.ts` tourne
// sous bun et ne peut pas importer un `.tsx` qui tire React Native. Une
// escalade que rien ne relit finit toujours par s'inverser au milieu.

import type { Rarity } from '@/lib/animals/rarity';

/**
 * L'escalade, un nombre par palier.
 *
 * `loudness` monte strictement du commun au légendaire et pilote tout ce qui se
 * voit : l'épaisseur du trait, la portée du halo, la vitesse d'écoulement. Un
 * seul curseur plutôt que huit jeux de réglages — impossible d'inverser deux
 * paliers par distraction, et `check-card-rarity.ts` le relit.
 *
 * Les COULEURS n'y figurent pas, et c'est délibéré : elles viennent de l'animal
 * (`identity`), jamais du palier. La rareté dit à quel point c'est fort, la
 * capture dit de quelle couleur — les deux axes du système de cartes, tenus
 * séparés ici comme partout.
 */
export const AURA_LOUDNESS: Record<Rarity, number> = {
  common: 0.34,
  uncommon: 0.45,
  rare: 0.58,
  very_rare: 0.7,
  ultra_rare: 0.84,
  epic: 0.9,
  mythic: 0.95,
  legendary: 1,
};

/** Les trois paliers du haut portent le métal ; les cinq autres, le néon. */
export const METAL_TIERS: Rarity[] = ['epic', 'mythic', 'legendary'];

