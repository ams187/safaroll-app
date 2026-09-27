import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { hasRecentNotificationLocation } from '../supabase/functions/_shared/notification-location';

// Real RLS checks against disposable Postgres, never the linked production DB.
const directory = mkdtempSync(join(tmpdir(), 'safaroll-consent-'));
let started = false;
try {
  execFileSync('initdb', ['-D', join(directory, 'db'), '-A', 'trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
  execFileSync('pg_ctl', ['-D', join(directory, 'db'), '-l', join(directory, 'log'), '-o', `-h '' -k ${directory}`, 'start'], { stdio: 'pipe' });
  started = true;
  const sql = `
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.profiles(user_id text primary key, region text);
    insert into public.profiles values ('alice','FR'),('bob','FR');
    create function public.current_user_id() returns text language sql stable as
      $$ select current_setting('test.user_id', true) $$;
    ${readFileSync('supabase/migrations/20260906211821_notification_consent.sql', 'utf8')}
    set role authenticated;
    set test.user_id='alice';
    insert into public.notification_consents(user_id) values('alice');
    do $$ begin
      if (select monthly_email from public.notification_consents) then raise exception 'Default opt-in'; end if;
    end $$;
    insert into public.notification_consents(user_id,monthly_email) values('alice',true)
      on conflict(user_id) do update set user_id=excluded.user_id,monthly_email=excluded.monthly_email;
    do $$ begin
      if not (select monthly_email from public.notification_consents) then raise exception 'Upsert failed'; end if;
    end $$;
    set test.user_id='bob';
    do $$ begin
      if exists(select from public.notification_consents) then raise exception 'Leaked consent'; end if;
      begin
        insert into public.notification_consents(user_id,monthly_email) values('alice',true);
        raise exception 'Cross-account write allowed';
      exception when insufficient_privilege then null; end;
    end $$;
    set test.user_id='alice';
    update public.notification_consents set monthly_email=false;
    do $$ begin
      if (select monthly_email from public.notification_consents) then raise exception 'Opt-out failed'; end if;
      begin
        update public.notification_consents set updated_at='2000-01-01';
        raise exception 'Consent timestamp forged';
      exception when insufficient_privilege then null; end;
    end $$;
    set role anon;
    do $$ begin
      begin perform * from public.notification_consents; raise exception 'Anonymous read';
      exception when insufficient_privilege then null; end;
    end $$;
    reset role;
    delete from public.profiles where user_id='alice';
    do $$ begin
      if exists(select from public.notification_consents) then raise exception 'Orphan consent'; end if;
    end $$;
  `;
  execFileSync('psql', ['-h', directory, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: sql, stdio: 'pipe' });
} finally {
  if (started) execFileSync('pg_ctl', ['-D', join(directory, 'db'), 'stop', '-m', 'immediate'], { stdio: 'pipe' });
  rmSync(directory, { recursive: true, force: true });
}

const now = Date.parse('2026-09-08T12:00:00Z');
const location = { latitude: 48, longitude: 2, region: 'FR', last_location_at: '2026-09-08T00:00:00Z' };
assert.equal(hasRecentNotificationLocation(location, now), true);
for (const change of [{ last_location_at: '2026-09-01' }, { last_location_at: '2026-09-09' },
  { last_location_at: 'invalid' }, { latitude: null }, { latitude: NaN }, { longitude: 181 }, { region: null }]) {
  assert.equal(hasRecentNotificationLocation({ ...location, ...change }, now), false);
}

// Execute the actual monthly handler with only its external boundaries mocked.
const source = readFileSync('supabase/functions/monthly-recap/index.ts', 'utf8').replace(/^import .*;\n/gm, '');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
for (const language of ['fr', 'en']) for (const consent of [undefined, false, true, 'read-error']) {
  let handler!: (request: Request) => Promise<Response>;
  let sends = 0;
  const keys: string[] = [];
  let currentDate = '2026-09-01T10:00:00Z';
  // The second species is beyond the default 1,000-row API cap.
  const captures = [...Array(1001).fill('A <script>'), 'B bird'].map((scientific_name, id) => ({ id: String(id).padStart(6, '0'), user_id: 'alice', scientific_name, common_name_locale: 'fr', rarity: 'rare' }));
  let cursor = '';
  let limit = 0;
  let readError = false;
  let sendError = false;
  let localeError = false;
  const query: any = { select: () => query, eq: () => query, gte: () => query, lt: () => query,
    in: () => query, order: () => query,
    limit: (value: number) => { limit = value; cursor = ''; return query; },
    gt: (_field: string, value: string) => { cursor = value; return query; },
    then: (resolve: (value: unknown) => unknown) => resolve({ data: captures.filter(c => c.id > cursor).slice(0, limit), error: readError && cursor ? { message: 'Page failed' } : null }),
    maybeSingle: async () => ({ data: consent === undefined ? null : { monthly_email: consent }, error: consent === 'read-error' ? {} : null }) };
  new Function('Deno', 'createClient', 'fetch', 'Date', code)(
    { env: { get: () => 'test-secret' }, serve: (fn: typeof handler) => { handler = fn; } },
    () => ({ from: () => query }), async (_url: string, init: RequestInit) => {
      if (_url.includes('/users/by/external_id/')) {
        assert.equal(consent, true, 'No OneSignal lookup without consent');
        return localeError ? Response.json({ errors: ['Unavailable'] }, { status: 503 }) : Response.json({ properties: { tags: { locale: language } } });
      }
      sends++;
      const body = JSON.parse(String(init.body));
      assert.ok(body.email_body.includes('[unsubscribe_url]'));
      assert.ok(!body.email_body.includes('<script>'));
      assert.ok(body.email_subject.includes(language === 'fr' ? '2 espèces' : '2 species'));
      assert.ok(body.email_body.includes(language === 'fr' ? 'Le mois dernier' : 'Last month'));
      assert.ok(body.email_body.includes(language === 'fr' ? 'Ne plus recevoir' : 'Unsubscribe'));
      assert.match(body.idempotency_key, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      keys.push(body.idempotency_key);
      return Response.json(sendError ? { errors: ['No subscribed recipient'] } : { id: 'accepted-test-message' });
    },
    class extends Date { constructor(value?: string | number) { super(value ?? currentDate); } },
  );
  assert.equal((await handler(new Request('https://test', { method: 'POST' }))).status, 401);
  await handler(new Request('https://test', { method: 'POST', headers: { 'x-recap-secret': 'test-secret' } }));
  assert.equal(sends, consent === true ? 1 : 0);
  await handler(new Request('https://test', { method: 'POST', headers: { 'x-recap-secret': 'test-secret' } }));
  if (consent === true) assert.equal(keys[0], keys[1], 'Replay uses the same OneSignal idempotency key');
  const beforeLateRetry = sends;
  currentDate = '2026-09-08T10:00:00Z';
  await handler(new Request('https://test', { method: 'POST', headers: { 'x-recap-secret': 'test-secret' } }));
  assert.equal(sends, beforeLateRetry, 'No late replay outside the deduplication-safe window');
  currentDate = '2026-10-01T10:00:00Z';
  await handler(new Request('https://test', { method: 'POST', headers: { 'x-recap-secret': 'test-secret' } }));
  if (consent === true) assert.notEqual(keys[0], keys.at(-1), 'New month gets a new send key');
  readError = true;
  const beforeReadError = sends;
  assert.equal((await handler(new Request('https://test', { method: 'POST', headers: { 'x-recap-secret': 'test-secret' } }))).status, 503);
  assert.equal(sends, beforeReadError, 'A failed later page must not send a partial recap');
  readError = false;
  sendError = true;
  if (consent === true) {
    const response = await handler(new Request('https://test', { method: 'POST', headers: { 'x-recap-secret': 'test-secret' } }));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).envoyes, 0, 'HTTP 200 with an API error is not an accepted message');
    localeError = true;
    const beforeLocaleError = sends;
    assert.equal((await handler(new Request('https://test', { method: 'POST', headers: { 'x-recap-secret': 'test-secret' } }))).status, 503);
    assert.equal(sends, beforeLocaleError, 'Failed language lookup does not send a guessed-language email');
  }
}
console.log('Notification consent: RLS, opt-in, opt-out, account deletion, fail-closed email and unsubscribe pass');
