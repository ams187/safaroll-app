import { uiLanguage } from '@/i18n/current';
// Pure module: no assets, no Skia — so the check script can run it under plain
// `bun`. The holo effects themselves live in `fx/effects` (the Skia port of
// simeydotme/pokemon-cards-css); this module only decides which one a card
// wears and which colours dress the rest of it.
import type { Rarity } from '@/lib/animals/rarity';
import type { EffectKey } from './fx/effects/types';
import { hexToHsl, hslToHex, hueDelta, meanHue, rotatePalette } from './color';

/**
 * Below this saturation an animal has no colour to speak of (a grey heron, a
 * brown hare): there is nothing to harmonise with, so the foil keeps the colours
 * of the light instead of chasing a meaningless hue.
 */
const MIN_SUBJECT_SATURATION = 0.22;

/**
 * Un palier, un traitement. Huit paliers, huit animations, choisies à l'œil.
 *
 * POURQUOI UN SEUL PAR PALIER
 *
 * Tant qu'un palier portait plusieurs effets, l'animation ne pouvait pas DIRE
 * la rareté : deux cartes ultra rares ne se ressemblaient pas, et une rare
 * pouvait paraître plus précieuse qu'elles. Avec une correspondance stricte,
 * voir la carte suffit à connaître son palier — c'est tout l'intérêt d'avoir
 * huit paliers plutôt que cinq.
 *
 * Le prix est assumé : douze des vingt effets portés ne sortent plus. Ils
 * restent dans `fx/effects` et le banc d'essai de la carte en détail les monte
 * toujours, donc rien n'est perdu — seulement mis de côté.
 *
 * CE QUI N'EST PLUS VRAI ICI
 *
 * L'ordre ne suit plus l'échelle du TCG. `radiant-holo` et `cosmos-holo` y sont
 * moins forts qu'un full art, et ils occupent pourtant mythique et légendaire.
 * C'est un choix esthétique, pris devant les cartes, et il prime : ces vingt
 * effets ont été portés pour cette app, pas pour rejouer la hiérarchie de
 * Pokémon.
 *
 * `secret-rare` (la carte or) reste hors échelle — c'est la signature de la
 * forme Éclipse.
 */
export const EFFECT_POOLS: Record<Rarity, EffectKey[]> = {
  common: ['glitter-foil'],
  uncommon: ['basic'],
  rare: ['sticker-holo'],
  very_rare: ['regular-holo'],
  ultra_rare: ['prism-foil'],
  epic: ['prism-full-art'],
  mythic: ['radiant-holo'],
  legendary: ['cosmos-holo'],
};

export function effectKeyFor({
  rarity,
  species,
}: {
  rarity?: Rarity | null;
  species: string;
}): EffectKey {
  if (!rarity) return 'basic';
  const pool = EFFECT_POOLS[rarity];
  return pool[hash(species) % pool.length];
}

export const HOLO_PALETTES = {
  /** Repo "Classic" — broad daylight, temperate latitudes. */
  daylight: ['#ff3b30', '#ff9500', '#ffcc00', '#4cd964', '#34aadc', '#5856d6', '#2e2d87'],
  /** Repo "Vaporwave" — the saturated light of the tropics. */
  tropical: ['#ff71ce', '#ff00aa', '#b967ff', '#7b5cff', '#01cdfe', '#05ffa1', '#bfff00'],
  /** Repo "Radiation" — cold, high-latitude light. */
  polar: ['#00aaff', '#00d4ff', '#00ffd0', '#00ff9a', '#00ff5e', '#39ff14', '#aaff00', '#fff700'],
} as const;

export type PaletteKey = keyof typeof HOLO_PALETTES;

export type CaptureTraits = {
  scientificName?: string;
  commonName?: string;
  taxonomy?: { class?: string; order?: string; family?: string; genus?: string };
  capturedAt?: number;
  latitude?: number;
  /** Vibrant colour of the animal itself, sampled from its cut-out. */
  dominantColor?: string;
};

export type LatitudeBand = 'tropical' | 'temperate' | 'polar' | 'unknown';

/**
 * Each branch of the tree of life is a TCG energy type: the realm sets the
 * card's default hue and gradient direction, and the energy type feeds the
 * effects that read it (reverse-holo's foil brightness, radiant-holo's glow) —
 * exactly how a printed Water card differs from a Darkness one.
 */
const REALM_LOOK: Record<string, { angle: number; energy: string; hue: number }> = {
  Aves: { angle: 180, energy: 'colorless', hue: 205 },
  Mammalia: { angle: 135, energy: 'fighting', hue: 28 },
  Actinopterygii: { angle: 100, energy: 'water', hue: 195 },
  Chondrichthyes: { angle: 100, energy: 'water', hue: 210 },
  Amphibia: { angle: 100, energy: 'water', hue: 155 },
  Reptilia: { angle: 120, energy: 'dragon', hue: 95 },
  Squamata: { angle: 120, energy: 'dragon', hue: 95 },
  Testudines: { angle: 120, energy: 'dragon', hue: 130 },
  Insecta: { angle: 160, energy: 'grass', hue: 80 },
  Arachnida: { angle: 150, energy: 'darkness', hue: 268 },
  Gastropoda: { angle: 140, energy: 'psychic', hue: 320 },
  Cephalopoda: { angle: 140, energy: 'psychic', hue: 300 },
};
const DEFAULT_LOOK = { angle: 165, energy: 'colorless', hue: 45 };

