-- Une planche supprimée restait `ready`, puis pouvait être prêtée à des
-- milliers d'espèces. Le client recevait alors une URL inexistante, essayait
-- la vignette puis le grand format, et la carte flashait deux fois.
create or replace function public.refresh_card_scenes()
returns table (groupe text, propres bigint, empruntees bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  create temporary table _planches on commit drop as
  select replace(o.name, '.webp', '') as slug
  from storage.objects o
  where o.bucket_id = 'card-scenes'
    and o.name like '%.webp'
    and o.name not like 'thumb/%';

  -- Retirer les références mortes AVANT de choisir les planches à prêter.
  update public.species_catalog c
  set artwork_status = 'generic', scene_slug = null
  where c.artwork_status = 'ready'
    and not exists (select 1 from _planches p where p.slug = c.scene_slug);

  update public.world_species w
  set artwork_status = 'generic', scene_slug = null
  where w.artwork_status = 'ready'
    and not exists (select 1 from _planches p where p.slug = w.scene_slug);

  update public.species_catalog c
  set artwork_status = 'ready', scene_slug = public.scene_slug_of(c.scientific_name)
  where exists (select 1 from _planches p where p.slug = public.scene_slug_of(c.scientific_name));

  with disponibles as (
    select c.animal_group,
           array_agg(public.scene_slug_of(c.scientific_name) order by c.scientific_name) as slugs
    from public.species_catalog c
    where c.artwork_status = 'ready'
    group by c.animal_group
  )
  update public.species_catalog c
  set artwork_status = case when c.artwork_status in ('queued', 'generating') then c.artwork_status else 'generic' end,
      scene_slug = d.slugs[1 + (abs(hashtext(c.scientific_name)) % array_length(d.slugs, 1))]
  from disponibles d
  where d.animal_group = c.animal_group
    and not exists (select 1 from _planches p where p.slug = public.scene_slug_of(c.scientific_name));

  update public.world_species w
  set animal_group = case lower(coalesce(w.taxonomy->>'class', ''))
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
    else 'invertebres'
  end;

  update public.world_species w
  set artwork_status = 'ready', scene_slug = public.scene_slug_of(w.scientific_name)
  where exists (select 1 from _planches p where p.slug = public.scene_slug_of(w.scientific_name));

  with disponibles as (
    select c.animal_group,
           array_agg(public.scene_slug_of(c.scientific_name) order by c.scientific_name) as slugs
    from public.species_catalog c
    where c.artwork_status = 'ready'
    group by c.animal_group
  )
  update public.world_species w
  set artwork_status = case when w.artwork_status in ('queued', 'generating') then w.artwork_status else 'generic' end,
      scene_slug = d.slugs[1 + (abs(hashtext(w.scientific_name)) % array_length(d.slugs, 1))]
  from disponibles d
  where d.animal_group = w.animal_group
    and not exists (select 1 from _planches p where p.slug = public.scene_slug_of(w.scientific_name));

  return query
    select c.animal_group,
           count(*) filter (where c.artwork_status = 'ready'),
           count(*) filter (where c.artwork_status <> 'ready')
    from public.species_catalog c
    group by c.animal_group
    order by 3 desc;
end;
$$;

revoke execute on function public.refresh_card_scenes() from public, anon, authenticated;

select * from public.refresh_card_scenes();
