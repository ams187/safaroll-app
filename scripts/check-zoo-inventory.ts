import assert from 'node:assert/strict';
import { inspectZoo, parseInventory } from './inspect-zoo-inventory';
import { Database } from 'bun:sqlite';
import { parseZooIndex, parseScientificNames, parseZooCoordinates, saveInventory, setup } from './import-zoo-inventory';

// Synthetic fixtures, not a redistributed provider inventory.
const popup = '<div class="datum">Test Zoo</div><div>Current&nbsp;Inventory:&nbsp;1&nbsp;Species<br>Entry information of the last complete revision:<br>04/2019 - updated after visit</div>';
const inventory = '<div id="zootitle">Current Inventory<br>Test Zoo</div><div id="artliste"><a href="index.php?art=123&amp;klasse=1&amp;familie=42">Test &amp; animal</a></div>';
const parsed = parseInventory('123', popup, inventory);
assert.equal(parsed.taxa.length, 1);
assert.equal(parsed.taxa[0].sourceLabel, 'Test & animal');
assert.equal(parsed.taxa[0].scientificName, null);
assert.equal(parsed.readyForChallenges, false);
assert.equal(parsed.revisionNote, '04/2019 - updated after visit');
assert.throws(() => parseInventory('123&haltung=1', popup, inventory));
assert.throws(() => parseInventory('123', popup, '<html>Rate limited</html>'));
assert.throws(() => parseInventory('123', popup.replace('1&nbsp;Species', '2&nbsp;Species'), inventory));
assert.throws(() => parseInventory('123', popup, inventory.replace('Current Inventory', 'Former Inventory')));
assert.throws(() => parseInventory('123', popup, inventory.replace('Test Zoo', 'Other Zoo')));
assert.throws(() => parseInventory('123', popup, inventory.replace('index.php?', 'https://example.org/index.php?')));
let requests = 0;
const limited = (async () => {
  requests++;
  return new Response('Rate limited', { status: 429 });
}) as typeof fetch;
await assert.rejects(inspectZoo('123', limited), /HTTP 429/);
assert.equal(requests, 1);
const index = parseZooIndex('<a href="?zoos=B">B</a><a href="map.php?showzoo=123">Test Zoo [France]</a><a href="map.php?showzoo=456">Old Zoo - geschlossen [France]</a>');
assert.equal(index.zoos.length, 2);
assert.equal(index.zoos[1].closed, true);
assert.equal(index.pages[0], 'https://www.zootierliste.de/en/zoos.php?zoos=B');
assert.throws(() => parseZooIndex('<html>Unavailable</html>'));
const names = parseScientificNames('<img alt="Scientific"><a class="navText" href="?art=123">Panthera&nbsp;leo&nbsp;leo<br>(Syn.: something)<sup>EU</sup></a>');
assert.equal(names.get('123'), 'Panthera leo leo');
assert.equal(parseScientificNames('<img alt="Scientific"><a class="navText" href="?art=123">Poecilia reticulata f. domestica<sup>EU</sup></a>').get('123'), 'Poecilia reticulata f. domestica');
assert.equal(parseScientificNames('<img alt="Scientific"><a class="navText" href="?art=123">Panthera leo × Panthera tigris</a>').size, 0);
assert.throws(() => parseScientificNames('<img alt="Scientific">Unavailable'));
assert.throws(() => parseScientificNames('<img alt="Scientific"><a class="navText" href="https://example.org/en/index.php?art=123">Panthera leo</a>'));
assert.throws(() => parseScientificNames('<a class="navText" href="?art=123">Barbary lion</a>'));
assert.deepEqual(parseZooCoordinates('point\ttitle\tdescription\ticon\n48.8,2.4\t123\t \ticon.png\n0,0\t456\t \ticon.png'),
  [{ id: '123', latitude: 48.8, longitude: 2.4, invalid: false }, { id: '456', latitude: null, longitude: null, invalid: false }]);
assert.deepEqual(parseZooCoordinates('point\ttitle\tdescription\ticon\n999,0\t123'),
  [{ id: '123', latitude: null, longitude: null, invalid: true }]);
const db = new Database(':memory:');
setup(db);
db.run("INSERT INTO zoos(id,name,country,closed) VALUES('123','Test Zoo','France',0)");
db.run("INSERT INTO jobs(key,kind) VALUES('123','zoo')");
saveInventory(db, parsed);
saveInventory(db, parsed);
assert.deepEqual(db.query('SELECT count(*) AS n FROM holdings').get(), { n: 1 });
assert.deepEqual(db.query("SELECT done FROM jobs WHERE key='123'").get(), { done: 1 });
const broken = { ...parsed, taxa: [{ ...parsed.taxa[0], sourceUrl: 'https://www.zootierliste.de/en/index.php?art=123' }] };
assert.throws(() => saveInventory(db, broken));
assert.deepEqual(db.query('SELECT count(*) AS n FROM holdings').get(), { n: 1 });
db.close();
console.log('Zoo inventory: parsing, completeness, source isolation and HTTP failures OK.');
