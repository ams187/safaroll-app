// Les teintes des distinctions.
//
// SÉPARÉES DES IMAGES, ET C'EST NÉCESSAIRE
//
// `badge-art.ts` fait des `require` de PNG : Metro sait les résoudre, un script
// lancé sous bun non. Garder les couleurs ici permet à `check:badges` de
// vérifier l'invariant — douze teintes bien distinctes — sans jamais toucher un
// fichier image.

/**
 * La couleur dominante — ou sa couleur d'appui la plus lisible — de chaque
 * illustration.
 *
 * Ce ne sont pas des couleurs choisies après coup : ce sont celles imposées au
 * générateur, image par image, dans la consigne de cadre. Les écrire ici est le
 * seul moyen que l'app connaisse la teinte d'un PNG sans l'échantillonner à
 * l'exécution — et un échantillonnage rendrait une couleur moyenne, donc terne,
 * là où on veut la couleur DOMINANTE.
 *
 * Les nouveaux écussons n'ont volontairement plus un cadre commun : carnet,
 * atlas, jumelles, aile, scarabée… Leur vitrine reprend donc leur propre
 * matière au lieu d'une roue chromatique abstraite. Les couleurs restent
 * assez éloignées pour que deux pages voisines ne se confondent jamais.
 */
export const BADGE_FIELD: Record<string, string> = {
  'ampleur-10': '#B9472C', // carnet terracotta
  'ampleur-50': '#176B68', // plaques photo pétrole
  'ampleur-150': '#183D73', // atlas bleu nuit
  'ampleur-500': '#176A43', // baobab émeraude
  'flair-1': '#C58A13', // diaphragme safran
  'flair-10': '#CB4E59', // jumelles corail
  'flair-40': '#543179', // viseur violet
  'regne-oiseaux-25': '#2F7DBD', // aile bleu ciel
  'regne-mammiferes-20': '#7E2638', // cornes bordeaux
  'regne-insectes-20': '#78A914', // scarabée chartreuse
  'regne-poissons-12': '#1096A3', // vague turquoise
  'regne-reptiles-12': '#7C718F', // serpent lavande minérale
};