/** ±deg of species-hash jitter, so two grey birds still get two cards. */
const SPECIES_JITTER = 16;

export type CardIdentity = {
  paletteKey: PaletteKey;
  palette: string[];
  /** Degrees the palette was rotated to sit opposite the animal, 0 if none. */
  hueShift: number;
  /**
   * The card body itself, top → bottom — the saturated painted background a
   * printed card has, in this animal's own colour.
   */
  body: [string, string, string];
  /** Gradient direction for the body, CSS degrees (realm motif). */
  bodyAngle: number;
  /** Halo behind the subject. */
  glow: string;
  /**
   * The foil actually painted on this card: a narrow sweep around the card's
   * own hue instead of the broad complementary rainbow. It stays in the
   * scene's family so the shimmer looks reflected rather than painted on.
   */
  /** TCG energy type fed to the holo effects. */
  energyType: string;
  /** Human-readable trail of what produced this look. Shown on the card back. */
  reason: string;
};

/** FNV-1a. Stable across launches and devices, and spreads short names well. */
function hash(seed: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

export function latitudeBandFor(latitude?: number): LatitudeBand {
  if (latitude === undefined || !Number.isFinite(latitude)) return 'unknown';
  const absolute = Math.abs(latitude);
  if (absolute < 23.5) return 'tropical';
  if (absolute < 55) return 'temperate';
  return 'polar';
}

function paletteKeyFor(band: LatitudeBand): PaletteKey {
  if (band === 'tropical') return 'tropical';
  if (band === 'polar') return 'polar';
  return 'daylight';
}

/**
 * The card's colours are *read off the encounter and the animal*, never rolled:
 *
 * - **body** ← the animal's own dominant colour when it has one (a kingfisher's
 *   card is kingfisher-blue), otherwise its realm's hue nudged by a per-species
 *   jitter — so every species owns a visibly different card, Pokédex style.
 * - **palette** ← the encounter's broad geographic zone, then rotated to sit
 *   opposite the animal's own colour so
 *   the rim light and the animal never clash.
 *
 * The holo treatment itself comes from `effectKeyFor` — rarity picks the pool,
 * the species picks inside it. Rarity is deliberately not an input *here*: a
 * common animal deserves as beautiful a card as a rare one.
 */
export function identityFor(traits: CaptureTraits | undefined): CardIdentity {
  const species = traits?.scientificName ?? traits?.commonName ?? 'unidentified';
  const taxonClass = traits?.taxonomy?.class ?? '';
  const band = latitudeBandFor(traits?.latitude);

  const paletteKey = paletteKeyFor(band);
  const basePalette = [...HOLO_PALETTES[paletteKey]];

  // Harmony: spin the palette so its centre of mass lands on the complement of
  // the animal's own colour. A green lizard gets a magenta-centred rim, a red
  // squirrel a teal one — the animal never fights its own card, and it works
  // for any palette instead of needing one per hue.
  const subject = traits?.dominantColor ? hexToHsl(traits.dominantColor) : undefined;
  const harmonise = subject !== undefined && subject.s >= MIN_SUBJECT_SATURATION;
  const hueShift = harmonise ? Math.round(hueDelta(meanHue(basePalette), (subject.h + 180) % 360)) : 0;

  // The card body: the animal's colour if it has one, else the realm's hue
  // jittered by the species so no two species share a card. Saturation is
  // clamped upward — a printed card is dyed, not photographed — and lightness
  // stays dark enough for the white chrome to read.
  const realm = REALM_LOOK[taxonClass] ?? DEFAULT_LOOK;
  const jitter = (hash(`${species}:body`) % (SPECIES_JITTER * 2 + 1)) - SPECIES_JITTER;
  const hue = harmonise && subject ? subject.h : (realm.hue + jitter + 360) % 360;
  const saturation = Math.min(0.85, Math.max(0.55, subject?.s ?? 0.7));
  const body: [string, string, string] = [
    hslToHex({ h: (hue + 10) % 360, l: 0.44, s: saturation }),
    hslToHex({ h: hue, l: 0.3, s: saturation }),
    hslToHex({ h: (hue - 14 + 360) % 360, l: 0.17, s: Math.min(0.9, saturation + 0.08) }),
  ];

  return {
    paletteKey,
    palette: rotatePalette(basePalette, hueShift),
    hueShift,
    body,
    bodyAngle: realm.angle,
    glow: hslToHex({ h: (hue + 24) % 360, l: 0.58, s: saturation }),
    energyType: realm.energy,
    reason: [
      traits?.taxonomy?.class ?? 'Animalia',
      BAND_LABEL[uiLanguage()][band],
      harmonise ? (uiLanguage() === 'fr' ? 'palette complémentaire' : 'complementary palette') : '',
    ]
      .filter(Boolean)
      .join(' · '),
  };
}

const BAND_LABEL: Record<'fr' | 'en', Record<LatitudeBand, string>> = {
  fr: { tropical: 'tropiques', temperate: 'zone tempérée', polar: 'hautes latitudes', unknown: '' },
  en: { tropical: 'tropics', temperate: 'temperate zone', polar: 'high latitudes', unknown: '' },
};
