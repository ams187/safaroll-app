// Les objectifs du mois — génériques, jamais une espèce nommée.
//
// POURQUOI AUCUN OBJECTIF NE NOMME UNE ESPÈCE
//
// « Trouve la Chouette hulotte » est une promesse que l'app ne contrôle pas :
// la chouette décide. Un joueur qui sort deux soirs, ne la croise pas, et voit
// la même consigne le troisième matin apprend une seule chose — cet écran ment.
// « Capture 5 oiseaux, peu importe lesquels » est gagnable par N'IMPORTE QUELLE
// sortie ; c'est la différence entre un objectif et une loterie.
//
// AUCUNE TABLE, AUCUNE ÉCRITURE — MÊME RÈGLE QUE LES DISTINCTIONS
//
// Un objectif accompli n'est pas un fait à stocker : c'est une LECTURE des
// captures du mois. Le persister obligerait à gérer les corrections
// d'identification qui le décochent, et à migrer quand un seuil change. Ici,
// changer un seuil suffit.
//
// L'XP EST RÉELLE, ET DÉTERMINISTE
//
// `questXp` refait le calcul sur TOUS les mois de l'historique : un objectif
// accompli en mars vaut son XP pour toujours, sans ligne en base. Une
// récompense annoncée qui ne tombe pas est pire que pas de récompense.
//
// Seules les captures DATÉES comptent. Une capture sans `capturedAt` n'a pas
// de mois — et c'est aussi ce qui fige les règles historiques du barème.

import { FINDING_RARITIES, groupForClass } from './badges';
import type { CardRarity } from './progression';

export type ObjectiveCapture = {
  status: 'processing' | 'ready' | 'needs_review' | 'failed';
  scientificName?: string;
  commonName?: string;
  capturedAt?: number;
  rarity?: CardRarity;
  taxonomy?: { class?: string };
};

export type ObjectiveDef = {
  key: string;
  /** L'icône SF Symbols, comme partout ailleurs dans l'app. */
  icon: string;
  label: string;
  /** Combien il en faut dans le mois. */
  target: number;
  /** Ce que l'accomplissement rapporte, une fois par mois. */
  xp: number;
  /** Ce que l'objectif retient parmi les captures du mois. */
  counts: (capture: ObjectiveCapture, isNewSpecies: boolean) => boolean;
  /**
   * Présent, on compte les VALEURS DISTINCTES plutôt que les lignes.
   *
   * C'est ce qui permet « sors 3 jours différents » sans écrire un second
   * moteur : trois photos le même après-midi rendent la même clé, donc un seul
   * point. Même règle que la maîtrise, et pour la même raison — on récompense
   * le fait de RESSORTIR, pas de mitrailler.
   */
  distinct?: (capture: ObjectiveCapture) => string;
};

