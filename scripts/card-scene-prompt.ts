// LE PROMPT MAÎTRE DES PLANCHES D'ESPÈCES.
//
// D'OÙ IL VIENT
//
// Les 1 736 planches de `assets/cards/species/` ont été produites par un seul
// fil Codex (`019f60d0`, 2 766 générations). Le prompt n'existait nulle part
// dans le dépôt : il ne vivait que dans l'historique de cette conversation.
// Il est ici verbatim, dans sa forme finale — celle des 1 197 dernières
// générations, la plus corrigée.
//
// CE QUE LES PREMIERS ESSAIS ONT COÛTÉ
//
// Les six premières générations du fil ont été rejetées d'un mot : « ça fait
// beaucoup trop IA generated ». Elles étaient rédigées en prose libre, sans
// références jointes. Tout ce qui suit vient des corrections successives —
// chaque interdiction de la liste `SANS` répond à un rendu réel qui a échoué.
// Ne l'allège pas : c'est un journal de ratés, pas une précaution de style.
//
// LES DEUX RÉFÉRENCES SONT OBLIGATOIRES
//
// Sans elles le modèle retombe sur le fantasy générique. Image 1 porte la
// narration d'habitat façon full-art Pokémon, image 2 la luminosité SafaRoll
// et le centre réservé. L'ancre SafaRoll est le flamant — une planche livrée,
// donc elle ne peut pas diverger de ce que l'app affiche vraiment.

import { join } from 'node:path';

/** Planche Pokémon de référence. Hors dépôt : c'est de l'art tiers. */
export const REFERENCE_POKEMON = join(process.cwd(), 'tmp/imagegen/pokemon-card-references.jpg');

/** L'ancre SafaRoll : le flamant V4, la planche que tu as validée. */
export const REFERENCE_SAFAROLL = join(process.cwd(), 'assets/cards/species/phoenicopterus-roseus.webp');

/**
 * La partie INVARIANTE, mot pour mot. Le générateur y ajoute le seul bloc qui
 * change d'une espèce à l'autre : `Species context: …`.
 */
export const PROMPT_MAITRE = [
  'Use case: stylized-concept.',
  'Asset type: portrait 2:3 SafaRoll premium collectible natural-history card background.',
  'Input image 1 guides premium Pokémon full-art ecological storytelling, layered depth and tactile collectible finish;',
  'image 2 guides SafaRoll luminosity and future sticker composition.',
  'Background only, hand-authored painterly ecological realism, species-specific local materials,',
  'restrained collectible shimmer, no generic AI fantasy look.',
  'No target animal or any animal, body part, silhouette, animal-shaped shadow/reflection, track,',
  'footprint, nest, egg, burrow, hole, bones or fossils.',
  'No text, logo, border, frame, UI, signature, watermark, decorative stars or sparkle symbols.',
  'No road, trail, path, corridor, walkway, platform or stage.',
  'Do not create a smooth oval or rectangle.',
  'Lower-middle uses the same irregular natural texture as its surroundings with slightly calmer detail only.',
].join(' ');

/**
 * CE QUE LE GÉNÉRATEUR DOIT ENCORE ÉCRIRE, et pourquoi ça ne peut pas être un
 * gabarit : l'habitat doit être GÉOGRAPHIQUEMENT juste pour l'espèce, sinon on
 * obtient huit récifs interchangeables. Ça demande une recherche, pas une
 * substitution de variables — d'où la délégation à Codex.
 */
export function consigne(binomial: string, vernaculaire: string, groupe: string) {
  const nom = vernaculaire || binomial;
  return [
    `Tu produis la planche de fond de la carte SafaRoll pour ${binomial}${vernaculaire ? ` (${vernaculaire})` : ''}.`,
    '',
    "1. Cherche l'habitat RÉEL de cette espèce : région, biome, végétation, substrat, saison et lumière",
    "   caractéristiques. Sois précis géographiquement — pas « forêt tropicale » mais le milieu exact.",
    '',
    "2. Génère UNE image avec l'outil de génération d'images, en utilisant EXACTEMENT ce prompt maître,",
    '   suivi du bloc espèce que tu rédiges toi-même :',
    '',
    PROMPT_MAITRE,
    `Species context: ${binomial}${vernaculaire ? `, ${vernaculaire}` : ''}. <habitat en deux ou trois phrases, matériaux locaux, palette>.`,
    `No ${nom}${groupe ? `, ${groupe}` : ''}, animal, <les artefacts qu'il pourrait induire : terrier, plumes, toile, coquille…>.`,
    '',
    "3. Les deux images jointes sont les références de style. Ne copie ni créature, ni cadre, ni texte.",
    '',
    "4. Contrôle avant de rendre la main : aucun animal, aucun texte, aucun cadre, aucune couture",
    '   horizontale, aucun chemin ni clairière centrale, et un centre lisible pour le sticker.',
    "   Si le rendu échoue sur un de ces points, régénère.",
    '',
    "Ne modifie AUCUN fichier du dépôt. Ta seule sortie est l'image générée.",
  ].join('\n');
}
