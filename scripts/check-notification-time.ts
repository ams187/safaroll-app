import assert from 'node:assert/strict';
import { notificationLocalMinute, userLocalMinute } from '../supabase/functions/_shared/notification-time';

const tags = (zone: string, date: Date) => ({ notification_timezone: zone, tags_synced_at: String(date.getTime()) });
for (const [iso, zone, minute] of [
  ['2026-01-01T07:00:00Z', 'Europe/Paris', 480],
  ['2026-07-01T06:00:00Z', 'Europe/Paris', 480],
  ['2026-03-29T00:59:00Z', 'Europe/Paris', 119],
  ['2026-03-29T01:00:00Z', 'Europe/Paris', 180],
  ['2026-10-25T01:00:00Z', 'Europe/Paris', 120],
  ['2026-07-01T00:00:00Z', 'Asia/Kathmandu', 345],
  ['2026-07-01T22:00:00Z', 'Europe/Paris', 0],
] as const) {
  const now = new Date(iso);
  assert.equal(notificationLocalMinute(tags(zone, now), now), minute);
}
const now = new Date('2026-07-01T06:00:00Z');
for (const value of [undefined, {}, tags('invalid/zone', now),
  tags('Europe/Paris', new Date(+now - 86_400_001)),
  tags('Europe/Paris', new Date(+now + 1)),
  { notification_timezone: 'Europe/Paris', tags_synced_at: 'invalid' },
]) assert.equal(notificationLocalMinute(value, now), null);

const originalFetch = globalThis.fetch;
try {
  for (const [payload, status, expected] of [
    [{ properties: { tags: tags('Europe/Paris', now) } }, 200, 480],
    [{ properties: { tags: { ...tags('Europe/Paris', now), nudge_muted: 'leaving, peak' } } }, 200, null],
    [{ properties: { tags: { ...tags('Europe/Paris', now), nudge_muted: 'leaving' } } }, 200, 480],
    [{ properties: { tags: { ...tags('Europe/Paris', now), nudge_muted: 123 } } }, 200, null],
    [{ errors: ['unavailable'] }, 200, null],
    [{}, 429, null],
    [{ properties: {} }, 200, null],
  ] as const) {
    globalThis.fetch = (async (url: string | URL | Request) => {
      assert.ok(String(url).endsWith('/users/by/external_id/account%2Ftest'));
      return Response.json(payload, { status });
    }) as typeof fetch;
    assert.equal(await userLocalMinute('app', 'key', 'account/test', now, 'peak'), expected);
  }
  globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
  assert.equal(await userLocalMinute('app', 'key', 'user', now, 'peak'), null);
} finally { globalThis.fetch = originalFetch; }
console.log('Notification timezone: DST, midnight, fractional zones and unavailable data pass; no external requests.');
