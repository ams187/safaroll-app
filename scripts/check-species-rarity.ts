// La règle de rareté, vérifiée sur des espèces réelles.
//
// Elle décide de l'apparence de toute carte du jeu et de ce que « légendaire »
// veut dire. Un seuil déplacé d'une décade et le tigre devient commun, sans que
// rien ne plante — juste des milliers de cartes qui mentent.

import { rarityFromOccurrences } from '../src/lib/animals/species-rarity';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  if (actual !== expected) {
    failures += 1;
    console.error(`✗ ${label} — attendu ${expected}, obtenu ${actual}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

// Comptes GBIF réels, relevés le 6 août 2026. S'ils dérivent, le palier doit
// rester le même : c'est l'ordre qui compte, pas le chiffre exact.
const MEASURED: [string, number, string][] = [
  ['Moineau domestique', 25_841_840, 'common'],
  ['Pigeon biset', 15_559_681, 'common'],
  ['Merle noir', 13_463_814, 'common'],
  ['Cygne tuberculé', 6_718_119, 'common'],
  ['Renard roux', 2_010_100, 'common'],
  ['Aigle royal', 918_519, 'uncommon'],
  ['Flamant rose', 555_518, 'uncommon'],
  ['Koala', 397_180, 'uncommon'],
  ['Autruche', 142_722, 'rare'],
  ['Manchot empereur', 132_361, 'rare'],
  ['Perruche ondulée', 118_422, 'rare'],
  ['Éléphant d’Afrique', 28_638, 'very_rare'],
  ['Zèbre de Grant', 25_377, 'very_rare'],
  ['Lion', 19_010, 'very_rare'],
  ['Guépard', 10_050, 'very_rare'],
  ['Tigre', 7_976, 'ultra_rare'],
  ['Girafe', 6_776, 'ultra_rare'],
  ['Gorille', 2_074, 'epic'],
  ['Suricate', 1_906, 'epic'],
  ['Dragon de Komodo', 1_330, 'epic'],
  ['Axolotl', 934, 'mythic'],
  ['Panda roux', 799, 'mythic'],
  ['Panthère des neiges', 606, 'mythic'],
  ['Panda géant', 300, 'mythic'],
];

for (const [name, count, expected] of MEASURED) {
  check(`${name} (${count.toLocaleString('fr-FR')})`, rarityFromOccurrences(count), expected);
}

// Les bornes exactes : un seuil est inclusif par le bas.
check('pile 1 M → commun', rarityFromOccurrences(1_000_000), 'common');
check('juste sous 1 M → peu commun', rarityFromOccurrences(999_999), 'uncommon');
check('pile 300 → mythique', rarityFromOccurrences(300), 'mythic');
check('juste sous 300 → légendaire', rarityFromOccurrences(299), 'legendary');
check('zéro observation → légendaire', rarityFromOccurrences(0), 'legendary');

// Une requête ratée ne doit PAS produire un moineau légendaire : sans chiffre,
// pas de rareté, et l'appelant garde la sienne.
check('absent → indéfini', rarityFromOccurrences(undefined), undefined);
check('null → indéfini', rarityFromOccurrences(null), undefined);
check('NaN → indéfini', rarityFromOccurrences(Number.NaN), undefined);
check('négatif → indéfini', rarityFromOccurrences(-1), undefined);
check('texte → indéfini', rarityFromOccurrences('12000'), undefined);

// L'ordre doit être monotone : plus observé ne peut jamais être plus rare.
const ORDER = ['common', 'uncommon', 'rare', 'very_rare', 'ultra_rare', 'epic', 'mythic', 'legendary'];
let previous = -1;
for (const count of [50_000_000, 5_000_000, 900_000, 60_000, 20_000, 6_000, 1_500, 400, 100, 0]) {
  const index = ORDER.indexOf(rarityFromOccurrences(count) ?? '');
  if (index < previous) {
    failures += 1;
    console.error(`✗ monotonie cassée à ${count}`);
  }
  previous = index;
}
check('monotone : plus observé n’est jamais plus rare', failures, 0);

if (failures > 0) {
  console.error(`\n${failures} règle(s) cassée(s).`);
  process.exit(1);
}
console.log('\nRareté d’espèce : les seuils tiennent.');
