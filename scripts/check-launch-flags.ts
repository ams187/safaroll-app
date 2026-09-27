// UN DRAPEAU COUPÉ DOIT COUPER PARTOUT.
//
// Le Leaderboard et le Livre sont retirés du lancement par deux constantes.
// Le risque n'est pas qu'ils restent visibles — ça se verrait — c'est qu'ils
// restent visibles À UN SEUL ENDROIT : une ligne de paywall qui promet le
// Livre alors que rien n'y mène, et c'est la directive 2.3.1 (métadonnées
// trompeuses) qui répond à la revue.
//
// Ce contrôle relit les fichiers et exige que chaque point d'entrée soit bien
// derrière son drapeau, tant que celui-ci est faux.
// Run: bun run check:flags
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check-launch-flags: ${message}`);
}

const RACINE = join(import.meta.dir, '..');
const lire = (p: string) => readFileSync(join(RACINE, p), 'utf8');

const drapeaux = lire('src/lib/launch-flags.ts');
const leaderboard = /LEADERBOARD_ACTIF\s*=\s*true/.test(drapeaux);
const livre = /LIVRE_ACTIF\s*=\s*true/.test(drapeaux);
const cercle = /CERCLE_ACTIF\s*=\s*true/.test(drapeaux);

const profil = lire('src/app/(app)/profile.tsx');
const paywall = lire('src/app/(app)/paywall.tsx');

if (!leaderboard) {
  assert(
    profil.includes('{LEADERBOARD_ACTIF ? ('),
    'le Leaderboard est coupé mais son entrée de profil n’est pas derrière le drapeau',
  );
}

if (!livre) {
  assert(
    profil.includes('{LIVRE_ACTIF ? ('),
    'le Livre est coupé mais son entrée de profil n’est pas derrière le drapeau',
  );
  assert(
    /\.\.\.\(LIVRE_ACTIF/.test(paywall),
    'le Livre est coupé mais le paywall le promet encore — directive Apple 2.3.1',
  );
}

if (!cercle) {
  assert(
    profil.includes('{CERCLE_ACTIF ? ('),
    'le Cercle est coupé mais son entrée de profil n’est pas derrière le drapeau',
  );
  assert(
    profil.includes('CERCLE_ACTIF && circleOpen'),
    'la feuille du Cercle peut encore s’ouvrir alors que le Cercle est coupé',
  );
}

// Les deux écrans doivent rester COMPILÉS : on coupe des portes, pas du code.
for (const f of ['src/app/(app)/community.tsx', 'src/app/(app)/book.tsx']) {
  assert(lire(f).length > 0, `${f} a disparu — les drapeaux coupent l’accès, pas les fichiers`);
}

// Le signalement et le blocage restent posés même sans contenu d'autrui
// atteignable : ils ne coûtent rien, et le jour du rallumage la directive
// Apple 1.2 redevient exigible d'un coup.
assert(
  lire('src/components/moderation/use-moderation.ts').includes("t('mod_report')"),
  'la modération a disparu — elle doit survivre à la coupure des fonctions sociales',
);

console.log(
  `check-launch-flags: ok (leaderboard ${leaderboard ? 'ACTIF' : 'coupé'}, ` +
    `livre ${livre ? 'ACTIF' : 'coupé'}, cercle ${cercle ? 'ACTIF' : 'coupé'})`,
);
