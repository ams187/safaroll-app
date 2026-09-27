// Deuxième passe : les espèces éteintes que le premier filtre a laissées.
//
// POURQUOI IL EN RESTAIT
//
// `purge-unphotographable.ts` supprimait les espèces sans AUCUNE observation
// depuis 1990. Trop laxiste : la rhytine de Steller, éteinte depuis 1768, en
// compte six — des ossements catalogués tardivement — et passait donc pour
// vivante, au palier légendaire. Le phoque moine des Caraïbes (1952) en a deux.
//
// LA MESURE QUI SÉPARE VRAIMENT
//
// Ce n'est pas le nombre d'observations récentes, c'est leur PART :
//
//   Rhytine de Steller          6/269  =  2,2 %   éteinte
//   Phoque moine des Caraïbes   2/209  =  1,0 %   éteinte
//   Effraie hispanique          2/214  =  0,9 %   fossile
//   ─────────────────────────────────────────────────────
//   Rhinocéros de Sumatra      23/208  = 11,1 %   vivant
//   Gibbon noir                35/229  = 15,3 %   vivant
//   Alligator de Chine         53/298  = 17,8 %   vivant
//   Iguane bleu               264/271  = 97,4 %   vivant
//
// Une espèce vivante est observée en continu ; une espèce éteinte n'a que son
// stock de spécimens de musée, dont la numérisation moderne ne représente
// qu'une poignée. Coupé à 8 %, la marge est du bon côté du rhinocéros.
//
// N'ÉCRIT RIEN EN BASE. Produit `.cache/purge-extinct.sql`.

import { writeFile } from 'node:fs/promises';

const OUT = '.cache/purge-extinct.sql';
/** Sous cette part d'observations postérieures à 1990, l'espèce ne se
 *  photographie plus. Mesuré, pas choisi : voir l'en-tête. */
const MIN_RECENT_SHARE = 0.08;

const recent: Record<string, number> = await Bun.file('.cache/gbif-recent.json').json();
const total: Record<string, number> = await Bun.file('.cache/gbif-occurrences.json').json();

const doomed = Object.entries(recent)
  .filter(([name, count]) => {
    const all = total[name];
    return typeof all === 'number' && all > 0 && count / all < MIN_RECENT_SHARE;
  })
  .map(([name, count]) => ({ name, recent: count, share: count / total[name], total: total[name] }))
  .sort((a, b) => a.share - b.share);

console.log(`${doomed.length} espèces sous ${MIN_RECENT_SHARE * 100} % d'observations récentes.\n`);
for (const row of doomed.slice(0, 10)) {
  console.log(`  ${row.name.padEnd(30)} ${row.recent}/${row.total} = ${(100 * row.share).toFixed(1)} %`);
}

const sql = [
  `-- ${doomed.length} espèces éteintes ou fossiles, laissées par le premier filtre.`,
  '--',
  '-- Généré par scripts/purge-extinct.ts. Ne pas éditer à la main.',
  '-- Le critère est la PART d\'observations postérieures à 1990, pas leur nombre :',
  '-- une éteinte plafonne à 2 %, une vivante rare dépasse 11 %.',
  '',
  ...doomed.map(
    (row) => `delete from public.species_catalog where scientific_name = '${row.name.replaceAll("'", "''")}';`,
  ),
  '',
].join('\n');

await writeFile(OUT, sql);
console.log(`\nÉcrit dans ${OUT}. Rien n'a été modifié en base.`);
