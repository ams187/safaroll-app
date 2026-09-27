// Ce qui décide qu'une espèce est commune ou légendaire.
//
// UNE SEULE RÈGLE, ET ELLE EST OBJECTIVE
//
// Le nombre d'observations de l'espèce dans GBIF, à l'échelle du monde. Un
// chiffre, une source, aucune décision à la main — et il existe pour les deux
// millions d'espèces décrites, pas seulement pour celles qu'on a listées. C'est
// ce qui permet à une espèce jamais prévue d'obtenir sa rareté à la seconde où
// quelqu'un la photographie.
//
// Mesuré, et le classement tombe juste :
//
//   Moineau              25 841 840   commun
//   Pigeon biset         15 559 681   commun
//   Cygne tuberculé       6 718 119   commun
//   Renard roux           2 010 100   commun
//   Aigle royal             918 519   commun
//   Flamant rose            555 518   commun
//   Koala                   397 180   commun
//   Manchot empereur        132 361   peu commun
//   Perruche ondulée        118 422   peu commun
//   Lion                     19 010   rare
//   Guépard                  10 050   rare
//   Tigre                     7 976   ultra rare
//   Girafe                    6 776   ultra rare
//   Axolotl                     934   légendaire
//   Panthère des neiges         606   légendaire
//   Panda géant                 300   légendaire
//
// OUI, L'AIGLE ROYAL EST « COMMUN »
//
// Il totalise 918 519 observations : c'est l'un des oiseaux les plus enregistrés
// de l'hémisphère nord, largement réparti et très suivi par les ornithologues.
// Aucun seuil ne peut le rendre rare sans rendre le moineau rare aussi — testé,
// mesuré : monter la barre du commun à 500 000 le laisse commun et fait tomber
// le lion en ultra rare, ce qui casse tout le reste.
//
// CE QUE LA RARETÉ N'EST PAS
//
// Ce n'est pas la beauté. Le flamant rose ressort « peu commun » alors qu'il
// fait une carte splendide, et c'est normal : il vit en colonies de milliers
// d'individus dans des zones humides pleines d'ornithologues. Le rendre
// légendaire parce qu'il est rose, c'est faire dire au mot deux choses à la
// fois — et le mot ne veut alors plus rien dire pour personne.
//
// La beauté a son propre levier, et il est déjà en place : l'illustration
// authored (`card-scenes`) et le foil dédié (`cardSceneHoloFor`, où le flamant
// a déjà sa palette rien qu'à lui). Un Pikachu commun a des versions full art
// somptueuses sans cesser d'être commun.
//
// Ce n'est pas non plus la rareté LOCALE. Celle-là dépend d'où on se trouve, et
// une rareté qui change avec le lieu donnerait deux cartes différentes du même
// animal à deux joueurs — le classement ne comparerait plus rien. Elle reste,
// mais comme un fait sur la rencontre : « 3ᵉ observation dans ta zone », un
// badge, jamais une note.

/** Les cinq paliers. Déclarés ici plutôt qu'importés de l'app : ce fichier est
 *  lu par Deno dans l'edge function, qui ne voit pas `src/`. `Rarity` de
 *  `src/lib/birds/rarity.ts` est le même union — `check-species-rarity.ts` le
 *  vérifie en compilant les deux ensemble. */
export type Rarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'very_rare'
  | 'ultra_rare'
  | 'epic'
  | 'mythic'
  | 'legendary';

/**
 * Les seuils, en observations mondiales. FIGÉS.
 *
 * D'OÙ ILS VIENNENT
 *
 * Pas de l'intuition. La première version l'avait fait — des seuils choisis
 * pour que seize espèces connues tombent « bien » — et appliquée aux 3 558
 * espèces du catalogue elle produisait 41 % de rares et 1 % de communes. Une
 * pyramide à l'envers, où « rare » ne veut plus rien dire.
 *
 * La cause tient en un chiffre : la médiane du catalogue est à 97 090
 * observations. La moitié des espèces qu'un joueur peut collectionner sont déjà
 * rares à l'échelle de la planète — c'est une ménagerie, pas un échantillon de
 * la faune. Un seuil « 50 000 = rare » y range donc la moitié du jeu.
 *
 * Ces valeurs-ci sont lues DANS la distribution réelle, aux centiles qui
 * donnent la forme qu'un jeu de cartes demande, puis arrondies.
 *
 * CE QUE LA RÉPARTITION DU CATALOGUE N'EST PAS
 *
 * Sur les 5 799 espèces, elle donne :
 *
 *   commun      23,8 %   1 382 espèces
 *   ultra rare  22,9 %   1 328
 *   rare        20,6 %   1 197
 *   peu commun  17,8 %   1 033
 *   légendaire  14,8 %     859
 *
 * 15 % de légendaires paraît énorme, et ce chiffre ne décrit pourtant PAS ce
 * qu'un joueur vivra. Le catalogue contient 3 400 espèces venues du balayage
 * par familles — le trentième singe d'une famille de cent, présent pour que le
 * zoo qui l'expose soit couvert. Personne ne le photographiera. Ce qu'un joueur
 * rencontre vraiment, ce sont les espèces très observées, donc communes.
 *
 * Recalibrer sur ces centiles-là a été essayé et rejeté : la pyramide devenait
 * jolie (41 / 29 / 15 / 11 / 4) mais le tigre tombait « peu commun » et le
 * panda « ultra rare ». Une statistique flatteuse qui ment sur chaque carte que
 * le joueur regardera ne vaut rien. Les repères priment.
 *
 * POURQUOI DES NOMBRES FIXES ET PAS DES CENTILES
 *
 * Une rareté en centiles se déplacerait à chaque espèce ajoutée : la carte d'un
 * joueur changerait d'apparence sans qu'il ait rien fait, et deux joueurs
 * verraient le même animal à deux raretés différentes. Le calibrage se fait une
 * fois, ici, et ce qui en sort ne bouge plus. `scripts/calibrate-rarity.ts`
 * refait la mesure si le catalogue change au point de le justifier — mais
 * changer ces nombres, c'est repeindre des cartes déjà collectées.
 */
export const RARITY_THRESHOLDS: { min: number; rarity: Rarity }[] = [
  { min: 1_000_000, rarity: 'common' },
  { min: 200_000, rarity: 'uncommon' },
  { min: 50_000, rarity: 'rare' },
  { min: 10_000, rarity: 'very_rare' },
  { min: 3_000, rarity: 'ultra_rare' },
  { min: 1_000, rarity: 'epic' },
  { min: 300, rarity: 'mythic' },
  { min: 0, rarity: 'legendary' },
];

/**
 * La rareté d'une espèce, depuis son compteur mondial GBIF.
 *
 * `undefined` quand le compteur est absent ou aberrant — pas `legendary`. Une
 * requête ratée donnerait sinon une carte légendaire à un moineau, et le joueur
 * n'aurait aucun moyen de savoir que c'est une panne.
 */
export function rarityFromOccurrences(count: unknown): Rarity | undefined {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return undefined;
  return RARITY_THRESHOLDS.find((tier) => count >= tier.min)?.rarity;
}
