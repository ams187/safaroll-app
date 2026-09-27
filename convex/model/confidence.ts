export const MIN_CONFIDENCE = 0.45;
export const MIN_TOP_TWO_MARGIN = 0.12;

export function needsAnimalReview(scores: readonly number[]) {
  const best = scores[0];
  if (best === undefined) return true;
  return best < MIN_CONFIDENCE || best - (scores[1] ?? 0) < MIN_TOP_TWO_MARGIN;
}