/** Le jour local d'une capture, pour les objectifs de fidélité. */
function localDay(capturedAt: number) {
  const date = new Date(capturedAt);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Le groupe du vivant, tel que le catalogue le nomme. */
const inGroup = (group: string) => (capture: ObjectiveCapture) =>
  groupForClass(capture.taxonomy?.class) === group;

/**
 * LES DEUX ANCRES — présentes tous les mois, sans exception.
 *
 * Elles garantissent qu'un mois est toujours gagnable par quelqu'un qui sort
 * une fois : un objectif de volume très bas, et un de découverte. Sans elles,
 * la rotation pourrait tirer un mois entier de « 5 poissons » et « 2 reptiles »
 * à un joueur de ville, qui n'aurait alors rien à faire du tout.
 *
 * Les seuils démarrent à 3 : un objectif qu'une seule photo accomplit n'est pas
 * un objectif, c'est une notification.
 */
const ANCHORS: ObjectiveDef[] = [
  { key: 'captures-3', icon: 'camera.fill', label: 'Capture 3 animaux', target: 3, xp: 60,
    counts: () => true },
  { key: 'especes-3', icon: 'sparkle.magnifyingglass', label: 'Découvre 3 nouvelles espèces', target: 3, xp: 120,
    counts: (_, isNew) => isNew },
];

/**
 * LE VIVIER — quatre tirés au sort chaque mois, jamais les mêmes deux mois
 * d'affilée si le vivier est assez grand.
 *
 * Six objectifs figés, identiques tous les mois, deviennent du papier peint au
 * troisième mois : le joueur ne les lit plus. Un vivier plus large rend la
 * liste de septembre différente de celle d'août, donc relisible.
 *
 * Le tirage est DÉTERMINISTE et dérivé du mois (voir `pickForMonth`) : le jeu
 * d'août 2026 est le même aujourd'hui, demain et sur un autre téléphone. C'est
 * indispensable ici — `questXp` recalcule tout l'historique à chaque lecture,
 * et un tirage aléatoire ferait varier l'XP passée d'un lancement à l'autre.
 */
const POOL: ObjectiveDef[] = [
  // Volume
  { key: 'captures-10', icon: 'camera.on.rectangle.fill', label: 'Capture 10 animaux', target: 10, xp: 150,
    counts: () => true },
  { key: 'captures-25', icon: 'square.stack.3d.up.fill', label: 'Capture 25 animaux', target: 25, xp: 320,
    counts: () => true },
  // Découverte
  { key: 'especes-6', icon: 'binoculars.fill', label: 'Découvre 6 nouvelles espèces', target: 6, xp: 260,
    counts: (_, isNew) => isNew },
  // Fidélité — des JOURS, pas des photos.
  { key: 'jours-3', icon: 'calendar', label: 'Sors 3 jours différents', target: 3, xp: 110,
    counts: () => true, distinct: (capture) => localDay(capture.capturedAt!) },
  { key: 'jours-8', icon: 'calendar.badge.checkmark', label: 'Sors 8 jours différents', target: 8, xp: 280,
    counts: () => true, distinct: (capture) => localDay(capture.capturedAt!) },
  // Règnes — un par branche du vivant, pour que le joueur de ville et celui du
  // bord de mer n'aient pas la même liste.
  { key: 'oiseaux-5', icon: 'bird.fill', label: 'Capture 5 oiseaux', target: 5, xp: 100,
    counts: inGroup('oiseaux') },
  { key: 'mammiferes-3', icon: 'hare.fill', label: 'Capture 3 mammifères', target: 3, xp: 130,
    counts: inGroup('mammiferes') },
  { key: 'insectes-5', icon: 'ant.fill', label: 'Capture 5 insectes', target: 5, xp: 100,
    counts: inGroup('insectes') },
  { key: 'reptiles-2', icon: 'lizard.fill', label: 'Capture 2 reptiles', target: 2, xp: 150,
    counts: inGroup('reptiles') },
  { key: 'poissons-2', icon: 'fish.fill', label: 'Capture 2 poissons', target: 2, xp: 150,
    counts: inGroup('poissons') },
  // Rareté
  { key: 'trouvaille-1', icon: 'sparkles', label: 'Capture une trouvaille', target: 1, xp: 120,
    counts: (capture) => !!capture.rarity && FINDING_RARITIES.includes(capture.rarity) },
  { key: 'trouvaille-3', icon: 'wand.and.stars', label: 'Capture 3 trouvailles', target: 3, xp: 300,
    counts: (capture) => !!capture.rarity && FINDING_RARITIES.includes(capture.rarity) },
  { key: 'legendaire-1', icon: 'crown.fill', label: 'Capture un légendaire', target: 1, xp: 300,
    counts: (capture) => capture.rarity === 'legendary' },
];

/** Combien de tirés par mois, en plus des deux ancres. */
const DRAWN = 4;

/**
 * Le tirage du mois : déterministe, dérivé de l'année et du mois.
 *
 * Chaque entrée du vivier reçoit un score haché à partir de sa clé ET du mois ;
 * on garde les quatre plus petits. Deux mois voisins donnent des scores sans
 * rapport, donc des listes différentes — et le même mois redonne toujours la
 * même liste, ce dont `questXp` a besoin pour que l'XP passée ne bouge jamais.
 */
function pickForMonth(year: number, month: number): ObjectiveDef[] {
  const seed = year * 12 + month;
  const scored = POOL.map((def) => {
    let hash = seed * 2654435761;
    for (let index = 0; index < def.key.length; index += 1) {
      hash = (hash ^ def.key.charCodeAt(index)) * 16777619;
      hash >>>= 0;
    }
    return { def, hash };
  });
  scored.sort((a, b) => a.hash - b.hash || (a.def.key < b.def.key ? -1 : 1));
  // Réordonnés par exigence : la liste doit commencer par une barre qui bouge.
  return scored
    .slice(0, DRAWN)
    .map((item) => item.def)
    .sort((a, b) => a.xp - b.xp);
}

/** Les six objectifs d'un mois donné : les deux ancres, puis le tirage. */
export function objectivesForMonth(year: number, month: number): ObjectiveDef[] {
  return [...ANCHORS, ...pickForMonth(year, month)];
}

export type ObjectiveState = ObjectiveDef & { count: number; done: boolean };

function monthOf(capturedAt: number) {
  const date = new Date(capturedAt);
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function usable(capture: ObjectiveCapture) {
  return (
    (capture.status === 'ready' || capture.status === 'needs_review') &&
    capture.capturedAt !== undefined &&
    Number.isFinite(capture.capturedAt) &&
    !!(capture.scientificName ?? capture.commonName)
  );
}

/**
 * Le premier mois où chaque espèce a été vue — c'est lui qui décide de
 * « nouvelle espèce ». Une espèce redécouverte en août ne redevient pas neuve.
 */
function firstMonths(captures: readonly ObjectiveCapture[]) {
  const first = new Map<string, number>();
  for (const capture of captures) {
    if (!usable(capture)) continue;
    const key = (capture.scientificName ?? capture.commonName)!;
    const at = capture.capturedAt!;
    if (at < (first.get(key) ?? Infinity)) first.set(key, at);
  }
  return first;
}

function statesForMonth(
  captures: readonly ObjectiveCapture[],
  first: Map<string, number>,
  month: string,
): ObjectiveState[] {
  const inMonth = captures.filter((capture) => usable(capture) && monthOf(capture.capturedAt!) === month);
  const [year, index] = month.split('-').map(Number);
  return objectivesForMonth(year, index).map((def) => {
    const seen = new Set<string>();
    let count = 0;
    for (const capture of inMonth) {
      const key = (capture.scientificName ?? capture.commonName)!;
      const isNew = first.get(key) === capture.capturedAt && monthOf(capture.capturedAt!) === month;
      if (!def.counts(capture, isNew)) continue;
      if (def.distinct) seen.add(def.distinct(capture));
      else count += 1;
    }
    const total = def.distinct ? seen.size : count;
    return { ...def, count: Math.min(total, def.target), done: total >= def.target };
  });
}

/** Les objectifs du mois COURANT, pour l'écran des quêtes. */
export function monthlyObjectives(
  captures: readonly ObjectiveCapture[],
  now: Date = new Date(),
): ObjectiveState[] {
  return statesForMonth(captures, firstMonths(captures), `${now.getFullYear()}-${now.getMonth()}`);
}

/**
 * L'XP de TOUS les objectifs accomplis, sur tout l'historique.
 *
 * Recalculée à chaque lecture, comme le reste de la progression : pas de ligne
 * en base, pas de migration quand le barème bouge, et une identification
 * corrigée qui défait un objectif défait son XP — les deux ne peuvent pas se
 * contredire puisqu'ils lisent les mêmes captures.
 */
export function questXp(captures: readonly ObjectiveCapture[]): number {
  const first = firstMonths(captures);
  const months = new Set<string>();
  for (const capture of captures) {
    if (usable(capture)) months.add(monthOf(capture.capturedAt!));
  }
  let total = 0;
  for (const month of months) {
    for (const state of statesForMonth(captures, first, month)) {
      if (state.done) total += state.xp;
    }
  }
  return total;
}
