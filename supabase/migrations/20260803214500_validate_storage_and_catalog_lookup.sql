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
  if p_original_path not like uid || '/%'
    or not exists (select 1 from storage.objects where bucket_id = 'capture-originals' and name = p_original_path)
    or (p_sticker_path is not null and (
      p_sticker_path not like uid || '/%'
      or not exists (select 1 from storage.objects where bucket_id = 'capture-stickers' and name = p_sticker_path)
    ))
  then raise exception 'Invalid storage path'; end if;

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

create or replace function public.attach_capture_artwork(target_capture_id uuid, p_sticker_path text, p_dominant_color text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid text := public.current_user_id();
begin
  if p_sticker_path is not null and (
    p_sticker_path not like uid || '/%'
    or not exists (select 1 from storage.objects where bucket_id = 'capture-stickers' and name = p_sticker_path)
  ) then raise exception 'Invalid storage path'; end if;

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
  atlas_match boolean;
begin
  select value into candidate
  from public.bird_captures c, jsonb_array_elements(c.candidates) value
  where c.id = target_capture_id and c.user_id = uid and c.status = 'needs_review'
    and value->>'scientificName' = target_scientific_name
  limit 1;
  if candidate is null then raise exception 'Invalid candidate'; end if;

  select * into entry from public.species_catalog where scientific_name = target_scientific_name;
  atlas_match := found;
  update public.bird_captures set
    status = 'ready', scientific_name = candidate->>'scientificName',
    common_name = candidate->>'commonName',
    common_name_locale = coalesce(entry.vernacular_name, candidate->>'commonNameLocale'),
    in_atlas = atlas_match, rarity = entry.rarity,
    confidence = (candidate->>'confidence')::double precision,
    taxonomy = candidate - array['scientificName', 'commonName', 'commonNameLocale', 'confidence']
  where id = target_capture_id and user_id = uid;
end;
$$;

revoke execute on function public.create_capture(text, text, text, double precision, timestamptz, text, double precision, double precision) from public, anon;
revoke execute on function public.attach_capture_artwork(uuid, text, text) from public, anon;
revoke execute on function public.confirm_capture_identification(uuid, text) from public, anon;
grant execute on function public.create_capture(text, text, text, double precision, timestamptz, text, double precision, double precision) to authenticated;
grant execute on function public.attach_capture_artwork(uuid, text, text) to authenticated;
grant execute on function public.confirm_capture_identification(uuid, text) to authenticated;
