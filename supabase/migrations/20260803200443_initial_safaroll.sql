create extension if not exists pgcrypto with schema extensions;

create or replace function public.current_user_id()
returns text
language sql
stable
set search_path = ''
as $$ select nullif(auth.jwt()->>'sub', '') $$;

revoke all on function public.current_user_id() from public;
grant execute on function public.current_user_id() to authenticated;

create table public.species_catalog (
  scientific_name text primary key,
  gbif_key bigint not null unique,
  canonical_name text not null unique,
  vernacular_name text,
  vernacular_name_en text,
  kingdom text,
  phylum text,
  class text,
  "order" text,
  family text,
  genus text,
  animal_group text not null,
  field_note text,
  occurrences jsonb not null default '{}'::jsonb,
  rarity text check (rarity in ('common', 'uncommon', 'rare', 'ultra_rare', 'legendary')),
  created_at timestamptz not null default now()
);

create index species_catalog_group_idx on public.species_catalog (animal_group);
create index species_catalog_rarity_idx on public.species_catalog (rarity);

create table public.species_seasons (
  region text not null,
  scientific_name text not null references public.species_catalog(scientific_name) on update cascade on delete cascade,
  monthly_counts bigint[] not null check (cardinality(monthly_counts) = 12),
  computed_at timestamptz not null,
  primary key (region, scientific_name)
);

create table public.expeditions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default public.current_user_id(),
  started_at timestamptz not null default now(),
  ended_at timestamptz check (ended_at is null or ended_at >= started_at),
  created_at timestamptz not null default now()
);

create unique index expeditions_one_active_per_user_idx
on public.expeditions (user_id) where ended_at is null;
create index expeditions_user_started_idx on public.expeditions (user_id, started_at desc);

create table public.bird_captures (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default public.current_user_id(),
  status text not null default 'processing' check (status in ('processing', 'ready', 'needs_review', 'failed')),
  original_path text not null,
  sticker_path text,
  capture_source text not null check (capture_source in ('camera', 'library')),
  aspect_ratio double precision not null check (aspect_ratio > 0 and aspect_ratio < 'Infinity'::double precision),
  captured_at timestamptz not null default now(),
  dominant_color text check (dominant_color ~ '^#[0-9A-Fa-f]{6}$'),
  expedition_id uuid references public.expeditions(id) on delete set null,
  latitude double precision,
  longitude double precision,
  scientific_name text,
  common_name text,
  common_name_locale text,
  in_atlas boolean,
  confidence double precision check (confidence between 0 and 1),
  identification_issue text check (identification_issue in ('no_animal_detected', 'low_confidence', 'service_unavailable', 'invalid_image', 'unsupported_capture')),
  taxonomy jsonb,
  candidates jsonb,
  rarity text check (rarity in ('common', 'uncommon', 'rare', 'ultra_rare', 'legendary')),
  local_encounter_rarity text check (local_encounter_rarity in ('common', 'uncommon', 'rare', 'legendary')),
  local_occurrence_count bigint check (local_occurrence_count >= 0),
  rarity_source text check (rarity_source = 'gbif'),
  created_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null)),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check (original_path like user_id || '/%'),
  check (sticker_path is null or sticker_path like user_id || '/%')
);

create index bird_captures_user_created_idx on public.bird_captures (user_id, created_at desc);
create index bird_captures_expedition_idx on public.bird_captures (expedition_id) where expedition_id is not null;
create index bird_captures_scientific_name_idx on public.bird_captures (scientific_name) where scientific_name is not null;

create table public.identification_reports (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default public.current_user_id(),
  capture_id uuid not null references public.bird_captures(id) on delete cascade,
  predicted_name text,
  claimed_name text not null,
  note text,
  created_at timestamptz not null default now()
);
create index identification_reports_user_idx on public.identification_reports (user_id, created_at desc);
create index identification_reports_capture_idx on public.identification_reports (capture_id);

create table public.bird_decks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default public.current_user_id(),
  author_name text not null check (char_length(author_name) between 1 and 40),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 500),
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);
create index bird_decks_user_created_idx on public.bird_decks (user_id, created_at);
create index bird_decks_public_created_idx on public.bird_decks (created_at desc) where is_public;

create table public.bird_deck_cards (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default public.current_user_id(),
  deck_id uuid not null references public.bird_decks(id) on delete cascade,
  capture_id uuid not null references public.bird_captures(id) on delete cascade,
  position smallint not null check (position between 0 and 7),
  added_at timestamptz not null default now(),
  unique (deck_id, capture_id),
  unique (deck_id, position) deferrable initially immediate
);
create index bird_deck_cards_capture_idx on public.bird_deck_cards (capture_id);

