import catalog from '../convex/data/catalog.json';
import fixes from '../convex/data/vernacular-fr.json';

declare const Bun: {
  argv: string[];
  sleep(milliseconds: number): Promise<void>;
  write(path: string, data: string): Promise<number>;
};

const CONCURRENCY = 3;
const species = catalog.species as (typeof catalog.species[number] & {
  vernacularNameEn?: string;
})[];
const targetSpecies = Bun.argv.includes('--local') ? [] : species.filter(
  (item) =>
    /[,;/]/.test(item.vernacularName) ||
    /(beetle|spider|moth|snail|slug|ground|river|bee|wasp|weaver)/i.test(item.vernacularName),
);
const frenchFallback: Record<string, string> = {
  bees: 'Abeille ou guêpe',
  beetles: 'Coléoptère',
  birds: 'Oiseau',
  butterflies: 'Papillon',
  dragonflies: 'Libellule',
  herps: 'Reptile ou amphibien',
  mammals: 'Mammifère',
  molluscs: 'Mollusque',
  spiders: 'Araignée',
};
let cursor = 0;
let refreshed = 0;

const concise = (name?: string) =>
  name?.split(/\s*[,;/]\s*/, 1)[0]?.replace(/\s*\((?:le|la)\)$/i, '').trim() || undefined;

async function lookup(url: URL) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': 'SafaRoll/1.0' } });
    if (response.ok) return await response.json();
    if (response.status !== 429) return null;
    await Bun.sleep(750 * (attempt + 1));
  }
  return null;
}

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < targetSpecies.length) {
      const item = targetSpecies[cursor++];
      const url = new URL('https://api.inaturalist.org/v1/taxa');
      url.searchParams.set('q', item.canonicalName);
      url.searchParams.set('per_page', '10');
      url.searchParams.set('locale', 'fr');
      const body = await lookup(url).catch(() => null);
      const exact = body?.results?.find(
        (result: { name?: string }) =>
          result.name?.toLowerCase() === item.canonicalName.toLowerCase(),
      );
      if (!exact) continue;
      const frenchName = concise(
        fixes.names[item.canonicalName as keyof typeof fixes.names] ??
          exact.preferred_common_name ??
          item.vernacularName,
      );
      const englishName = concise(exact.english_common_name ?? item.vernacularNameEn);
      if (frenchName) item.vernacularName = frenchName;
      if (englishName) item.vernacularNameEn = englishName;
      refreshed++;
    }
  }),
);

for (const item of species) {
  item.vernacularName = concise(item.vernacularName) ?? frenchFallback[item.group] ?? 'Animal';
  if (/(beetle|spider|moth|snail|slug|ground|river|bee|wasp|weaver)/i.test(item.vernacularName)) {
    item.vernacularName = frenchFallback[item.group] ?? 'Animal';
  }
}

if (refreshed < targetSpecies.length * 0.8) {
  throw new Error(`Only ${refreshed}/${targetSpecies.length} suspect names resolved; catalogue left untouched.`);
}

await Bun.write(
  'convex/data/catalog.json',
  `${JSON.stringify({ ...catalog, species }, null, 2)}\n`,
);
console.log(`${refreshed}/${targetSpecies.length} noms suspects corrigés.`);
