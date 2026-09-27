/**
 * Turns convex/data/catalog.json into the JSONL that `convex import` expects.
 *
 * Import is the built-in path for bulk-loading a table, so the catalogue does
 * not need a mutation of its own — and `--replace` makes regeneration a clean
 * swap instead of a merge.
 *
 * Run: bun run seed:catalog
 */
import catalog from '../convex/data/catalog.json';

const rows = catalog.species.map((species: Record<string, unknown>) => ({
  gbifKey: species.key,
  scientificName: species.scientificName,
  canonicalName: species.canonicalName,
  ...(species.vernacularName ? { vernacularName: species.vernacularName } : {}),
  ...(species.vernacularNameEn ? { vernacularNameEn: species.vernacularNameEn } : {}),
  ...(species.kingdom ? { kingdom: species.kingdom } : {}),
  ...(species.phylum ? { phylum: species.phylum } : {}),
  ...(species.class ? { class: species.class } : {}),
  ...(species.order ? { order: species.order } : {}),
  ...(species.family ? { family: species.family } : {}),
  ...(species.genus ? { genus: species.genus } : {}),
  group: species.group,
  occurrences: species.occurrences,
  // The card's rarity, stamped by build:catalog. Listed explicitly like every
  // other column — this file names its fields one by one, so a new one added
  // upstream is dropped in silence unless it appears here too.
  ...(species.rarity ? { rarity: species.rarity } : {}),
}));

const graded = rows.filter((row) => 'rarity' in row).length;
if (graded < rows.length) {
  console.log(
    `⚠︎ ${rows.length - graded} espèces sans rareté de carte — relance bun run build:catalog.`,
  );
}

await Bun.write('convex/data/catalog.jsonl', rows.map((row) => JSON.stringify(row)).join('\n'));
console.log(`${rows.length} lignes → convex/data/catalog.jsonl`);
