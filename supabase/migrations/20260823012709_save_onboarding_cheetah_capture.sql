-- Le guépard du tutoriel est une vraie première capture, pas une carte
-- décorative. BioCLIP ne doit toutefois jamais analyser ce cliché : le guépard
-- est une surimpression locale et la photo contient uniquement le décor.
create or replace function public.create_onboarding_cheetah_capture(
  p_original_path text,
  p_sticker_path text,
  p_aspect_ratio double precision
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
  species public.species_catalog%rowtype;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  -- Un double tap ou une reprise du tutoriel ne peut jamais offrir deux cartes.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('onboarding-cheetah:' || uid, 0)
  );

  select id into capture_id
  from public.animal_captures
  where user_id = uid
    and scientific_name = 'Acinonyx jubatus'
    and status in ('ready', 'needs_review')
  order by created_at
  limit 1;
  if capture_id is not null then return capture_id; end if;

  if p_original_path not like uid || '/%'
    or p_sticker_path not like uid || '/%'
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'capture-originals' and name = p_original_path
    )
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'capture-stickers' and name = p_sticker_path
    )
  then raise exception 'Invalid storage path'; end if;

  if not (p_aspect_ratio > 0 and p_aspect_ratio < 'Infinity'::double precision)
  then raise exception 'Invalid aspect ratio'; end if;

  select * into species
  from public.species_catalog
  where scientific_name = 'Acinonyx jubatus';
  if not found then raise exception 'Onboarding species missing from catalog'; end if;

  select id into active_expedition
  from public.expeditions
  where user_id = uid and ended_at is null
  order by started_at desc
  limit 1;

  insert into public.animal_captures (
    user_id, status, original_path, sticker_path, capture_source, aspect_ratio,
    captured_at, dominant_color, expedition_id, scientific_name, common_name,
    common_name_locale, vernaculars, in_atlas, confidence, taxonomy, candidates,
    rarity, rarity_source
  ) values (
    uid, 'ready', p_original_path, p_sticker_path, 'camera', p_aspect_ratio,
    now(), '#D69A25', active_expedition, species.scientific_name,
    coalesce(species.vernacular_name_en, 'Cheetah'),
    coalesce(species.vernaculars->>'fr', species.vernacular_name, 'Guépard'),
    species.vernaculars, true, 1,
    jsonb_strip_nulls(jsonb_build_object(
      'kingdom', species.kingdom,
      'phylum', species.phylum,
      'class', species.class,
      'order', species."order",
      'family', species.family,
      'genus', species.genus
    )),
    jsonb_build_array(jsonb_build_object(
      'scientificName', species.scientific_name,
      'commonName', coalesce(species.vernacular_name_en, 'Cheetah'),
      'score', 1
    )),
    coalesce(species.rarity, 'very_rare'), 'gbif'
  )
  returning id into capture_id;

  return capture_id;
end;
$$;

revoke all on function public.create_onboarding_cheetah_capture(text, text, double precision)
  from public, anon;
grant execute on function public.create_onboarding_cheetah_capture(text, text, double precision)
  to authenticated;
