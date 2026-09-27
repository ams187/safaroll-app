// Open-Meteo precipitation timestamps mark the end of each hourly interval.
// Missing/invalid hours are unknown, never evidence that a place was wet.
export function recentRainfall(hourly: unknown, now: number): number | null {
  if (!hourly || typeof hourly !== 'object' || !Number.isFinite(now)) return null;
  const { time, precipitation } = hourly as { time?: unknown; precipitation?: unknown };
  if (!Array.isArray(time) || !Array.isArray(precipitation) || time.length !== precipitation.length) return null;
  const end = Math.floor(now / 3_600_000) * 3_600_000;
  const hours = new Map<number, number>();
  for (let i = 0; i < time.length; i++) {
    if (typeof time[i] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(time[i])) continue;
    const at = Date.parse(`${time[i]}Z`);
    if (at > end || at <= end - 12 * 3_600_000) continue;
    const rain = precipitation[i];
    if (typeof rain !== 'number' || !Number.isFinite(rain) || rain < 0 || hours.has(at)) return null;
    hours.set(at, rain);
  }
  return hours.size === 12 ? [...hours.values()].reduce((sum, rain) => sum + rain, 0) : null;
}
