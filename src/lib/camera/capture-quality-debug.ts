import { useSyncExternalStore } from 'react';

import type { CaptureQualityAssessment } from 'subject-lift';

export type CaptureQualityDebugScenario =
  | 'automatic'
  | 'low_quality'
  | 'subject_clipped'
  | 'subject_too_far'
  | 'too_dark';

let current: CaptureQualityDebugScenario = 'automatic';
const listeners = new Set<() => void>();

export function setCaptureQualityDebugScenario(scenario: CaptureQualityDebugScenario) {
  current = scenario;
  for (const listener of listeners) listener();
}

export function useCaptureQualityDebugScenario() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => 'automatic',
  );
}

export function consumeForcedCaptureQualityAssessment(): CaptureQualityAssessment | null {
  if (current === 'automatic') return null;
  const assessment: CaptureQualityAssessment = { issue: current, shouldRetake: true };
  setCaptureQualityDebugScenario('automatic');
  return assessment;
}
