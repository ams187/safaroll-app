import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recentRainfall } from '../supabase/functions/after-rain/rainfall';
import { hasRecentNotificationLocation } from '../supabase/functions/_shared/notification-location';
import { notificationPages } from '../supabase/functions/_shared/notification-pages';

const all = Array.from({ length: 1203 }, (_, id) => ({ id }));
assert.deepEqual((await notificationPages(async (from, to) => ({ data: all.slice(from, Math.min(to + 1, from + 300)), error: null }))).data, all, 'Read past 1,000 rows even with a lower server cap');
const failed = await notificationPages(async (from, to) => ({ data: all.slice(from, to + 1), error: from ? 'second-page-failure' : null }));
assert.deepEqual(failed.data, [], 'Never expose a partial result after a later error');
assert.ok(failed.error);

// Execute both real handlers; never connect to Supabase or OneSignal.
for (const name of ['dawn-chorus', 'after-rain']) {
  const source = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8').replace(/^import .*;\n/gm, '');
  const code = new Bun.Transpiler({ loader: 'ts', target: 'bun' }).transformSync(source);
  for (const configured of [false, true]) {
    let handler!: (r: Request) => Promise<Response>;
    let reads = 0;
    let pushes = 0;
    let writes = 0;
    let rejectPush = false;
    let rejectActivity = false;
    let partialPush = false;
    new Function('Deno', 'createClient', 'fetch', 'recentRainfall', 'hasRecentNotificationLocation', 'notificationPages', 'userLocalMinute', 'userLocale', code)(
      { env: { get: (key: string) => key === 'ONESIGNAL_TEST_USER_ID' ? (configured ? 'test-account' : undefined) : 'secret' }, serve: (fn: typeof handler) => { handler = fn; } },
      () => ({ from: (table: string) => {
        reads++;
        const data = table === 'notification_targets'
          ? ['real-account', 'test-account'].map(user_id => ({ user_id, latitude: 48, longitude: 2, region: 'FR', owned_species: [], last_capture_at: '2026-01-01' }))
          : table === 'species_seasons'
            ? [{ scientific_name: 'Test species', monthly_counts: Array(12).fill(100), region: 'FR' }]
            : [{ scientific_name: 'Test species', vernacular_name: 'Test' }];
        const query: any = { insert: async () => { writes++; return { error: null }; }, select: () => query, in: () => query, eq: () => query, order: () => query,
          range: async (from: number, to: number) => ({ data: data.slice(from, to + 1), error: null }) };
        return query;
      } }),
      async (url: string, init?: RequestInit) => {
        if (url.includes('open-meteo')) return Response.json({});
        const body = JSON.parse(String(init?.body));
        if (body.include_aliases) {
          assert.deepEqual(body.include_aliases.external_id, ['test-account'], `${name}: demo must never target a real user`);
          pushes++;
        } else assert.ok(url.includes('test-account'), 'Activity cleanup must also be restricted');
        if ((rejectPush && url.endsWith('/notifications') && body.include_aliases) ||
          (rejectActivity && body.event === 'start')) return Response.json({ errors: ['rejected'] });
        // Real OneSignal shape: delivered, but a dead subscription is listed.
        if (partialPush && url.endsWith('/notifications') && body.include_aliases)
          return Response.json({ id: 'test-message', errors: { invalid_aliases: { external_id: ['test-account'] } } });
        return Response.json(body.event === 'start' ? { notification_id: 'test-message' } : { id: 'test-message' });
      }, recentRainfall, hasRecentNotificationLocation, notificationPages, async () => null, async () => 'en',
    );
    for (const secret of [undefined, 'wrong-secret']) {
      const denied = await handler(new Request('https://test', { method: 'POST', headers: secret ? { 'x-recap-secret': secret } : {}, body: '{"force":true,"dryRun":true}' }));
      assert.equal(denied.status, 401);
      assert.equal(reads, 0, 'Unauthorized calls cannot read user data');
    }
    const dry = await handler(new Request('https://test', { method: 'POST', headers: { 'x-recap-secret': 'secret' }, body: '{"force":true,"dryRun":true}' }));
    assert.equal(dry.status, configured ? 200 : 400);
    if (configured) assert.equal((await dry.json()).eligibles, 1, 'Dry run evaluates the real selection');
    assert.equal(pushes, 0, 'Dry run never sends a push or activity');
    assert.equal(writes, 0, 'Dry run never reserves budget or registers activity');
    const r = await handler(new Request('https://test', { method: 'POST', headers: { 'x-recap-secret': 'secret' }, body: '{"force":true}' }));
    assert.equal(r.status, configured ? 200 : 400);
    assert.equal(pushes, configured ? (name === 'dawn-chorus' ? 2 : 1) : 0);
    if (!configured) assert.equal(reads, 0, 'Reject an unconfigured demo before any DB read');
    const beforeNormal = pushes;
    await handler(new Request('https://test', { method: 'POST', headers: { 'x-recap-secret': 'secret' }, body: '{}' }));
    assert.equal(pushes, beforeNormal, 'Normal cron must ignore targets without a fresh location');
    if (configured) {
      rejectPush = true;
      const rejected = await handler(new Request('https://test', { method: 'POST', headers: { 'x-recap-secret': 'secret' }, body: '{"force":true}' }));
      assert.equal(rejected.status, 503, 'An HTTP 200 with errors is not an accepted notification');
      assert.equal((await rejected.json()).envoyes, 0);
      rejectPush = false;
      partialPush = true;
      const partial = await handler(new Request('https://test', { method: 'POST', headers: { 'x-recap-secret': 'secret' }, body: '{"force":true}' }));
      assert.equal((await partial.json()).envoyes, 1, 'An id with invalid_aliases is a delivered push');
      partialPush = false;
      if (name === 'dawn-chorus') {
        rejectActivity = true;
        const failedActivity = await handler(new Request('https://test', { method: 'POST', headers: { 'x-recap-secret': 'secret' }, body: '{"force":true}' }));
        assert.equal(failedActivity.status, 503, 'Activity rejection must not be hidden by push success');
      }
    }
  }
}
console.log('Notification demos: test-account-only targeting passes; no external requests');
