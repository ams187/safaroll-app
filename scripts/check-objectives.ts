// Les objectifs du mois : génériques, mensuels, et l'XP qui va avec.
//
// La règle qui a motivé le module : aucun objectif ne nomme une espèce — la
// chouette décide, pas nous. Et l'XP est recalculée, jamais stockée : une
// identification corrigée qui défait un objectif défait son XP.
//
// Run: bun run check:objectives

import { monthlyObjectives, objectivesForMonth, questXp } from '../src/lib/animals/objectives';
import { getDeckProgress, xpForAnimal } from '../src/lib/animals/progression';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) console.log(`✓ ${label}`);
  else { failures += 1; console.error(`✗ ${label} — attendu ${expected}, obtenu ${actual}`); }
}

const AOUT = (day: number) => Date.UTC(2026, 7, day, 12);
const NOW = new Date(Date.UTC(2026, 7, 15));
const on = (name: string, day: number, extra: object = {}) =>
  ({ capturedAt: AOUT(day), rarity: 'common' as const, scientificName: name, status: 'ready' as const, ...extra });

// Trois captures datées → « Capture 3 animaux » accompli, +60.
{
  const captures = [on('A', 1), on('B', 2), on('C', 3)];
  const state = monthlyObjectives(captures, NOW).find((item) => item.key === 'captures-3')!;
  check('trois captures accomplissent « 3 animaux »', state.done, true);
  check('la barre est bornée à la cible', state.count, 3);
  check('l’XP tombe', questXp(captures), 60 + 120); // + « 3 nouvelles espèces »
}

// Une capture sans date n'a pas de mois : elle ne compte pour rien.
check('sans date, pas d’objectif', questXp([{ rarity: 'legendary', scientificName: 'X', status: 'ready' }]), 0);

// Le légendaire du mois vaut son objectif — et la trouvaille avec.
{
  const captures = [on('Panthera uncia', 4, { rarity: 'legendary' })];
  const states = monthlyObjectives(captures, NOW);
  check('un légendaire coche « légendaire »', states.find((s) => s.key === 'legendaire-1')!.done, true);
  check('et coche « trouvaille » aussi', states.find((s) => s.key === 'trouvaille-1')!.done, true);
}

// Les oiseaux se comptent par classe GBIF, pas par nom.
//
// Le mois d'épreuve est CHERCHÉ, pas écrit en dur : la liste tourne, et un test
// qui suppose « oiseaux-5 est là en août » casse au prochain réglage du vivier.
{
  const month = [...Array(12).keys()].find((m) =>
    objectivesForMonth(2026, m).some((def) => def.key === 'oiseaux-5'),
  )!;
  const day = (n: number) => Date.UTC(2026, month, n, 12);
  const birds = Array.from({ length: 5 }, (_, i) => ({
    capturedAt: day(i + 1), rarity: 'common' as const, scientificName: `Oiseau ${i}`,
    status: 'ready' as const, taxonomy: { class: 'Aves' },
  }));
  const at = new Date(Date.UTC(2026, month, 15));
  check('cinq Aves cochent « 5 oiseaux »',
    monthlyObjectives(birds, at).find((s) => s.key === 'oiseaux-5')!.done, true);
  check('cinq mammifères ne les cochent pas',
    monthlyObjectives(birds.map((b) => ({ ...b, taxonomy: { class: 'Mammalia' } })), at)
      .find((s) => s.key === 'oiseaux-5')!.done, false);
}

