import assert from 'node:assert/strict';
import { zooMapShape, type ZooMapSite } from '../src/lib/zoo-map';
const site: ZooMapSite = { id: '123', name: 'Zoo', country: 'France', latitude: 48.83, longitude: 2.41, inventory_at: '2026-09-06', revision_note: null };
const shape = zooMapShape([site, { ...site, latitude: NaN }, { ...site, longitude: 181 }]);
assert.equal(shape.features.length, 1);
assert.deepEqual(shape.features[0].geometry.coordinates, [2.41, 48.83]);
assert.equal(shape.features[0].properties?.id, '123');
assert.equal(zooMapShape([]).features.length, 0);
console.log('Zoo map: valid coordinates, longitude/latitude order and stable site IDs OK.');
