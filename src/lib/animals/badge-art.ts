// Les illustrations de distinction, une par clé.
//
// POURQUOI UNE TABLE EN DUR ET PAS UN CHEMIN CALCULÉ
//
// Metro résout les `require` d'images À LA COMPILATION : il lit l'arbre
// syntaxique, pas la valeur d'une variable. `require(`../../assets/badges/
// ${key}.png`)` ne compile donc pas — et quand une variante l'accepte, elle
// embarque le dossier entier dans le bundle.
//
// Écrire les douze lignes coûte douze lignes, et donne en échange une erreur de
// TYPE le jour où une distinction est ajoutée sans son image, au lieu d'une
// vignette manquante découverte par un joueur.

// Le type est `number` et pas `ImageSourcePropType` : Metro rend un handle
// numérique opaque, et c'est la seule forme que `useImage` de Skia accepte —
// l'union large de React Native contient `ImageURISource`, dont l'`uri`
// optionnel casse la signature.
export const BADGE_ART: Record<string, number> = {
  'ampleur-10': require('../../../assets/badges/ampleur-10.png'),
  'ampleur-50': require('../../../assets/badges/ampleur-50.png'),
  'ampleur-150': require('../../../assets/badges/ampleur-150.png'),
  'ampleur-500': require('../../../assets/badges/ampleur-500.png'),
  'flair-1': require('../../../assets/badges/flair-1.png'),
  'flair-10': require('../../../assets/badges/flair-10.png'),
  'flair-40': require('../../../assets/badges/flair-40.png'),
  'regne-oiseaux-25': require('../../../assets/badges/regne-oiseaux-25.png'),
  'regne-mammiferes-20': require('../../../assets/badges/regne-mammiferes-20.png'),
  'regne-insectes-20': require('../../../assets/badges/regne-insectes-20.png'),
  'regne-poissons-12': require('../../../assets/badges/regne-poissons-12.png'),
  'regne-reptiles-12': require('../../../assets/badges/regne-reptiles-12.png'),
};

export function badgeArt(key: string): number | undefined {
  return BADGE_ART[key];
}
