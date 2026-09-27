// Local inspection: also reused by the resumable catalogue importer.
// bun scripts/inspect-zoo-inventory.ts 10000453
import { parseHTML } from 'linkedom';

export const BASE = 'https://www.zootierliste.de/en/';

function zooId(value: string) {
  if (!/^[1-9]\d{0,11}$/.test(value)) throw new Error('Expected one numeric Zootierliste zoo ID.');
  return value;
}

export function parseInventory(id: string, popup: string, inventory: string) {
  zooId(id);
  const info = parseHTML(`<html><body>${popup}</body></html>`).document;
  const page = parseHTML(`<html><body>${inventory}</body></html>`).document;
  const name = info.querySelector('.datum')?.textContent?.trim();
  const count = info.body.textContent?.match(/Current\s+Inventory:\s*(\d+)\s+Species/i);
  const title = page.querySelector('#zootitle')?.textContent ?? '';
  const list = page.querySelector('#artliste');
  if (!name || !count || !list || !title.includes(name) || !/^Current Inventory/.test(title.trim())) {
    throw new Error('Unrecognized response or wrong zoo/current inventory. No import produced.');
  }
  const taxa = new Map<string, { sourceTaxonId: string; sourceLabel: string; sourceUrl: string; scientificName: null }>();
  for (const link of list.querySelectorAll('a[href]')) {
    const url = new URL(link.getAttribute('href')!, BASE);
    const taxonId = url.searchParams.get('art');
    const label = link.textContent?.trim();
    if (url.origin !== new URL(BASE).origin || url.pathname !== '/en/index.php' || !taxonId || !/^[1-9]\d*$/.test(taxonId) || !label) {
      throw new Error('Unexpected taxon link. Source markup needs review.');
    }
    const existing = taxa.get(taxonId);
    if (existing && existing.sourceLabel !== label) throw new Error(`Conflicting taxon ${taxonId}`);
    taxa.set(taxonId, { sourceTaxonId: taxonId, sourceLabel: label, sourceUrl: url.href, scientificName: null });
  }
  if (taxa.size !== Number(count[1])) {
    throw new Error(`Incomplete inventory: expected ${count[1]}, parsed ${taxa.size}. No import produced.`);
  }
  return {
    source: 'zootierliste',
    sourceZooId: id,
    sourceUrl: `${BASE}map.php?showzoo=${id}`,
    name,
    inventoryStatus: 'current-as-listed',
    // Retrieval date is NOT the date the zoo's holdings were verified.
    retrievedAt: new Date().toISOString(),
    revisionNote: info.body.textContent?.split('Entry information of the last complete revision:')[1]?.trim() ?? null,
    reuseStatus: 'permission-not-confirmed',
    readyForChallenges: false,
    taxa: [...taxa.values()],
  };
}

export async function inspectZoo(id: string, request: typeof fetch = fetch) {
  zooId(id);
  async function html(url: string, body?: URLSearchParams) {
    const response = await request(url, {
      method: body ? 'POST' : 'GET',
      body,
      redirect: 'error',
      headers: { 'User-Agent': 'SafaRoll/1.0 (single-zoo inventory inspection)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Zootierliste HTTP ${response.status}; stopped without retry.`);
    if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Expected HTML.');
    return response.text();
  }
  const popup = await html(`${BASE}map_zoos.php?showzoo=${id}&popup=true`);
  const inventory = await html(`${BASE}ajax.php`, new URLSearchParams({
    id, haltung: '0', aktion: 'getarten', sender: 'zoosmap.php', height: '800px',
  }));
  return parseInventory(id, popup, inventory);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error('Usage: bun scripts/inspect-zoo-inventory.ts <one-zoo-id>');
    process.exitCode = 1;
  } else {
    try {
      console.log(JSON.stringify(await inspectZoo(args[0]), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
