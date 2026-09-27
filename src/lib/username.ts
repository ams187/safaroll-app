// LE PSEUDO, DÉRIVÉ DU NOM PLUTÔT QUE DEMANDÉ.
//
// POURQUOI ON NE LE DEMANDE PAS
//
// En v1 personne ne voit le profil d'un autre joueur — `CERCLE_ACTIF` et
// `LEADERBOARD_ACTIF` sont coupés. Un pseudo demandé sans public reçoit une
// réponse sans soin (`aaaa`, `test1`), et le jour où le classement arrive, ces
// gens veulent en changer : on aurait payé la friction deux fois pour de moins
// bons pseudos.
//
// Dérivé d'un vrai nom, il est lisible dès le premier jour, et
// `auth_username.immutable` vaut `false` côté Clerk — donc modifiable le jour
// où il aura un sens.
//
// LES RÈGLES VIENNENT DE LA CONFIGURATION CLERK, PAS D'UNE SUPPOSITION
//
//   auth_username : min_length 4 · max_length 64
//                   allow_extended_special_characters false
//                   allow_numeric_usernames false
//
// `allow_numeric_usernames: false` interdit un pseudo ENTIÈREMENT numérique —
// un suffixe de départage reste donc permis.

const MIN = 4;
const MAX = 64;

/**
 * Rend le pseudo de base, ou `null` si le nom ne donne rien d'exploitable.
 *
 * `null` n'est pas un échec : un nom en écriture non latine, ou trop court une
 * fois nettoyé, ne doit pas produire un pseudo bricolé que le joueur n'aurait
 * pas choisi. Mieux vaut pas de pseudo qu'un pseudo faux — il se posera au
 * lancement du classement, quand il aura un sens.
 */
export function pseudoDepuis(nom: string): string | null {
  const base = nom
    .normalize('NFD')
    // Les diacritiques deviennent leur lettre nue : « Zoé Müller » → `zoemuller`,
    // et non `zomuller`, qui perdrait une lettre.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, MAX);
  if (base.length < MIN) return null;
  // Un pseudo entièrement numérique est refusé par l'instance. Le nom qui le
  // produirait n'était de toute façon pas un nom.
  if (!/[a-z]/.test(base)) return null;
  return base;
}

/**
 * Les candidats à essayer dans l'ordre, du plus propre au plus résigné.
 *
 * Clerk refuse un pseudo déjà pris ; il n'existe pas d'appel « est-il libre ? »
 * côté client. On tente donc, et on retombe sur le suivant. Six essais : au
 * delà, l'insistance coûte plus que le pseudo ne vaut, et il reste dérivable
 * plus tard.
 */
export function candidatsPseudo(nom: string, essais = 6): string[] {
  const base = pseudoDepuis(nom);
  if (!base) return [];
  const suite = [base];
  for (let n = 2; suite.length < essais; n += 1) {
    const suffixe = String(n);
    suite.push(base.slice(0, MAX - suffixe.length) + suffixe);
  }
  return suite;
}
