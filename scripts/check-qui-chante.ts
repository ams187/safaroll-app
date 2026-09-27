import assert from 'node:assert/strict';
import { BIRD_SONGS, choisirChant } from '../supabase/functions/_shared/bird-songs';

// Credits are a license obligation (CC BY / BY-SA), not decoration.
assert.equal(new Set(BIRD_SONGS.map((s) => s.slug)).size, BIRD_SONGS.length, 'Duplicate song slug');
for (const s of BIRD_SONGS) {
  assert.ok(s.author.trim() && s.source.startsWith('https://commons.wikimedia.org/'), `${s.slug}: missing credit`);
  assert.match(s.license, /^(CC0|CC BY(-SA)? [0-9.]+|Public domain)$/i, `${s.slug}: license not reusable`);
  assert.doesNotMatch(s.license, /NC/i, `${s.slug}: non-commercial license in a paid app`);
  assert.ok(s.photoAuthor.trim() && s.photoSource.startsWith('https://www.inaturalist.org/photos/'), `${s.slug}: missing photo credit`);
  assert.match(s.photoLicense, /^(CC0|CC BY(-SA)?)$/, `${s.slug}: photo license not reusable`);
}

const merle = 'Turdus merula';
const rouge = 'Erithacus rubecula';
const presence = new Map([[merle, 50], [rouge, 10], ['Cuculus canorus', 0]]);
assert.equal(choisirChant(presence, new Set(), 0)?.scientificName, merle, 'Most present species first');
assert.equal(choisirChant(presence, new Set([merle]), 0)?.scientificName, rouge, 'Never a species already owned');
assert.equal(choisirChant(presence, new Set(), 1)?.scientificName, rouge, 'Rotates day to day');
assert.equal(choisirChant(presence, new Set([merle, rouge]), 0), null, 'Out-of-season species (count 0) are never proposed');
assert.equal(choisirChant(new Map(), new Set(), 0), null, 'Unknown region: stay silent');
console.log(`Qui est-ce: ${BIRD_SONGS.length} credited songs; season, collection and rotation rules pass`);
