import assert from 'node:assert/strict';
import { closeExpiredChoruses, updateChorusActivity } from '../supabase/functions/_shared/chorus-lifecycle';

const originalFetch = globalThis.fetch;
const now = new Date('2026-09-08T10:00:00Z');
try {
  for (const active of [false, true]) {
    let sends = 0;
    const query: any = { select: () => query, is: () => query, lte: () => query, gt: () => query,
      eq: (key: string, value: string) => { assert.equal(key, 'user_id'); assert.equal(value, 'player'); return query; },
      then: (resolve: (value: unknown) => void) => resolve({ data: active ? [{ id: 'real-activity' }] : [] }) };
    const db: any = { from: () => query, rpc: async () => ({ data: { speciesCount: 3, newSpeciesCount: 2, lastSpecies: 'Species' } }) };
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
      sends++;
      assert.equal(JSON.parse(String(init.body)).event_updates.data.speciesCount, 3);
      return Response.json({ id: 'accepted' });
    }) as typeof fetch;
    await updateChorusActivity(db, 'app', 'key', 'player', now);
    assert.equal(sends, active ? 1 : 0);
  }
  for (const scenario of ['ok', 'absent', 'lost', 'network', 'claim', 'ack', 'invalid', 'read', 'unknown-404', 'body-error', 'invalid-json', 'state-error']) {
    let sent = 0, ended = false;
    const db: any = { rpc: async () => ({ data: { speciesCount: 3 }, error: scenario === 'state-error' ? 'RPC failed' : null }), from: () => {
      let update: any;
      const query: any = {
        select: () => query, eq: () => query, is: () => query, or: () => query, order: () => query, limit: () => query,
        lte: (key: string, value: string) => { assert.equal(key, 'expires_at'); assert.equal(value, now.toISOString()); return query; },
        update: (value: any) => { update = value; return query; },
        then: (resolve: (value: unknown) => void) => {
          if (!update) return resolve({ data: [{ id: 'test', content_state: { speciesCount: 3 } }], error: scenario === 'read' ? 'read error' : null });
          if (update.attempted_at) return resolve({ data: scenario === 'lost' ? [] : [{ id: 'test' }], error: scenario === 'claim' ? 'claim error' : null });
          if (update.ended_at) { ended = scenario !== 'ack'; return resolve({ error: ended ? null : 'ack error' }); }
          return resolve({ error: null });
        },
      };
      return query;
    } };
    globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
      sent++;
      const body = JSON.parse(String(init.body));
      assert.equal(body.event, 'end');
      assert.equal(body.event_updates.data.speciesCount, 3, 'Preserve final state');
      assert.ok(body.dismissal_date < +now / 1000);
      assert.equal(body.priority, 10);
      if (scenario === 'network') throw new Error('offline');
      if (scenario === 'absent') return Response.json({ errors: ['activity_id not found in this app'] }, { status: 404 });
      if (scenario === 'unknown-404') return Response.json({ errors: ['Unknown endpoint'] }, { status: 404 });
      if (scenario === 'body-error') return Response.json({ id: 'not-enough', errors: ['rejected'] });
      if (scenario === 'invalid-json') return new Response('not JSON');
      return Response.json(scenario === 'invalid' ? {} : { id: 'accepted' });
    }) as typeof fetch;
    if (scenario === 'read') {
      await assert.rejects(closeExpiredChoruses(db, 'app', 'key', now));
      assert.equal(sent, 0);
      continue;
    }
    const result = await closeExpiredChoruses(db, 'app', 'key', now);
    assert.equal(result.closed, ended ? 1 : 0, scenario);
    assert.equal(result.failed, ['network', 'claim', 'ack', 'invalid', 'unknown-404', 'body-error', 'invalid-json', 'state-error'].includes(scenario) ? 1 : 0, scenario);
    assert.equal(ended, ['ok', 'absent'].includes(scenario), 'Only accepted or explicitly absent activities can be marked ended');
    assert.equal(sent, ['lost', 'claim', 'state-error'].includes(scenario) ? 0 : 1);
  }
} finally { globalThis.fetch = originalFetch; }
console.log('Chorus closure: expiry filter, claim contention, response validation and retry preservation pass; no external requests.');
