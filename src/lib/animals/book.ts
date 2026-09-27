// Le Livre — la collection racontée dans l'ordre où elle a été vécue.
//
// L'ATLAS MONTRE LE PRÉSENT, LE LIVRE CONSERVE LE PASSÉ
//
// L'Atlas répond à « qu'est-ce que je possède ? » : une espèce, une entrée,
// l'état d'aujourd'hui. Le Livre répond à « qu'est-ce que j'ai vécu ? » : une
// mésange photographiée quatorze fois reste une entrée d'Atlas, mais chacune de
// ses rencontres a un mois, une page, une place dans l'histoire.
//
// AUCUNE TABLE, AUCUNE ÉCRITURE — MÊME RÈGLE QUE LES OBJECTIFS
//
// Le Livre est une LECTURE des captures, entièrement dérivée. Rien à migrer,
// rien qui puisse se désynchroniser, et les corrections d'identification se
// répercutent d'elles-mêmes. Le point qui aurait pu l'interdire — « la carte
// reste dans l'état visuel de l'époque » — tombe gratuitement : la maîtrise est
// déjà un calcul sur les captures, donc la calculer sur les captures
// D'AVANT LA FIN DU MOIS rend exactement les étoiles de l'époque.
//
// LES PAGES VIDES RESTENT VIDES
//
// Un février à deux rencontres est deux cartes sur une page de neuf poches.
// Le combler serait mentir : dans trois ans, ce vide EST l'histoire.

import type { Capture } from '@/lib/supabase/api';
import { speciesMasteries, type SpeciesMastery } from './progression';
import { RARITY_ORDER, type Rarity } from './rarity';

/** Une rencontre posée dans le Livre : la capture, plus l'état de l'époque. */
export type BookEncounter = {
  capture: Capture;
  /** Les étoiles telles qu'elles étaient À LA FIN de ce mois-là. */
  mastery: SpeciesMastery | undefined;
  /** Première rencontre de l'espèce, toutes années confondues. */
  discovery: boolean;
};

export type BookMilestone = {
  key: string;
  icon: string;
  title: string;
  detail?: string;
  /** La carte à mettre en scène, quand le jalon en a une. */
  captureId?: string;
};

export type BookMonth = {
  year: number;
  /** 0..11 — le mois de `Date`. */
  month: number;
  encounters: BookEncounter[];
  speciesDiscovered: number;
  /** Les jalons franchis CE mois-là. */
  milestones: BookMilestone[];
};

export type BookYear = {
  year: number;
  months: BookMonth[];
  encounterCount: number;
  speciesDiscovered: number;
};

const SPECIES_STEPS = [10, 25, 50, 100, 250, 500];

/** Le premier cran qui mérite une page : à partir de TRÈS RARE. */
const NOTABLE_FROM = RARITY_ORDER.indexOf('very_rare');

function rarityRank(rarity?: Rarity) {
  return rarity ? RARITY_ORDER.indexOf(rarity) : -1;
}

function keyOf(capture: Capture) {
  return capture.scientificName ?? capture.commonName ?? '';
}

/**
 * Construit tous les livres d'un coup, du premier mois au dernier.
 *
 * Un seul passage chronologique, parce que tous les jalons sont des PREMIÈRES :
 * première espèce n°100, première légendaire, premier cran notable. Il faut la
 * mémoire de tout ce qui précède, et l'ordre la donne gratuitement.
 */
export function buildBook(captures: Capture[]): BookYear[] {
  const kept = captures
    .filter(
      (capture) =>
        (capture.status === 'ready' || capture.status === 'needs_review') &&
        typeof capture.capturedAt === 'number' &&
        keyOf(capture),
    )
    .sort((a, b) => a.capturedAt - b.capturedAt);
  if (!kept.length) return [];

  const seen = new Set<string>();
  let bestRarity = -1;
  let sawLegendary = false;
  const passedSteps = new Set<number>();

  const months = new Map<string, BookMonth>();

  for (const capture of kept) {
    const date = new Date(capture.capturedAt);
    const year = date.getFullYear();
    const month = date.getMonth();
    const id = `${year}-${month}`;
    let page = months.get(id);
    if (!page) {
      page = { encounters: [], milestones: [], month, speciesDiscovered: 0, year };
      months.set(id, page);
    }

    const species = keyOf(capture);
    const discovery = !seen.has(species);
    if (discovery) {
      seen.add(species);
      page.speciesDiscovered += 1;
      // Les paliers d'espèces — franchis à l'instant même de la découverte.
      const step = SPECIES_STEPS.find((s) => seen.size === s && !passedSteps.has(s));
      if (step) {
        passedSteps.add(step);
        page.milestones.push({
          captureId: capture._id,
          detail: capture.commonNameLocale ?? capture.commonName ?? species,
          icon: 'rosette',
          key: `species-${step}`,
          title: `${step}ᵉ espèce`,
        });
      }
    }

    const rank = rarityRank(capture.rarity);
    if (rank > bestRarity) {
      bestRarity = rank;
      // Un seul jalon de rareté générique — « ta plus rare à ce jour » — et un
      // jalon à part pour la légendaire, qui est un événement en soi.
      if (rank >= NOTABLE_FROM && capture.rarity !== 'legendary') {
        page.milestones.push({
          captureId: capture._id,
          detail: capture.commonNameLocale ?? capture.commonName ?? species,
          icon: 'sparkles',
          key: `rarity-${capture.rarity}`,
          title: 'Ta plus rare à ce jour',
        });
      }
    }
    if (capture.rarity === 'legendary' && !sawLegendary) {
      sawLegendary = true;
      page.milestones.push({
        captureId: capture._id,
        detail: capture.commonNameLocale ?? capture.commonName ?? species,
        icon: 'crown.fill',
        key: 'first-legendary',
        title: 'Ta première LÉGENDAIRE',
      });
    }

    page.encounters.push({ capture, discovery, mastery: undefined });
  }

  // La maîtrise de l'époque : pour chaque mois, les étoiles calculées sur les
  // captures jusqu'à SA fin. C'est la photographie de la collection à cet
  // instant — l'Atlas, lui, continuera d'avancer.
  const ordered = [...months.values()].sort(
    (a, b) => a.year - b.year || a.month - b.month,
  );
  for (const page of ordered) {
    const end = new Date(page.year, page.month + 1, 1).getTime();
    // ponytail: un filtre par mois, O(mois × captures) — largement suffisant
    // pour des années de collection ; un balayage incrémental si ça se mesure.
    const masteries = speciesMasteries(kept.filter((c) => c.capturedAt < end));
    for (const encounter of page.encounters) {
      encounter.mastery = masteries.get(keyOf(encounter.capture));
    }
  }

  const years = new Map<number, BookYear>();
  for (const page of ordered) {
    let year = years.get(page.year);
    if (!year) {
      year = { encounterCount: 0, months: [], speciesDiscovered: 0, year: page.year };
      years.set(page.year, year);
    }
    year.months.push(page);
    year.encounterCount += page.encounters.length;
    year.speciesDiscovered += page.speciesDiscovered;
  }
  return [...years.values()].sort((a, b) => b.year - a.year);
}

export const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
] as const;
