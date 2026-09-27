-- Les foyers d'observation, agrégés.
--
-- NOTE : la couche de carte qui s'en servait a été retirée le jour même. Cette
-- fonction reste en base parce qu'elle y est APPLIQUÉE — le fichier décrit
-- l'état réel du schéma, il ne décrit pas une intention. Elle n'a aujourd'hui
-- aucun appelant. Pour la retirer, une migration `drop function`, pas une
-- suppression de ce fichier : effacer un fichier appliqué désynchronise
-- l'historique et le prochain `db push` refuse de partir.
--
-- Ce qu'elle fait : `world_species_observations` arrondit déjà les positions à
-- 0,1° (~11 km) ; on agrège par case et par mois, toutes années confondues, et
-- on n'expose ni `observer_id` ni `observed_at`. Une case, un compte.

create or replace function public.species_hotspots(
  p_month integer default null,
  p_species text default null
)
returns table (
  latitude numeric,
  longitude numeric,
  observations integer,
  species integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.latitude_bucket as latitude,
    o.longitude_bucket as longitude,
    count(*)::integer as observations,
    count(distinct o.scientific_name)::integer as species
  from public.world_species_observations o
  where o.latitude_bucket is not null
    and (p_month is null or extract(month from o.observed_at at time zone 'utc') = p_month)
    and (p_species is null or o.scientific_name = p_species)
  group by o.latitude_bucket, o.longitude_bucket
  order by count(*) desc
  limit 5000;
$$;

revoke all on function public.species_hotspots(integer, text) from public;
grant execute on function public.species_hotspots(integer, text) to authenticated;
