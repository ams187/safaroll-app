// Le Livre : chronologique, jalons uniques, et le passé qui ne bouge plus.

import { buildBook } from '../src/lib/animals/book';
import type { Capture } from '../src/lib/supabase/api';

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures += 1;
}

let seq = 0;
function capture(overrides: Partial<Capture>): Capture {
  seq += 1;
  return {
    _creationTime: 0,
    _id: `c${seq}`,
    aspectRatio: 1,
    capturedAt: Date.UTC(2026, 3, 10),
    originalStorageId: '',
    originalUrl: null,
    status: 'ready',
    stickerUrl: null,
    userId: 'u',
    ...overrides,
  } as Capture;
}

const day = (y: number, m: number, d: number) => Date.UTC(y, m, d, 12);

// Deux mois, une espèce revue, une rare, une légendaire plus tard.
const captures = [
  capture({ capturedAt: day(2026, 3, 2), rarity: 'common', scientificName: 'Turdus merula' }),
  capture({ capturedAt: day(2026, 3, 9), rarity: 'common', scientificName: 'Turdus merula' }),
  capture({ capturedAt: day(2026, 3, 15), rarity: 'very_rare', scientificName: 'Alcedo atthis' }),
  capture({ capturedAt: day(2026, 6, 4), rarity: 'common', scientificName: 'Turdus merula' }),
  capture({ capturedAt: day(2026, 6, 20), rarity: 'legendary', scientificName: 'Panthera pardus' }),
  capture({ capturedAt: day(2025, 11, 25), rarity: 'common', scientificName: 'Pica pica' }),
];

const book = buildBook(captures);

check('les années sortent du plus récent au plus ancien', book[0]?.year === 2026 && book[1]?.year === 2025);
check('les mois d’une année sont dans l’ordre vécu', book[0].months[0].month === 3 && book[0].months[1].month === 6);

const avril = book[0].months[0];
const juillet = book[0].months[1];
check('chaque rencontre compte, pas chaque espèce', avril.encounters.length === 3);
check('la découverte n’est marquée qu’à la première rencontre',
  avril.encounters.filter((e) => e.discovery).length === 2 && juillet.encounters.some((e) => !e.discovery));
check('une espèce déjà vue en 2025 n’est pas une découverte 2026',
  book[1].months[0].encounters[0].discovery === true);

check('la première très rare pose son jalon en avril',
  avril.milestones.some((m) => m.key === 'rarity-very_rare'));
check('la première légendaire pose le sien en juillet',
  juillet.milestones.some((m) => m.key === 'first-legendary'));
check('aucun jalon n’apparaît deux fois',
  new Set(book.flatMap((y) => y.months.flatMap((m) => m.milestones.map((j) => j.key)))).size ===
    book.flatMap((y) => y.months.flatMap((m) => m.milestones)).length);

// LE PASSÉ NE BOUGE PLUS : le merle a 2 jours distincts fin avril, 3 fin
// juillet. La page d'avril doit garder l'état d'avril.
const merleAvril = avril.encounters.find((e) => e.capture.scientificName === 'Turdus merula');
const merleJuillet = juillet.encounters.find((e) => e.capture.scientificName === 'Turdus merula');
check('la maîtrise d’avril est celle d’avril', merleAvril?.mastery?.observationDays === 2);
check('la maîtrise de juillet a avancé', merleJuillet?.mastery?.observationDays === 3);

check('un livre vide rend un tableau vide', buildBook([]).length === 0);

if (failures) {
  console.error(`\n${failures} échec(s).`);
  process.exit(1);
}
console.log('\nLe Livre : chronologie, jalons, maîtrise historique.');
