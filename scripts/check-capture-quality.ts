import assert from 'node:assert/strict';

import { withCaptureQualityDecision } from '../modules/subject-lift/capture-quality';
import { liveCaptureGuidance } from '../src/lib/camera/live-capture-guidance';
import {
  consumeForcedCaptureQualityAssessment,
  setCaptureQualityDebugScenario,
} from '../src/lib/camera/capture-quality-debug';

assert.equal(withCaptureQualityDecision({ aestheticsScore: -0.8 }).issue, 'low_quality');
assert.equal(withCaptureQualityDecision({ aestheticsScore: -0.79 }).shouldRetake, false);
assert.equal(withCaptureQualityDecision({ meanLuma: 24 }).issue, 'too_dark');
assert.equal(withCaptureQualityDecision({ meanLuma: 24.01 }).shouldRetake, false);
assert.equal(
  withCaptureQualityDecision({ subjectClipped: true, subjectConfidence: 0.5 }).issue,
  'subject_clipped',
);
assert.equal(
  withCaptureQualityDecision({ subjectClipped: true, subjectConfidence: 0.49 }).shouldRetake,
  false,
);
assert.equal(
  withCaptureQualityDecision({ subjectArea: 0.04, subjectConfidence: 0.5 }).issue,
  'subject_too_far',
);
assert.equal(
  withCaptureQualityDecision({ subjectArea: 0.041, subjectConfidence: 0.5 }).shouldRetake,
  false,
);
assert.equal(
  withCaptureQualityDecision({ subjectArea: 0.01, subjectClipped: true, subjectConfidence: 0.9 }).issue,
  'subject_clipped',
);
assert.equal(
  liveCaptureGuidance({ height: 0.5, width: 0.5, x: 0, y: 0 }, true),
  'ready',
);

setCaptureQualityDebugScenario('automatic');
assert.equal(consumeForcedCaptureQualityAssessment(), null);
setCaptureQualityDebugScenario('low_quality');
assert.deepEqual(consumeForcedCaptureQualityAssessment(), { issue: 'low_quality', shouldRetake: true });
setCaptureQualityDebugScenario('too_dark');
assert.deepEqual(consumeForcedCaptureQualityAssessment(), { issue: 'too_dark', shouldRetake: true });
setCaptureQualityDebugScenario('subject_clipped');
assert.deepEqual(consumeForcedCaptureQualityAssessment(), { issue: 'subject_clipped', shouldRetake: true });
setCaptureQualityDebugScenario('subject_too_far');
assert.deepEqual(consumeForcedCaptureQualityAssessment(), { issue: 'subject_too_far', shouldRetake: true });

console.log('check-capture-quality: ok');
