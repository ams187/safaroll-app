// L'horloge de la saison. Pure, sans une seule dépendance — c'est ce qui
// permet à `check-season-nudges` de la vérifier hors simulateur.

/**
 * Jours restants avant que la saison tourne — dernier jour du mois INCLUS.
 *
 * L'inclusion est la règle qui compte : le 31 août, il reste un jour, pas
 * zéro. Annoncer « 0 jour » à quelqu'un qui a encore sa journée pour capturer,
 * c'est lui faire manquer une espèce qui ne revient pas avant un an.
 *
 * La rotation est réelle : les espèces visibles changent avec le mois. Ce
 * n'est pas un compte à rebours fabriqué pour presser.
 */
export function daysLeftInMonth(now: Date): number {
  // Jour 0 du mois suivant = dernier jour de celui-ci, années bissextiles
  // comprises, sans table de longueurs à tenir à jour.
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate() + 1;
}
