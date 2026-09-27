import { uiLanguage } from '@/i18n/current';
// Où se trouve le joueur, à l'échelle qui compte pour la saisonnalité.
//
// Le problème que ça règle : `species_seasons` n'avait qu'une région, `FR`, et
// personne ne la demandait — le backend retombait sur un défaut codé en dur.
// Un joueur à Johannesburg recevait la saisonnalité française.
//
// L'échelle des sources, du plus fiable au dernier recours :
//
//   1. DÉCLARÉE   ce qu'il a répondu à l'onboarding. Explicite, donc prioritaire
//                 sur tout le reste — c'est la seule qui sait qu'un Français
//                 vit en Afrique du Sud.
//   2. APPAREIL   `expo-localization`. Le téléphone connaît déjà son pays, sans
//                 aucune permission et dès la première frame. C'est le socle :
//                 refuser la question ne coûte rien.
//   3. MONDE      téléphone sans région configurée. Cas de bord.
//
// Ce qui n'est PAS dans cette échelle, et pourquoi : la déduction par l'espèce
// photographiée. Un pigeon est observé sur tous les continents, et la
// distribution GBIF par pays reflète où sont les OBSERVATEURS — massivement les
// États-Unis, le Royaume-Uni et les Pays-Bas — pas où est le joueur. Un pigeon
// parisien aurait répondu « États-Unis ».
//
// Le GPS n'y est pas non plus : il donne des coordonnées, pas un pays, et le
// convertir demanderait un géocodage inverse pour le seul cas de l'expatrié
// dont le téléphone est resté au pays. Il sert la carte des captures, qui a
// besoin d'une précision que le pays ne donne pas.
// ponytail: si le cas expatrié se voit, `reverseGeocodeAsync` sur une capture
// située donnerait le pays réel en un appel, à insérer en tête de l'échelle.

/** Le repli quand aucune source ne sait. La table le connaît sous ce nom. */
export const WORLD_REGION = 'GLOBAL';

/**
 * Les pays proposés à l'onboarding, et les seuls pour lesquels le script de
 * saisonnalité construit des données. Ailleurs, `GLOBAL` prend le relais —
 * mieux vaut une liste mondiale honnête qu'une liste française déguisée.
 *
 * L'ordre est celui de la liste : les continents groupés, pour qu'on trouve le
 * sien sans lire les quarante lignes.
 */
const REGION_NAMES: { code: string; fr: string; en: string }[] = [
  { code: 'FR', fr: 'France', en: 'France' },
  { code: 'BE', fr: 'Belgique', en: 'Belgium' },
  { code: 'CH', fr: 'Suisse', en: 'Switzerland' },
  { code: 'GB', fr: 'Royaume-Uni', en: 'United Kingdom' },
  { code: 'ES', fr: 'Espagne', en: 'Spain' },
  { code: 'PT', fr: 'Portugal', en: 'Portugal' },
  { code: 'IT', fr: 'Italie', en: 'Italy' },
  { code: 'DE', fr: 'Allemagne', en: 'Germany' },
  { code: 'NL', fr: 'Pays-Bas', en: 'Netherlands' },
  { code: 'MA', fr: 'Maroc', en: 'Morocco' },
  { code: 'DZ', fr: 'Algérie', en: 'Algeria' },
  { code: 'TN', fr: 'Tunisie', en: 'Tunisia' },
  { code: 'SN', fr: 'Sénégal', en: 'Senegal' },
  { code: 'CI', fr: 'Côte d’Ivoire', en: 'Côte d’Ivoire' },
  { code: 'CM', fr: 'Cameroun', en: 'Cameroon' },
  { code: 'ZA', fr: 'Afrique du Sud', en: 'South Africa' },
  { code: 'KE', fr: 'Kenya', en: 'Kenya' },
  { code: 'TZ', fr: 'Tanzanie', en: 'Tanzania' },
  { code: 'US', fr: 'États-Unis', en: 'United States' },
  { code: 'CA', fr: 'Canada', en: 'Canada' },
  { code: 'MX', fr: 'Mexique', en: 'Mexico' },
  { code: 'BR', fr: 'Brésil', en: 'Brazil' },
  { code: 'AR', fr: 'Argentine', en: 'Argentina' },
  { code: 'AU', fr: 'Australie', en: 'Australia' },
  { code: 'NZ', fr: 'Nouvelle-Zélande', en: 'New Zealand' },
  { code: 'IN', fr: 'Inde', en: 'India' },
  { code: 'JP', fr: 'Japon', en: 'Japan' },
  { code: 'ID', fr: 'Indonésie', en: 'Indonesia' },
];

export const SEASON_REGIONS: { readonly code: string; readonly label: string }[] = REGION_NAMES.map(({ code, fr, en }) => ({
  code,
  get label() { return uiLanguage() === 'fr' ? fr : en; },
}));

export type RegionSource = 'declared' | 'device' | 'world';

export type ResolvedRegion = {
  /** Code ISO à deux lettres, ou `GLOBAL`. */
  code: string;
  source: RegionSource;
};

/**
 * Le joueur a explicitement refusé de répondre. Distinct de « pas encore
 * demandé » : on ne le relance pas, et on retombe sur l'appareil sans bruit.
 */
export const REGION_DECLINED = 'declined';

export function resolveRegion(input: {
  /** Réponse à l'onboarding : un code ISO, `REGION_DECLINED`, ou rien. */
  declared?: string | null;
  /** `getLocales()[0].regionCode`. */
  deviceRegion?: string | null;
}): ResolvedRegion {
  const declared = normalize(input.declared);
  if (declared && declared !== REGION_DECLINED.toUpperCase()) {
    return { code: declared, source: 'declared' };
  }
  // La région de l'appareil peut être n'importe quel pays du monde ; on ne la
  // retient que si on a de quoi la servir. Sans ce filtre, quelqu'un au Vietnam
  // verrait « SAISON · AOÛT · VIETNAM » au-dessus d'une liste mondiale — le
  // serveur bascule bien, mais l'en-tête mentirait sur ce qu'il montre.
  const device = normalize(input.deviceRegion);
  if (device && SEASON_REGIONS.some((region) => region.code === device)) {
    return { code: device, source: 'device' };
  }
  return { code: WORLD_REGION, source: 'world' };
}

/**
 * Les codes arrivent de trois endroits qui ne s'accordent pas sur la casse :
 * la colonne Postgres, iOS (`fr-FR` → `FR`) et Android. Un `FR` contre `fr`
 * ferait manquer la seule région qui a des données.
 */
function normalize(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toUpperCase();
  if (trimmed.length !== 2 && trimmed !== WORLD_REGION) return null;
  return trimmed;
}

/** Le nom du pays, ou le code si on ne le connaît pas — jamais rien. */
export function regionLabel(code: string): string {
  if (code === WORLD_REGION) return uiLanguage() === 'fr' ? 'Monde' : 'World';
  return SEASON_REGIONS.find((region) => region.code === code)?.label ?? code;
}
