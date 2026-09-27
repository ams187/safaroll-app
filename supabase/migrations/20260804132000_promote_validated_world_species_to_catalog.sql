-- The 884 species are the launch set, not a permanent ceiling. A community
-- species joins the global catalog only after biological validation and once
-- its official scene exists; until then it remains a personal wild discovery.
create or replace function private.promote_world_species_to_catalog()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  animal_group text;
begin
  if new.status <> 'validated'
    or new.artwork_status <> 'ready'
    or new.artwork_path is null
    or new.gbif_key is null
  then
    return new;
  end if;

  animal_group := case
    when new.taxonomy->>'class' = 'Mammalia' then 'mammiferes'
    when new.taxonomy->>'class' = 'Aves' then 'oiseaux'
    when new.taxonomy->>'class' in ('Reptilia', 'Squamata', 'Testudines') then 'reptiles'
    when new.taxonomy->>'class' = 'Amphibia' then 'amphibiens'
    when new.taxonomy->>'class' in ('Actinopterygii', 'Chondrichthyes') then 'poissons'
    when new.taxonomy->>'class' = 'Insecta' then 'insectes'
    when new.taxonomy->>'class' = 'Arachnida' then 'arachnides'
    when new.taxonomy->>'phylum' = 'Mollusca' then 'mollusques'
    when new.taxonomy->>'class' in ('Malacostraca', 'Branchiopoda', 'Maxillopoda', 'Ostracoda') then 'crustaces'
    else 'invertebres'
  end;

  insert into public.species_catalog (
    scientific_name,
    gbif_key,
    canonical_name,
    vernacular_name,
    vernacular_name_en,
    kingdom,
    phylum,
    class,
    "order",
    family,
    genus,
    animal_group,
    occurrences,
    created_at
  ) values (
    new.scientific_name,
    new.gbif_key,
    new.canonical_name,
    new.common_name_locale,
    new.common_name,
    new.taxonomy->>'kingdom',
    new.taxonomy->>'phylum',
    new.taxonomy->>'class',
    new.taxonomy->>'order',
    new.taxonomy->>'family',
    new.taxonomy->>'genus',
    animal_group,
    '{}'::jsonb,
    coalesce(new.validated_at, now())
  ) on conflict (scientific_name) do nothing;

  -- Existing contributors must immediately see the same official species key
  -- as everybody else, including when GBIF normalized an older synonym.
  update public.animal_captures c
  set scientific_name = new.scientific_name,
      common_name = coalesce(new.common_name, c.common_name),
      common_name_locale = coalesce(new.common_name_locale, c.common_name_locale),
      taxonomy = new.taxonomy,
      in_atlas = true
  from public.world_species_observations o
  where o.capture_id = c.id
    and o.scientific_name = new.scientific_name
    and exists (
      select 1
      from public.species_catalog catalog
      where catalog.scientific_name = new.scientific_name
    );

  return new;
end;
$$;

revoke all on function private.promote_world_species_to_catalog() from public, anon, authenticated;

create trigger world_species_promote_to_catalog
after insert or update of status, artwork_status, artwork_path on public.world_species
for each row execute function private.promote_world_species_to_catalog();

-- Idempotent backfill for an illustration that may have completed before this
-- migration reached production.
update public.world_species
set artwork_status = artwork_status
where status = 'validated'
  and artwork_status = 'ready'
  and artwork_path is not null
  and gbif_key is not null;

comment on table public.species_catalog is
  'Global SafaRoll encyclopedia: 884 launch species plus validated community additions with official artwork.';

notify pgrst, 'reload schema';
