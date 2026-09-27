// What there is left to do, derived from what the app already stores: the
// seasonal table, the catalogue, the player's captures and their observation
// days. No new table, no new query.
//
// The three kinds are deliberately different *shapes*, not three copies of one
// row — a species to find or a day to come back. The
// screen draws each one as the thing it is.

import {
  MASTERY_DAY_THRESHOLDS,
  speciesMasteries,
  type SpeciesMastery,
} from '@/lib/animals/progression';
import { useRegion } from '@/lib/animals/use-region';
import { api, type CatalogEntry } from '@/lib/supabase/api';
import { useBackendAuth, useQuery } from '@/lib/supabase/backend';
import { useMemo } from 'react';

export { daysLeftInMonth } from '@/lib/animals/season-clock';

const IN_SEASON_LIMIT = 40;
const HUNT_COUNT = 8;
const ROW_COUNT = 4;

/** A species in season and never caught — the hunt. */
export type Hunt = {
  entry?: CatalogEntry;
  key: string;
  name: string;
  scientificName: string;
  /** Share of this species' yearly sightings that fall in this month, 0..1. */
  share: number;
};

/**
 * L'avancement de la saison : combien d'espèces visibles ce mois-ci sont déjà
 * dans la collection, sur combien.
 *
 * C'est le seul chiffre de cet écran qui vaille un titre — et il est vrai :
 * `seasons.inSeason` est la liste réelle, `caught` ce qu'on en a. Les apps de
 * la catégorie ouvrent toutes sur UN nombre, jamais sur une liste.
 */
export type SeasonProgress = { caught: number; total: number };

/** A species one distinct observation day from its next star. */
export type MasteryHunt = {
  key: string;
  mastery: SpeciesMastery;
  name: string;
  stickerUrl?: string | null;
};

export function useChallenges() {
  const { isAuthenticated } = useBackendAuth();
  const region = useRegion();
  const captures = useQuery(api.animals.listCaptures, isAuthenticated ? {} : 'skip');
  const catalog = useQuery(api.catalog.listAll, isAuthenticated ? {} : 'skip');
  // La saisonnalité est enfin demandée POUR une région. Sans ce paramètre, le
  // backend servait la France à la planète entière.
  const inSeason = useQuery(
    api.seasons.inSeason,
    isAuthenticated ? { limit: IN_SEASON_LIMIT, region: region.code } : 'skip',
  );

  const ready = useMemo(
    () =>
      (captures ?? []).filter(
        (capture) => capture.status === 'ready' || capture.status === 'needs_review',
      ),
    [captures],
  );

  const byName = useMemo(() => {
    const map = new Map<string, CatalogEntry>();
    for (const entry of catalog ?? []) {
      map.set(entry.scientificName, entry);
      map.set(entry.canonicalName, entry);
    }
    return map;
  }, [catalog]);

  // `seasons.inSeason` already sorts by how much of a species' yearly sightings
  // fall in this month, so the top of it is the likeliest thing to find today.
  // Removing what is already owned turns a ranking into an errand list.
  const hunts = useMemo<Hunt[]>(() => {
    const owned = new Set(ready.map((capture) => capture.scientificName).filter(Boolean));
    return (inSeason ?? [])
      .filter((row) => !owned.has(row.scientificName))
      .slice(0, HUNT_COUNT)
      .map((row) => {
        const entry = byName.get(row.scientificName);
        return {
          entry,
          key: row.scientificName,
          name: entry?.vernacularName ?? entry?.vernacularNameEn ?? row.scientificName,
          scientificName: row.scientificName,
          share: row.share,
        };
      });
  }, [byName, inSeason, ready]);

  // Mastery counts distinct days, not photographs, so this one can only be
  // answered tomorrow. That is the point of it.
  const masteries = useMemo<MasteryHunt[]>(() => {
    const stickers = new Map<string, string | null | undefined>();
    for (const capture of ready) {
      const key = capture.scientificName ?? capture.commonName;
      if (key && !stickers.has(key)) stickers.set(key, capture.stickerUrl);
    }
    const out: MasteryHunt[] = [];
    for (const [key, mastery] of speciesMasteries(ready)) {
      if (out.length >= ROW_COUNT) break;
      if (mastery.level >= MASTERY_DAY_THRESHOLDS.common.length) continue;
      if (mastery.daysToNextLevel !== 1) continue;
      out.push({
        key,
        mastery,
        name: byName.get(key)?.vernacularName ?? key,
        stickerUrl: stickers.get(key),
      });
    }
    return out;
  }, [byName, ready]);

  // Sur TOUTE la liste de saison, pas sur les huit chasses affichées : le
  // titre annonce l'avancement du mois, pas celui de la rangée.
  const season = useMemo<SeasonProgress>(() => {
    const owned = new Set(ready.map((capture) => capture.scientificName).filter(Boolean));
    const rows = inSeason ?? [];
    return {
      caught: rows.filter((row) => owned.has(row.scientificName)).length,
      total: rows.length,
    };
  }, [inSeason, ready]);

  return {
    captures,
    hunts,
    loading: captures === undefined || catalog === undefined || inSeason === undefined,
    masteries,
    region,
    season,
  };
}