create table public.bird_deck_likes (
  user_id text not null default public.current_user_id(),
  deck_id uuid not null references public.bird_decks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, deck_id)
);
create index bird_deck_likes_deck_idx on public.bird_deck_likes (deck_id);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default public.current_user_id(),
  type text not null check (type in ('image', 'link', 'note')),
  status text not null check (status in ('processing', 'ready', 'failed')),
  title text,
  description text,
  url text,
  storage_path text,
  aspect_ratio double precision check (aspect_ratio > 0 and aspect_ratio < 'Infinity'::double precision),
  captured_at timestamptz,
  latitude double precision,
  longitude double precision,
  is_sticker boolean,
  tags text[] not null default '{}',
  content text,
  site_name text,
  hero_image_url text,
  note text,
  intents jsonb,
  products jsonb,
  products_status text check (products_status in ('searching', 'ready', 'failed')),
  search_text text not null default '',
  created_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null)),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check (storage_path is null or storage_path like user_id || '/%')
);
create index items_user_created_idx on public.items (user_id, created_at desc);
create index items_search_idx on public.items using gin (to_tsvector('simple', search_text));

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default public.current_user_id(),
  name text not null check (char_length(name) between 1 and 80),
  description text,
  dynamic boolean not null default false,
  created_at timestamptz not null default now()
);
create index spaces_user_created_idx on public.spaces (user_id, created_at desc);

create table public.space_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default public.current_user_id(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  status text not null default 'saved' check (status in ('suggested', 'saved', 'dismissed')),
  intents jsonb,
  created_at timestamptz not null default now(),
  unique (space_id, item_id)
);
create index space_items_item_idx on public.space_items (item_id);
create index space_items_user_idx on public.space_items (user_id);

alter table public.species_catalog enable row level security;
alter table public.species_seasons enable row level security;
alter table public.expeditions enable row level security;
alter table public.bird_captures enable row level security;
alter table public.identification_reports enable row level security;
alter table public.bird_decks enable row level security;
alter table public.bird_deck_cards enable row level security;
alter table public.bird_deck_likes enable row level security;
alter table public.items enable row level security;
alter table public.spaces enable row level security;
alter table public.space_items enable row level security;

create policy "authenticated users read catalog" on public.species_catalog for select to authenticated using (true);
create policy "authenticated users read seasons" on public.species_seasons for select to authenticated using (true);

create policy "owners manage expeditions" on public.expeditions for all to authenticated
using (user_id = (select public.current_user_id()))
with check (user_id = (select public.current_user_id()));

create policy "owners read captures" on public.bird_captures for select to authenticated
using (user_id = (select public.current_user_id()));
create policy "public deck readers read captures" on public.bird_captures for select to authenticated
using (exists (
  select 1 from public.bird_deck_cards dc
  join public.bird_decks d on d.id = dc.deck_id
  where dc.capture_id = bird_captures.id and d.is_public
));
create policy "owners insert captures" on public.bird_captures for insert to authenticated
with check (user_id = (select public.current_user_id()));
create policy "owners update captures" on public.bird_captures for update to authenticated
using (user_id = (select public.current_user_id()))
with check (user_id = (select public.current_user_id()));
create policy "owners delete captures" on public.bird_captures for delete to authenticated
using (user_id = (select public.current_user_id()));

create policy "owners manage reports" on public.identification_reports for all to authenticated
using (user_id = (select public.current_user_id()))
with check (
  user_id = (select public.current_user_id()) and exists (
    select 1 from public.bird_captures c
    where c.id = capture_id and c.user_id = (select public.current_user_id())
  )
);

create policy "owners read decks" on public.bird_decks for select to authenticated
using (user_id = (select public.current_user_id()));
create policy "community reads public decks" on public.bird_decks for select to authenticated using (is_public);
create policy "owners insert decks" on public.bird_decks for insert to authenticated
with check (
  user_id = (select public.current_user_id())
  and (select count(*) from public.bird_decks where user_id = (select public.current_user_id())) < 5
);
create policy "owners update decks" on public.bird_decks for update to authenticated
using (user_id = (select public.current_user_id())) with check (user_id = (select public.current_user_id()));
create policy "owners delete decks" on public.bird_decks for delete to authenticated
using (user_id = (select public.current_user_id()));

