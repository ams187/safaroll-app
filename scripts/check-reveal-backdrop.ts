import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Wiring regression: reuse the collection shader, only once the identified card is shown.
const reveal = readFileSync('src/app/(app)/camera.tsx', 'utf8');
const detail = readFileSync('src/app/(app)/(tabs)/(home)/[id].tsx', 'utf8');
const backdrop = '<MoltenBackdrop color={identityFor(capture).body[1]} />';
assert.ok(detail.includes(backdrop));
assert.match(reveal, /showCard && complete && capture && cardRarity\(capture\) === 'legendary' \? \(\s*<MoltenBackdrop/);
assert.ok(reveal.includes(backdrop));
assert.ok(reveal.indexOf(backdrop) < reveal.indexOf('<CardReveal'));
console.log('Reveal backdrop: collection shader/palette, legendary gate and background layer OK.');
