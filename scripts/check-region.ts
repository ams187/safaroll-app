// L'échelle des sources de région.
//
// Elle décide de ce que l'écran Défis propose ET de ce que l'atlas montre. Une
// erreur ici ne se voit pas : elle sert simplement la mauvaise moitié du monde,
// silencieusement — exactement le bug qu'on vient de corriger.

import { setUiLanguage } from '../src/i18n/current';
import {
  REGION_DECLINED,
  SEASON_REGIONS,
  WORLD_REGION,
  regionLabel,
  resolveRegion,
} from '../src/lib/animals/region';

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

check(
  'déclarée gagne sur l’appareil — c’est tout l’intérêt de la question',
  resolveRegion({ declared: 'ZA', deviceRegion: 'FR' }),
  { code: 'ZA', source: 'declared' },
);
check(
  'refus → appareil, silencieusement',
  resolveRegion({ declared: REGION_DECLINED, deviceRegion: 'FR' }),
  { code: 'FR', source: 'device' },
);
check(
  'jamais demandé → appareil',
  resolveRegion({ declared: null, deviceRegion: 'KE' }),
  { code: 'KE', source: 'device' },
);
check(
  'ni l’un ni l’autre → le monde, jamais un pays par défaut',
  resolveRegion({ declared: null, deviceRegion: null }),
  { code: WORLD_REGION, source: 'world' },
);
// La casse vient de trois sources qui ne s'accordent pas : Postgres, iOS
// (`fr-FR`) et Android. Un `fr` contre `FR` raterait la seule région peuplée.
check(
  'casse normalisée',
  resolveRegion({ declared: null, deviceRegion: 'fr' }),
  { code: 'FR', source: 'device' },
);
check(
  'code non ISO ignoré plutôt que servi tel quel',
  resolveRegion({ declared: null, deviceRegion: 'FRA' }),
  { code: WORLD_REGION, source: 'world' },
);
// Un pays qu'on ne sait pas servir doit devenir « Monde », pas rester affiché
// au-dessus de données mondiales : l'en-tête des Défis écrit la région en clair.
check(
  'pays sans données saisonnières → Monde, pas un en-tête menteur',
  resolveRegion({ declared: null, deviceRegion: 'VN' }),
  { code: WORLD_REGION, source: 'world' },
);
check(
  'chaîne vide ignorée',
  resolveRegion({ declared: '', deviceRegion: '' }),
  { code: WORLD_REGION, source: 'world' },
);

// Un libellé manquant afficherait un code brut dans l'en-tête des Défis.
for (const region of SEASON_REGIONS) {
  if (regionLabel(region.code) === region.code) {
    failures += 1;
    console.error(`✗ ${region.code} n’a pas de libellé`);
  }
}
check('toutes les régions proposées ont un libellé', failures, 0);
check('le monde a le sien (en)', regionLabel(WORLD_REGION), 'World');
setUiLanguage('fr');
check('le monde a le sien (fr)', regionLabel(WORLD_REGION), 'Monde');
setUiLanguage('en');

// Les codes doivent être uniques : un doublon donnerait deux lignes identiques
// dans le sélecteur, et une seule serait sélectionnable.
check(
  'aucun doublon dans la liste',
  new Set(SEASON_REGIONS.map((region) => region.code)).size,
  SEASON_REGIONS.length,
);

if (failures > 0) {
  console.error(`\n${failures} règle(s) cassée(s).`);
  process.exit(1);
}
console.log('\nRésolution de région : OK.');
