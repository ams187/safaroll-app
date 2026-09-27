/**
 * La rareté de la RENCONTRE : quatre niveaux, et ils ne notent jamais une carte.
 * Volontairement plus grossière que l'échelle de carte — elle dit « 3ᵉ fois
 * qu'on voit ça dans ta zone », pas « cette espèce vaut tant ».
 */
// Pas de cycle à l'exécution : `objectives` importe des valeurs de `badges`,
// qui n'importe d'ici que des types.
import { questXp } from './objectives';

export type LocalEncounterRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

/**
 * La rareté de la CARTE : huit paliers, la même pour tous les joueurs du monde.
 *
 * Cinq ne suffisaient pas. Le catalogue compte 5 799 espèces réparties sur cinq
 * décades d'observations mondiales : lion et tigre finissaient au même palier,
 * panda géant et panthère des neiges aussi, et le haut de l'échelle — celui
 * qu'un joueur convoite — n'avait que deux crans au-dessus de « rare ».
 *
 * Huit est aussi le nombre du TCG moderne (Common → Hyper Rare), et le nombre
 * de décades naturelles de la distribution GBIF. Les seuils sont dans
 * `supabase/functions/_shared/species-rarity.ts`.
 */
export type CardRarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'very_rare'
  | 'ultra_rare'
  | 'epic'
  | 'mythic'
  | 'legendary';

const XP_BY_RARITY: Record<CardRarity, number> = {
  common: 100,
  uncommon: 160,
  rare: 240,
  very_rare: 330,
  ultra_rare: 425,
  epic: 520,
  mythic: 610,
  legendary: 700,
};

type ProgressCapture = {
  status: 'processing' | 'ready' | 'needs_review' | 'failed';
  scientificName?: string;
  commonName?: string;
  capturedAt?: number;
  rarity?: CardRarity;
  /** La classe GBIF, pour les objectifs par groupe (« 5 oiseaux »). */
  taxonomy?: { class?: string };
};

/**
 * Combien de JOURS d'observation distincts pour chaque niveau de maîtrise.
 *
 * Des jours, pas des captures : dix photos de moineau le même jour laissent au
 * niveau 1. Plus l'espèce est rare, moins il en faut — on ne demande pas douze
 * journées avec un panda géant.
 */
export const MASTERY_DAY_THRESHOLDS: Record<CardRarity, readonly [number, number, number, number, number]> = {
  common: [1, 2, 4, 7, 12],
  uncommon: [1, 2, 4, 6, 10],
  rare: [1, 2, 3, 5, 8],
  very_rare: [1, 2, 3, 4, 7],
  ultra_rare: [1, 2, 3, 4, 6],
  // Cinq jours est le plancher : cinq niveaux ne peuvent pas tenir en moins.
  // Les trois paliers du haut s'y rejoignent donc, et c'est voulu — au-delà,
  // c'est la carte qui récompense, pas la vitesse de maîtrise.
  epic: [1, 2, 3, 4, 5],
  mythic: [1, 2, 3, 4, 5],
  legendary: [1, 2, 3, 4, 5],
};
export type MasteryLevel = 1 | 2 | 3 | 4 | 5;

export type SpeciesMastery = {
  level: MasteryLevel;
  levelStartDays: number;
  observationDays: number;
  nextLevelDays?: number;
  daysToNextLevel: number;
};

export type MasteryProgressEvent = 'same_day' | 'progress' | 'level_up';

function speciesKey(capture: ProgressCapture) {
  return capture.scientificName ?? capture.commonName;
}

