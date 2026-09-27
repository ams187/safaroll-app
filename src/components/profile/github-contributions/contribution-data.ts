import type { Capture } from '@/lib/supabase/api';
import { addDays, format } from 'date-fns';

import type { ContributionData, ContributionLevel } from './contribution-calendar/types';
import { getDateRange } from './contribution-calendar/utils/date-utils';

export const generateContributionData = ({
  captures,
  days,
  endDate = new Date(),
}: {
  captures: readonly Capture[];
  days: number;
  endDate?: Date;
}): ContributionData => {
  const { startDate } = getDateRange(endDate, days);
  const data: ContributionData = {};

  for (let i = 0; i < days; i++) {
    const currentDate = addDays(startDate, i);
    const dateStr = format(currentDate, 'yyyy-MM-dd');
    data[dateStr] = 0;
  }

  for (const capture of captures) {
    if (capture.status !== 'ready' && capture.status !== 'needs_review') continue;
    const dateStr = format(new Date(capture.capturedAt), 'yyyy-MM-dd');
    if (data[dateStr] === undefined) continue;
    data[dateStr] = Math.min(4, data[dateStr] + 1) as ContributionLevel;
  }

  return data;
};