create policy "deck readers read cards" on public.bird_deck_cards for select to authenticated
using (exists (
  select 1 from public.bird_decks d
  where d.id = deck_id and (d.user_id = (select public.current_user_id()) or d.is_public)
));
create policy "owners insert deck cards" on public.bird_deck_cards for insert to authenticated
with check (
  user_id = (select public.current_user_id())
  and exists (select 1 from public.bird_decks d where d.id = deck_id and d.user_id = (select public.current_user_id()))
  and exists (select 1 from public.bird_captures c where c.id = capture_id and c.user_id = (select public.current_user_id()))
);
create policy "owners update deck cards" on public.bird_deck_cards for update to authenticated
using (user_id = (select public.current_user_id()))
with check (
  user_id = (select public.current_user_id())
  and exists (select 1 from public.bird_decks d where d.id = deck_id and d.user_id = (select public.current_user_id()))
  and exists (select 1 from public.bird_captures c where c.id = capture_id and c.user_id = (select public.current_user_id()))
);
create policy "owners delete deck cards" on public.bird_deck_cards for delete to authenticated
using (user_id = (select public.current_user_id()));

create policy "authenticated users read likes" on public.bird_deck_likes for select to authenticated using (true);
create policy "users like public decks" on public.bird_deck_likes for insert to authenticated
with check (
  user_id = (select public.current_user_id())
  and exists (select 1 from public.bird_decks d where d.id = deck_id and d.is_public)
);
create policy "users remove own likes" on public.bird_deck_likes for delete to authenticated
using (user_id = (select public.current_user_id()));

create policy "owners manage items" on public.items for all to authenticated
using (user_id = (select public.current_user_id())) with check (user_id = (select public.current_user_id()));
create policy "owners manage spaces" on public.spaces for all to authenticated
using (user_id = (select public.current_user_id())) with check (user_id = (select public.current_user_id()));
create policy "owners manage space items" on public.space_items for all to authenticated
using (user_id = (select public.current_user_id()))
with check (
  user_id = (select public.current_user_id())
  and exists (select 1 from public.spaces s where s.id = space_id and s.user_id = (select public.current_user_id()))
  and exists (select 1 from public.items i where i.id = item_id and i.user_id = (select public.current_user_id()))
);

