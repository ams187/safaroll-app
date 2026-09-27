// Quels candidats un joueur a le droit de choisir pour corriger une carte.
//
// POURQUOI CETTE RÈGLE EXISTE
//
// Le modèle se trompe en étant sûr de lui — sur un paresseux à crinière il a
// rendu « paresseux à trois doigts » à 55 % contre 14 % au bon. Le joueur, qui
// était devant l'animal, doit pouvoir rectifier.
//
// Mais laisser choisir l'espèce, c'est laisser choisir la rareté. Sans plancher,
// on pouvait viser le 5ᵉ candidat à 3 % uniquement parce qu'il était légendaire.
//
// LE PLANCHER
//
// Un candidat est recevable s'il pèse au moins 5 % ET au moins un cinquième du
// premier. Autrement dit : il faut que le modèle ait VRAIMENT hésité — ce qui
// est précisément le cas quand il se trompe. Sur l'exemple ci-dessus, le
// paresseux à crinière passe (14,5 % contre un plancher à 11,1 %) et les trois
// suivants sont écartés.
//
// La règle est dupliquée dans `confirm_capture_identification` côté base, et
// c'est LÀ qu'elle protège : un filtre d'écran ne fait qu'éviter de proposer un
// bouton qui lèverait une exception. `scripts/check-correction.ts` garde les
// deux copies d'accord.

/** Part minimale de confiance absolue. */
export const MIN_CANDIDATE_CONFIDENCE = 0.05;
/** Et part minimale relative au premier candidat. */
export const MIN_CANDIDATE_RATIO = 1 / 5;

type Candidate = { confidence: number; scientificName: string };

/**
 * Les candidats proposables, hors espèce déjà retenue.
 *
 * `chosen` est l'espèce actuelle de la capture : la reproposer n'aurait aucun
 * sens, et la base la refuserait de toute façon comme un non-changement.
 */
export function correctableCandidates<T extends Candidate>(
  candidates: readonly T[] | undefined,
  chosen: string | undefined,
): T[] {
  if (!candidates || candidates.length === 0) return [];
  const best = candidates.reduce(
    (top, candidate) => Math.max(top, candidate.confidence ?? 0),
    0,
  );
  if (best <= 0) return [];
  return candidates.filter(
    (candidate) =>
      candidate.scientificName !== chosen
      && candidate.confidence >= MIN_CANDIDATE_CONFIDENCE
      && candidate.confidence >= best * MIN_CANDIDATE_RATIO,
  );
}
