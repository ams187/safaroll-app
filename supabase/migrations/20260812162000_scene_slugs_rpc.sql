-- La planche d'une capture, résolue à la LECTURE.
--
-- POURQUOI CE N'EST PAS UNE COLONNE DE `animal_captures`
--
-- Écrire le slug sur la capture à l'identification le figerait. Or tout
-- l'intérêt du système est qu'une planche livrée demain remplace l'empruntée
-- d'aujourd'hui chez tous les joueurs, sans migration ni régénération. Le slug
-- appartient à l'ESPÈCE, pas à la rencontre.
--
-- Une seule requête par chargement de collection, quel que soit le nombre de
-- captures : la liste des noms distincts entre, la table des planches sort.
-- Le catalogue d'abord, les espèces sauvages ensuite — une espèce peut être
-- dans les deux, et c'est la ligne relue à la main qui gagne.

create or replace function public.scene_slugs(names text[])
returns table (scientific_name text, scene_slug text, artwork_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (s.scientific_name) s.scientific_name, s.scene_slug, s.artwork_status
  from (
    select c.scientific_name, c.scene_slug, c.artwork_status, 0 as priorite
    from public.species_catalog c
    where c.scientific_name = any(names)
    union all
    select w.scientific_name, w.scene_slug, w.artwork_status, 1 as priorite
    from public.world_species w
    where w.scientific_name = any(names)
  ) s
  where s.scene_slug is not null
  order by s.scientific_name, s.priorite;
$$;

revoke execute on function public.scene_slugs(text[]) from public, anon;
grant execute on function public.scene_slugs(text[]) to authenticated;