create or replace function public.ensure_default_decks(author_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  deck_count integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select count(*) into deck_count from public.bird_decks where user_id = uid;
  if deck_count > 5 then raise exception 'Deck limit exceeded'; end if;
  for i in deck_count + 1..5 loop
    insert into public.bird_decks (user_id, author_name, name)
    values (uid, left(coalesce(nullif(author_name, ''), 'Explorer'), 40), 'Deck ' || i);
  end loop;
end;
$$;

create or replace function public.create_capture(
  p_original_path text,
  p_sticker_path text,
  p_capture_source text,
  p_aspect_ratio double precision,
  p_captured_at timestamptz default now(),
  p_dominant_color text default null,
  p_latitude double precision default null,
  p_longitude double precision default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  active_expedition uuid;
  capture_id uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_original_path not like uid || '/%' or (p_sticker_path is not null and p_sticker_path not like uid || '/%') then
    raise exception 'Invalid storage path';
  end if;
  select id into active_expedition
  from public.expeditions
  where user_id = uid and ended_at is null
  order by started_at desc limit 1;

  insert into public.bird_captures (
    user_id, original_path, sticker_path, capture_source, aspect_ratio,
    captured_at, dominant_color, latitude, longitude, expedition_id
  ) values (
    uid, p_original_path, p_sticker_path, p_capture_source, p_aspect_ratio,
    coalesce(p_captured_at, now()), p_dominant_color, p_latitude, p_longitude, active_expedition
  ) returning id into capture_id;
  return capture_id;
end;
$$;

create or replace function public.place_deck_card(target_deck_id uuid, target_capture_id uuid, target_position integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  current_position smallint;
  occupant_id uuid;
  member_count integer;
begin
  set constraints bird_deck_cards_deck_id_position_key deferred;
  if target_position < 0 or target_position > 7 then raise exception 'Invalid slot'; end if;
  if not exists (select 1 from public.bird_decks where id = target_deck_id and user_id = uid) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.bird_captures where id = target_capture_id and user_id = uid) then raise exception 'Not allowed'; end if;

  select position into current_position from public.bird_deck_cards
  where deck_id = target_deck_id and capture_id = target_capture_id for update;
  select id into occupant_id from public.bird_deck_cards
  where deck_id = target_deck_id and position = target_position for update;

  if current_position = target_position then return; end if;
  if current_position is not null then
    if occupant_id is not null then
      update public.bird_deck_cards
      set position = case when id = occupant_id then current_position else target_position end
      where id = occupant_id or (deck_id = target_deck_id and capture_id = target_capture_id);
    else
      update public.bird_deck_cards set position = target_position where deck_id = target_deck_id and capture_id = target_capture_id;
    end if;
    return;
  end if;

  if occupant_id is not null then
    delete from public.bird_deck_cards where id = occupant_id;
  else
    select count(*) into member_count from public.bird_deck_cards where deck_id = target_deck_id;
    if member_count >= 8 then raise exception 'Deck is full'; end if;
  end if;
  insert into public.bird_deck_cards (user_id, deck_id, capture_id, position)
  values (uid, target_deck_id, target_capture_id, target_position);
end;
$$;

create or replace function public.toggle_deck_like(target_deck_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare uid text := public.current_user_id();
begin
  if not exists (select 1 from public.bird_decks where id = target_deck_id and is_public) then raise exception 'Deck is not public'; end if;
  if exists (select 1 from public.bird_deck_likes where user_id = uid and deck_id = target_deck_id) then
    delete from public.bird_deck_likes where user_id = uid and deck_id = target_deck_id;
    return false;
  end if;
  insert into public.bird_deck_likes (user_id, deck_id) values (uid, target_deck_id);
  return true;
end;
$$;

create or replace function public.attach_capture_artwork(target_capture_id uuid, p_sticker_path text, p_dominant_color text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid text := public.current_user_id();
begin
  if p_sticker_path is not null and p_sticker_path not like uid || '/%' then raise exception 'Invalid storage path'; end if;
  update public.bird_captures
  set sticker_path = coalesce(p_sticker_path, sticker_path),
      dominant_color = coalesce(p_dominant_color, dominant_color)
  where id = target_capture_id and user_id = uid;
  if not found then raise exception 'Capture not found'; end if;
end;
$$;

create or replace function public.confirm_capture_identification(target_capture_id uuid, target_scientific_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  candidate jsonb;
  entry public.species_catalog%rowtype;
begin
  select value into candidate
  from public.bird_captures c, jsonb_array_elements(c.candidates) value
  where c.id = target_capture_id and c.user_id = uid and c.status = 'needs_review'
    and value->>'scientificName' = target_scientific_name
  limit 1;
  if candidate is null then raise exception 'Invalid candidate'; end if;
  select * into entry from public.species_catalog where canonical_name = target_scientific_name;
  update public.bird_captures set
    status = 'ready',
    scientific_name = candidate->>'scientificName',
    common_name = candidate->>'commonName',
    common_name_locale = coalesce(entry.vernacular_name, candidate->>'commonNameLocale'),
    in_atlas = found,
    rarity = entry.rarity,
    confidence = (candidate->>'confidence')::double precision,
    taxonomy = candidate - array['scientificName', 'commonName', 'commonNameLocale', 'confidence']
  where id = target_capture_id and user_id = uid;
end;
$$;

create or replace function public.toggle_deck_public(target_deck_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare next_value boolean;
begin
  update public.bird_decks set is_public = not is_public
  where id = target_deck_id and user_id = public.current_user_id()
  returning is_public into next_value;
  if next_value is null then raise exception 'Not allowed'; end if;
  return next_value;
end;
$$;

create or replace function public.toggle_deck_card(target_deck_id uuid, target_capture_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  existing_id uuid;
  next_position integer;
begin
  set constraints bird_deck_cards_deck_id_position_key deferred;
  if not exists (select 1 from public.bird_decks where id = target_deck_id and user_id = uid)
    or not exists (select 1 from public.bird_captures where id = target_capture_id and user_id = uid)
  then raise exception 'Not allowed'; end if;
  select id into existing_id from public.bird_deck_cards where deck_id = target_deck_id and capture_id = target_capture_id;
  if existing_id is not null then
    delete from public.bird_deck_cards where id = existing_id;
    with ordered as (
      select id, row_number() over (order by position) - 1 as next_position
      from public.bird_deck_cards where deck_id = target_deck_id
    )
    update public.bird_deck_cards c set position = ordered.next_position
    from ordered where c.id = ordered.id;
    return false;
  end if;
  select coalesce(max(position) + 1, 0) into next_position from public.bird_deck_cards where deck_id = target_deck_id;
  if next_position >= 8 then raise exception 'Deck is full'; end if;
  insert into public.bird_deck_cards (user_id, deck_id, capture_id, position)
  values (uid, target_deck_id, target_capture_id, next_position);
  return true;
end;
$$;

create or replace function public.reorder_deck_cards(target_deck_id uuid, target_capture_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid text := public.current_user_id();
begin
  if cardinality(target_capture_ids) > 8 or cardinality(target_capture_ids) <> (select count(distinct value) from unnest(target_capture_ids) value) then
    raise exception 'Invalid deck order';
  end if;
  if not exists (select 1 from public.bird_decks where id = target_deck_id and user_id = uid) then raise exception 'Not allowed'; end if;
  if cardinality(target_capture_ids) <> (select count(*) from public.bird_deck_cards where deck_id = target_deck_id)
    or exists (
      select 1 from unnest(target_capture_ids) value
      where not exists (select 1 from public.bird_deck_cards where deck_id = target_deck_id and capture_id = value)
    )
  then raise exception 'Deck cards changed'; end if;
  set constraints bird_deck_cards_deck_id_position_key deferred;
  update public.bird_deck_cards c set position = ordered.position
  from (select value as capture_id, ordinality - 1 as position from unnest(target_capture_ids) with ordinality) ordered
  where c.deck_id = target_deck_id and c.capture_id = ordered.capture_id;
end;
$$;

grant execute on function public.ensure_default_decks(text) to authenticated;
grant execute on function public.create_capture(text, text, text, double precision, timestamptz, text, double precision, double precision) to authenticated;
grant execute on function public.place_deck_card(uuid, uuid, integer) to authenticated;
grant execute on function public.toggle_deck_like(uuid) to authenticated;
grant execute on function public.attach_capture_artwork(uuid, text, text) to authenticated;
grant execute on function public.confirm_capture_identification(uuid, text) to authenticated;
grant execute on function public.toggle_deck_public(uuid) to authenticated;
grant execute on function public.toggle_deck_card(uuid, uuid) to authenticated;
grant execute on function public.reorder_deck_cards(uuid, uuid[]) to authenticated;

revoke execute on function public.ensure_default_decks(text) from public, anon;
revoke execute on function public.create_capture(text, text, text, double precision, timestamptz, text, double precision, double precision) from public, anon;
revoke execute on function public.place_deck_card(uuid, uuid, integer) from public, anon;
revoke execute on function public.toggle_deck_like(uuid) from public, anon;
revoke execute on function public.attach_capture_artwork(uuid, text, text) from public, anon;
revoke execute on function public.confirm_capture_identification(uuid, text) from public, anon;
revoke execute on function public.toggle_deck_public(uuid) from public, anon;
revoke execute on function public.toggle_deck_card(uuid, uuid) from public, anon;
revoke execute on function public.reorder_deck_cards(uuid, uuid[]) from public, anon;

revoke insert, update on public.bird_captures from authenticated;
revoke insert on public.bird_decks from authenticated;
revoke insert, update, delete on public.bird_deck_cards from authenticated;
revoke insert, delete on public.bird_deck_likes from authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('capture-originals', 'capture-originals', false, 20971520, array['image/jpeg', 'image/png', 'image/webp']),
  ('capture-stickers', 'capture-stickers', false, 20971520, array['image/png', 'image/webp']),
  ('items', 'items', false, 20971520, array['image/jpeg', 'image/png', 'image/webp']),
  ('card-scenes', 'card-scenes', true, 5242880, array['image/webp'])
on conflict (id) do nothing;

create policy "owners upload private files" on storage.objects for insert to authenticated
with check (
  bucket_id in ('capture-originals', 'capture-stickers', 'items')
  and (storage.foldername(name))[1] = (select public.current_user_id())
);
create policy "owners read private files" on storage.objects for select to authenticated
using (
  bucket_id in ('capture-originals', 'capture-stickers', 'items')
  and (storage.foldername(name))[1] = (select public.current_user_id())
);
create policy "public decks read stickers" on storage.objects for select to authenticated
using (
  bucket_id = 'capture-stickers' and exists (
    select 1 from public.bird_captures c
    join public.bird_deck_cards dc on dc.capture_id = c.id
    join public.bird_decks d on d.id = dc.deck_id
    where c.sticker_path = name and d.is_public
  )
);
create policy "owners update private files" on storage.objects for update to authenticated
using (
  bucket_id in ('capture-originals', 'capture-stickers', 'items')
  and (storage.foldername(name))[1] = (select public.current_user_id())
)
with check ((storage.foldername(name))[1] = (select public.current_user_id()));
create policy "owners delete private files" on storage.objects for delete to authenticated
using (
  bucket_id in ('capture-originals', 'capture-stickers', 'items')
  and (storage.foldername(name))[1] = (select public.current_user_id())
);

alter publication supabase_realtime add table public.bird_captures;
alter publication supabase_realtime add table public.bird_decks;
alter publication supabase_realtime add table public.bird_deck_cards;
alter publication supabase_realtime add table public.bird_deck_likes;
alter publication supabase_realtime add table public.expeditions;
alter publication supabase_realtime add table public.items;
alter publication supabase_realtime add table public.spaces;
alter publication supabase_realtime add table public.space_items;
