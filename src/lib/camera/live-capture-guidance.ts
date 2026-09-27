import { ANIMAL_COUPE_ACTIF } from '@/lib/launch-flags';

export type LiveCaptureGuidance = 'idle' | 'moving' | 'too_far' | 'clipped' | 'ready';

type NormalizedBox = { height: number; width: number; x: number; y: number };

const EDGE_MARGIN = 0.015;
const MIN_SUBJECT_AREA = 0.04;

export function liveCaptureGuidance(
  box: NormalizedBox | null,
  stable: boolean,
): LiveCaptureGuidance {
  if (!box) return 'idle';
  if (ANIMAL_COUPE_ACTIF && (
    box.x <= EDGE_MARGIN ||
    box.y <= EDGE_MARGIN ||
    box.x + box.width >= 1 - EDGE_MARGIN ||
    box.y + box.height >= 1 - EDGE_MARGIN
  )) return 'clipped';
  if (box.width * box.height <= MIN_SUBJECT_AREA) return 'too_far';
  return stable ? 'ready' : 'moving';
}
