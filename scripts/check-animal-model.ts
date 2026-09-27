import { needsAnimalReview } from '../convex/model/confidence';
import { localEncounterRarityFromOccurrences } from '../convex/model/rarity';
import { conciseCommonName } from '../src/lib/animals/concise-common-name';
import { animalGroupName } from '../src/lib/animals/animal-group-name';

function assertEqual(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`check-animal-model: expected ${String(expected)}, got ${String(actual)}`);
  }
}

assertEqual(needsAnimalReview([0.8, 0.2]), false);
assertEqual(needsAnimalReview([0.4, 0.1]), true);
assertEqual(needsAnimalReview([0.8, 0.75]), true);
assertEqual(localEncounterRarityFromOccurrences(0), undefined);
assertEqual(localEncounterRarityFromOccurrences(4), 'legendary');
assertEqual(localEncounterRarityFromOccurrences(100), 'common');
assertEqual(conciseCommonName("Frelon d'Europe, Frelon, Guichard"), "Frelon d'Europe");
assertEqual(conciseCommonName('Vipère de Seoane (La)'), 'Vipère de Seoane');
assertEqual(animalGroupName({ class: 'Insecta', order: 'Odonata' }, 'fr'), 'Libellule');
assertEqual(animalGroupName({ class: 'Aves', order: 'Passeriformes' }, 'en'), 'Bird');

console.log('check-animal-model: ok');
