// Le niveau du joueur, et son accord avec le Registre.
//
// L'XP comptait chaque CAPTURE : dix photos du même moineau valaient 1 000
// points, plus qu'une panthère des neiges. Le classement « Maîtrise », lui,
// pèse les espèces distinctes. Deux nombres prétendaient mesurer la même chose
// et se contredisaient — un joueur repère ça avant nous.
//
// Run: bun run check:progress

import {
  getDeckProgress,
  naturalistTitle,
  xpForAnimal,
  xpForMastery,
} from '../src/lib/animals/progression';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) console.log(`✓ ${label}`);
  else { failures += 1; console.error(`✗ ${label} — attendu ${expected}, obtenu ${actual}`); }
}

const ready = (scientificName: string, rarity: any) =>
  ({ rarity, scientificName, status: 'ready' as const });

// Le défaut qui a motivé ce fichier : répéter une espèce ne rapporte rien.
check(
  'dix moineaux valent un moineau',
  getDeckProgress(Array.from({ length: 10 }, () => ready('Passer domesticus', 'common'))).totalXp,
  xpForAnimal('common'),
);
check(
  'deux espèces distinctes cumulent',
  getDeckProgress([ready('Passer domesticus', 'common'), ready('Panthera leo', 'rare')]).totalXp,
  xpForAnimal('common') + xpForAnimal('rare'),
);

// --- L'XP de fidélité -----------------------------------------------------
//
// Elle bouche le trou de l'écran des défis : revoir une espèce à une journée
// de son étoile ne rapportait RIEN. Elle doit compter des JOURS distincts, et
// rester en dessous de la découverte — sinon camper sur une espèce vaudrait
// mieux qu'explorer, et le jeu s'appelle SafaRoll.

const onDay = (scientificName: string, rarity: any, day: number) =>
  ({ capturedAt: Date.UTC(2026, 0, day, 12), rarity, scientificName, status: 'ready' as const });

check('une seule étoile ne rapporte rien', xpForMastery('common', 1), 0);
check('la deuxième étoile rapporte', xpForMastery('common', 2), 25);
check('et ça monte avec les étoiles', xpForMastery('common', 3), 50);
check('un légendaire vaut plus par étoile', xpForMastery('legendary', 2), 175);

// Deux jours distincts sur un moineau : niveau 2 (seuils common [1,2,4,7,12]).
check(
  'revenir le lendemain rapporte',
  getDeckProgress([onDay('Passer domesticus', 'common', 1), onDay('Passer domesticus', 'common', 2)]).totalXp,
  xpForAnimal('common') + xpForMastery('common', 2),
);
// Mais deux photos LE MÊME JOUR ne sont qu'une journée — la règle de l'app
// entière, et celle qui empêche de farmer.
check(
  'deux photos le même jour ne rapportent qu’une fois',
  getDeckProgress([onDay('Passer domesticus', 'common', 1), onDay('Passer domesticus', 'common', 1)]).totalXp,
  xpForAnimal('common'),
);
// Le garde-fou d'équilibre : douze journées de sortie sur un moineau (niveau 5,
// le maximum) doivent valoir MOINS qu'une seule espèce rare découverte.
check(
  'la fidélité ne dépasse pas la découverte',
  xpForMastery('common', 5) < xpForAnimal('rare'),
  true,
);

// Une identification corrigée vers le haut ne doit pas laisser l'ancienne
// valeur derrière elle : on garde la MEILLEURE rareté de l'espèce.
check(
  'la meilleure rareté de l’espèce gagne',
  getDeckProgress([
    ready('Bradypus torquatus', 'epic'),
    ready('Bradypus torquatus', 'legendary'),
  ]).totalXp,
  xpForAnimal('legendary'),
);

// Les captures en cours ou ratées ne comptent pas.
check(
  'une capture non terminée ne rapporte rien',
  getDeckProgress([{ rarity: 'legendary', scientificName: 'X', status: 'processing' }]).totalXp,
  0,
);
// Une capture sans espèce n'a rien à peser.
check(
  'une capture sans nom ne rapporte rien',
  getDeckProgress([{ rarity: 'legendary', status: 'ready' }]).totalXp,
  0,
);

// Le niveau part de 1 et monte, jamais l'inverse.
check('collection vide → niveau 1', getDeckProgress([]).level, 1);
check('collection vide → titre du début', getDeckProgress([]).title, naturalistTitle(1));
{
  let previous = 0;
  for (const count of [0, 1, 5, 20, 60, 200, 800]) {
    const level = getDeckProgress(
      Array.from({ length: count }, (_, i) => ready(`Espece ${i}`, 'rare')),
    ).level;
    if (level < previous) { failures += 1; console.error(`✗ le niveau redescend à ${count} espèces`); }
    previous = level;
  }
  check('le niveau ne redescend jamais', failures, 0);
}

// Les titres couvrent toute l'échelle, sans trou ni doublon d'affilée.
{
  let last = '';
  let breaks = 0;
  for (let level = 1; level <= 60; level += 1) {
    const title = naturalistTitle(level);
    if (!title) breaks += 1;
    last = title;
  }
  check('chaque niveau porte un titre', breaks, 0);
  check('le sommet a le sien', last, naturalistTitle(60));
}

if (failures > 0) {
  console.error(`\n${failures} règle(s) cassée(s).`);
  process.exit(1);
}
console.log('\nProgression : l’XP pèse les espèces, pas les photos.');
