alter table public.animal_captures
  add column if not exists is_onboarding_capture boolean not null default false;

comment on column public.animal_captures.is_onboarding_capture is
  'Vraie rencontre offerte par le tutoriel. Une seule par compte; la collection la regroupe avec les autres rencontres de la meme espece.';

-- Reconnaît uniquement les lignes créées par la première version de la RPC :
-- BioCLIP ne rend pas simultanément ce score parfait, cette couleur fixe et ce
-- candidat synthétique. Une seule ligne est reprise si un double appel ancien
-- en avait malgré tout produit plusieurs.
with tutorial_rows as (
  select id, row_number() over (partition by user_id order by created_at) as position
  from public.animal_captures
  where scientific_name = 'Acinonyx jubatus'
    and confidence = 1
    and dominant_color = '#D69A25'
    and candidates @> '[{"scientificName":"Acinonyx jubatus","score":1}]'::jsonb
)
update public.animal_captures c
set is_onboarding_capture = true
from tutorial_rows t
where c.id = t.id and t.position = 1;

create unique index if not exists animal_captures_one_onboarding_capture_per_user_idx
  on public.animal_captures (user_id)
  where is_onboarding_capture;

-- La fiche lit ces clés exactes. Le catalogue importé pouvait avoir des trous,
-- mais la taxonomie du guépard, espèce fixe du tutoriel, ne varie pas.
update public.animal_captures
set taxonomy = coalesce(taxonomy, '{}'::jsonb) || jsonb_build_object(
  'kingdom', 'Animalia',
  'phylum', 'Chordata',
  'class', 'Mammalia',
  'order', 'Carnivora',
  'family', 'Felidae',
  'genus', 'Acinonyx'
)
where scientific_name = 'Acinonyx jubatus';

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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('onboarding-cheetah:' || uid, 0)
  );

  select id into capture_id
  from public.animal_captures
  where user_id = uid and is_onboarding_capture
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
    rarity, rarity_source, is_onboarding_capture
  ) values (
    uid, 'ready', p_original_path, p_sticker_path, 'camera', p_aspect_ratio,
    now(), '#D69A25', active_expedition, species.scientific_name,
    coalesce(species.vernacular_name_en, 'Cheetah'),
    coalesce(species.vernaculars->>'fr', species.vernacular_name, 'Guépard'),
    species.vernaculars, true, 1,
    jsonb_build_object(
      'kingdom', 'Animalia',
      'phylum', 'Chordata',
      'class', 'Mammalia',
      'order', 'Carnivora',
      'family', 'Felidae',
      'genus', 'Acinonyx'
    ),
    jsonb_build_array(jsonb_build_object(
      'scientificName', species.scientific_name,
      'commonName', coalesce(species.vernacular_name_en, 'Cheetah'),
      'score', 1
    )),
    coalesce(species.rarity, 'very_rare'), 'gbif', true
  )
  returning id into capture_id;

  return capture_id;
end;
$$;

revoke all on function public.create_onboarding_cheetah_capture(text, text, double precision)
  from public, anon;
grant execute on function public.create_onboarding_cheetah_capture(text, text, double precision)
  to authenticated;
