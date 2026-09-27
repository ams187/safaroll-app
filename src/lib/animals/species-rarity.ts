// La règle de rareté vit dans `supabase/functions/_shared/`, pas ici.
//
// Elle décide de l'apparence d'une carte à DEUX endroits : dans l'app, pour ce
// qu'on dessine, et dans l'edge function `identify-animal`, pour ce qu'on
// écrit en base quand un joueur photographie une espèce hors catalogue. Deux
// runtimes — Hermes et Deno — qui ne partagent pas de module... sauf celui-là,
// que le CLI Supabase embarque au déploiement.
//
// Deux copies des seuils dériveraient : le jour où l'un dit « légendaire sous
// 1 000 » et l'autre « sous 5 000 », la même espèce a deux cartes selon
// qu'elle était au catalogue ou non, et personne ne s'en aperçoit.
export { RARITY_THRESHOLDS, rarityFromOccurrences } from '../../../supabase/functions/_shared/species-rarity';
