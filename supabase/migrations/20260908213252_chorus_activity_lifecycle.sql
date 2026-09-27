-- Recorded before push-to-start: even a timed-out response needs eventual cleanup.
create table public.chorus_activities (
  id text primary key,
  user_id text not null references public.profiles(user_id) on delete cascade,
  started_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > started_at),
  content_state jsonb not null default '{"speciesCount":0,"newSpeciesCount":0,"lastSpecies":""}'::jsonb,
  attempted_at timestamptz,
  ended_at timestamptz,
  error text
);
create index chorus_activities_due on public.chorus_activities(expires_at) where ended_at is null;
alter table public.chorus_activities enable row level security;
revoke all on public.chorus_activities from public, anon, authenticated;
grant select, insert, update, delete on public.chorus_activities to service_role;
