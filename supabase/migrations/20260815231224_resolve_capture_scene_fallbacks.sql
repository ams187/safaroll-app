-- Une capture valide peut ne plus appartenir au catalogue courant (ou être une
-- découverte sauvage pas encore enregistrée dans world_species). Dans ce cas
-- scene_slugs ne répondait rien : le client inventait deux URL, vignette puis
-- plein format, et payait deux 400 pendant le scroll.
create or replace function public.scene_slugs(names text[])
returns table (scientific_name text, scene_slug text, artwork_status text)
language sql
stable
security definer
set search_path = ''
as $$
  with disponibles as (
    select c.animal_group,
           array_agg(distinct c.scene_slug order by c.scene_slug) as slugs
    from public.species_catalog c
    where c.scene_slug is not null
    group by c.animal_group
  ), captures as (
    select distinct on (c.scientific_name)
           c.scientific_name,
           coalesce(
             case lower(coalesce(c.taxonomy->>'class', ''))
               when 'aves' then 'oiseaux'
               when 'mammalia' then 'mammiferes'
               when 'insecta' then 'insectes'
               when 'reptilia' then 'reptiles'
               when 'amphibia' then 'amphibiens'
               when 'arachnida' then 'arachnides'
               when 'malacostraca' then 'crustaces'
               when 'gastropoda' then 'mollusques'
               when 'bivalvia' then 'mollusques'
               when 'cephalopoda' then 'mollusques'
               when 'actinopterygii' then 'poissons'
               when 'chondrichthyes' then 'poissons'
             end,
             (
               select min(catalog.animal_group)
               from public.species_catalog catalog
               where catalog.genus = split_part(c.scientific_name, ' ', 1)
             ),
             'invertebres'
           ) as animal_group
    from public.animal_captures c
    where c.scientific_name = any(names)
    order by c.scientific_name, c.captured_at desc
  ), candidates as (
    select c.scientific_name, c.scene_slug, c.artwork_status, 0 as priority
    from public.species_catalog c
    where c.scientific_name = any(names)
    union all
    select w.scientific_name, w.scene_slug, w.artwork_status, 1 as priority
    from public.world_species w
    where w.scientific_name = any(names)
    union all
    select c.scientific_name,
           d.slugs[1 + mod(abs(hashtext(c.scientific_name)::bigint), array_length(d.slugs, 1))],
           'generic',
           2
    from captures c
    join disponibles d using (animal_group)
  )
  select distinct on (c.scientific_name)
         c.scientific_name, c.scene_slug, c.artwork_status
  from candidates c
  where c.scene_slug is not null
  order by c.scientific_name, c.priority;
$$;

revoke execute on function public.scene_slugs(text[]) from public, anon;
grant execute on function public.scene_slugs(text[]) to authenticated;
