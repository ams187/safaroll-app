-- The curated 884-card atlas remains immutable. Species outside it live here:
-- personal immediately, communal only after independent corroboration.
create table public.world_species (
  scientific_name text primary key,
  gbif_key bigint unique,
  canonical_name text not null,
  common_name text,
  common_name_locale text,
  taxonomy jsonb not null default '{}'::jsonb,
  taxonomy_validated boolean not null default false,
  status text not null default 'candidate'
    check (status in ('candidate', 'validated', 'rejected')),
  observation_count integer not null default 0 check (observation_count >= 0),
  observer_count integer not null default 0 check (observer_count >= 0),
  average_confidence double precision
    check (average_confidence is null or average_confidence between 0 and 1),
  artwork_status text not null default 'generic'
    check (artwork_status in ('generic', 'queued', 'generating', 'ready', 'failed')),
  artwork_path text unique check (artwork_path is null or artwork_path ~ '^[a-z0-9-]+\.webp$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  validated_at timestamptz,
  artwork_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index world_species_status_seen_idx
  on public.world_species (status, last_seen_at desc);
create index world_species_artwork_queue_idx
  on public.world_species (artwork_status, validated_at)
  where artwork_status in ('queued', 'failed');

-- Deliberately stores only ~11 km buckets. Exact coordinates remain solely on
-- the owner's private capture and can never leak through the community model.
create table public.world_species_observations (
  id uuid primary key default gen_random_uuid(),
  scientific_name text not null
    references public.world_species(scientific_name) on update cascade on delete cascade,
  capture_id uuid not null unique
    references public.animal_captures(id) on delete cascade,
  observer_id text not null references public.profiles(user_id) on delete cascade,
  confidence double precision not null check (confidence between 0 and 1),
  latitude_bucket numeric(4, 1) check (latitude_bucket between -90 and 90),
  longitude_bucket numeric(5, 1) check (longitude_bucket between -180 and 180),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check ((latitude_bucket is null) = (longitude_bucket is null))
);

create index world_species_observations_species_observer_idx
  on public.world_species_observations (scientific_name, observer_id);
create index world_species_observations_observer_created_idx
  on public.world_species_observations (observer_id, created_at desc);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Recompute instead of incrementing counters: capture deletion and retries are
-- both correct, and the unique capture_id keeps every observation idempotent.
create or replace function private.refresh_world_species_metrics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_name text;
  total integer;
  observers integer;
  confidence double precision;
begin
  target_name := case
    when tg_op = 'DELETE' then old.scientific_name
    else new.scientific_name
  end;

  select count(*)::integer, count(distinct observer_id)::integer, avg(o.confidence)
  into total, observers, confidence
  from public.world_species_observations o
  where o.scientific_name = target_name;

  update public.world_species s
  set observation_count = total,
      observer_count = observers,
      average_confidence = confidence,
      last_seen_at = coalesce((
        select max(o.observed_at)
        from public.world_species_observations o
        where o.scientific_name = target_name
      ), s.last_seen_at),
      status = case
        when s.status <> 'rejected'
          and s.taxonomy_validated
          and observers >= 3
          and total >= 3
          and confidence >= 0.65
        then 'validated'
        else s.status
      end,
      validated_at = case
        when s.validated_at is null
          and s.status <> 'rejected'
          and s.taxonomy_validated
          and observers >= 3
          and total >= 3
          and confidence >= 0.65
        then now()
        else s.validated_at
      end,
      artwork_status = case
        when s.artwork_status = 'generic'
          and s.status <> 'rejected'
          and s.taxonomy_validated
          and observers >= 3
          and total >= 3
          and confidence >= 0.65
        then 'queued'
        else s.artwork_status
      end,
      updated_at = now()
  where s.scientific_name = target_name;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.refresh_world_species_metrics() from public, anon, authenticated;

create trigger world_species_observations_refresh_metrics
after insert or update or delete on public.world_species_observations
for each row execute function private.refresh_world_species_metrics();

create trigger world_species_set_updated_at
before update on public.world_species
for each row execute function public.set_updated_at();

alter table public.world_species enable row level security;
alter table public.world_species_observations enable row level security;

create policy "community reads validated or contributed species"
  on public.world_species for select to authenticated
  using (
    status = 'validated'
    or exists (
      select 1
      from public.world_species_observations o
      where o.scientific_name = world_species.scientific_name
        and o.observer_id = (select public.current_user_id())
    )
  );

create policy "owners read their generalized observations"
  on public.world_species_observations for select to authenticated
  using (observer_id = (select public.current_user_id()));

revoke all on public.world_species, public.world_species_observations from anon, authenticated;
grant select on public.world_species, public.world_species_observations to authenticated;

notify pgrst, 'reload schema';
