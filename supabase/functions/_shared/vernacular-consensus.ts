// Quel nom courant afficher, quand GBIF en propose plusieurs dans la même langue.
//
// LE PREMIER N'EST PAS LE BON
//
// GBIF rend les noms triés par autorité de la source, et la source la plus
// « autoritaire » est un catalogue taxonomique — qui donne le nom savant, pas
// celui que les gens emploient. Mesuré sur `Melopsittacus undulatus` :
//
//   Mélopsitte ondulé   Catalogue of Life
//   Perruche ondulée    Catalogue of Life
//   Perruche ondulée    TAXREF
//   Perruche ondulée    ITIS
//
// Prendre le premier donne « Mélopsitte ondulé » sur la carte. Personne
// n'appelle ça comme ça. Trois sources sur quatre disent « Perruche ondulée ».
//
// LE CONSENSUS, LUI, TOMBE JUSTE
//
// Le nom que le plus de sources répètent est celui qui circule vraiment. À
// égalité on retombe sur l'ordre de GBIF, qui reste le meilleur départage
// disponible.
//
//   Panthera leo         Lion 3×, Lionne 1×          → Lion
//   Puma concolor        Couguar 2×, Lion de m. 1×   → Couguar
//   Melopsittacus u.     Perruche ondulée 3×         → Perruche ondulée

/**
 * Les langues qu'on garde, et leur code court.
 *
 * GBIF étiquette en ISO 639-3 (`fra`, `eng`) mais aussi en 639-1 (`fr`, `en`)
 * selon la source — les deux formes cohabitent dans la même réponse. Cette
 * table les ramène au code que l'app utilise.
 *
 * La liste s'arrête aux grandes langues de diffusion : garder les 107 langues
 * que GBIF connaît alourdirait chaque capture pour des noms que personne ne
 * lira. Ajouter une langue ici suffit à la rendre disponible pour toutes les
 * captures FUTURES ; `scripts/backfill-vernaculars.ts` s'occupe des anciennes.
 *
 * Elle vit ICI et non dans l'edge function parce que le backfill doit lire
 * exactement la même : deux tables, et une langue ajoutée d'un côté ne
 * remplirait jamais les lignes rattrapées de l'autre.
 */
export const LANGUAGE_CODES: Record<string, string> = {
  ar: 'ar', ara: 'ar',
  de: 'de', deu: 'de', ger: 'de',
  en: 'en', eng: 'en',
  es: 'es', spa: 'es',
  fr: 'fr', fra: 'fr', fre: 'fr',
  hi: 'hi', hin: 'hi',
  id: 'id', ind: 'id',
  it: 'it', ita: 'it',
  ja: 'ja', jpn: 'ja',
  ko: 'ko', kor: 'ko',
  nl: 'nl', nld: 'nl', dut: 'nl',
  pl: 'pl', pol: 'pl',
  pt: 'pt', por: 'pt',
  ru: 'ru', rus: 'ru',
  sv: 'sv', swe: 'sv',
  tr: 'tr', tur: 'tr',
  vi: 'vi', vie: 'vi',
  zh: 'zh', zho: 'zh', chi: 'zh',
};

type Entry = { language?: string; vernacularName?: string };

/**
 * Un nom courant par langue de l'app, choisi par consensus des sources.
 *
 * `languageCodes` ramène les étiquettes GBIF au code de l'app : la même
 * réponse mélange l'ISO 639-3 (`fra`) et le 639-1 (`fr`) selon la source.
 */
export function vernacularsByConsensus(
  entries: Entry[],
  languageCodes: Record<string, string>,
): Record<string, string> {
  const tally = new Map<string, Map<string, { count: number; rank: number }>>();

  entries.forEach((entry, index) => {
    const code = languageCodes[(entry.language ?? '').toLowerCase()];
    const value = entry.vernacularName?.trim();
    if (!code || !value) return;
    let byName = tally.get(code);
    if (!byName) {
      byName = new Map();
      tally.set(code, byName);
    }
    const seen = byName.get(value);
    // `rank` garde la position d'apparition : c'est le départage à égalité, et
    // il doit rester celui de la PREMIÈRE apparition, pas de la dernière.
    if (seen) seen.count += 1;
    else byName.set(value, { count: 1, rank: index });
  });

  const out: Record<string, string> = {};
  for (const [code, byName] of tally) {
    let best: [string, { count: number; rank: number }] | undefined;
    for (const candidate of byName) {
      if (
        !best
        || candidate[1].count > best[1].count
        || (candidate[1].count === best[1].count && candidate[1].rank < best[1].rank)
      ) {
        best = candidate;
      }
    }
    if (best) out[code] = best[0];
  }
  return out;
}
