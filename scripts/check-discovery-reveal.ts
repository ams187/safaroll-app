import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoveryAngle, DISCOVERY_DURATION } from '../src/components/cards/discovery-motion';

assert.equal(discoveryAngle(0), 0);
assert.equal(discoveryAngle(700), 0);
assert.equal(discoveryAngle(1272), 88);
assert.equal(discoveryAngle(2000), 180);
assert.equal(discoveryAngle(DISCOVERY_DURATION), 180);
let previous = 0;
let crossings = 0;
for (let time = 0; time <= DISCOVERY_DURATION; time++) {
  const angle = discoveryAngle(time);
  assert.ok(angle >= previous && angle <= 180);
  if (previous < 90 && angle >= 90) crossings++;
  previous = angle;
}
assert.equal(crossings, 1, 'Exactly one front reveal/haptic event');
const source = readFileSync('src/components/cards/card-reveal.tsx', 'utf8');
assert.doesNotMatch(source, /subjectUri|strikeWaitRect/, 'No floating sticker over the card back during discovery');
const camera = readFileSync('src/app/(app)/camera.tsx', 'utf8');
assert.match(camera, /const discoveryResolved = !complete \|\| allCaptures !== undefined;/,
  'Successful captures wait for collection data; offline/failed captures do not');
assert.match(camera, /const showCard = identificationStarted && lifted && ready && discoveryResolved;/,
  'Do not freeze discovery=false before the collection arrives');
assert.match(camera, /const isNewSpecies =\s+complete &&/,
  'Both ready and needs_review captures use the discovery reveal');
assert.match(source, /useState\(discovery\)/, 'Freeze variant during query refresh');
assert.match(source, /firstDiscovery && props.celebrate && !reduceMotion/);
assert.match(source, /: <StaticReveal \{\.\.\.props\} \/>;/, 'Legacy sticker impact stays disabled');
assert.match(source, /if \(!revealed \|\| delivered.current\) return;/, 'Static reveal releases controls once ready');
assert.match(source, /cancelAnimation\(time\); scheduleOnUI\(tremor.stop\)/);
assert.match(source, /pointerEvents=\{settled \? 'auto' : 'none'\}/);
assert.match(source, /if \(!mounted.current \|\| delivered.current\) return/);
console.log('Discovery reveal: flip timing, single crossing, reduced motion, interaction and cleanup guards OK.');
