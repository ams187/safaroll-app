// Local factual catalogue only. No photos, descriptions or production writes.
import { Database } from 'bun:sqlite';
import { mkdir, open, unlink } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { BASE, inspectZoo } from './inspect-zoo-inventory';

const DIR = '.cache/zootierliste';
const DB_PATH = `${DIR}/catalog.sqlite`;
const text = (value: string) => value.replace(/\s+/g, ' ').trim();
type Zoo = { id: string; name: string; country: string; closed: boolean };

export function parseZooIndex(html: string) {
  const doc = parseHTML(html).document;
  const zoos = new Map<string, Zoo>();
  const pages = new Set<string>();
  for (const a of doc.querySelectorAll('a[href]')) {
    const url = new URL(a.getAttribute('href')!, `${BASE}zoos.php`);
    if (url.origin !== new URL(BASE).origin) continue;
    if (url.pathname === '/en/zoos.php' && url.searchParams.has('zoos')) pages.add(url.href);
    const id = url.searchParams.get('showzoo');
    if (url.pathname !== '/en/map.php' || !id) continue;
    const match = text(a.textContent ?? '').match(/^(.*?)\s*\[([^\]]+)\]$/);
    if (!/^[1-9]\d*$/.test(id) || !match) throw new Error('Invalid zoo index row');
    zoos.set(id, { id, name: match[1], country: match[2], closed: /geschlossen|\bclosed\b/i.test(match[1]) });
  }
  if (!zoos.size) throw new Error('Zoo index empty or markup changed');
  return { zoos: [...zoos.values()], pages: [...pages] };
}

export function parseScientificNames(html: string) {
  const doc = parseHTML(html).document;
  // Validate that the server actually honoured the scientific-language switch.
  if (!doc.querySelector('img[alt="Scientific"]')) throw new Error('Scientific language not selected');
  const names = new Map<string, string>();
  let sourceEntries = 0;
  for (const a of doc.querySelectorAll('a.navText[href]')) {
    const url = new URL(a.getAttribute('href')!, `${BASE}index.php`);
    if (url.origin !== new URL(BASE).origin || url.pathname !== '/en/index.php') continue;
    const id = url.searchParams.get('art');
    if (!id || !/^[1-9]\d*$/.test(id)) continue;
    sourceEntries++;
    let firstLine = '';
    for (const node of a.childNodes) {
      if (node.nodeName === 'BR' || node.nodeName === 'SUP') break;
      firstLine += node.textContent ?? '';
    }
    const name = text(firstLine);
    // Preserve the source's domestic-form suffix; this is not a GBIF-normalized name.
    if (/^[A-Z][a-z]+ [a-z][a-z-]+(?: [a-z][a-z-]+)?(?: f\. domestica)?$/.test(name)) names.set(id, name);
  }
  // A family containing only hybrids is valid, but its names remain unresolved.
  if (!sourceEntries) throw new Error('No scientific taxon entries found');
  return names;
}

export function parseZooCoordinates(tsv: string) {
  const lines = tsv.trim().split(/\r?\n/);
  if (!lines.shift()?.startsWith('point\ttitle\t')) throw new Error('Unexpected map format');
  return lines.filter(line => line.trim()).map(line => {
    const [point, id] = line.split('\t');
    const parts = point.split(',');
    const [latitude, longitude] = parts.map(Number);
    if (!/^[1-9]\d*$/.test(id) || parts.length !== 2) throw new Error('Invalid map row');
    const invalid = parts.some(p => !p.trim()) || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180;
    const missing = invalid || (latitude === 0 && longitude === 0);
    return { id, latitude: missing ? null : latitude, longitude: missing ? null : longitude, invalid };
  });
}

