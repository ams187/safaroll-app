-- LE CHIEN QUI DEVENAIT UN LOUP.
--
-- Mesuré le 2026-08-23 sur les captures réelles : un chien beige rendait une
-- carte « Loup gris » à 1,000 de confiance. Trois causes distinctes, dont deux
-- vivantes.
--
-- 1. DANS TREEOFLIFE, LE CHIEN ET LE LOUP PARTAGENT `Canis lupus`.
--    Seul le `commonName` de la prédiction les sépare — « Domestic Dog » contre
--    « Gray Wolf ». `identify-animal` prenait le nom à afficher dans
--    `species_catalog` à partir du nom SCIENTIFIQUE, donc il jetait le seul
--    signal qui distinguait les deux.
--
-- 2. LES SYNONYMES TAXONOMIQUES SORTAIENT DU CATALOGUE.
--    Même mesure : `Uncia uncia (Snow leopard)` ne trouvait rien, alors que le
--    catalogue contient `Panthera uncia` — la panthère des neiges perdait son
--    nom français, sa rareté relue et sa planche.
--
--    Ces deux-là se corrigent ENSEMBLE, côté serveur, sans rien coder en dur :
--    on résout aussi par le nom vernaculaire anglais. Voir `identify-animal`.
--
-- 3. QUAND BIOCLIP EST SÛR ET SE TROMPE, RIEN NE LE RATTRAPE.
--    Le cas du 23 août : « Gray Wolf » à 1,000, aucun candidat chien dans le
--    top 5. Aucune relecture de noms ne peut sauver ça — il faut un SECOND
--    AVIS, et il existe déjà : `VNClassifyImageRequest` tourne sur chaque
--    capture, en local, avant le téléversement, et sa taxonomie connaît
--    `dog`, `cat`, `horse`. Elle est entraînée sur des photos du quotidien là
--    où BioCLIP l'est sur de la biodiversité sauvage.
--
--    Ce verdict n'était simplement jamais transmis. Cette colonne le conserve
--    avec la capture, et l'edge function s'en sert d'arbitre.
--
-- POURQUOI UN `drop` AVANT LE `create` : ajouter un paramètre à valeur par
-- défaut ne remplace pas la fonction, il en crée une SURCHARGE — et l'appel à
-- huit arguments devient alors ambigu, donc toute capture échoue.
alter table public.animal_captures add column if not exists vision_labels jsonb;

drop function if exists public.create_capture(
  text, text, text, double precision, timestamptz, text, double precision, double precision
);

create or replace function public.create_capture(
  p_original_path text,
  p_sticker_path text,
  p_capture_source text,
  p_aspect_ratio double precision,
  p_captured_at timestamptz default now(),
  p_dominant_color text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  -- Ce qu'Apple Vision a vu, EN LOCAL, avant le moindre téléversement.
  p_vision_labels jsonb default null
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
  taken integer;
  plafond integer;
  stamped timestamptz;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_original_path not like uid || '/%'
    or not exists (select 1 from storage.objects where bucket_id = 'capture-originals' and name = p_original_path)
    or (p_sticker_path is not null and (
      p_sticker_path not like uid || '/%'
      or not exists (select 1 from storage.objects where bucket_id = 'capture-stickers' and name = p_sticker_path)
    ))
  then raise exception 'Invalid storage path'; end if;

  -- Dix pour un compte gratuit — la règle du jeu, affichée par l'app.
  -- Trois cents pour un abonné — jamais atteint par un humain, atteint en
  -- minutes par un script : ce n'est pas une règle du jeu, c'est un disjoncteur.
  plafond := case
    when coalesce((
      select p.is_premium and (p.premium_until is null or p.premium_until > now())
      from public.profiles p where p.user_id = uid
    ), false)
      then 300 else 10 end;
  select count(*) into taken
  from public.animal_captures c
  where c.user_id = uid and c.created_at >= date_trunc('day', now());
  if taken >= plafond then
    -- DEUX MESSAGES, DEUX PUBLICS. Le gratuit peut être précis : la limite de
    -- dix est publique, l'app l'affiche, et ce chemin n'est qu'un filet — le
    -- client bloque avant. Le disjoncteur d'abonné, lui, reste MUET : on a
    -- vendu « illimité » à l'humain, et le seul lecteur de ce texte est un
    -- script qui inspecte les réponses. Un message précis lui donnerait le
    -- seuil exact à contourner ; « Capture failed » est indiscernable d'une
    -- panne ordinaire. Dans les deux cas le client met la capture en file
    -- locale et la ressoumet — avec succès une fois le compteur retombé.
    if plafond = 10 then
      raise exception 'Daily capture energy exhausted';
    else
      raise exception 'Capture failed';
    end if;
  end if;

  stamped := least(coalesce(p_captured_at, now()), now());
  stamped := greatest(stamped, now() - interval '7 days');

  select id into active_expedition
  from public.expeditions
  where user_id = uid and ended_at is null
  order by started_at desc limit 1;

  insert into public.animal_captures (
    user_id, original_path, sticker_path, capture_source, aspect_ratio,
    captured_at, dominant_color, latitude, longitude, expedition_id, vision_labels
  ) values (
    uid, p_original_path, p_sticker_path, p_capture_source, p_aspect_ratio,
    stamped, p_dominant_color, p_latitude, p_longitude, active_expedition, p_vision_labels
  ) returning id into capture_id;
  return capture_id;
end;
$$;

-- LES DROITS NE SUIVENT PAS LA FONCTION.
--
-- Ils sont attachés à une SIGNATURE. La fonction à huit arguments avait les
-- siens (`initial_safaroll.sql:537`, rejoués deux fois depuis) ; celle à neuf
-- naît sans rien, et `authenticated` ne peut donc pas l'appeler. Oublier ces
-- deux lignes ne casse pas la migration — ça casse TOUTE capture, en
-- production, après coup.
revoke execute on function public.create_capture(
  text, text, text, double precision, timestamptz, text, double precision, double precision, jsonb
) from public, anon;
grant execute on function public.create_capture(
  text, text, text, double precision, timestamptz, text, double precision, double precision, jsonb
) to authenticated;
