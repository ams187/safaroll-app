// CE QUI NE PART PAS AU LANCEMENT.
//
// Trois fonctions finies mais mises de côté pour la première version : le
// Leaderboard, le Livre et le Cercle. Le code reste entier — écrans, requêtes, contrôles —
// seuls leurs points d'entrée sont coupés.
//
// POURQUOI UN DRAPEAU ET PAS UNE SUPPRESSION
//
// Commenter des blocs de JSX les fait pourrir : ils ne compilent plus, ne sont
// plus typés, et le jour où on les rallume, la moitié des identifiants a bougé
// sous eux. Ici tout reste compilé et vérifié par `tsc` ; rallumer, c'est passer
// une constante à `true`.
//
// CE QUE ÇA NE FAIT PAS : les routes `/community` et `/book` restent déclarées.
// Elles ne sont plus atteignables depuis l'interface, mais un lien profond y
// mène encore. C'est volontaire — on veut pouvoir les ouvrir en interne pour
// tester — et sans conséquence tant qu'aucun écran n'y renvoie.

/** Le Leaderboard : podium, registre, cinq mesures. */
export const LEADERBOARD_ACTIF = false;

/** Le Livre : l'histoire du joueur année par année, et son export PDF. */
export const LIVRE_ACTIF = false;

/**
 * Le Cercle : les amis, les demandes, la recherche par identifiant.
 *
 * COUPÉ, ET ÇA REND LA V1 ENTIÈREMENT SOLO. Il faut le savoir, parce que la
 * conséquence dépasse un menu : la galerie de decks publics `(tidy)` porte déjà
 * `href: null` et rien ne l'ouvre. Le cercle était donc le DERNIER chemin vers
 * le contenu d'un autre joueur — sa fiche, ses decks. Sans lui, plus aucun
 * contenu d'autrui n'est atteignable dans l'app.
 *
 * CE QUI EN DÉCOULE
 *   · la classification d'âge n'a plus de contenu généré par les utilisateurs
 *     à déclarer ;
 *   · le signalement et le blocage restent en place (`@/components/moderation`)
 *     et ne coûtent rien — ils redeviendront nécessaires le jour du rallumage ;
 *   · publier un deck n'a plus de public. Le bouton reste, voir la note de
 *     `(tabs)/(deck)/[id].tsx`.
 */
export const CERCLE_ACTIF = false;

/**
 * LA CARTE D'ACTIVITÉ QUI SE RETOURNE, dans le profil.
 *
 * Le bandeau de progression basculait au doigt pour montrer une grille de
 * contributions façon GitHub — un jour par case, teintée par le nombre de
 * captures. Le rendu marche ; c'est le GESTE qui pose problème : rien n'annonce
 * qu'un bandeau d'apparence statique est retournable, donc on le découvre par
 * accident, et on le redéclenche par accident en visant autre chose.
 *
 * Coupé, le bandeau redevient un simple bloc. `GitHubContributions` reste
 * compilé et typé — rallumer, c'est repasser cette constante à `true`.
 */
export const GRILLE_ACTIVITE_ACTIVE = false;

/**
 * LE WIDGET DECK, coupé pour la v1.
 *
 * Le point d'entrée est retiré côté Swift (`targets/widget/index.swift`), donc
 * la tuile n'apparaît plus dans la galerie d'iOS. Ce drapeau-ci coupe l'autre
 * bout : `DeckWidgetPainter` monte une vue, la photographie et écrit un PNG
 * dans l'App Group à chaque changement de deck. Du travail réel, pour une
 * image que plus personne ne lit.
 *
 * Les deux vont ensemble. Rallumer, c'est cette constante ET la ligne
 * `DeckWidget()` dans le bundle.
 */
export const WIDGET_DECK_ACTIF = false;

/**
 * LE REFUS DES PELUCHES ET DES ÉCRANS, coupé pour la v1.
 *
 * POURQUOI, ET CE QUE ÇA DIT DU SEUIL
 *
 * `VNClassifyImageRequest` sait reconnaître une peluche, mais sa taxonomie
 * range aussi sous « contrefaçon » ce qui n'en est pas une pour le joueur :
 * `screenshot`, `television`, `painting`. Mesuré sur des captures réelles, un
 * animal photographié dehors sortait à `faux=0.25` à `0.28` — sous le plancher
 * de 0,35, mais assez près pour qu'une photo un peu plate bascule. Le refus
 * tombait alors sur une vraie rencontre, et une rencontre refusée ne revient
 * pas.
 *
 * Le sens de l'erreur est celui de tout ce chemin : laisser passer une peluche
 * coûte une carte à supprimer, refuser un vrai animal coûte un moment.
 *
 * CE QUI RESTE ALLUMÉ : le refus « aucun animal » (`SEUIL_AUCUN_ANIMAL`), qui
 * juge la présence d'un animal et non sa nature — il n'a jamais posé problème.
 * Et le garde anti-écran par moiré (`screen-capture-guard.ts`), qui mesure la
 * trame d'un écran au lieu de deviner depuis une étiquette.
 *
 * Rallumer, c'est repasser cette constante à `true` : le calcul natif, les
 * seuils, l'écran de refus et sa traduction restent compilés et typés.
 */
export const REFUS_CONTREFACON_ACTIF = false;

/**
 * Le conseil « animal coupé », désactivé tant que sa détection produit des
 * faux positifs. Ce même drapeau coupe le viseur en direct et l'avertissement
 * après la photo ; le remettre à `true` rallume les deux.
 */
export const ANIMAL_COUPE_ACTIF = false;

/**
 * LE GARDE « ÇA, C'EST UN ÉCRAN », coupé le 25/09/2026.
 *
 * Mesuré sur le terrain : il refusait de VRAIS animaux — vitres d'animalerie,
 * et un chat photographié à bout de bras dans une résidence. Le sous-
 * échantillonnage au plus proche voisin replie le pelage et l'éclairage LED en
 * un « moiré » que le score prend pour une grille de pixels.
 *
 * Même arbitrage que le refus des contrefaçons : laisser passer une photo
 * d'écran coûte une carte à supprimer, refuser un vrai animal coûte une
 * rencontre. Le portail « aucun animal » (classifieur d'Apple) reste allumé.
 * Rallumer : repasser à `true`, après un réglage du seuil mesuré sur des
 * photos réelles.
 */
export const GARDE_ECRAN_ACTIF = false;
