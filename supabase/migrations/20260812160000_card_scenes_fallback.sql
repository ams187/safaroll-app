-- Les planches d'espèces : un décor pour toutes, tout de suite.
--
-- LE TROU
--
-- `cardSceneFor` fabriquait une URL depuis le nom de l'espèce et la donnait à
-- la carte sans jamais demander si le fichier existait. 1 736 planches sont en
-- ligne pour 5 576 espèces au catalogue — et le catalogue lui-même ne couvre
-- pas les espèces sauvages que BioCLIP reconnaît. Autrement dit, deux cartes
-- sur trois pointent aujourd'hui vers un 404, et le joueur voit un décor vide
-- sans que rien ne le signale.
--
-- LE PRINCIPE : PERSONNE N'ATTEND SA PLANCHE
--
-- Une espèce sans planche en EMPRUNTE une à son groupe. La carte est complète
-- dès la première seconde — deck, maîtrise, partage, Registre, tout marche — et
-- la planche définitive prendra sa place plus tard, sans rien migrer.
--
-- Ce n'est possible que parce que la carte reste COMPOSÉE à l'affichage :
-- planche + sticker personnel + couleur capturée + rareté + texte. Rien n'est
-- rendu en image et stocké. Remplacer `scene_slug` suffit donc à mettre à
-- niveau, d'un coup, toutes les cartes de cette espèce chez tous les joueurs.
--
-- L'EMPRUNT EST DÉTERMINISTE, PAS ALÉATOIRE
--
-- Le hachage du nom choisit la planche dans le groupe. Une même espèce emprunte
-- donc toujours la même — sinon sa carte changerait de décor à chaque
-- rafraîchissement, ce qui se lirait comme un bug plutôt que comme une attente.
--
-- LA FILE DE GÉNÉRATION SUIT LES VRAIES CAPTURES
--
-- `artwork_queue` classe les espèces sans planche par nombre de captures
-- réelles. On ne dessine pas 50 000 espèces que personne ne photographiera
-- jamais : le catalogue visuel grandit là où les joueurs vont.

alter table public.species_catalog
  add column if not exists artwork_status text not null default 'missing',
  add column if not exists scene_slug text;

alter table public.world_species
  add column if not exists artwork_status text not null default 'missing',
  add column if not exists scene_slug text,
  add column if not exists animal_group text;

comment on column public.species_catalog.artwork_status is
  '''ready'' = sa propre planche existe dans le bucket card-scenes. ''missing'' = elle en emprunte une.';
comment on column public.species_catalog.scene_slug is
  'La planche à afficher, propre ou empruntée. Toujours remplie — voir refresh_card_scenes().';

-- Le slug d'une espèce : le nom scientifique en minuscules, deux mots, tirets.
-- Mêmes règles que `speciesKey` côté client, à la lettre près.
create or replace function public.scene_slug_of(scientific_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(
    array_to_string((string_to_array(lower(trim(scientific_name)), ' '))[1:2], ' '),
    ' ', '-'
  );
$$;

/**
 * Recalcule les planches depuis ce qui est RÉELLEMENT dans le bucket.
 *
 * À relancer après chaque lot d'illustrations livré. Idempotente, et c'est le
 * point : elle lit le stockage plutôt qu'une liste tenue à la main, donc elle
 * ne peut pas prétendre qu'une planche existe alors qu'elle a été retirée.
 */
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

  -- 2. Celles qui n'en ont pas : elles en empruntent une à leur groupe.
  with disponibles as (
    select c.animal_group,
           array_agg(public.scene_slug_of(c.scientific_name) order by c.scientific_name) as slugs
    from public.species_catalog c
    where c.artwork_status = 'ready'
    group by c.animal_group
  )
  update public.species_catalog c
  set artwork_status = 'missing',
      scene_slug = d.slugs[1 + (abs(hashtext(c.scientific_name)) % array_length(d.slugs, 1))]
  from disponibles d
  where d.animal_group = c.animal_group
    and not exists (select 1 from _planches p where p.slug = public.scene_slug_of(c.scientific_name));

  -- 3. Les espèces sauvages, hors catalogue. Leur groupe se déduit de la classe
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
  set artwork_status = 'missing',
      scene_slug = d.slugs[1 + (abs(hashtext(w.scientific_name)) % array_length(d.slugs, 1))]
  from disponibles d
  where d.animal_group = w.animal_group
    and not exists (select 1 from _planches p where p.slug = public.scene_slug_of(w.scientific_name));

  return query
    select c.animal_group,
           count(*) filter (where c.artwork_status = 'ready'),
           count(*) filter (where c.artwork_status = 'missing')
    from public.species_catalog c
    group by c.animal_group
    order by 3 desc;
end;
$$;

revoke execute on function public.refresh_card_scenes() from public, anon, authenticated;

/**
 * La file de génération, classée par ce que les joueurs trouvent vraiment.
 *
 * Le premier joueur qui découvre une espèce sans planche déclenche indirectement
 * sa création — c'est le monde réel qui écrit l'ordre de travail, pas une liste
 * alphabétique.
 */
create or replace view public.artwork_queue as
  select
    src.scientific_name,
    src.animal_group,
    src.origine,
    count(c.id) as captures,
    count(distinct c.user_id) as joueurs,
    max(c.captured_at) as derniere_capture
  from (
    select scientific_name, animal_group, 'catalogue' as origine
    from public.species_catalog where artwork_status = 'missing'
    union all
    select scientific_name, animal_group, 'sauvage' as origine
    from public.world_species where artwork_status = 'missing'
  ) src
  left join public.animal_captures c
    on c.scientific_name = src.scientific_name
   and c.status in ('ready', 'needs_review')
  group by src.scientific_name, src.animal_group, src.origine
  order by count(c.id) desc, count(distinct c.user_id) desc;

revoke all on public.artwork_queue from public, anon, authenticated;
