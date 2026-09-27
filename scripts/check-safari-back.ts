import assert from 'node:assert/strict';
import { safariBackStep } from '../src/lib/safari-back-step';

assert.equal(safariBackStep(false, true, false, false, false), 'recap');
assert.equal(safariBackStep(false, false, true, true, false), 'offer');
assert.equal(safariBackStep(false, false, false, true, false), 'mode');
assert.equal(safariBackStep(false, false, false, false, true), 'joining');
assert.equal(safariBackStep(false, false, false, false, false), null);
assert.equal(safariBackStep(true, true, true, true, true), null);
console.log('Safari back: memory, goals, terrain, invitation and root OK');
