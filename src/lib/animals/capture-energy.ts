export const DAILY_CAPTURE_ENERGY = 10;

export function remainingCaptureEnergy(
  captures: readonly { capturedAt: number }[],
  unlimited: boolean,
  now = Date.now(),
) {
  if (unlimited) return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const used = captures.filter(
    ({ capturedAt }) => capturedAt >= start.getTime() && capturedAt < end.getTime(),
  ).length;
  return Math.max(0, DAILY_CAPTURE_ENERGY - used);
}