// --- La rotation ----------------------------------------------------------
//
// Six objectifs figés deviennent du papier peint. Mais le tirage doit rester
// DÉTERMINISTE : `questXp` recalcule tout l'historique à chaque lecture, et un
// tirage qui varierait ferait bouger l'XP passée d'un lancement à l'autre.
{
  const keys = (year: number, month: number) => objectivesForMonth(year, month).map((d) => d.key).join(',');
  check('le même mois redonne toujours la même liste', keys(2026, 7), keys(2026, 7));
  check('six objectifs par mois', objectivesForMonth(2026, 7).length, 6);

  let identical = 0;
  let anchorsMissing = 0;
  for (let m = 0; m < 24; m += 1) {
    const year = 2026 + Math.floor(m / 12);
    const month = m % 12;
    const defs = objectivesForMonth(year, month);
    if (!defs.some((d) => d.key === 'captures-3') || !defs.some((d) => d.key === 'especes-3')) anchorsMissing += 1;
    if (m > 0) {
      const prev = keys(2026 + Math.floor((m - 1) / 12), (m - 1) % 12);
      if (keys(year, month) === prev) identical += 1;
    }
  }
  check('les deux ancres sont là tous les mois', anchorsMissing, 0);
  check('aucun mois n’est la copie du précédent', identical, 0);
}

// « Sors 3 jours différents » compte des JOURS, pas des photos — la règle qui
// empêche de tout gagner depuis son canapé en mitraillant le même pigeon.
{
  const month = [...Array(12).keys()].find((m) =>
    objectivesForMonth(2026, m).some((def) => def.key === 'jours-3'),
  )!;
  const shot = (day: number, n: number) => ({
    capturedAt: Date.UTC(2026, month, day, 9 + n), rarity: 'common' as const,
    scientificName: `Espece ${day}-${n}`, status: 'ready' as const,
  });
  const at = new Date(Date.UTC(2026, month, 20));
  check('cinq photos le même jour valent un jour',
    monthlyObjectives([shot(1, 0), shot(1, 1), shot(1, 2), shot(1, 3), shot(1, 4)], at)
      .find((s) => s.key === 'jours-3')!.count, 1);
  check('trois jours distincts accomplissent',
    monthlyObjectives([shot(1, 0), shot(2, 0), shot(3, 0)], at)
      .find((s) => s.key === 'jours-3')!.done, true);
}

// Une espèce revue le mois suivant n'est plus « nouvelle ».
{
  const captures = [
    on('A', 1), on('B', 2), on('C', 3),
    { ...on('A', 1), capturedAt: Date.UTC(2026, 8, 1, 12) },
    { ...on('B', 2), capturedAt: Date.UTC(2026, 8, 2, 12) },
    { ...on('C', 3), capturedAt: Date.UTC(2026, 8, 3, 12) },
  ];
  const sept = monthlyObjectives(captures, new Date(Date.UTC(2026, 8, 15)));
  check('revoir trois espèces ne les rend pas neuves', sept.find((s) => s.key === 'especes-3')!.done, false);
  check('mais elles comptent comme captures', sept.find((s) => s.key === 'captures-3')!.done, true);
}

// L'XP d'objectifs entre dans la progression totale — et une seule fois.
{
  const captures = [on('A', 1), on('B', 2), on('C', 3)];
  const total = getDeckProgress(captures).totalXp;
  check(
    'la progression additionne espèces + objectifs',
    total >= 3 * xpForAnimal('common') + 180,
    true,
  );
}

// LA RÈGLE QUI DÉCIDE DU TON DE L'ÉCRAN : rien ne se perd au changement de
// mois. L'XP d'août est acquise, et le même objectif se regagne en septembre.
{
  const aout = [on('A', 1), on('B', 2), on('C', 3)];
  const puisSept = [
    ...aout,
    { ...on('A', 1), capturedAt: Date.UTC(2026, 8, 1, 12) },
    { ...on('B', 2), capturedAt: Date.UTC(2026, 8, 2, 12) },
    { ...on('C', 3), capturedAt: Date.UTC(2026, 8, 3, 12) },
  ];
  check('l’XP d’un mois est acquise', questXp(aout), 180);
  check('le mois suivant la regagne, sans effacer l’ancienne', questXp(puisSept), 180 + 60);
  check(
    'la barre du nouveau mois repart bien de zéro',
    monthlyObjectives(aout, new Date(Date.UTC(2026, 8, 15))).find((s) => s.key === 'captures-3')!.count,
    0,
  );
}

if (failures > 0) {
  console.error(`\n${failures} règle(s) cassée(s).`);
  process.exit(1);
}
console.log('\nObjectifs : génériques, mensuels, jamais une espèce nommée.');
