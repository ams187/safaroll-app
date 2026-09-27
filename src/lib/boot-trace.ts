// Chronomètre de démarrage — TEMPORAIRE, à retirer une fois le diagnostic fait.
//
// Le symptôme est « écran blanc de trois secondes après l'animation de splash ».
// Trois secondes, c'est long, mais le mot « après » ne dit pas OÙ elles se
// passent : évaluation du bundle, chargement de Clerk, montage de l'arbre,
// premier écran. Chaque repère marque une frontière, et l'intervalle le plus
// large désigne le coupable.
//
// L'origine est l'ÉVALUATION DU MODULE, pas le premier rendu : le coût d'un
// `require` natif se paie avant que React existe, et c'est justement l'un des
// suspects.

const DEPART = Date.now();
let precedent = DEPART;

export function marque(nom: string): void {
  if (!__DEV__) return;
  const maintenant = Date.now();
  const depuisDepart = maintenant - DEPART;
  const depuisPrecedent = maintenant - precedent;
  precedent = maintenant;
  console.log(`[boot] ${String(depuisDepart).padStart(5)} ms  (+${String(depuisPrecedent).padStart(5)})  ${nom}`);
}

marque('évaluation du bundle');
