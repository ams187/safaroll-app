// Ce que le synthétiseur reçoit n'est pas ce que l'écran affiche.
//
// `EnrichedMarkdownText` rend le balisage ; `Speech.speak` reçoit la chaîne
// brute et lit TOUT. Sans ce passage, « **Le martinet** » s'entend avec ses
// astérisques, un titre avec ses dièses, et une URL est épelée.

import { spokenText } from '../src/components/guide/state/spoken-text';

const assert = (actual: string, expected: string, what: string) => {
  if (actual !== expected) {
    throw new Error(`check-spoken-text: ${what}\n  attendu : ${JSON.stringify(expected)}\n  obtenu  : ${JSON.stringify(actual)}`);
  }
};

assert(spokenText('**Le martinet noir**'), 'Le martinet noir', 'le gras se lit sans ses astérisques');
assert(spokenText('## Habitat'), 'Habitat', 'un titre se lit sans ses dièses');
assert(spokenText('- vole\n- dort en vol'), 'vole\ndort en vol', 'les puces ne se prononcent pas');
assert(spokenText('1. Premier\n2. Second'), 'Premier\nSecond', 'la numérotation non plus');
assert(spokenText('Voir [la fiche](https://ex.fr/a) ici'), 'Voir la fiche ici', "un lien garde son texte, pas son URL");
assert(spokenText('Source https://fr.wikipedia.org/wiki/Martinet fin'), 'Source fin', 'une URL nue disparaît');
assert(spokenText('Le `Apus apus` vole'), 'Le Apus apus vole', 'le code en ligne garde son contenu');
assert(spokenText('Avant\n```js\nconst a = 1;\n```\nAprès'), 'Avant\nAprès', 'un bloc de code entier disparaît');
assert(spokenText('> Une citation'), 'Une citation', 'le chevron de citation disparaît');
assert(spokenText('Un\n\n---\n\nDeux'), 'Un\nDeux', 'une ligne de séparation disparaît');
assert(spokenText('*mot* seul'), 'mot seul', "l'italique se lit sans ses étoiles");
assert(spokenText('2 * 3 * 4'), '2 * 3 * 4', "une multiplication n'est PAS de l'italique");
assert(spokenText('   \n  '), '', 'un texte sans contenu prononçable rend une chaîne vide');

console.log('check-spoken-text: la voix lit le texte, pas le balisage');
