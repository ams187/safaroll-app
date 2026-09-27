import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activityState, coordinates, distanceKm, type SafariRun } from '../supabase/functions/_shared/safari';

assert.throws(() => coordinates(NaN, 2));
assert.throws(() => coordinates(48, 181));
assert.equal(distanceKm(48, 2, 48, 2), 0);
assert.ok(distanceKm(48, 2, 49, 2) > 110);
assert.deepEqual(activityState({ targets: [{ scientificName: 'A a', label: 'A', foundAt: '2026-01-01', foundBy: 'a' },
  { scientificName: 'B b', label: 'B' }], members: [{ userId: 'a', name: 'Ada', left: false }] } as SafariRun),
{ speciesCount: 1, newSpeciesCount: 0, targetCount: 2, nextTarget: 'B', lastSpecies: 'Ada · A', teamSize: 1 });

// A throwaway Postgres cluster, unix socket only. Never touches the linked Supabase project.
const directory = mkdtempSync(join(tmpdir(), 'safaroll-safari-'));
let started = false;
try {
  execFileSync('initdb', ['-D', join(directory, 'db'), '-A', 'trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
  execFileSync('pg_ctl', ['-D', join(directory, 'db'), '-l', join(directory, 'log'), '-o', `-h '' -k ${directory}`, 'start'], { stdio: 'pipe' });
  started = true;
  const sql = `
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.profiles(user_id text primary key,display_name text);
    create table public.animal_captures(id uuid primary key default gen_random_uuid(),user_id text,
      status text,scientific_name text,is_onboarding_capture boolean default false,capture_source text default 'camera',
      latitude double precision default 48,longitude double precision default 2,captured_at timestamptz default clock_timestamp());
    grant select on public.profiles,public.animal_captures to service_role;
    ${readFileSync('supabase/migrations/20260906103421_photo_safaris.sql', 'utf8')}
    ${readFileSync('supabase/migrations/20260906211836_safari_delivery_revision.sql', 'utf8')}
    ${readFileSync('supabase/migrations/20260908213252_chorus_activity_lifecycle.sql', 'utf8')}
    ${readFileSync('supabase/migrations/20260908213619_chorus_activity_counts.sql', 'utf8')}
    do $$ begin
      if has_table_privilege('anon','public.chorus_activities','SELECT')
        or has_table_privilege('authenticated','public.chorus_activities','INSERT')
        or not (select relrowsecurity from pg_class where oid='public.chorus_activities'::regclass)
        then raise exception 'Chorus ledger is exposed to clients'; end if;
    end $$;
    insert into public.profiles values('a','Ada'),('b','Ben'),('c','Cam'),('d','Dan'),('e','Eve');
    insert into public.profiles values('chorus-test','Test');
    insert into public.chorus_activities(id,user_id,started_at,expires_at)
      values('chorus-test','chorus-test',now()-interval '1 hour',now()+interval '1 hour');
    insert into public.animal_captures(user_id,status,scientific_name,captured_at) values
      ('chorus-test','ready','Known',now()-interval '2 hours'),
      ('chorus-test','ready','Known',now()),
      ('chorus-test','ready','New',now()),
      ('chorus-test','ready','New',now()),
      ('chorus-test','needs_review','Uncertain',now()),
      ('chorus-test','ready','Too late',now()+interval '2 hours');
    insert into public.animal_captures(user_id,status,scientific_name,is_onboarding_capture)
      values('chorus-test','ready','Demo',true);
    insert into public.animal_captures(user_id,status,scientific_name,capture_source)
      values('chorus-test','ready','Imported','library');
    do $$ declare s jsonb; begin
      s:=public.chorus_activity_state('chorus-test');
      if (s->>'speciesCount')::int<>2 or (s->>'newSpeciesCount')::int<>1
        then raise exception 'Incorrect chorus count: %',s; end if;
      if public.chorus_activity_state('missing') is not null then raise exception 'Invented missing activity'; end if;
      if has_function_privilege('authenticated','public.chorus_activity_state(text)','execute')
        then raise exception 'Chorus state exposed'; end if;
    end $$;
    delete from public.animal_captures where user_id='chorus-test';
    delete from public.profiles where user_id='chorus-test';
    select public.safari_import_sites('[{"id":"123","name":"Test","country":"France","latitude":48,"longitude":2,"inventoryAt":"2026-09-01","species":["A a","A a","B b"]}]');
    select public.safari_import_sites('[{"id":"123","name":"Test","country":"France","latitude":48,"longitude":2,"inventoryAt":"2026-09-01","species":["A a","B b"]}]');
    do $$
    declare offer uuid; run jsonb; rid uuid; result jsonb; caught boolean:=false; i integer;
    begin
      if (select count(*) from public.safari_site_species)<>2 then raise exception 'Import not idempotent'; end if;
      insert into public.safari_offers(user_id,mode,title,latitude,longitude,radius_km,evidence,source_url,targets)
        values('a','nature','Test',48,2,15,'Fixture','https://www.gbif.org',
        '[{"scientificName":"A a","label":"A"},{"scientificName":"B b","label":"B"},{"scientificName":"C c","label":"C"}]') returning id into offer;
      begin perform public.safari_command('e','create',jsonb_build_object('offerId',offer,'targets',jsonb_build_array('A a','B b','C c')));
      exception when others then caught:=true; end;
      if not caught then raise exception 'Another user stole an offer'; end if;
      caught:=false;
      begin perform public.safari_command('a','create',jsonb_build_object('offerId',offer,'targets',jsonb_build_array('A a','B b')));
      exception when others then caught:=true; end;
      if not caught then raise exception 'Accepted fewer than three targets'; end if;
      caught:=false;
      begin perform public.safari_command('a','create',jsonb_build_object('offerId',offer,'targets',jsonb_build_array('A a','B b','Unknown animal')));
      exception when others then caught:=true; end;
      if not caught then raise exception 'Accepted a target outside the offer'; end if;
      run:=public.safari_command('a','create',jsonb_build_object('offerId',offer,'targets',jsonb_build_array('A a','B b','C c')));
      rid:=(run->>'id')::uuid;
      caught:=false;
      begin perform public.safari_command('a','create',jsonb_build_object('offerId',offer,'targets',jsonb_build_array('A a','B b','C c')));
      exception when others then caught:=true; end;
      if not caught or (select count(*) from public.safari_runs)<>1 then raise exception 'Duplicate start created another run'; end if;
      perform public.safari_command('b','join',jsonb_build_object('code',run->>'code'));
      perform public.safari_command('b','join',jsonb_build_object('code',run->>'code'));
      if (select count(*) from public.safari_members where run_id=rid)<>2 then raise exception 'Duplicate member'; end if;
      insert into public.safari_runs(host_id,mode,title,latitude,longitude,radius_km,evidence,source_url,code)
        values('e','zoo','Other zoo',48,2,5,'Fixture','https://example.com','OTHERZOO');
      caught:=false;
      begin perform public.safari_command('b','join',jsonb_build_object('code','OTHERZOO'));
      exception when others then caught:=true; end;
      if not caught then raise exception 'Member joined two simultaneous runs'; end if;
      delete from public.safari_runs where code='OTHERZOO';
      perform public.safari_command('c','join',jsonb_build_object('code',run->>'code'));
      perform public.safari_command('d','join',jsonb_build_object('code',run->>'code'));
      caught:=false;
      begin perform public.safari_command('e','join',jsonb_build_object('code',run->>'code'));
      exception when others then caught:=true; end;
      if not caught then raise exception 'Overfull team'; end if;
      caught:=false;
      begin perform public.safari_command('b','end',jsonb_build_object('runId',rid));
      exception when others then caught:=true; end;
      if not caught then raise exception 'Non-host ended team'; end if;
      insert into public.animal_captures(user_id,status,scientific_name,is_onboarding_capture) values('a','ready','A a',true);
      insert into public.animal_captures(user_id,status,scientific_name,capture_source) values('a','ready','A a','library');
      insert into public.animal_captures(user_id,status,scientific_name,latitude) values('a','ready','A a',0);
      insert into public.animal_captures(user_id,status,scientific_name,captured_at) values('a','ready','A a',now()-interval '1 day');
      insert into public.animal_captures(user_id,status,scientific_name) values('a','needs_review','A a');
      if exists(select 1 from public.safari_targets where found_at is not null) then raise exception 'Invalid photo scored'; end if;
      insert into public.animal_captures(user_id,status,scientific_name) values('b','ready','A a');
      insert into public.animal_captures(user_id,status,scientific_name) values('a','ready','A a');
      if (select count(*) from public.safari_targets where found_at is not null)<>1 then raise exception 'Duplicate scored'; end if;
      if (select found_by from public.safari_targets where run_id=rid and scientific_name='A a')<>'b' then raise exception 'Wrong finder'; end if;
      update public.safari_activity_outbox set attempted_at=now(),sent_at=now() where run_id=rid;
      perform public.safari_command('d','leave',jsonb_build_object('runId',rid));
      if exists(select from public.safari_activity_outbox where run_id=rid and (attempted_at is not null or sent_at is not null))
        then raise exception 'New state retained the previous delivery cooldown'; end if;
      insert into public.animal_captures(user_id,status,scientific_name) values('d','ready','B b');
      if (select count(*) from public.safari_targets where found_at is not null)<>1 then raise exception 'Departed member scored'; end if;
      insert into public.animal_captures(user_id,status,scientific_name) values('a','ready','B b'),('c','ready','C c');
      if (select status from public.safari_runs where id=rid)<>'completed' then raise exception 'Not complete'; end if;
      if exists(select 1 from public.safari_members where run_id=rid and left_at is null) then raise exception 'Members not released'; end if;
      if not exists(select 1 from public.safari_activity_outbox where run_id=rid and sent_at is null) then raise exception 'Missing OneSignal outbox'; end if;
      result:=public.safari_command('b','status');
      if result->'active'<>'null'::jsonb or jsonb_array_length(result->'history')<>1 then raise exception 'Missing recap'; end if;
      if (public.safari_command('e','status')->'history')<>'[]'::jsonb then raise exception 'History leak'; end if;
      update public.safari_offers set expires_at=now()-interval '1 second' where id=offer;
      caught:=false;
      begin perform public.safari_command('a','create',jsonb_build_object('offerId',offer,'targets',jsonb_build_array('A a','B b','C c')));
      exception when others then caught:=true; end;
      if not caught then raise exception 'Expired offer started a run'; end if;
      insert into public.safari_runs(host_id,mode,title,latitude,longitude,radius_km,evidence,source_url,expires_at)
        values('a','nature','Expired',48,2,15,'fixture','https://www.gbif.org',now()-interval '1 second') returning id into rid;
      insert into public.safari_members(run_id,user_id) values(rid,'a');
      perform public.safari_command('a','status');
      if (select status from public.safari_runs where id=rid)<>'expired' then raise exception 'No expiration'; end if;
      if not exists(select 1 from public.safari_activity_outbox where run_id=rid) then raise exception 'Expiry not sent'; end if;
      for i in 1..30 loop if not public.safari_rate_limit('e') then raise exception 'Rate limit premature'; end if; end loop;
      if public.safari_rate_limit('e') then raise exception 'Rate limit absent'; end if;
    end $$;
    set role authenticated;
    do $$ begin
      begin perform public.safari_command('a','status'); raise exception 'Client forged identity'; exception when insufficient_privilege then null; end;
      begin perform * from public.safari_runs; raise exception 'RLS leak'; exception when insufficient_privilege then null; end;
      begin update public.safari_targets set found_at=now(); raise exception 'Client forged score'; exception when insufficient_privilege then null; end;
    end $$;
    reset role;
    set role anon;
    do $$ begin
      begin perform * from public.safari_members; raise exception 'Anonymous leak'; exception when insufficient_privilege then null; end;
    end $$;
    reset role;
    set role service_role;
    select public.safari_command('a','status') is not null as service_api_ok;
  `;
  execFileSync('psql', ['-h', directory, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, stdio: ['pipe', 'pipe', 'pipe'] });
  console.log('Safaris OK: private API, team membership, verified captures, deduplication, expiry, recap and OneSignal outbox.');
} catch (error) {
  if (error && typeof error === 'object' && 'stderr' in error) console.error(String(error.stderr));
  throw error;
} finally {
  if (started) execFileSync('pg_ctl', ['-D', join(directory, 'db'), 'stop', '-m', 'fast'], { stdio: 'pipe' });
  rmSync(directory, { recursive: true, force: true });
}
