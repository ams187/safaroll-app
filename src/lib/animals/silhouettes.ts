import { uiLanguage } from '@/i18n/current';
import type { SFSymbol } from 'expo-symbols';

/**
 * Locked slots show a silhouette per *group*, never per species.
 *
 * Drawing 1000 individual silhouettes is a content project on its own, and it
 * would also spoil the game: a duck-shaped hole says "you are missing a duck"
 * without saying which one. The mystery is the point.
 */
const GROUP_SILHOUETTES: Record<string, SFSymbol> = {
  birds: 'bird.fill',
  butterflies: 'ladybug.fill',
  mammals: 'hare.fill',
  dragonflies: 'ant.fill',
  beetles: 'ladybug.fill',
  bees: 'ant.fill',
  herps: 'lizard.fill',
  spiders: 'ant.fill',
  others: 'tortoise.fill',
  mammiferes: 'hare.fill',
  oiseaux: 'bird.fill',
  reptiles: 'lizard.fill',
  amphibiens: 'lizard.fill',
  poissons: 'fish.fill',
  insectes: 'ladybug.fill',
  // LES QUATRE GROUPES QUE SF SYMBOLS N'A PAS.
  //
  // Il n'existe ni araignée, ni crabe, ni escargot, ni ver dans le jeu système.
  // Ces quatre-là partageaient donc deux formes à deux : `ant.fill` pour les
  // arachnides ET les crustacés, `circle.grid.3x3.fill` pour les mollusques ET
  // les invertébrés — une grille de points qui ne ressemblait à aucun animal.
  // Deux groupes qui portent la même silhouette ne sont plus deux groupes.
  //
  // Chacun a donc une forme qui lui est propre :
  // Les arachnides gardent la fourmi : elle n'est pas juste, mais elle se lit
  // comme une bestiole à pattes, ce que l'acarien des allergènes ne faisait pas.
  // Elle n'est plus partagée avec les crustacés, donc elle ne désigne qu'eux.
  arachnides: 'ant.fill',
  mollusques: 'fossil.shell.fill',
  // Une coquille en spirale. Celui-là n'est pas une approximation.
  // LES DEUX GROUPES QU'APPLE N'A PAS DESSINÉS.
  //
  // Les 546 racines de SF Symbols ont été rendues et REGARDÉES, pas seulement
  // lues : le bestiaire entier tient en onze formes — fourmi, coccinelle,
  // oiseau, poisson, lézard, lièvre, tortue, chat, chien, empreinte, ourson —
  // plus une coquille fossile. Ni crabe, ni ver, ni méduse, ni escargot.
  //
  // Trois choix faits AU NOM ont échoué avant celui-ci, et chacun s'est
  // effondré dès qu'on l'a affiché : `allergens.fill` n'est pas un acarien mais
  // des grains de pollen épars, `microbe` est un anneau entouré de points,
  // `water.waves` trois vagues. Des glyphes maison ont été dessinés puis
  // abandonnés : un dessin qui n'est pas d'Apple se voit à côté de ceux qui le
  // sont.
  //
  // Faute de l'animal, ces deux-là prennent une forme choisie à la main, après
  // avoir parcouru le catalogue complet.
  crustaces: 'water.waves',
  // La mer. Ce n'est pas la bête, c'est là où on la trouve.
  invertebres: 'star.fill',
  // L'étoile de mer — un échinoderme, donc un invertébré pour de vrai. La forme
  // sert aussi de repère pour le reste du groupe.
};

/** A few families deserve their own shape — they are the icons of the game. */
const FAMILY_SILHOUETTES: Record<string, SFSymbol> = {
  Anatidae: 'bird.fill',
  Canidae: 'dog.fill',
  Felidae: 'cat.fill',
  Sciuridae: 'hare.fill',
  Testudinidae: 'tortoise.fill',
  Emydidae: 'tortoise.fill',
  Salmonidae: 'fish.fill',
  Cyprinidae: 'fish.fill',
};

export function silhouetteFor(group?: string, family?: string): SFSymbol {
  if (family && FAMILY_SILHOUETTES[family]) return FAMILY_SILHOUETTES[family];
  if (group && GROUP_SILHOUETTES[group]) return GROUP_SILHOUETTES[group];
  return 'pawprint.fill';
}

const GROUP_LABEL_TEXT: Record<'fr' | 'en', Record<string, string>> = {
  fr: {
    birds: 'Oiseaux',
    butterflies: 'Papillons',
    mammals: 'Mammifères',
    dragonflies: 'Libellules',
    beetles: 'Coléoptères',
    bees: 'Abeilles et guêpes',
    herps: 'Reptiles et amphibiens',
    spiders: 'Araignées',
    others: 'Autres',
    mammiferes: 'Mammifères',
    oiseaux: 'Oiseaux',
    reptiles: 'Reptiles',
    amphibiens: 'Amphibiens',
    poissons: 'Poissons',
    insectes: 'Insectes',
    arachnides: 'Arachnides',
    mollusques: 'Mollusques',
    crustaces: 'Crustacés',
    invertebres: 'Invertébrés',
  },
  en: {
    birds: 'Birds',
    butterflies: 'Butterflies',
    mammals: 'Mammals',
    dragonflies: 'Dragonflies',
    beetles: 'Beetles',
    bees: 'Bees and wasps',
    herps: 'Reptiles and amphibians',
    spiders: 'Spiders',
    others: 'Others',
    mammiferes: 'Mammals',
    oiseaux: 'Birds',
    reptiles: 'Reptiles',
    amphibiens: 'Amphibians',
    poissons: 'Fish',
    insectes: 'Insects',
    arachnides: 'Arachnids',
    mollusques: 'Molluscs',
    crustaces: 'Crustaceans',
    invertebres: 'Invertebrates',
  },
};

/** Read in the UI language at the moment it is displayed, never cached. */
export const GROUP_LABELS: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_, key) => (typeof key === 'string' ? GROUP_LABEL_TEXT[uiLanguage()][key] : undefined),
  has: (_, key) => typeof key === 'string' && key in GROUP_LABEL_TEXT.fr,
});
