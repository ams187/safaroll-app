-- Un seul vocabulaire pour l'état d'une planche.
--
-- `world_species` en avait déjà un, posé avec la table et gardé par une
-- contrainte : generic → queued → generating → ready, plus failed. J'ai
-- introduit `missing` à côté sans le voir, et la contrainte a fait son travail
-- — la fonction a été refusée en bloc.
--
-- C'est le bon vocabulaire, et il est plus riche que le mien : il distingue
-- « aucune planche propre » de « dans la file » et de « en cours de
-- génération », ce dont le tableau de bord de production aura besoin. Le
-- catalogue adopte donc celui de `world_species`, contrainte comprise.
--
--   generic     pas de planche propre — elle en emprunte une à son groupe
--   queued      retenue pour génération
--   generating  en cours
--   ready       sa planche existe dans le bucket
--   failed      génération abandonnée

update public.species_catalog set artwork_status = 'generic' where artwork_status = 'missing';

alter table public.species_catalog
  drop constraint if exists species_catalog_artwork_status_check;
alter table public.species_catalog
  add constraint species_catalog_artwork_status_check
  check (artwork_status in ('generic', 'queued', 'generating', 'ready', 'failed'));

alter table public.species_catalog alter column artwork_status set default 'generic';

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
  where o.bucket_id = 'card-scenes' and o.name like '%.webp';

  -- 1. Les espèces qui ont leur propre planche.
  update public.species_catalog c
  set artwork_status = 'ready', scene_slug = public.scene_slug_of(c.scientific_name)
  where exists (select 1 from _planches p where p.slug = public.scene_slug_of(c.scientific_name));

  -- 2. Celles qui n'en ont pas empruntent à leur groupe. `generating` et
  --    `queued` sont préservés : une espèce déjà dans la file ne doit pas
  --    retomber à `generic` à chaque passage, sinon on la remet en file
  --    indéfiniment. Elle emprunte quand même en attendant.
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

  -- 3. Les espèces sauvages, hors catalogue. Le groupe se déduit de la classe
  --    taxonomique, exactement comme `groupForClass` côté client.
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

drop view if exists public.artwork_queue;
create view public.artwork_queue as
  select
    src.scientific_name,
    src.animal_group,
    src.origine,
    src.artwork_status,
    count(c.id) as captures,
    count(distinct c.user_id) as joueurs,
    max(c.captured_at) as derniere_capture
  from (
    select scientific_name, animal_group, artwork_status, 'catalogue' as origine
    from public.species_catalog where artwork_status <> 'ready'
    union all
    select scientific_name, animal_group, artwork_status, 'sauvage' as origine
    from public.world_species where artwork_status <> 'ready'
  ) src
  left join public.animal_captures c
    on c.scientific_name = src.scientific_name
   and c.status in ('ready', 'needs_review')
  group by src.scientific_name, src.animal_group, src.origine, src.artwork_status
  order by count(c.id) desc, count(distinct c.user_id) desc;

revoke all on public.artwork_queue from public, anon, authenticated;
