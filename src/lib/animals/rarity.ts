import { uiLanguage } from '@/i18n/current';
import type { CardRarity, LocalEncounterRarity } from './progression';

export type Rarity = CardRarity;

/**
 * Rarity decides how *loud* a card is, never what it looks like: the shader,
 * the foil texture and the palette come from the capture itself (see
 * `card-identity.ts`), exactly like two Pokémon cards of the same rarity have
 * different art. Here lives only the frame, the plate and which layers are lit.
 */
export type RarityTier = {
  key: Rarity;
  label: string;
  /** Card body behind the shader, and the well behind a grid tile's animal. */
  base: string;
  /** Frame, plate and star color. */
  accent: string;
  /** Text and scrims drawn over `accent`. */
  onAccent: string;
  /** Fallback foil colors, used where a card has no identity (locked slots). */
  holo: string[];
  /** Opacity of the printed foil texture layer, 0..1. */
  foil: number;
  /** How much holographic shimmer paints the animal itself, 0..1. */
  subjectHolo: number;
  /** How hard the white gloss sweep hits, 0..1. */
  gloss: number;
  /**
   * How heavy the card's frame is, relative to a common's.
   *
   * Rarity used to speak in stars. It no longer does: stars count mastery
   * levels now, and one symbol cannot mean two things. So rarity moved to the
   * edge of the card, where thickness is the whole voice — a legendary is a
   * card you can pick out of a grid without reading anything on it.
   */
  frameWeight: number;
};

/**
 * The frame's width for a card of this width. Scaled, not fixed: 5pt is a bold
 * rim on a 340pt card and a picture mount on a 64pt tile, so the same animal
 * would read as two different rarities depending on where you saw it.
 *
 * The floor is on the BASE and the weight multiplies it, not the other way
 * round. Flooring the result instead clamped common and uncommon to the same
 * hairline on anything under ~90pt — two tiers, one frame, on exactly the
 * screen where the frame is the only thing left to read.
 */
export function frameWidthFor(tier: RarityTier, width: number): number {
  return Math.max(1, width * 0.006) * tier.frameWeight;
}

const TIER_LABELS = {
  fr: {
    common: 'COMMUN', uncommon: 'PEU COMMUN', rare: 'RARE', very_rare: 'TRÈS RARE',
    ultra_rare: 'ULTRA RARE', epic: 'ÉPIQUE', mythic: 'MYTHIQUE', legendary: 'LÉGENDAIRE',
    unknown: 'INCONNU',
  },
  en: {
    common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE', very_rare: 'VERY RARE',
    ultra_rare: 'ULTRA RARE', epic: 'EPIC', mythic: 'MYTHIC', legendary: 'LEGENDARY',
    unknown: 'UNKNOWN',
  },
} as const;

