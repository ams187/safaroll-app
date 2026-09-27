// Le texte tel qu'on le PRONONCE — pur, sans une seule dépendance.
//
// Séparé de `speech.ts` pour ça : ce fichier n'importe rien, donc
// `check-spoken-text.ts` peut l'exercer sans monter React Native.

/**
 * Le texte tel qu'on le PRONONCE.
 *
 * `EnrichedMarkdownText` rend le balisage à l'écran ; le synthétiseur, lui,
 * reçoit la chaîne brute et lit tout. Sans ce passage, « **Le martinet** »
 * s'entend avec ses astérisques et une URL est épelée caractère par caractère.
 *
 * Les blocs de code partent entièrement : les faire lire à voix haute n'a
 * jamais aidé personne.
 */
export function spokenText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, ' ')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+[.)]\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    // L'italique, et RIEN d'autre : le contenu doit commencer et finir par un
    // caractère non blanc, faute de quoi « 2 * 3 * 4 » se lirait « 2 3 4 ».
    .replace(/(?<!\S)[*_](\S(?:[^*_\n]*\S)?)[*_](?!\S)/g, '$1')
    .replace(/[ \t]+/g, ' ')
    // Chaque retrait laisse un blanc derrière lui — un bloc de code effacé rend
    // une ligne d'espaces, une puce retirée peut vider sa ligne. On recompose
    // ligne à ligne plutôt que d'empiler des règles pour rattraper ça.
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}
