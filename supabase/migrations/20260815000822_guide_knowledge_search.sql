create index if not exists species_catalog_guide_search_idx
on public.species_catalog
using gin (
  to_tsvector(
    'simple',
    coalesce(scientific_name, '') || ' ' ||
    coalesce(canonical_name, '') || ' ' ||
    coalesce(vernacular_name, '') || ' ' ||
    coalesce(vernacular_name_en, '') || ' ' ||
    coalesce(animal_group, '') || ' ' ||
    coalesce(kingdom, '') || ' ' ||
    coalesce(phylum, '') || ' ' ||
    coalesce(class, '') || ' ' ||
    coalesce(family, '') || ' ' ||
    coalesce(genus, '')
  )
);

create or replace function public.search_species_knowledge(
  search_query text,
  result_limit integer default 5
)
returns table (
  scientific_name text,
  vernacular_name text,
  vernacular_name_en text,
  animal_group text,
  rarity text,
  kingdom text,
  phylum text,
  class text,
  family text,
  genus text
)
language sql
stable
set search_path = ''
as $$
  select
    species.scientific_name,
    species.vernacular_name,
    species.vernacular_name_en,
    species.animal_group,
    species.rarity,
    species.kingdom,
    species.phylum,
    species.class,
    species.family,
    species.genus
  from public.species_catalog as species
  where
    nullif(btrim(search_query), '') is not null
    and to_tsvector(
      'simple',
      coalesce(species.scientific_name, '') || ' ' ||
      coalesce(species.canonical_name, '') || ' ' ||
      coalesce(species.vernacular_name, '') || ' ' ||
      coalesce(species.vernacular_name_en, '') || ' ' ||
      coalesce(species.animal_group, '') || ' ' ||
      coalesce(species.kingdom, '') || ' ' ||
      coalesce(species.phylum, '') || ' ' ||
      coalesce(species.class, '') || ' ' ||
      coalesce(species.family, '') || ' ' ||
      coalesce(species.genus, '')
    ) @@ websearch_to_tsquery('simple', left(search_query, 160))
  order by ts_rank_cd(
    to_tsvector(
      'simple',
      coalesce(species.scientific_name, '') || ' ' ||
      coalesce(species.canonical_name, '') || ' ' ||
      coalesce(species.vernacular_name, '') || ' ' ||
      coalesce(species.vernacular_name_en, '') || ' ' ||
      coalesce(species.animal_group, '') || ' ' ||
      coalesce(species.kingdom, '') || ' ' ||
      coalesce(species.phylum, '') || ' ' ||
      coalesce(species.class, '') || ' ' ||
      coalesce(species.family, '') || ' ' ||
      coalesce(species.genus, '')
    ),
    websearch_to_tsquery('simple', left(search_query, 160))
  ) desc
  limit least(greatest(result_limit, 1), 8)
$$;

revoke all on function public.search_species_knowledge(text, integer) from public;
grant execute on function public.search_species_knowledge(text, integer) to authenticated;