export function setup(db: Database) {
  db.run(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS jobs (
      key TEXT PRIMARY KEY, kind TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS zoos (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL, closed INTEGER NOT NULL,
      latitude REAL, longitude REAL, retrieved_at TEXT, revision_note TEXT);
    CREATE TABLE IF NOT EXISTS taxa (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, source_url TEXT NOT NULL, scientific_name TEXT);
    CREATE TABLE IF NOT EXISTS holdings (
      zoo_id TEXT NOT NULL REFERENCES zoos(id), taxon_id TEXT NOT NULL REFERENCES taxa(id),
      PRIMARY KEY(zoo_id,taxon_id));
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  db.run("INSERT OR IGNORE INTO metadata VALUES ('reuse_status','not-confirmed'),('publication_enabled','false')");
}

export function saveInventory(db: Database, inventory: Awaited<ReturnType<typeof inspectZoo>>) {
  db.transaction(() => {
    db.run('DELETE FROM holdings WHERE zoo_id=?', [inventory.sourceZooId]);
    for (const taxon of inventory.taxa) {
      db.run(`INSERT INTO taxa(id,label,source_url) VALUES(?,?,?) ON CONFLICT(id)
        DO UPDATE SET label=excluded.label,source_url=excluded.source_url`,
      [taxon.sourceTaxonId, taxon.sourceLabel, taxon.sourceUrl]);
      db.run('INSERT INTO holdings VALUES(?,?)', [inventory.sourceZooId, taxon.sourceTaxonId]);
      const family = new URL(taxon.sourceUrl);
      family.searchParams.delete('art');
      if (!family.searchParams.get('familie')) throw new Error('Missing family for scientific-name resolution');
      db.run("INSERT OR IGNORE INTO jobs(key,kind) VALUES(?,'family')", [family.href]);
    }
    db.run('UPDATE zoos SET retrieved_at=?,revision_note=? WHERE id=?',
      [inventory.retrievedAt, inventory.revisionNote, inventory.sourceZooId]);
    db.run("UPDATE jobs SET done=1 WHERE key=? AND kind='zoo'", [inventory.sourceZooId]);
  })();
}

export function status(db: Database) {
  return {
    jobs: db.query('SELECT kind,done,count(*) AS count FROM jobs GROUP BY kind,done').all(),
    zoos: db.query('SELECT count(*) AS total,sum(closed) AS marked_closed,sum(retrieved_at IS NOT NULL) AS imported,sum(latitude IS NOT NULL) AS geolocated FROM zoos').get(),
    taxa: db.query('SELECT count(*) AS total,sum(scientific_name IS NOT NULL) AS scientific_names FROM taxa').get(),
    holdings: db.query('SELECT count(*) AS count FROM holdings').get(),
    lastError: db.query("SELECT value FROM metadata WHERE key='last_error'").get(),
  };
}

async function run() {
  const mode = process.argv[2];
  if (!['--run', '--status', '--export'].includes(mode) || process.argv.length !== 3) {
    throw new Error('Usage: bun scripts/import-zoo-inventory.ts --run | --status | --export');
  }
  if (mode === '--status') {
    const db = new Database(DB_PATH, { readonly: true });
    try { console.log(JSON.stringify(status(db), null, 2)); } finally { db.close(); }
    return;
  }
  await mkdir(DIR, { recursive: true });
  const lock = await open(`${DIR}/import.lock`, 'wx');
  await lock.writeFile(String(process.pid));
  const db = new Database(DB_PATH);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    setup(db);
    db.run('PRAGMA journal_mode=WAL');
    if (mode === '--export') {
      const pending = db.query('SELECT count(*) AS n FROM jobs WHERE done<>1').get() as { n: number };
      if (pending.n || !(db.query('SELECT count(*) AS n FROM zoos').get() as { n: number }).n) {
        throw new Error('Import incomplete; use the SQLite database for inspection. Export refused.');
      }
      const file = await open(`${DIR}/catalog.jsonl.tmp`, 'w');
      try {
        await file.write(JSON.stringify({ type: 'metadata', source: BASE, reuseStatus: 'not-confirmed', exportedAt: new Date().toISOString() }) + '\n');
        for (const zoo of db.query('SELECT * FROM zoos WHERE closed=0 ORDER BY id').iterate() as Iterable<{ id: string }>) {
          const taxa = db.query(`SELECT t.* FROM taxa t JOIN holdings h ON h.taxon_id=t.id
            WHERE h.zoo_id=? ORDER BY t.id`).all(zoo.id);
          await file.write(JSON.stringify({ type: 'zoo', ...zoo, taxa }) + '\n');
        }
      } finally { await file.close(); }
      const { rename } = await import('node:fs/promises');
      await rename(`${DIR}/catalog.jsonl.tmp`, `${DIR}/catalog.jsonl`);
      console.log(`${DIR}/catalog.jsonl exported (scientific names can still be unresolved).`);
      return;
    }
    // ponytail: one worker, max 1 request/second; provider agreement needed to increase throughput.
    let lastRequest = 0;
    const request = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.origin !== new URL(BASE).origin || !url.pathname.startsWith('/en/')) throw new Error('Unexpected request target');
      await Bun.sleep(Math.max(0, 1000 - (Date.now() - lastRequest)));
      if (stopping) throw new Error('Stopped; run --run again to resume.');
      lastRequest = Date.now();
      const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { 'User-Agent': 'SafaRoll/1.0 (local factual zoo catalogue)' } });
      if (!response.ok) throw new Error(`HTTP ${response.status} at ${url.pathname}; stopped, no automatic retry.`);
      return response;
    }) as typeof fetch;
    const html = async (url: string, body?: URLSearchParams) => {
      const r = await request(url, { method: body ? 'POST' : 'GET', body });
      if (!r.headers.get('content-type')?.includes('text/html')) throw new Error('Expected HTML');
      return r.text();
    };
    db.run("INSERT OR IGNORE INTO jobs(key,kind) VALUES(?,'index')", [`${BASE}zoos.php`]);
    db.run("INSERT OR IGNORE INTO jobs(key,kind) VALUES(?,'map')", [`${BASE}map_zoos.php`]);
    // A new explicit run retries previously quarantined records once.
    db.run('UPDATE jobs SET done=0 WHERE done=-1');
    let processed = 0;
    let formatFailures = 0;
    const quarantine = (key: string, error: unknown) => {
      db.run('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)', [`format-error:${key}`, String(error)]);
      db.run('UPDATE jobs SET done=-1 WHERE key=?', [key]);
      console.error(`Needs review: ${key}: ${String(error)}`);
      if (++formatFailures >= 5) throw new Error('Five consecutive format errors; source layout needs review.');
    };
    for (;;) {
      const job = db.query(`SELECT key,kind FROM jobs WHERE done=0 ORDER BY
        EXISTS(SELECT 1 FROM metadata WHERE metadata.key='format-error:'||jobs.key),
        CASE kind WHEN 'index' THEN 0 WHEN 'map' THEN 1 WHEN 'family' THEN 2 ELSE 3 END,
        CASE WHEN key='10000453' THEN 0 ELSE 1 END, key LIMIT 1`).get() as { key: string; kind: string } | null;
      if (!job || stopping) break;
      db.run("INSERT OR REPLACE INTO metadata(key,value) VALUES('last_job',?)", [job.key]);
      if (job.kind === 'index') {
        const index = parseZooIndex(await html(job.key));
        db.transaction(() => {
          for (const page of index.pages) db.run("INSERT OR IGNORE INTO jobs(key,kind) VALUES(?,'index')", [page]);
          for (const zoo of index.zoos) {
            db.run('INSERT OR IGNORE INTO zoos(id,name,country,closed) VALUES(?,?,?,?)', [zoo.id, zoo.name, zoo.country, Number(zoo.closed)]);
            if (!zoo.closed) db.run("INSERT OR IGNORE INTO jobs(key,kind) VALUES(?,'zoo')", [zoo.id]);
          }
          db.run('UPDATE jobs SET done=1 WHERE key=?', [job.key]);
        })();
      } else if (job.kind === 'map') {
        const coordinates = parseZooCoordinates(await (await request(job.key)).text());
        db.transaction(() => {
          for (const point of coordinates) {
            db.run('UPDATE zoos SET latitude=?,longitude=? WHERE id=?', [point.latitude, point.longitude, point.id]);
            if (point.invalid) db.run('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)',
              [`invalid-coordinate:${point.id}`, 'Source coordinates invalid; not guessed or swapped.']);
          }
          db.run('UPDATE jobs SET done=1 WHERE key=?', [job.key]);
        })();
      } else if (job.kind === 'family') {
        const page = await html(job.key, new URLSearchParams({ sprache: 'lat' }));
        let names: Map<string, string>;
        try { names = parseScientificNames(page); }
        catch (error) { quarantine(job.key, error); continue; }
        db.transaction(() => {
          // Update known taxa; store all names for taxa discovered in later zoos too.
          for (const [id, name] of names) db.run('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)', [`taxon:${id}`, name]);
          db.run('UPDATE jobs SET done=1 WHERE key=?', [job.key]);
        })();
      } else {
        try { saveInventory(db, await inspectZoo(job.key, request)); }
        catch (error) {
          if (!/Unrecognized response|Incomplete inventory|Unexpected taxon link|Conflicting taxon/.test(String(error))) throw error;
          quarantine(job.key, error); continue;
        }
      }
      formatFailures = 0;
      db.run('DELETE FROM metadata WHERE key=?', [`format-error:${job.key}`]);
      db.run(`UPDATE taxa SET scientific_name=(SELECT value FROM metadata WHERE key='taxon:'||taxa.id)
        WHERE scientific_name IS NULL AND EXISTS(SELECT 1 FROM metadata WHERE key='taxon:'||taxa.id)`);
      db.run("DELETE FROM metadata WHERE key='last_error'");
      if (++processed % 10 === 0 || job.key === '10000453') console.log(JSON.stringify(status(db)));
    }
    const unresolved = db.query('SELECT count(*) AS n FROM jobs WHERE done<>1').get() as { n: number };
    console.log(stopping ? 'Paused, resume with --run.' : unresolved.n
      ? `${unresolved.n} jobs need review; import is not complete. See format-error metadata.`
      : 'All queued jobs completed. Run --export for JSONL.');
    console.log(JSON.stringify(status(db), null, 2));
  } catch (error) {
    db.run('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)', ['last_error', String(error)]);
    throw error;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    db.close();
    await lock.close();
    await unlink(`${DIR}/import.lock`);
  }
}

if (import.meta.main) run().catch(error => { console.error(error); process.exitCode = 1; });
