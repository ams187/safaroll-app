import catalog from '../convex/data/catalog.json';

declare const Bun: {
  file(path: string): { text(): Promise<string> };
  write(path: string, data: string): Promise<number>;
};

const groupLabels = new Map(catalog.groups.map((group) => [group.key, group.label]));
const slug = (name: string) =>
  name.trim().toLowerCase().split(/\s+/).slice(0, 2).join(' ').replace(/[^a-z0-9]+/g, '-');
const animals = catalog.species.map((species) => ({
  name: species.vernacularName,
  scientific: species.canonicalName,
  slug: slug(species.canonicalName),
  rarity: species.rarity,
  group: groupLabels.get(species.group) ?? species.group,
  total: Object.values(species.occurrences).reduce((sum, count) => sum + count, 0),
}));
const html = await Bun.file('index.html').text();
const updated = html.replace(
  /const animals = \[[\s\S]*?\];\n/,
  `const animals = ${JSON.stringify(animals)};\n`,
);
if (updated === html) throw new Error('index.html animals block not found');
await Bun.write('index.html', updated);
console.log(`${animals.length} espèces → index.html`);
