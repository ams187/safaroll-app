// Le nom affiché sous un animal, et sa chaîne de repli.
//
// C'est le seul texte que tout joueur lit sur toute carte. Un maillon cassé ne
// plante pas : il affiche du latin à quelqu'un qui attendait « Lion », ou pire,
// un nom français à un joueur japonais. Rien dans une capture d'écran ne le
// signale — d'où ce fichier.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { resolveSpeciesName as speciesName } from '../src/lib/animals/species-name-chain';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) {
    failures += 1;
    console.error(`✗ ${label}\n    attendu ${JSON.stringify(expected)}\n    obtenu  ${JSON.stringify(actual)}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

const lion = {
  commonName: 'Lion',
  commonNameLocale: 'Lion',
  scientificName: 'Panthera leo',
  vernaculars: { en: 'Lion', es: 'León', fr: 'Lion', ja: 'ライオン' },
};

check('sa langue gagne', speciesName(lion, 'fr'), 'Lion');
check('anglais servi en anglais', speciesName(lion, 'en'), 'Lion');

// Une langue absente de la carte doit retomber sur l'anglais, JAMAIS sur le
// français : `commonNameLocale` est français par construction, et le servir à
// un joueur allemand serait pire que l'anglais — il prétendrait être sa langue.
check(
  'langue non couverte → anglais, pas la colonne française',
  speciesName({ commonName: 'Lion', commonNameLocale: 'Lion', scientificName: 'Panthera leo', vernaculars: { en: 'Lion' } }, 'en'),
  'Lion',
);

// Les captures d'avant la migration n'ont pas de carte. Elles doivent continuer
// de fonctionner sans reprise de données.
const ancienne = { commonName: 'Rock Pigeon', commonNameLocale: 'Pigeon biset', scientificName: 'Columba livia' };
check('capture ancienne, en français', speciesName(ancienne, 'fr'), 'Pigeon biset');
check('capture ancienne, en anglais', speciesName(ancienne, 'en'), 'Rock Pigeon');

// Une espèce sans aucun nom courant : le latin, et c'est honnête. Un coléoptère
// obscur n'a pas de nom vernaculaire, en inventer un serait faux.
check('aucun nom courant → le binôme', speciesName({ scientificName: 'Abax parallelepipedus' }, 'fr'), 'Abax parallelepipedus');
check('carte vide → le binôme', speciesName({ scientificName: 'Abax parallelepipedus', vernaculars: {} }, 'fr'), 'Abax parallelepipedus');

// Rien à dire du tout reste `undefined` : l'appelant affiche alors son propre
// repli, il ne doit pas recevoir une chaîne vide qui passerait pour un nom.
check('aucune capture', speciesName(undefined, 'fr'), undefined);
check('capture sans le moindre nom', speciesName({}, 'fr'), undefined);

// L'invariant qui compte : tant qu'il y a un binôme, il y a un nom à afficher.
for (const language of ['fr', 'en'] as const) {
  for (const capture of [lion, ancienne, { scientificName: 'Abax parallelepipedus' }]) {
    if (!speciesName(capture, language)) {
      failures += 1;
      console.error(`✗ ${language}: nom manquant pour ${capture.scientificName}`);
    }
  }
}
check('jamais vide quand le binôme existe', failures, 0);

// ─── LE NOM AFFICHÉ PASSE PAR LA CHAÎNE, JAMAIS PAR LA COLONNE ──────────────
//
// `commonName` est la colonne ANGLAISE. `speciesName` est la chaîne complète :
// sa langue → le français hérité → l'anglais → le binôme.
//
// Quatre endroits lisaient la colonne en direct — la tuile de carte (deck,
// musée, profil visité) et les trois phrases de l'année sauvage. La même bête
// s'appelait donc « vice-roi » sur la grande carte et « Viceroy » dans le deck,
// au milieu d'une interface française.
//
// Un rendu direct est invisible en revue : la ligne se lit bien, elle affiche
// juste la mauvaise langue. Ce fil d'alarme ne prouve pas l'absence du défaut —
// il refuse qu'un fichier de PLUS touche la colonne sans qu'on l'ait regardé.
// Ajouter un fichier ici veut dire : vérifié, il ne l'AFFICHE pas, il s'en sert
// comme donnée (clé d'espèce, écriture, repli).
const TOUCHENT_LA_COLONNE = [
  'src/app/(app)/(tabs)/(home)/[id].tsx',             // clé d'espèce pour la maîtrise
  'src/app/(app)/camera.tsx',                         // écriture à l'identification
  'src/app/(app)/museum.tsx',                         // clé d'espèce
  'src/app/(app)/player/[id].tsx',                    // clés + réécriture depuis le catalogue
  'src/app/(app)/profile.tsx',                        // clé d'espèce
  'src/app/(app)/wild-year.tsx',                      // clé d'espèce ; les phrases passent par speciesName
  'src/components/animals/collection-screen.tsx',     // clés + réécriture depuis le catalogue
  'src/components/cards/holo-card.tsx',               // type + clé de scène
  'src/components/challenges/challenges-screen.tsx',  // clés d'espèce
  'src/components/community/badge-grid.tsx',          // clé d'espèce
  'src/components/onboarding/tarot-animal-cards.tsx', // cartes de démo, noms français en dur
];

const racine = new URL('..', import.meta.url).pathname;
const touchent = execSync("grep -rl '\\.commonName' src --include='*.tsx' | sort", {
  cwd: racine, encoding: 'utf8',
}).trim().split('\n').filter(Boolean);
const nonRevus = touchent.filter((fichier) => !TOUCHENT_LA_COLONNE.includes(fichier));
check('aucun fichier non revu ne touche la colonne anglaise', nonRevus.join(', '), '');

// La tuile a été le défaut : qu'elle reste sur la chaîne.
const tuile = readFileSync(new URL('../src/components/cards/card-tile.tsx', import.meta.url), 'utf8');
check('la tuile ne lit plus commonName', /\.commonName/.test(tuile), false);
check('la tuile nomme via speciesName', /speciesName\(data\)/.test(tuile), true);

if (failures > 0) {
  console.error(`\n${failures} règle(s) cassée(s).`);
  process.exit(1);
}
console.log('\nNoms d’espèces : la chaîne tient, et rien ne la contourne à l’affichage.');
