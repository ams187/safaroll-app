// A photo is not live GPS. Restrict geographical suggestions to a recently
// photographed place; describe that place, never claim current proximity.
export function hasRecentNotificationLocation(target: {
  latitude: unknown; longitude: unknown; last_location_at?: unknown; region: unknown;
}, now: number): boolean {
  const { latitude, longitude, last_location_at, region } = target;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      typeof region !== 'string' || !region.trim() || typeof last_location_at !== 'string') return false;
  const age = now - Date.parse(last_location_at);
  return Number.isFinite(age) && age >= 0 && age <= 24 * 3_600_000;
}
