// Partager reste gratuit ; enregistrer automatiquement dans Photos est premium.
// Run: bun run check:premium
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check-premium-gates: ${message}`);
}

const RACINE = join(import.meta.dir, '..');
const PORTEUR = 'src/components/cards/card-share-button.tsx';

const appelants: string[] = [];
for (const rel of new Glob('src/**/*.{ts,tsx}').scanSync(RACINE)) {
  if (rel === PORTEUR || rel === 'src/lib/card-share.ts') continue;
  if (/\bshareCard\s*\(/.test(readFileSync(join(RACINE, rel), 'utf8'))) appelants.push(rel);
}

assert(
  appelants.length === 0,
  `shareCard est appelée hors du hook commun : ${appelants.join(', ')}`,
);

const hook = readFileSync(join(RACINE, PORTEUR), 'utf8');
assert(hook.includes('export function useCardShare'), 'useCardShare a disparu');
assert(
  !/isPremium|\/paywall/.test(hook),
  'le partage de carte doit rester gratuit',
);

const exporteur = readFileSync(join(RACINE, 'src/lib/capture-export.ts'), 'utf8');
assert(
  /requestPermissionsAsync\(true, \['photo'\]\)/.test(exporteur),
  'l’activation de l’export ne demande plus le droit d’ajouter aux Photos',
);
const camera = readFileSync(join(RACINE, 'src/app/(app)/camera.tsx'), 'utf8');
assert(
  /!isPremium[\s\S]+exportCaptureAssets/.test(camera),
  'la caméra peut exporter automatiquement sans vérifier SafaRoll+',
);
const profile = readFileSync(join(RACINE, 'src/app/(app)/profile.tsx'), 'utf8');
assert(
  /settings_capture_export[\s\S]+!isPremium[\s\S]+router\.push\('\/paywall'\)/.test(profile),
  'la ligne d’export des Réglages ne renvoie plus les comptes gratuits au paywall',
);

// Ce qui est gardé doit être VENDU : une fonctionnalité bloquée sans ligne au
// paywall, c'est un mur sans porte.
// On vérifie la LIGNE du tableau, puis sa traduction dans les deux langues :
// le libellé est sorti vers `src/locales`, chercher le texte français en dur
// ferait échouer ce contrôle à chaque traduction.
const paywall = readFileSync(join(RACINE, 'src/app/(app)/paywall.tsx'), 'utf8');
assert(
  /pay_row_export/.test(paywall),
  'le paywall ne liste plus l’export de cartes alors qu’il est réservé',
);
for (const langue of ['fr', 'en']) {
  const dico = JSON.parse(readFileSync(join(RACINE, `src/locales/${langue}.json`), 'utf8'));
  assert(
    dico.pay_row_export,
    `pay_row_export manque dans ${langue}.json — la ligne afficherait son identifiant`,
  );
}

// LES ROUTES PAYANTES SE PROTÈGENT ELLES-MÊMES.
//
// `/guide` a longtemps été gardée par son APPELANT — la ligne du profil. Le
// jour où une action rapide a ouvert une deuxième porte, hors de tout composant
// React, elle serait entrée gratuitement. Une garde chez l'appelant ne survit
// pas au deuxième appelant.
for (const route of ['src/app/(app)/guide.tsx', 'src/app/(app)/map.tsx']) {
  const src = readFileSync(join(RACINE, route), 'utf8');
  assert(
    /isPremium/.test(src) && /paywall/.test(src),
    `${route} est une route payante et ne porte plus sa propre garde`,
  );
}

// LE GUIDE RESTE PAYANT EN DEV.
//
// Les quatre portes du Guide portaient un court-circuit `__DEV__` : en
// développement le paywall ne s'ouvrait jamais. Le parcours qu'on testait
// n'était donc jamais celui du joueur non abonné — le seul qui compte pour
// savoir si le mur a une porte.
//
// Pour essayer le Guide en dev : Profil > Réglages, basculer l'abonnement
// (`devToggle`). Ça passe par la vraie garde au lieu de la contourner.
//
// On vérifie la FORME exacte de chaque garde : un `__DEV__ ||` réintroduit la
// casse. `profile.tsx` garde par ailleurs un `__DEV__ || isPremium` légitime
// (le compteur de captures), d'où le contrôle porte par porte plutôt qu'une
// interdiction globale de `__DEV__` dans le fichier.
const PORTES_GUIDE: [string, RegExp][] = [
  ['src/app/(app)/guide.tsx', /if \(!isPremium\) return <Redirect href="\/paywall" \/>;/],
  ['src/app/(app)/profile.tsx', /router\.push\(isPremium \? '\/guide' : '\/paywall'\)/],
  ['src/app/(app)/_layout.tsx', /router\.push\(estPremium \? '\/guide' : '\/paywall'\)/],
  ['src/components/cards/card-morph-overlay.tsx', /const openGuide = \(\) => \{\s*if \(!isPremium\) \{/],
];
for (const [porte, garde] of PORTES_GUIDE) {
  assert(
    garde.test(readFileSync(join(RACINE, porte), 'utf8')),
    `${porte} : la porte du Guide n'a plus sa garde nue (un \`__DEV__\` l'a rouverte ?)`,
  );
}

console.log('check-premium-gates: ok (partage gratuit, export Photos premium, routes protégées)');
