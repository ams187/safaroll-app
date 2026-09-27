import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// PostgreSQL 15+ required. Only temporary objects, synthetic users, rollback.
// Run explicitly with --linked; never substitute a weaker PostgreSQL 14 view.
if (!process.argv.includes('--linked')) throw new Error('Run with --linked for the transactional PostgreSQL 17 check');
const migration = readFileSync('supabase/migrations/20260908185024_notification_target_location.sql', 'utf8').replaceAll('public.', 'pg_temp.');
const sql = `begin;
create temporary table profiles(user_id text, region text);
create temporary table animal_captures(id int, user_id text, scientific_name text,
  latitude double precision, longitude double precision, captured_at timestamptz, status text);
insert into profiles values ('alice','FR'),('bob','FR');
insert into animal_captures values
  (1,'alice','Cat',48,2,'2026-09-01','ready'),
  (2,'alice','Bird',null,null,'2026-09-08','ready'),
  (3,'bob','Dog',49,3,'2026-09-07','ready'),
  (4,'bob','Dog',999,3,'2026-09-08','ready');
alter table animal_captures enable row level security;
create policy own_capture on animal_captures to authenticated
 using (user_id = current_setting('test.user_id',true));
${migration}
do $$ begin execute format('grant usage on schema %I to authenticated', pg_my_temp_schema()::regnamespace); end $$;
grant select on pg_temp.profiles, pg_temp.animal_captures, pg_temp.notification_targets to authenticated;
set local role authenticated;
set local test.user_id='alice';
do $$ begin
  if (select count(*) from pg_temp.notification_targets) <> 1 then raise exception 'RLS target isolation'; end if;
  if not (select owned_species @> array['Cat','Bird'] from pg_temp.notification_targets) then raise exception 'GPS-less species missing'; end if;
  if not (select last_capture_at > last_location_at from pg_temp.notification_targets) then raise exception 'Old location refreshed'; end if;
end $$;
set local test.user_id='bob';
do $$ begin
  if (select count(*) from pg_temp.notification_targets) <> 1 then raise exception 'RLS Bob isolation'; end if;
  if not (select latitude = 49 from pg_temp.notification_targets) then raise exception 'Invalid location selected'; end if;
end $$;
reset role;
rollback;`;
execFileSync('supabase', ['db', 'query', '--linked', sql], { stdio: 'pipe' });
console.log('Notification targets: RLS isolation, GPS-less ownership, separate location timestamp, invalid coordinates pass (rolled back)');
