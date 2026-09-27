// Le PDF du Livre : une feuille par paquet de six, et rien qui déborde.
//
// Ce qui est vérifié n'est pas l'apparence — c'est la PAGINATION, parce que
// c'est elle qui coupait les cartes en deux. Le nombre de feuilles doit être
// exactement le nombre de paquets, et chacune doit contenir au plus six cartes.

import { bookHtml } from '../src/lib/animals/book-pdf';
import { buildBook } from '../src/lib/animals/book';
import type { Capture } from '../src/lib/supabase/api';

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures += 1;
}

let seq = 0;
function capture(day: number, month: number): Capture {
  seq += 1;
  return {
    _creationTime: 0,
    _id: `c${seq}`,
    aspectRatio: 1,
    capturedAt: Date.UTC(2026, month, day, 12),
    originalStorageId: '',
    originalUrl: null,
    rarity: 'rare',
    scientificName: `Species ${seq}`,
    status: 'ready',
    stickerUrl: 'https://example.test/s.png',
    userId: 'u',
  } as Capture;
}

// Avril : 14 rencontres → 3 feuilles (6 + 6 + 2). Juin : 1 → 1 feuille.
const captures = [
  ...Array.from({ length: 14 }, (_, i) => capture(1 + i, 3)),
  capture(4, 5),
];
const book = buildBook(captures);
const html = bookHtml(book[0]);

const feuilles = html.match(/class="feuille"/g)?.length ?? 0;
const cartes = html.match(/class="carte"/g)?.length ?? 0;

check('une feuille par paquet de six', feuilles === 4);
check('toutes les cartes sont imprimées', cartes === 15);

// Aucune feuille ne doit porter plus de six cartes : c'est la garantie qui
// remplace `break-inside: avoid`, que WebKit n'honore pas en flex.
const parFeuille = html
  .split('class="feuille"')
  .slice(1)
  .map((bloc) => (bloc.match(/class="carte"/g) ?? []).length);
check('jamais plus de six cartes par feuille', parFeuille.every((n) => n <= 6));
check('la dernière feuille porte le reste', parFeuille.includes(2));

check('les fonds sont forcés à l’impression', html.includes('print-color-adjust: exact'));
check('chaque feuille coupe la page', html.includes('page-break-after: always'));
check('la couverture et le dos existent', html.includes('couverture') && html.includes('class="dos"'));
check('le sommaire liste les mois', html.includes('Sommaire') && html.includes('Avril'));
// Un détourage étiré serait trahi : il doit rester en `contain`.
check('l’animal détouré n’est jamais étiré', /\.bete[^}]*object-fit: contain/s.test(html));

if (failures) {
  console.error(`\n${failures} échec(s).`);
  process.exit(1);
}
console.log('\nPDF : pagination fixe, fonds imprimés, détourages intacts.');
