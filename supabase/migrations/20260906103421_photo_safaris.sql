-- Service-only API. Clerk identity is verified by the safari Edge Function;
-- the mobile client cannot write goals, members, scores or catalogue rows.
create table public.safari_sites (
  id text primary key, name text not null, country text not null,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  inventory_at timestamptz not null, revision_note text, source_url text not null
);
create table public.safari_site_species (
  site_id text not null references public.safari_sites on delete cascade,
  scientific_name text not null,
  primary key(site_id, scientific_name)
);
create table public.safari_offers (
  id uuid primary key default gen_random_uuid(), user_id text not null references public.profiles(user_id) on delete cascade,
  mode text not null check(mode in ('zoo','nature')), title text not null,
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  radius_km integer not null check(radius_km between 1 and 25),
  evidence text not null, source_url text not null,
  targets jsonb not null check(jsonb_typeof(targets)='array' and jsonb_array_length(targets) between 1 and 30),
  expires_at timestamptz not null default now() + interval '30 minutes'
);
create index safari_offers_expiry on public.safari_offers(expires_at);
create table public.safari_runs (
  id uuid primary key default gen_random_uuid(), host_id text not null references public.profiles(user_id) on delete cascade,
  code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  mode text not null check(mode in ('zoo','nature')), title text not null,
  latitude double precision not null, longitude double precision not null, radius_km integer not null,
  evidence text not null, source_url text not null,
  started_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '1 hour',
  ended_at timestamptz,
  status text not null default 'active' check(status in ('active','completed','ended','expired')),
  revision integer not null default 0
);
create table public.safari_members (
  run_id uuid not null references public.safari_runs on delete cascade,
  user_id text not null references public.profiles(user_id) on delete cascade,
  joined_at timestamptz not null default now(), left_at timestamptz,
  primary key(run_id,user_id)
);
create index safari_runs_active_expiry on public.safari_runs(expires_at) where status='active';
create unique index safari_members_one_active on public.safari_members(user_id) where left_at is null;
create table public.safari_targets (
  run_id uuid not null references public.safari_runs on delete cascade,
  scientific_name text not null, label text not null, position integer not null,
  capture_id uuid references public.animal_captures(id) on delete set null,
  found_by text references public.profiles(user_id) on delete set null, found_at timestamptz,
  primary key(run_id,scientific_name)
);
-- Outbox: a database commit never waits for OneSignal. Retried by a cron.
create table public.safari_activity_outbox (
  run_id uuid primary key references public.safari_runs on delete cascade,
  revision integer not null, attempted_at timestamptz, sent_at timestamptz, error text
);
create table public.safari_request_limits (
  user_id text primary key references public.profiles(user_id) on delete cascade,
  window_at timestamptz not null default now(), requests integer not null default 0
);

alter table public.safari_sites enable row level security;
alter table public.safari_site_species enable row level security;
alter table public.safari_offers enable row level security;
alter table public.safari_runs enable row level security;
alter table public.safari_members enable row level security;
alter table public.safari_targets enable row level security;
alter table public.safari_activity_outbox enable row level security;
alter table public.safari_request_limits enable row level security;
revoke all on public.safari_sites, public.safari_site_species, public.safari_offers, public.safari_runs,
  public.safari_members, public.safari_targets, public.safari_activity_outbox, public.safari_request_limits from anon, authenticated;
grant all on public.safari_sites, public.safari_site_species, public.safari_offers, public.safari_runs,
  public.safari_members, public.safari_targets, public.safari_activity_outbox, public.safari_request_limits to service_role;

create function public.safari_snapshot(p_run uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'id',r.id,'title',r.title,'mode',r.mode,'code',r.code,'hostId',r.host_id,
    'startedAt',r.started_at,'expiresAt',r.expires_at,'status',r.status,'revision',r.revision,
    'radiusKm',r.radius_km,'evidence',r.evidence,'sourceUrl',r.source_url,
    'members',coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'name',coalesce(p.display_name,'Explorateur'),
      'left',m.left_at is not null) order by m.joined_at) from public.safari_members m
      join public.profiles p on p.user_id=m.user_id where m.run_id=r.id),'[]'::jsonb),
    'targets',coalesce((select jsonb_agg(jsonb_build_object('scientificName',t.scientific_name,'label',t.label,
      'foundBy',t.found_by,'foundAt',t.found_at) order by t.position) from public.safari_targets t where t.run_id=r.id),'[]'::jsonb)
  ) from public.safari_runs r where r.id=p_run
$$;

