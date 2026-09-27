// Les deux règles qui décident quand l'app a le droit de parler de position.
//
// Elles ne sont pas cosmétiques : `shouldInvite` protège la cartouche unique du
// dialogue iOS, et `mapNotice` interdit de vendre Naturaliste vers une carte
// vide. Toutes deux sont pures pour être vérifiables ici, sans simulateur.

import {
  INVITE_COOLDOWN_MS,
  MAX_INVITES,
  mapGate,
  mapNotice,
  shouldInvite,
} from '../src/lib/location-rules';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`✗ ${label}\n    attendu ${JSON.stringify(expected)}\n    obtenu  ${JSON.stringify(actual)}`);
  } else {
    console.log(`✓ ${label}`);
  }
}

const NOW = 1_800_000_000_000;
const invite = (over: Partial<Parameters<typeof shouldInvite>[0]>) =>
  shouldInvite({ gate: 'ask', invites: 0, lastInviteAt: 0, now: NOW, ...over });

// --- shouldInvite ---------------------------------------------------------

check('jamais invité, permission demandable → on invite', invite({}), true);
check('déjà autorisé → rien à demander', invite({ gate: 'granted' }), false);
check('permission pas encore lue → on se tait', invite({ gate: 'unknown' }), false);
check(
  'bloqué au niveau système → on invite quand même (la feuille bascule sur Réglages)',
  invite({ gate: 'settings' }),
  true,
);
check(
  'plafond atteint → plus jamais',
  invite({ invites: MAX_INVITES, lastInviteAt: NOW - INVITE_COOLDOWN_MS * 10 }),
  false,
);
check(
  'une invitation, délai non écoulé → on attend',
  invite({ invites: 1, lastInviteAt: NOW - INVITE_COOLDOWN_MS + 1 }),
  false,
);
check(
  'une invitation, délai écoulé → seconde et dernière',
  invite({ invites: 1, lastInviteAt: NOW - INVITE_COOLDOWN_MS }),
  true,
);

// --- mapNotice ------------------------------------------------------------

const notice = (over: Partial<Parameters<typeof mapNotice>[0]>) =>
  mapNotice({ captureCount: 0, gate: 'granted', isPremium: false, locatedCount: 0, ...over });

check('aucune capture → rien à dire', notice({}), null);
check(
  'permission pas encore lue → aucune bannière (sinon elle clignote)',
  notice({ captureCount: 5, gate: 'unknown' }),
  null,
);
check(
  'des captures, aucune située, permission absente → on répare la position',
  notice({ captureCount: 5, gate: 'ask' }),
  { captureCount: 5, kind: 'location' },
);
check(
  'REFUSÉE ET PREMIUM : on répare quand même, on ne revend pas',
  notice({ captureCount: 5, gate: 'settings', isPremium: true }),
  { captureCount: 5, kind: 'location' },
);
check(
  'autorisée mais tout le stock est antérieur → on le dit',
  notice({ captureCount: 5, gate: 'granted' }),
  { kind: 'pending' },
);
check(
  'du stock situé, compte gratuit → on vend la carte',
  notice({ captureCount: 5, locatedCount: 3 }),
  { kind: 'premium', locatedCount: 3 },
);
check(
  'du stock situé, déjà Naturaliste → rien, la carte se suffit',
  notice({ captureCount: 5, isPremium: true, locatedCount: 3 }),
  null,
);
// La règle qui coûte le plus cher si elle saute : jamais de paywall vers le vide.
check(
  'gratuit, captures mais rien de situé → JAMAIS le paywall',
  notice({ captureCount: 9, gate: 'settings' }),
  { captureCount: 9, kind: 'location' },
);

// --- mapGate : ce que le carton affiche vraiment, verrou compris -----------

const gateCard = (over: Partial<Parameters<typeof mapGate>[0]>) =>
  mapGate({ captureCount: 0, gate: 'granted', isPremium: false, locatedCount: 0, ...over });

check(
  'gratuit sans aucune capture → la carte reste verrouillée et se présente',
  gateCard({}),
  { kind: 'premium', locatedCount: 0 },
);
check(
  'gratuit avec du stock situé → le verrou annonce ce qui est dessous',
  gateCard({ captureCount: 5, locatedCount: 3 }),
  { kind: 'premium', locatedCount: 3 },
);
// La règle qui coûte un remboursement si elle saute.
check(
  'gratuit, captures mais rien de situé → on répare la position, PAS le paywall',
  gateCard({ captureCount: 5, gate: 'ask' }),
  { captureCount: 5, kind: 'location' },
);
check(
  'gratuit et position bloquée → toujours la position d’abord, même sous le flou',
  gateCard({ captureCount: 5, gate: 'settings', locatedCount: 0 }),
  { captureCount: 5, kind: 'location' },
);
check(
  'gratuit, position OK, stock antérieur → on l’explique avant de vendre',
  gateCard({ captureCount: 5, gate: 'granted', locatedCount: 0 }),
  { kind: 'premium', locatedCount: 0 },
);
check(
  'Naturaliste avec du stock → aucun carton, la carte se suffit',
  gateCard({ captureCount: 5, isPremium: true, locatedCount: 3 }),
  null,
);
check(
  'Naturaliste mais position refusée → on répare, on ne revend rien',
  gateCard({ captureCount: 5, gate: 'settings', isPremium: true }),
  { captureCount: 5, kind: 'location' },
);
check(
  'autorisation pas encore lue → aucun carton (sinon il change sous les yeux)',
  gateCard({ captureCount: 5, gate: 'unknown' }),
  null,
);

if (failures > 0) {
  console.error(`\n${failures} règle(s) cassée(s).`);
  process.exit(1);
}
console.log('\nRègles de position et d’accès carte : OK.');