function localDay(capturedAt?: number) {
  if (capturedAt === undefined || !Number.isFinite(capturedAt)) return undefined;
  const date = new Date(capturedAt);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function masteryForDays(observationDays: number, rarity: CardRarity): SpeciesMastery {
  const thresholds = MASTERY_DAY_THRESHOLDS[rarity];
  const reached = thresholds.filter((threshold) => observationDays >= threshold).length;
  const level = Math.max(1, reached) as MasteryLevel;
  const levelStartDays = thresholds[level - 1];
  const nextLevelDays = thresholds.at(level);

  return {
    level,
    levelStartDays,
    observationDays,
    nextLevelDays,
    daysToNextLevel: nextLevelDays === undefined ? 0 : nextLevelDays - observationDays,
  };
}

/** Builds every species' mastery in one pass for collection-sized lists. */
export function speciesMasteries(captures: ProgressCapture[]) {
  const progressBySpecies = new Map<string, { days: Set<string>; rarity: CardRarity }>();
  for (const capture of captures) {
    if (capture.status !== 'ready' && capture.status !== 'needs_review') continue;
    const key = speciesKey(capture);
    const day = localDay(capture.capturedAt);
    if (!key || !day) continue;
    const progress = progressBySpecies.get(key) ?? {
      days: new Set<string>(),
      rarity: capture.rarity ?? 'common',
    };
    progress.days.add(day);
    if (capture.rarity) progress.rarity = capture.rarity;
    progressBySpecies.set(key, progress);
  }
  return new Map(
    [...progressBySpecies].map(([key, progress]) => [
      key,
      masteryForDays(progress.days.size, progress.rarity),
    ]),
  );
}

/** One mastery credit per species and local calendar day; progress never resets. */
export function speciesMastery(captures: ProgressCapture[], key?: string): SpeciesMastery {
  const days = new Set<string>();
  let rarity: CardRarity = 'common';
  if (key) {
    for (const capture of captures) {
      if (capture.status !== 'ready' && capture.status !== 'needs_review') continue;
      if (speciesKey(capture) !== key) continue;
      if (capture.rarity) rarity = capture.rarity;
      const day = localDay(capture.capturedAt);
      if (day) days.add(day);
    }
  }

  return masteryForDays(days.size, rarity);
}

/** What changed when an already-owned species was photographed again. */
export function masteryProgressEvent(
  previous: SpeciesMastery,
  current: SpeciesMastery,
): MasteryProgressEvent {
  if (current.observationDays <= previous.observationDays) return 'same_day';
  return current.level > previous.level ? 'level_up' : 'progress';
}

/** Progress inside the current mastery level, for the compact card meter. */
export function masteryLevelProgress(mastery?: SpeciesMastery) {
  if (!mastery) return 0;
  if (mastery.nextLevelDays === undefined) return 1;
  return Math.max(
    0,
    Math.min(
      1,
      (mastery.observationDays - mastery.levelStartDays) /
        (mastery.nextLevelDays - mastery.levelStartDays),
    ),
  );
}

export function xpForAnimal(rarity?: CardRarity) {
  return XP_BY_RARITY[rarity ?? 'common'];
}

/**
 * L'XP des étoiles de maîtrise — ce que rapporte le fait de REVENIR.
 *
 * Le trou que ça bouche : l'écran des défis propose deux choses, trouver une
 * espèce de saison et revoir une espèce à une journée de son étoile. La
 * première payait déjà (c'est une espèce distincte de plus) ; la seconde ne
 * payait RIEN. On demandait au joueur de ressortir demain pour zéro.
 *
 * Un quart de l'XP de l'espèce par étoile au-delà de la première. Le rapport
 * est volontairement modeste : mener un moineau à cinq étoiles (12 jours de
 * sortie) vaut 100 XP, soit une espèce commune de plus — la découverte reste
 * ce qui fait monter, la fidélité ajoute. L'inverse pousserait à camper sur
 * une espèce plutôt qu'à explorer, et le jeu s'appelle SafaRoll.
 */
const MASTERY_XP_SHARE = 0.25;

export function xpForMastery(rarity: CardRarity | undefined, level: number) {
  return Math.round(xpForAnimal(rarity) * MASTERY_XP_SHARE) * Math.max(0, level - 1);
}

/**
 * Le niveau du joueur, et l'XP qui le porte.
 *
 * L'XP compte les espèces DISTINCTES, pas les captures.
 *
 * Elle sommait chaque capture, si bien que dix photos du même moineau valaient
 * 1 000 XP — plus qu'une panthère des neiges. Pire : le classement « Maîtrise »
 * du Registre, lui, pèse les espèces distinctes. Deux nombres prétendaient
 * mesurer la même chose et se contredisaient, et c'est le genre d'écart qu'un
 * joueur repère avant nous.
 *
 * La rareté retenue pour une espèce est la MEILLEURE de ses captures : une
 * identification corrigée vers le haut ne doit pas laisser l'ancienne valeur
 * derrière elle.
 */
export function getDeckProgress(captures: ProgressCapture[]) {
  const completed = captures.filter((capture) => capture.status === 'ready' || capture.status === 'needs_review');
  const best = new Map<string, number>();
  const rarities = new Map<string, CardRarity>();
  for (const capture of completed) {
    const key = capture.scientificName ?? capture.commonName;
    if (!key) continue;
    const xp = xpForAnimal(capture.rarity);
    if (xp > (best.get(key) ?? 0)) {
      best.set(key, xp);
      rarities.set(key, capture.rarity ?? 'common');
    }
  }
  const speciesXp = [...best.values()].reduce((sum, xp) => sum + xp, 0);
  // La deuxième source : les étoiles de maîtrise. Sans elle, l'écran des défis
  // demandait au joueur de ressortir demain revoir une espèce pour zéro XP.
  // Le barème (`xpForMastery`) est réglé pour ajouter, pas pour remplacer : la
  // découverte reste ce qui fait monter.
  const masteryXp = [...speciesMasteries(completed)].reduce(
    (sum, [key, mastery]) => sum + xpForMastery(rarities.get(key), mastery.level),
    0,
  );
  // La troisième source : les objectifs du mois (« capture 5 oiseaux »).
  // Recalculée sur tout l'historique, comme le reste — un objectif accompli en
  // mars vaut son XP pour toujours, sans rien stocker. Voir `objectives.ts`.
  const objectivesXp = questXp(captures);
  const totalXp = speciesXp + masteryXp + objectivesXp;
  const level = Math.floor(Math.sqrt(totalXp / 250)) + 1;
  const levelStartXp = 250 * (level - 1) ** 2;
  const nextLevelXp = 250 * level ** 2;
  const progress = (totalXp - levelStartXp) / (nextLevelXp - levelStartXp);
  const speciesCount = best.size;

  return {
    captureCount: completed.length,
    level,
    /** L'XP venue des étoiles — ce que la fidélité a rapporté, séparément. */
    masteryXp,
    progress,
    speciesCount,
    speciesXp,
    title: naturalistTitle(level),
    titleKey: `naturalist_${TITLES.find((tier) => level >= tier.from)?.from ?? 1}`,
    totalXp,
    xpToNextLevel: nextLevelXp - totalXp,
  };
}

/**
 * Le titre porté à chaque palier de niveau.
 *
 * Le vocabulaire est celui de l'app — carnet de terrain, atlas, expédition —
 * et il monte du regard à l'autorité. Pas de « naturaliste en herbe » : c'est
 * le registre d'un autre.
 */
const TITLES: { from: number; title: string }[] = [
  { from: 40, title: 'Mémoire du vivant' },
  { from: 30, title: 'Cartographe des espèces' },
  { from: 22, title: 'Chroniqueur de terrain' },
  { from: 16, title: 'Traqueur aguerri' },
  { from: 11, title: 'Arpenteur des saisons' },
  { from: 7, title: 'Œil exercé' },
  { from: 4, title: 'Carnet ouvert' },
  { from: 1, title: 'Premier regard' },
];

export function naturalistTitle(level: number): string {
  return TITLES.find((tier) => level >= tier.from)?.title ?? TITLES[TITLES.length - 1].title;
}

/** @deprecated Compatibility alias while imports migrate. */
