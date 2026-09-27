// The seasonal nudge is the app's one honest retention hook — if it lies
// about a bird leaving, it is worse than no notification at all.
// Run: bun run check:seasons
import { isResident, nudgeFor, pickDailyNudge } from '../src/lib/animals/season-nudges';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check-season-nudges: ${message}`);
}

// A swift: present May→August, gone the rest of the year.
const swift = {
  monthlyCounts: [0, 0, 0, 2, 180, 420, 380, 90, 4, 0, 0, 0],
  scientificName: 'Apus apus',
};
// A blackbird: everywhere, all year.
const blackbird = {
  monthlyCounts: [90, 88, 95, 102, 110, 108, 99, 94, 96, 101, 93, 91],
  scientificName: 'Turdus merula',
};

assert(isResident(blackbird.monthlyCounts), 'a year-round species must read as resident');
assert(!isResident(swift.monthlyCounts), 'a summer migrant is not a resident');
assert(nudgeFor(blackbird, 'Merle noir', 5) === null, 'a resident never gets a season nudge');

// July is mid-season: the bird is neither arriving, peaking nor leaving, so
// there is nothing true to say. Silence is the correct answer — a nudge every
// month would train the player to ignore all of them.
assert(nudgeFor(swift, 'Martinet noir', 6) === null, 'mid-season must stay silent');

// June is the peak — the one month worth recommending.
const june = nudgeFor(swift, 'Martinet noir', 5);
assert(june !== null && june.kind === 'peak', 'June must read as the peak month');
assert(june.body.includes('juin'), 'the peak nudge must name its month');

// August is the last present month: September is empty.
const august = nudgeFor(swift, 'Martinet noir', 7);
assert(august !== null && august.kind === 'leaving', 'August must be the departure warning');
assert(august.urgency > 0.85, 'a departure is the most urgent nudge there is');
// L'ESPÈCE EST NOMMÉE — DANS LE TITRE OU DANS LE CORPS.
//
// Elle vivait dans le corps. Elle est passée en titre parce qu'écrite dans la
// phrase, elle exigeait un article que le catalogue ne porte pas : « LE
// martinet noir » mais « LA grue cendrée ». Sans genre en base, une phrase sur
// deux aurait été fautive.
//
// L'invariant n'a pas changé — un rappel qui ne nomme pas l'animal ne sert à
// rien — seulement l'endroit où on le vérifie. C'était le contrôle qui était
// trop étroit, pas le message qui a dérivé.
assert(
  `${august.title} ${august.body}`.includes('Martinet noir'),
  'the nudge must name the species, in the title or the body',
);
assert(august.body.includes('août'), 'the nudge must name the month in French');

// May is the first present month → arrival.
const may = nudgeFor(swift, 'Martinet noir', 4);
assert(may !== null && may.kind === 'arriving', 'May must read as an arrival');
for (const lang of ['fr', 'en'] as const) {
  for (const month of [4, 5, 7]) {
    const body = nudgeFor(swift, 'Apus apus', month, lang)!.body;
    assert(/observations|Sightings/.test(body), 'describe historical sightings, not guaranteed presence');
    assert(!/viennent d’être vus|just been seen|Visible jusqu|Never easier/.test(body), 'no live sighting or availability claim');
  }
}
assert(nudgeFor(swift, 'Swift', 12) === null, 'invalid month');
assert(nudgeFor({ ...swift, monthlyCounts: [NaN, ...swift.monthlyCounts.slice(1)] }, 'Swift', 5) === null, 'invalid counts');

// Off-season months say nothing at all.
assert(nudgeFor(swift, 'Martinet noir', 0) === null, 'January must stay silent for a summer bird');

// Too little data must never produce a claim.
assert(
  nudgeFor({ monthlyCounts: [0, 0, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0], scientificName: 'X y' }, 'X', 4) ===
    null,
  'three observations are not a season',
);
assert(
  nudgeFor({ monthlyCounts: [1, 2, 3], scientificName: 'X y' }, 'X', 1) === null,
  'a malformed curve must be refused, not extrapolated',
);

// Species you already own are not advertised to you.
const owned = pickDailyNudge(
  [{ commonName: 'Martinet noir', curve: swift }],
  new Set(['Apus apus']),
  7,
);
assert(owned === null, 'a species already in the collection must not be nudged');

const picked = pickDailyNudge([{ commonName: 'Martinet noir', curve: swift }], new Set(), 7);
assert(picked !== null && picked.kind === 'leaving', 'the missing migrant must be picked');

console.log('check-season-nudges: departures, arrivals, peaks and silences all hold');

// --- L'échéance de la saison ------------------------------------------------
//
// Le compte à rebours de la page Défis. Il porte la seule urgence de l'écran,
// et elle doit rester vraie : dernier jour du mois INCLUS, sinon on annonce
// « 0 jour » à quelqu'un qui a encore la journée pour capturer.

import { daysLeftInMonth } from '../src/lib/animals/season-clock';

function expectDays(iso: string, expected: number) {
  const actual = daysLeftInMonth(new Date(iso));
  if (actual !== expected) {
    throw new Error(`check-season-nudges: ${iso} — got ${actual}, expected ${expected}`);
  }
}

expectDays('2026-08-06T12:00:00', 26); // août : 31 jours
expectDays('2026-08-31T23:00:00', 1); // dernier jour, il reste la journée
expectDays('2026-08-01T00:30:00', 31); // premier jour, le mois entier
expectDays('2026-02-15T12:00:00', 14); // février commun : 28 jours
expectDays('2028-02-15T12:00:00', 15); // février bissextile : 29
expectDays('2026-12-31T12:00:00', 1); // bascule d'année

console.log('check-season-nudges: échéance de saison — dernier jour inclus, mois courts et bissextiles.');
