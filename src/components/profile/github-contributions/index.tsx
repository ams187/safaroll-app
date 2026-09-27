import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { memo, useEffect, useMemo, useRef } from 'react';

import type { Capture } from '@/lib/supabase/api';
import { COLOR_SCHEMES } from './config/defaults';
import { GitHubContributionCalendar } from './contribution-calendar';
import type { CalendarAnimationControls } from './contribution-calendar/types';
import { generateContributionData } from './contribution-data';

export const GitHubContributions = memo(function GitHubContributions({ active, captures }: { active: boolean; captures: readonly Capture[] }) {
  const calendarRef = useRef<CalendarAnimationControls>(null);
  const { width: windowWidth } = useWindowDimensions();
  const calendarWidth = windowWidth * 0.9;

  const contributionData = useMemo(() => {
    return generateContributionData({
      captures,
      days: Math.floor(calendarWidth / 3),
    });
  }, [calendarWidth, captures]);

  useEffect(() => {
    if (active) calendarRef.current?.startAnimation();
    else calendarRef.current?.resetAnimation();
  }, [active]);

  return (
    <View style={styles.appContainer}>
      <GitHubContributionCalendar
        ref={calendarRef}
        data={contributionData}
        colorScheme={COLOR_SCHEMES.github}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  appContainer: {
    alignItems: 'center',
    backgroundColor: '#F7EEDC',
    flex: 1,
    justifyContent: 'center',
  },
});
