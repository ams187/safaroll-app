import assert from 'node:assert/strict';
import { safariPortraits } from '../src/lib/safari-portraits';
import type { Capture } from '../src/lib/supabase/api';

const capture = (overrides: Partial<Capture>) => ({ status: 'ready', scientificName: 'Lynx lynx', stickerUrl: 'full', ...overrides }) as Capture;
const portraits = safariPortraits([
  capture({ scientificName: ' Lynx LYNX ', stickerThumbUrl: 'thumb' }),
  capture({ stickerUrl: 'older' }),
  capture({ scientificName: 'Lynx pardinus', status: 'processing' }),
  capture({ scientificName: 'Panthera leo', stickerUrl: null }),
]);
assert.deepEqual([...portraits], [['lynx lynx', 'thumb']]);
assert.equal(safariPortraits([capture({})]).get('lynx lynx'), 'full');
assert.equal(safariPortraits().size, 0);
console.log('Safari portraits: exact species, ready-only, thumbnail fallback OK');