export const RARITY_TIERS: Record<Rarity, RarityTier> = {
  common: {
    key: 'common',
    get label() { return TIER_LABELS[uiLanguage()].common; },
    base: '#22262e',
    accent: '#9aa4b4',
    onAccent: '#16181d',
    holo: ['#6f7787', '#c9d2de', '#8b94a4', '#e6ebf2', '#6f7787'],
    foil: 0.24,
    subjectHolo: 0.14,
    gloss: 0.3,
    frameWeight: 1,
  },
  uncommon: {
    key: 'uncommon',
    get label() { return TIER_LABELS[uiLanguage()].uncommon; },
    base: '#2b1e14',
    accent: '#d1894f',
    onAccent: '#1d1109',
    holo: ['#8a4a1f', '#f0b071', '#ffd9a8', '#d1894f', '#8a4a1f'],
    foil: 0.38,
    subjectHolo: 0.24,
    gloss: 0.42,
    frameWeight: 1.2,
  },
  rare: {
    key: 'rare',
    get label() { return TIER_LABELS[uiLanguage()].rare; },
    base: '#161b2c',
    accent: '#7f9dff',
    onAccent: '#0d1120',
    holo: ['#ff3b6b', '#ff9500', '#ffe14c', '#3ddc97', '#39b8ff', '#7f6bff', '#ff3b6b'],
    foil: 0.52,
    subjectHolo: 0.34,
    gloss: 0.54,
    frameWeight: 1.45,
  },
  // Le palier qui manquait le plus : lion, guépard, zèbre et éléphant
  // d'Afrique partageaient « ultra rare » avec le tigre et la girafe.
  very_rare: {
    key: 'very_rare',
    get label() { return TIER_LABELS[uiLanguage()].very_rare; },
    base: '#0f2027',
    accent: '#54d0c8',
    onAccent: '#08161a',
    holo: ['#00c2a8', '#4be0d0', '#a8f4ea', '#2fb6c9', '#00c2a8'],
    foil: 0.64,
    subjectHolo: 0.43,
    gloss: 0.66,
    frameWeight: 1.7,
  },
  ultra_rare: {
    key: 'ultra_rare',
    get label() { return TIER_LABELS[uiLanguage()].ultra_rare; },
    base: '#20142e',
    accent: '#c995ff',
    onAccent: '#160d20',
    holo: ['#ff3bd4', '#9b5cff', '#39c8ff', '#55f2c2', '#ffe36b', '#ff3bd4'],
    foil: 0.75,
    subjectHolo: 0.52,
    gloss: 0.76,
    frameWeight: 1.95,
  },
  // Épique, mythique, légendaire : le trio que tout joueur lit sans réfléchir.
  // Ils partagent la famille `swsecret` côté effets, donc ils doivent se
  // distinguer par la couleur et le poids du cadre, pas par le foil seul.
  epic: {
    key: 'epic',
    get label() { return TIER_LABELS[uiLanguage()].epic; },
    base: '#2a0f18',
    accent: '#ff6b8a',
    onAccent: '#1c0810',
    holo: ['#ff2d6f', '#ff7ab0', '#ffc2d6', '#ff4f8f', '#ff2d6f'],
    foil: 0.85,
    subjectHolo: 0.6,
    gloss: 0.85,
    frameWeight: 2.2,
  },
  mythic: {
    key: 'mythic',
    get label() { return TIER_LABELS[uiLanguage()].mythic; },
    base: '#0d1f14',
    accent: '#6bffae',
    onAccent: '#07140c',
    holo: ['#00ff9a', '#6bffae', '#c2ffe0', '#00e0c8', '#00ff9a'],
    foil: 0.93,
    subjectHolo: 0.66,
    gloss: 0.93,
    frameWeight: 2.4,
  },
  legendary: {
    key: 'legendary',
    get label() { return TIER_LABELS[uiLanguage()].legendary; },
    base: '#1a1305',
    accent: '#ffca4b',
    onAccent: '#241a04',
    holo: ['#ff00c8', '#7a2bff', '#00b3ff', '#00ffc6', '#ffe14c', '#ff5a2b', '#ff00c8'],
    foil: 1,
    subjectHolo: 0.72,
    gloss: 1,
    frameWeight: 2.6,
  },
};

export const RARITY_ORDER: Rarity[] = [
  'common', 'uncommon', 'rare', 'very_rare', 'ultra_rare', 'epic', 'mythic', 'legendary',
];

/** Locked slots and still-processing captures render on this neutral tier. */
export const UNKNOWN_TIER: RarityTier = {
  ...RARITY_TIERS.common,
  get label() { return TIER_LABELS[uiLanguage()].unknown; },
  base: '#1b1e24',
  accent: '#4b525e',
  onAccent: '#0f1114',
  holo: ['#3a4049', '#5c6474', '#3a4049'],
  foil: 0.15,
  subjectHolo: 0,
  gloss: 0.2,
  frameWeight: 0.8,
};

export function tierFor(rarity?: Rarity | null): RarityTier {
  return rarity ? RARITY_TIERS[rarity] : UNKNOWN_TIER;
}

/**
 * Which of a capture's two rarities grades the card — the ONE answer, because
 * six screens used to spell it out and they must never disagree.
 *
 * `rarity` is the species' own, copied from the catalogue: the same animal is
 * the same card for every player on earth, which is what makes a card worth
 * showing to someone.
 *
 * `localEncounterRarity` ne subsiste QUE comme roue de secours, et n'est plus
 * jamais montré : c'est une observation sauvage GBIF dans un carré de ±1°, ce
 * qui est faux dès qu'on photographie derrière une clôture. Un flamant rose au
 * zoo de Vincennes compte 3 observations sauvages autour de Paris, un lion
 * zéro. Les phrases « très rare ici » et « fréquence inconnue » qu'on en tirait
 * sont parties avec `local-rarity.ts`.
 *
 * Il reste ici parce que les animaux hors atlas — voyageurs, égarés — n'ont
 * aucune entrée au catalogue : sans lui leur carte tombe sur `UNKNOWN_TIER` et
 * s'affiche « INCONNU », zéro étoile. Une note approximative vaut mieux que
 * pas de carte.
 */
export function cardRarity(capture?: {
  localEncounterRarity?: LocalEncounterRarity | null;
  rarity?: Rarity | null;
}): Rarity | undefined {
  return capture?.rarity ?? capture?.localEncounterRarity ?? undefined;
}
