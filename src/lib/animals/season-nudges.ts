/**
 * Why come back tomorrow.
 *
 * GBIF monthly counts describe historical observation patterns, not live
 * sightings or a guarantee that an animal is present. Copy must keep that
 * distinction, even when a curve suggests an arrival or departure.
 *
 * Pure functions — no notification API or backend — so the phrasing is
 * testable and the scheduling layer stays thin.
 */

export type SeasonCurve = {
  scientificName: string;
  /** Index 0 = January. Raw GBIF occurrence counts. */
  monthlyCounts: number[];
};

export type Nudge = {
  body: string;
  kind: 'leaving' | 'arriving' | 'peak';
  scientificName: string;
  title: string;
  /** 0..1 — used to pick the single best nudge of the day. */
  urgency: number;
};

/**
 * A month counts as "present" when it reaches 40% of the average month.
 *
 * Not a flat 1/12 share: a species observed evenly all year sits *at* 1/12
 * every month, so a `> 1/12` test would call a resident blackbird absent
 * twelve months out of twelve. Measuring against the mean instead separates
 * "quiet month" from "gone".
 */
const PRESENT_FRACTION_OF_MEAN = 0.4;
const MONTH_NAMES = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
} as const;

function presenceMask(counts: number[]): boolean[] {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return counts.map(() => false);
  const floor = (total / 12) * PRESENT_FRACTION_OF_MEAN;
  return counts.map((value) => value >= floor);
}

/** Species present all year have no season to announce. */
export function isResident(counts: number[]): boolean {
  return presenceMask(counts).filter(Boolean).length >= 11;
}

/*
 * LE NOM DE L'ESPÈCE EST LE TITRE, ET C'EST UNE DÉCISION DE LANGUE.
 *
 * Écrit dans la phrase, il exige un article que le catalogue ne porte pas :
 * « LE martinet noir » mais « LA grue cendrée ». Sans genre en base, toute
 * formulation aurait été fausse une fois sur deux — et une faute d'accord dans
 * une notification détruit plus de crédit qu'un beau message n'en construit.
 *
 * Placé en titre, il n'a besoin d'aucun article. Le corps se passe alors aussi
 * de pronom (« Les observations diminuent » plutôt que « il part »), ce qui le
 * rend juste pour toutes les espèces, dans les deux langues, sans table de
 * genres à tenir.
 *
 * Et c'est meilleur : sur un écran verrouillé, le titre est en gras. Le nom de
 * l'animal y frappe, l'enjeu suit en dessous.
 */

/**
 * Le prochain mois au-dessus du seuil d'observations, pas un retour garanti.
 */
function moisDeRetour(present: boolean[], depuis: number): number | null {
  for (let pas = 2; pas < 12; pas += 1) {
    const mois = (depuis + pas) % 12;
    if (present[mois]) return mois;
  }
  return null;
}

export function nudgeFor(
  curve: SeasonCurve,
  commonName: string,
  month: number,
  language: 'en' | 'fr' = 'fr',
): Nudge | null {
  const counts = curve.monthlyCounts;
  if (counts.length !== 12 || counts.some(value => !Number.isFinite(value) || value < 0)
    || !Number.isInteger(month) || month < 0 || month > 11) return null;
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total < 24 || isResident(counts)) return null;

  const present = presenceMask(counts);
  const now = present[month];
  const next = present[(month + 1) % 12];
  const previous = present[(month + 11) % 12];
  const share = counts[month] / total;

  if (now && !next) {
    // Describe the curve without inventing a deadline for photographing.
    const retour = moisDeRetour(present, month);
    return {
      body: language === 'fr'
        ? retour === null
          ? `Les observations diminuent après ${MONTH_NAMES.fr[month]}. Une piste pour ta prochaine balade.`
          : `Les observations diminuent après ${MONTH_NAMES.fr[month]} et remontent en ${MONTH_NAMES.fr[retour]}. Garde l’œil ouvert !`
        : retour === null
          ? `Sightings decrease after ${MONTH_NAMES.en[month]}. An idea for your next walk.`
          : `Sightings decrease after ${MONTH_NAMES.en[month]} and rise in ${MONTH_NAMES.en[retour]}. Keep an eye out!`,
      kind: 'leaving',
      scientificName: curve.scientificName,
      title: commonName,
      urgency: 0.9 + share * 0.1,
    };
  }
  if (now && !previous) {
    return {
      // Historical observations are not a live sighting report.
      body: language === 'fr'
        ? 'Les observations augmentent à cette période de l’année. Une piste pour ta prochaine balade.'
        : 'Sightings increase at this time of year. An idea for your next walk.',
      kind: 'arriving',
      scientificName: curve.scientificName,
      title: commonName,
      urgency: 0.7 + share * 0.1,
    };
  }
  const peakMonth = counts.indexOf(Math.max(...counts));
  if (now && peakMonth === month && share > 0.2) {
    return {
      // More observations do not guarantee easier encounters.
      body: language === 'fr'
        ? `C’est en ${MONTH_NAMES.fr[month]} que les observations sont les plus nombreuses. Garde l’œil ouvert !`
        : `Sightings are most frequent in ${MONTH_NAMES.en[month]}. Keep an eye out!`,
      kind: 'peak',
      scientificName: curve.scientificName,
      title: commonName,
      urgency: 0.5 + share * 0.2,
    };
  }
  return null;
}

/**
 * One nudge a day, at most. A notification that fires twice is uninstalled
 * twice as fast — pick the single most urgent species the player is missing.
 */
export function pickDailyNudge(
  candidates: { commonName: string; curve: SeasonCurve }[],
  ownedScientificNames: Set<string>,
  month: number,
  language: 'en' | 'fr' = 'fr',
): Nudge | null {
  const nudges = candidates
    .filter((candidate) => !ownedScientificNames.has(candidate.curve.scientificName))
    .map((candidate) => nudgeFor(candidate.curve, candidate.commonName, month, language))
    .filter((nudge): nudge is Nudge => nudge !== null)
    .sort((a, b) => b.urgency - a.urgency);
  return nudges[0] ?? null;
}
