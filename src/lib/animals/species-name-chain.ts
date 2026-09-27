// La chaîne de repli du nom affiché. Pure — aucun import natif — pour que
// `scripts/check-names.ts` la vérifie sans simulateur.
//
// C'est le seul texte que tout joueur lit sur toute carte. Un maillon cassé ne
// plante pas : il affiche du latin à quelqu'un qui attendait « Lion », ou pire,
// un nom français à un joueur japonais.

import { conciseCommonName } from './concise-common-name';

/**
 * `| null` autant que `| undefined` : ces champs viennent de colonnes Postgres
 * nullables, et selon le chemin de mise en forme l'absence arrive sous l'une
 * ou l'autre forme. N'accepter que `undefined` obligeait chaque appelant à
 * convertir — et un appelant qui ne convertit pas, c'est un écran qui cesse de
 * traduire. La chaîne ci-dessous n'utilise que `??`, qui traite les deux
 * pareil.
 */
export type NamedCapture = {
  commonName?: string | null;
  /** The catalogue's vernacular name — French, written by `identifyCapture`. */
  commonNameLocale?: string | null;
  scientificName?: string | null;
  /** Noms par code de langue, écrits à l'identification. Voir la migration. */
  vernaculars?: Record<string, string> | null;
};

/**
 * Le nom, dans cette langue. Chaque maillon existe pour un cas réel :
 *
 *   1. sa langue           la carte `vernaculars`, écrite à l'identification
 *   2. les deux colonnes   les captures d'avant la carte, jamais reprises
 *   3. l'anglais           l'espèce n'a pas de nom dans sa langue
 *   4. le latin            aucun nom courant n'existe — c'est le cas d'un
 *                          coléoptère obscur, et l'afficher est honnête
 *
 * Rien ne peut rendre `undefined` tant qu'il y a un nom scientifique.
 */
export function resolveSpeciesName(
  capture: NamedCapture | undefined,
  language: string,
): string | undefined {
  if (!capture) return undefined;
  // Les colonnes historiques ne valent que pour leur langue : servir
  // `commonNameLocale` (français) à un joueur espagnol serait pire que
  // l'anglais, qui au moins ne prétend pas être sa langue.
  const legacy = language === 'fr' ? capture.commonNameLocale : undefined;
  return conciseCommonName(
    capture.vernaculars?.[language]
      ?? legacy
      ?? capture.vernaculars?.en
      ?? capture.commonName
      ?? capture.scientificName,
  );
}
