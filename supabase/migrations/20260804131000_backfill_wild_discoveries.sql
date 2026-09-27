-- Preserve already-earned off-atlas discoveries when this feature ships.
insert into public.world_species (
  scientific_name,
  canonical_name,
  common_name,
  common_name_locale,
  taxonomy,
  last_seen_at
)
select distinct on (c.scientific_name)
  c.scientific_name,
  c.scientific_name,
  coalesce(c.common_name, c.scientific_name),
  c.common_name_locale,
  coalesce(c.taxonomy, '{}'::jsonb),
  c.captured_at
from public.animal_captures c
where c.status = 'ready'
  and c.in_atlas = false
  and c.scientific_name is not null
order by c.scientific_name, c.captured_at desc
on conflict (scientific_name) do nothing;

insert into public.world_species_observations (
  scientific_name,
  capture_id,
  observer_id,
  confidence,
  latitude_bucket,
  longitude_bucket,
  observed_at
)
select
  c.scientific_name,
  c.id,
  c.user_id,
  c.confidence,
  case when c.latitude is null then null else round(c.latitude::numeric, 1) end,
  case when c.longitude is null then null else round(c.longitude::numeric, 1) end,
  c.captured_at
from public.animal_captures c
where c.status = 'ready'
  and c.in_atlas = false
  and c.scientific_name is not null
  and c.confidence between 0 and 1
on conflict (capture_id) do nothing;

notify pgrst, 'reload schema';
