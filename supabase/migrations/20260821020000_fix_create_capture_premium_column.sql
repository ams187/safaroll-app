-- `create_capture` LISAIT UNE COLONNE QUI N'EXISTE PLUS, ET PLUS RIEN NE SE CAPTURAIT.
--
-- Le 19 août, `rename_naturalist_to_premium` a renommé la colonne :
--
--   alter table public.profiles rename column is_naturalist to is_premium;
--
-- `fix_premium_rpc_columns`, écrit dans la foulée, a rattrapé `register_board`
-- et `community_profile`. Il a manqué `create_capture`, redéfinie la veille par
-- `abuse_hardening` et qui lit la colonne pour choisir le plafond quotidien.
--
-- CE QUE ÇA DONNAIT EN PRODUCTION
--
--   {"code":"42703","message":"column p.is_naturalist does not exist"}
--
-- Postgres ne vérifie pas le corps d'une fonction plpgsql à sa création : la
-- colonne n'est résolue qu'à l'exécution. Le renommage est donc passé sans un
-- avertissement, et la fonction n'a échoué qu'au premier appel — c'est-à-dire
-- à CHAQUE capture, pour tout le monde. L'app téléversait la photo, détourait
-- le sticker, affichait « BioCLIP2 analyse la capture », et attendait une
-- ligne qui n'était jamais écrite.
--
-- CE QUI CHANGE EN PLUS DU NOM
--
-- L'ancienne condition lisait la colonne SEULE. On reprend ici la sémantique
-- de `public.is_premium()` — le droit ET sa date de fin :
--
--   p.is_premium and (p.premium_until is null or p.premium_until > now())
--
-- Sans la date, un abonnement expiré gardait le plafond de 300. Le disjoncteur
-- anti-script protégeait alors quelqu'un qui ne paie plus.
--
-- Le reste du corps est repris à l'identique de `abuse_hardening` : mêmes
-- plafonds, mêmes messages, même validation de chemin. On ne corrige qu'une
-- ligne, mais plpgsql impose de réécrire la fonction entière.

create or replace function public.create_capture(
  p_original_path text,
  p_sticker_path text,
  p_capture_source text,
  p_aspect_ratio double precision,
  p_captured_at timestamptz default now(),
  p_dominant_color text default null,
  p_latitude double precision default null,
  p_longitude double precision default null
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
    captured_at, dominant_color, latitude, longitude, expedition_id
  ) values (
    uid, p_original_path, p_sticker_path, p_capture_source, p_aspect_ratio,
    stamped, p_dominant_color, p_latitude, p_longitude, active_expedition
  ) returning id into capture_id;
  return capture_id;
end;
$$;