create function public.safari_rate_limit(p_user text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
  insert into public.safari_request_limits(user_id,requests) values(p_user,1)
  on conflict(user_id) do update set
    requests=case when safari_request_limits.window_at < now()-interval '1 minute' then 1 else safari_request_limits.requests+1 end,
    window_at=case when safari_request_limits.window_at < now()-interval '1 minute' then now() else safari_request_limits.window_at end
  returning requests into n;
  return n<=30;
end $$;

create function public.safari_command(p_user text,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.safari_runs; o public.safari_offers; rid uuid; target jsonb; selected text[]; n integer;
begin
  -- Serialize this user's starts/joins. The run row lock serializes team joins.
  perform pg_advisory_xact_lock(hashtextextended('safari:'||p_user,0));
  update public.safari_runs set status='expired',ended_at=expires_at,revision=revision+1
    where status='active' and expires_at<=now();
  update public.safari_members m set left_at=coalesce(finished.ended_at,now()) from public.safari_runs finished
    where m.run_id=finished.id and finished.status<>'active' and m.left_at is null;
  delete from public.safari_offers where expires_at<now();
  if p_action='create' then
    if exists(select 1 from public.safari_members where user_id=p_user and left_at is null) then
      raise exception 'Tu as déjà un safari en cours.';
    end if;
    select * into o from public.safari_offers where id=(p_payload->>'offerId')::uuid and user_id=p_user and expires_at>now() for update;
    if not found then raise exception 'Ces pistes ont expiré. Actualise la recherche.'; end if;
    select array_agg(distinct value) into selected from jsonb_array_elements_text(p_payload->'targets');
    if coalesce(cardinality(selected),0) not between 3 and 6 then raise exception 'Choisis entre 3 et 6 espèces.'; end if;
    if exists(select 1 from unnest(selected) s where not exists(select 1 from jsonb_array_elements(o.targets) t where t->>'scientificName'=s)) then
      raise exception 'Objectif invalide.';
    end if;
    insert into public.safari_runs(host_id,mode,title,latitude,longitude,radius_km,evidence,source_url)
      values(p_user,o.mode,o.title,o.latitude,o.longitude,o.radius_km,o.evidence,o.source_url) returning id into rid;
    insert into public.safari_members(run_id,user_id) values(rid,p_user);
    n:=0;
    for target in select value from jsonb_array_elements(o.targets) where value->>'scientificName'=any(selected) loop
      insert into public.safari_targets(run_id,scientific_name,label,position) values(rid,target->>'scientificName',target->>'label',n);
      n:=n+1;
    end loop;
    delete from public.safari_offers where id=o.id;
    return public.safari_snapshot(rid);
  elsif p_action='join' then
    if (p_payload->>'code') !~ '^[A-F0-9]{8}$' then raise exception 'Code invalide.'; end if;
    select * into r from public.safari_runs where code=p_payload->>'code' and status='active' and expires_at>now() for update;
    if not found then raise exception 'Code inconnu ou safari terminé.'; end if;
    if exists(select 1 from public.safari_members where user_id=p_user and left_at is null and run_id<>r.id) then
      raise exception 'Termine ton safari actuel avant de rejoindre une équipe.';
    end if;
    if exists(select 1 from public.safari_members where run_id=r.id and user_id=p_user) then
      if exists(select 1 from public.safari_members where run_id=r.id and user_id=p_user and left_at is not null) then
        raise exception 'Tu as déjà quitté cette sortie.';
      end if;
      return public.safari_snapshot(r.id);
    end if;
    if (select count(*) from public.safari_members where run_id=r.id)>=4 then raise exception 'Cette équipe est complète (4 maximum).'; end if;
    insert into public.safari_members(run_id,user_id) values(r.id,p_user);
    update public.safari_runs set revision=revision+1 where id=r.id;
    return public.safari_snapshot(r.id);
  elsif p_action in ('end','leave') then
    select x.* into r from public.safari_runs x join public.safari_members m on m.run_id=x.id
      where x.id=(p_payload->>'runId')::uuid and m.user_id=p_user for update of x;
    if not found then raise exception 'Safari introuvable.'; end if;
    if p_action='end' then
      if r.host_id<>p_user then raise exception 'Seul le créateur peut terminer la sortie.'; end if;
      update public.safari_runs set status=case when status='active' then 'ended' else status end,
        ended_at=coalesce(ended_at,now()),revision=revision+1 where id=r.id;
      update public.safari_members set left_at=coalesce(left_at,now()) where run_id=r.id;
    else
      if r.host_id=p_user then raise exception 'Termine la sortie pour ton équipe.'; end if;
      update public.safari_members set left_at=coalesce(left_at,now()) where run_id=r.id and user_id=p_user;
      update public.safari_runs set revision=revision+1 where id=r.id;
    end if;
    return public.safari_snapshot(r.id);
  elsif p_action='status' then
    select run_id into rid from public.safari_members where user_id=p_user and left_at is null;
    return jsonb_build_object('active',public.safari_snapshot(rid),'history',coalesce((select jsonb_agg(public.safari_snapshot(h.run_id))
      from (select run_id from public.safari_members where user_id=p_user and left_at is not null order by joined_at desc limit 10) h),'[]'::jsonb));
  end if;
  raise exception 'Action inconnue.';
end $$;

create schema if not exists private;
-- This trigger is the only writer of successful goals. No client-side score.
create function private.safari_capture() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.safari_runs; n integer;
begin
  if new.status<>'ready' or new.is_onboarding_capture or new.capture_source<>'camera' or new.latitude is null then return new; end if;
  select x.* into r from public.safari_runs x join public.safari_members m on m.run_id=x.id
    where m.user_id=new.user_id and m.left_at is null and x.status='active' and x.expires_at>now()
      and new.captured_at>=m.joined_at and new.captured_at<=x.expires_at for update of x;
  if not found then return new; end if;
  -- Great-circle distance. Position is used only for validation, never shared with teammates.
  if 6371*2*asin(sqrt(least(1.0,power(sin(radians(new.latitude-r.latitude)/2),2)+
    cos(radians(r.latitude))*cos(radians(new.latitude))*power(sin(radians(new.longitude-r.longitude)/2),2))))>r.radius_km then return new; end if;
  update public.safari_targets set capture_id=new.id,found_by=new.user_id,found_at=now()
    where run_id=r.id and scientific_name=new.scientific_name and found_at is null;
  get diagnostics n=row_count;
  if n=0 then return new; end if;
  update public.safari_runs set revision=revision+1,
    status=case when not exists(select 1 from public.safari_targets where run_id=r.id and found_at is null) then 'completed' else status end,
    ended_at=case when not exists(select 1 from public.safari_targets where run_id=r.id and found_at is null) then now() else null end where id=r.id;
  update public.safari_members set left_at=now() where run_id=r.id and left_at is null
    and exists(select 1 from public.safari_runs where id=r.id and status='completed');
  return new;
end $$;
revoke all on function private.safari_capture() from public, anon, authenticated;
create trigger safari_capture_ready after insert or update of status,scientific_name on public.animal_captures
  for each row execute function private.safari_capture();

create function private.safari_enqueue() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.safari_activity_outbox(run_id,revision) values(new.id,new.revision)
    on conflict(run_id) do update set revision=excluded.revision,sent_at=null,error=null;
  return new;
end $$;
revoke all on function private.safari_enqueue() from public, anon, authenticated;
create function private.safari_revision() returns trigger language plpgsql set search_path='' as $$
begin
  new.revision:=old.revision+1;
  return new;
end $$;
revoke all on function private.safari_revision() from public,anon,authenticated;
create trigger safari_revision before update on public.safari_runs for each row execute function private.safari_revision();
create trigger safari_changed after update on public.safari_runs for each row execute function private.safari_enqueue();

revoke all on function public.safari_snapshot(uuid), public.safari_rate_limit(text), public.safari_command(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.safari_snapshot(uuid), public.safari_rate_limit(text), public.safari_command(text,text,jsonb) to service_role;

-- One complete zoo at a time, all changes in one transaction. Never publish a half inventory.
create function public.safari_import_sites(p_sites jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare site jsonb; n integer:=0;
begin
  if jsonb_typeof(p_sites)<>'array' or jsonb_array_length(p_sites)>25 then raise exception 'Invalid import batch'; end if;
  for site in select value from jsonb_array_elements(p_sites) loop
    if (site->>'id') !~ '^[1-9][0-9]{0,11}$' or jsonb_typeof(site->'species')<>'array' or
      jsonb_array_length(site->'species')>2000 or nullif(site->>'name','') is null then raise exception 'Invalid zoo'; end if;
    insert into public.safari_sites(id,name,country,latitude,longitude,inventory_at,revision_note,source_url)
      values(site->>'id',site->>'name',site->>'country',(site->>'latitude')::double precision,(site->>'longitude')::double precision,
        (site->>'inventoryAt')::timestamptz,site->>'revisionNote','https://www.zootierliste.de/en/map.php?showzoo='||(site->>'id'))
      on conflict(id) do update set name=excluded.name,country=excluded.country,latitude=excluded.latitude,
        longitude=excluded.longitude,inventory_at=excluded.inventory_at,revision_note=excluded.revision_note;
    delete from public.safari_site_species where site_id=site->>'id';
    insert into public.safari_site_species(site_id,scientific_name)
      select site->>'id',value from jsonb_array_elements_text(site->'species') where length(value) between 3 and 200
      on conflict do nothing;
    n:=n+1;
  end loop;
  return n;
end $$;
revoke all on function public.safari_import_sites(jsonb) from public,anon,authenticated;
grant execute on function public.safari_import_sites(jsonb) to service_role;
