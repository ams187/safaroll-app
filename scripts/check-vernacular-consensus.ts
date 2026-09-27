// Le nom courant affiché sur la carte doit être celui que les gens emploient.
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { LANGUAGE_CODES, vernacularsByConsensus } from '../supabase/functions/_shared/vernacular-consensus';

const CODES: Record<string, string> = { en: 'en', eng: 'en', fr: 'fr', fra: 'fr', ja: 'ja', jpn: 'ja' };

// Le cas réel qui a motivé la règle : GBIF classe le nom savant en premier.
assert.equal(
  vernacularsByConsensus(
    [
      { language: 'fra', vernacularName: 'Mélopsitte ondulé' },
      { language: 'fra', vernacularName: 'Perruche ondulée' },
      { language: 'fra', vernacularName: 'Perruche ondulée' },
      { language: 'fra', vernacularName: 'Perruche ondulée' },
    ],
    CODES,
  ).fr,
  'Perruche ondulée',
);

// À égalité, l'ordre de GBIF départage — et c'est la PREMIÈRE apparition qui
// compte, pas la dernière rencontrée.
assert.equal(
  vernacularsByConsensus(
    [
      { language: 'fr', vernacularName: 'Lion' },
      { language: 'fra', vernacularName: 'Lionne' },
    ],
    CODES,
  ).fr,
  'Lion',
);

// Un nom cité plus tard mais plus souvent doit quand même gagner.
assert.equal(
  vernacularsByConsensus(
    [
      { language: 'fr', vernacularName: 'Panthère' },
      { language: 'fr', vernacularName: 'Léopard' },
      { language: 'fr', vernacularName: 'Léopard' },
    ],
    CODES,
  ).fr,
  'Léopard',
);

// Les langues ne se contaminent pas.
const mixed = vernacularsByConsensus(
  [
    { language: 'eng', vernacularName: 'Lion' },
    { language: 'jpn', vernacularName: 'ライオン' },
    { language: 'fra', vernacularName: 'Lion' },
  ],
  CODES,
);
assert.deepEqual(mixed, { en: 'Lion', fr: 'Lion', ja: 'ライオン' });

// Une langue hors de l'app est ignorée, pas rangée sous un code au hasard.
assert.deepEqual(vernacularsByConsensus([{ language: 'swa', vernacularName: 'Simba' }], CODES), {});

// Entrées vides ou blanches : rien, surtout pas une chaîne vide affichée à la
// place du nom scientifique.
assert.deepEqual(
  vernacularsByConsensus(
    [{ language: 'fr', vernacularName: '   ' }, { language: 'fr' }, { vernacularName: 'Lion' }],
    CODES,
  ),
  {},
);

// Les espaces autour ne créent pas deux candidats concurrents.
assert.equal(
  vernacularsByConsensus(
    [
      { language: 'fr', vernacularName: 'Renard roux' },
      { language: 'fr', vernacularName: '  Renard roux  ' },
      { language: 'fr', vernacularName: 'Renard' },
    ],
    CODES,
  ).fr,
  'Renard roux',
);

// ─── LE REPLI GBIF NE DOIT PAS DÉPENDRE DE LA SEULE PRÉSENCE AU CATALOGUE ───
//
// La condition a été `entry ? null : await gbifSpecies(...)` pendant un temps,
// sur la foi d'un commentaire affirmant que « les 5 576 espèces du catalogue
// ont toutes leurs vernaculaires ». 945 n'en avaient aucune. Résultat inversé :
// une espèce ABSENTE du catalogue était traduite dans vingt langues, une espèce
// PRÉSENTE mais incomplète finissait en latin sur la carte.
//
// L'assertion ne peut pas être vérifiée en base ici — le check tourne hors
// ligne — mais la forme du code, si. Le repli doit tester les NOMS, pas la
// ligne.
const identify = readFileSync(
  new URL('../supabase/functions/identify-animal/index.ts', import.meta.url),
  'utf8',
);

assert.doesNotMatch(
  identify,
  /const gbif = entry \? null :/,
  'identify-animal saute GBIF sur la simple présence au catalogue : les lignes '
  + 'sans nom courant repartiraient en latin. Teste les noms, pas la ligne.',
);
assert.match(
  identify,
  /const gbif = entry\?\.vernacular_name && entry\?\.vernacular_name_en/,
  'le repli GBIF doit être conditionné aux deux noms du catalogue.',
);

// Et le nom écrit sur la capture se lit dans la fusion, pas dans `entry` :
// c'est la fusion qui fait primer le catalogue tout en gardant GBIF en repli.
assert.doesNotMatch(
  identify,
  /common_name_locale: entry\?\.vernacular_name,/,
  'common_name_locale lu depuis `entry` : le nom GBIF serait jeté même quand '
  + 'le catalogue n\'en a aucun. Lis-le dans `vernaculars`.',
);

// Les vingt langues vivent dans le module partagé, pas recopiées dans l'edge
// function — sinon une langue ajoutée d'un côté ne rattrape rien de l'autre.
assert.ok(LANGUAGE_CODES.fra === 'fr' && LANGUAGE_CODES.fr === 'fr', 'ISO 639-3 et 639-1 ramenés au même code');
assert.doesNotMatch(identify, /const LANGUAGE_CODES/, 'LANGUAGE_CODES recopié dans identify-animal');

console.log('noms courants : consensus ok, repli GBIF ok');
