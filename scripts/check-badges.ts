// Les distinctions comptent des ESPÈCES, jamais des photos.
//
// C'est la même règle que l'XP, et elle doit le rester : deux compteurs qui
// divergent se remarquent tout de suite. Un joueur qui voit « 50 espèces » sur
// sa carte de niveau et une distinction « Collection · 50 » encore verrouillée
// perd confiance dans les deux.
//
// Run: bun run check:badges

import { BADGE_FIELD } from '../src/lib/animals/badge-colors';
import { badgeStates, FINDING_RARITIES } from '../src/lib/animals/badges';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) console.log(`✓ ${label}`);
  else { failures += 1; console.error(`✗ ${label} — attendu ${expected}, obtenu ${actual}`); }
}

const at = (key: string, states = badgeStates([])) => states.find((b) => b.key === key)!;

// Collection vide : tout est verrouillé, rien ne plante.
check('vide → rien de gagné', badgeStates([]).every((b) => !b.earned), true);
check('vide → progression nulle', at('ampleur-10').progress, 0);

// Dix photos du même moineau ne valent qu'une espèce.
const tenSparrows = Array.from({ length: 10 }, () => ({
  group: 'oiseaux', rarity: 'common' as const, scientificName: 'Passer domesticus',
}));
check(
  'dix moineaux ne débloquent pas « Carnet entamé »',
  at('ampleur-10', badgeStates(tenSparrows)).earned,
  false,
);

// Dix espèces distinctes, si.
const tenSpecies = Array.from({ length: 10 }, (_, i) => ({
  group: 'oiseaux', rarity: 'common' as const, scientificName: `Espece ${i}`,
}));
check('dix espèces débloquent', at('ampleur-10', badgeStates(tenSpecies)).earned, true);
check('mais pas la suivante', at('ampleur-50', badgeStates(tenSpecies)).earned, false);

// Le flair suit exactement la liste du Registre : une « rare » n'est pas une
// trouvaille, une « très rare » l'est.
check(
  'une espèce rare n’est pas une trouvaille',
  at('flair-1', badgeStates([{ rarity: 'rare', scientificName: 'A' }])).earned,
  false,
);
check(
  'une très rare l’est',
  at('flair-1', badgeStates([{ rarity: 'very_rare', scientificName: 'A' }])).earned,
  true,
);
check('le légendaire compte aussi', FINDING_RARITIES.includes('legendary'), true);
check('le commun ne compte pas', FINDING_RARITIES.includes('common'), false);

// Le règne compte dans SA branche, pas dans une autre.
const birds = Array.from({ length: 25 }, (_, i) => ({
  group: 'oiseaux', rarity: 'common' as const, scientificName: `Oiseau ${i}`,
}));
check('vingt-cinq oiseaux → Ornithologue', at('regne-oiseaux-25', badgeStates(birds)).earned, true);
check(
  'et pas Mammalogiste',
  at('regne-mammiferes-20', badgeStates(birds)).earned,
  false,
);

// Une espèce sans nom n'existe pas : elle ne peut pas être comptée deux fois,
// ni une seule.
check(
  'une capture sans nom ne compte pas',
  at('ampleur-10', badgeStates([{ group: 'oiseaux', rarity: 'common' }])).progress,
  0,
);

// La progression est bornée : au-delà du seuil elle reste à 1, sinon la barre
// déborderait de sa piste.
check(
  'progression bornée à 1',
  at('ampleur-10', badgeStates(Array.from({ length: 99 }, (_, i) => ({
    group: 'oiseaux', rarity: 'common' as const, scientificName: `E${i}`,
  })))).progress,
  1,
);

// Les clés sont uniques : deux distinctions homonymes se masqueraient.
{
  const keys = badgeStates([]).map((b) => b.key);
  check('les clés sont uniques', new Set(keys).size, keys.length);
}

// --- Les teintes -----------------------------------------------------------
//
// Chaque distinction peint le fond de sa vitrine avec une couleur tirée de sa
// propre illustration. Elles n'ont donc plus une saturation artificiellement
// identique ; l'invariant utile est simplement qu'aucune paire ne se confonde.
{
  const keys = Object.keys(BADGE_FIELD);
  check('chaque distinction a sa teinte', keys.length, badgeStates([]).length);
  check('aucune distinction sans teinte',
    badgeStates([]).filter((badge) => !BADGE_FIELD[badge.key]).length, 0);
  check('aucune teinte en double', new Set(Object.values(BADGE_FIELD)).size, keys.length);

  const rgb = Object.values(BADGE_FIELD).map((hex) =>
    [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16)),
  );
  let tropProches = 0;
  for (let a = 0; a < rgb.length; a += 1) {
    for (let b = a + 1; b < rgb.length; b += 1) {
      const distance = Math.hypot(...rgb[a].map((channel, index) => channel - rgb[b][index]));
      if (distance < 35) tropProches += 1;
    }
  }
  check('deux fonds ne se confondent jamais', tropProches, 0);
}

if (failures > 0) {
  console.error(`\n${failures} règle(s) cassée(s).`);
  process.exit(1);
}
console.log('\nDistinctions : elles comptent des espèces, pas des photos.');
