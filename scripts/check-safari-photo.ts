import assert from 'node:assert/strict';
import { selectSafariPhoto, fetchSafariPhoto } from '../src/lib/safari-photo';
const media = { type: 'StillImage', license: 'http://creativecommons.org/licenses/by/4.0/',
  identifier: 'https://inaturalist-open-data.s3.amazonaws.com/photos/123/original.jpg',
  references: 'https://www.inaturalist.org/photos/123', creator: 'Photographer' };
const payload = (overrides = {}) => ({ results: [{ species: 'Panthera leo', media: [{ ...media, ...overrides }] }] });
assert.equal(selectSafariPhoto(payload(), 'Panthera leo')?.uri, media.identifier.replace('original', 'medium'));
assert.equal(selectSafariPhoto(payload(), 'Lynx lynx'), null);
assert.equal(selectSafariPhoto(payload({ license: 'http://creativecommons.org/licenses/by-nc/4.0/' }), 'Panthera leo'), null);
assert.equal(selectSafariPhoto(payload({ license: null }), 'Panthera leo'), null);
assert.equal(selectSafariPhoto(payload({ identifier: 'https://example.org/huge.jpg' }), 'Panthera leo'), null);
assert.equal(selectSafariPhoto(payload({ creator: null }), 'Panthera leo'), null);
assert.equal(selectSafariPhoto(null, 'Panthera leo'), null);
if (process.argv.includes('--live')) {
  for (const name of ['Panthera leo', 'Giraffa camelopardalis', 'Lynx lynx']) {
    const photo = await fetchSafariPhoto(name, AbortSignal.timeout(15000));
    assert.ok(photo, name);
    const response = await fetch(photo.uri, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
    assert.ok(response.ok, `${name}: ${response.status}`);
    console.log(name, photo);
  }
}
console.log('Safari photos: exact species, media licence, credits and bounded image URLs OK.');
