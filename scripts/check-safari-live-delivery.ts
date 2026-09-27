import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Execute the production handler with in-memory transports; no real messages.
const source = readFileSync('supabase/functions/safari-live/index.ts', 'utf8').replace(/^import .*;\n/gm, '');
const code = new Bun.Transpiler({ loader: 'ts', target: 'bun' }).transformSync(source);
for (const scenario of ['ok', 'absent', 'mixed', 'unknown-404-error', 'send-error', 'body-error', 'missing-id-error', 'invalid-json-error', 'claim-error', 'claim-lost', 'ack-error', 'expired', 'left']) {
  let handler!: (r: Request) => Promise<Response>;
  let sends = 0;
  let acknowledged = false;
  const run = { id: 'run', revision: 1, status: scenario === 'expired' ? 'expired' : 'active',
    expiresAt: '2026-09-08T12:00:00Z', members: [{ userId: 'test', left: scenario === 'left' }] };
  if (scenario === 'mixed') run.members.push({ userId: 'following', left: false });
  new Function('Deno', 'createClient', 'activityState', 'fetch', 'closeExpiredChoruses', code)(
    { env: { get: () => 'secret' }, serve: (fn: typeof handler) => { handler = fn; } },
    () => ({ rpc: async () => ({ data: run }), from: (table: string) => {
      let update: Record<string, unknown> | undefined;
      const query: any = {
        update: (value: typeof update) => { update = value; return query; },
        select: () => query, eq: () => query, lte: () => query, is: () => query,
        or: () => query, order: () => query, limit: () => query,
        then: (resolve: (v: unknown) => void) => {
          if (table === 'safari_runs') return resolve({ error: null });
          if (!update) return resolve({ data: [{ run_id: 'run', revision: 1 }] });
          if (update.attempted_at) return resolve({ data: scenario === 'claim-lost' ? [] : [{ run_id: 'run' }], error: scenario === 'claim-error' ? 'db error' : null });
          if (update.sent_at) { acknowledged = scenario !== 'ack-error'; return resolve({ error: acknowledged ? null : 'db error' }); }
          return resolve({ error: null });
        },
      };
      return query;
    } }),
    () => ({ speciesCount: 1 }),
    async (_url: string, init: RequestInit) => {
      sends++;
      const payload = JSON.parse(String(init.body));
      const end = scenario === 'expired' || scenario === 'left';
      assert.equal(payload.event, end ? 'end' : 'update');
      assert.equal(payload.priority, end ? 10 : 5);
      if (end) assert.ok(payload.dismissal_date < Date.now() / 1000);
      if (scenario === 'absent' || (scenario === 'mixed' && _url.includes('run-test/'))) {
        return Response.json({ errors: ['activity_id not found in this app'] }, { status: 404 });
      }
      if (scenario === 'unknown-404-error') return Response.json({ errors: ['Unknown endpoint'] }, { status: 404 });
      if (scenario === 'body-error') return Response.json({ errors: ['rejected'] });
      if (scenario === 'missing-id-error') return Response.json({ id: '' });
      if (scenario === 'invalid-json-error') return new Response('invalid JSON');
      return Response.json({ id: 'message' }, { status: scenario === 'send-error' ? 503 : 201 });
    },
    async () => ({ closed: 0, failed: 0 }),
  );
  assert.equal((await handler(new Request('https://test', { method: 'POST' }))).status, 401);
  assert.equal(sends, 0);
  const response = await handler(new Request('https://test', { method: 'POST', headers: { 'x-recap-secret': 'secret' } }));
  const failure = scenario.endsWith('-error');
  assert.equal(response.status, failure ? 503 : 200, scenario);
  const result = await response.json();
  assert.equal(result.failed, failure ? 1 : 0, scenario);
  assert.equal(result.accepted, acknowledged && scenario !== 'absent' ? 1 : 0, scenario);
  if (scenario === 'absent') assert.equal(acknowledged, true, 'No follower must not leave an endlessly retrying job');
  assert.equal(sends, scenario.startsWith('claim-') ? 0 : scenario === 'mixed' ? 2 : 1, scenario);
  assert.equal(result.absent, scenario === 'absent' || scenario === 'mixed' ? 1 : 0, scenario);
  if (failure) assert.equal(acknowledged, false);
}
console.log('Safari Live Activity delivery: failures, claim contention, expiry and leave pass; no external sends');
