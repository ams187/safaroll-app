-- Les trois plafonds qui manquaient — l'audit d'avant-prod, deuxième passe.
--
-- Le durcissement du 12 août a fermé le gros : l'énergie comptée en base, la
-- date bornée, l'anti-rejeu sur les captures terminées. Restaient trois portes,
-- toutes du même genre : un coût serveur que RIEN ne compte.
--
--   LES RETENTATIVES ÉTAIENT ILLIMITÉES
--   `failed` reste réinvocable — voulu, c'est par là que la file hors-ligne
--   retente après une panne réseau. Mais aucun compteur : un client hostile
--   pouvait faire échouer UNE capture puis marteler `identify-animal` dessus,
--   chaque appel payant une inférence Modal. C'était le vecteur de spam le
--   moins cher restant.
--
--   UN ABONNÉ N'AVAIT AUCUN PLAFOND
--   Le trigger exempte `is_naturalist`, et c'est le produit. Mais « illimité
--   pour un humain » et « illimité pour un script » ne doivent pas être le
--   même nombre : un compte abonné compromis pouvait générer des captures en
--   boucle, chacune facturée. 300/jour ne gênera jamais un vrai joueur — c'est
--   une capture toutes les trois minutes, sans dormir.
--
--   LES FICHIERS N'ÉTAIENT PAS COMPTÉS
--   10 captures/jour, mais AUCUNE limite sur le nombre d'objets déposés dans
--   son propre dossier : on pouvait gonfler le stockage à 20 Mo pièce sans
--   jamais créer de capture. 200 objets/jour couvre large — une capture en
--   écrit au plus quatre (photo, détourage, vignette, retentatives comprises).

-- ------------------------------------------------- 1. retentatives comptées
--
-- Le compteur vit sur la ligne, incrémenté par l'edge function via `admin` à
-- CHAQUE départ d'identification. Le plafond est large : six échecs d'affilée,
-- ce n'est plus une panne réseau, c'est une image que le service ne saura
-- jamais lire — ou une boucle.
alter table public.animal_captures
  add column if not exists identify_attempts integer not null default 0;

-- --------------------------------------------- 2. plafond d'abonné, et rappel
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
    when coalesce((select p.is_naturalist from public.profiles p where p.user_id = uid), false)
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

-- ------------------------------------------------ 3. les fichiers, comptés
--
-- `security definer` : la politique d'insertion tourne sous l'identité de
-- l'utilisateur, qui n'a pas le droit de lire les objets des autres — mais la
-- fonction ne compte que les SIENS, donc lui prêter ce droit ne fuit rien.
create or replace function public.storage_upload_quota_ok()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select count(*) < 200
  from storage.objects o
  where o.bucket_id in ('capture-originals', 'capture-stickers', 'items')
    and (storage.foldername(o.name))[1] = public.current_user_id()
    and o.created_at >= date_trunc('day', now());
$$;

revoke execute on function public.storage_upload_quota_ok() from public, anon;
grant execute on function public.storage_upload_quota_ok() to authenticated;

drop policy if exists "owners upload private files" on storage.objects;
create policy "owners upload private files" on storage.objects for insert to authenticated
with check (
  bucket_id in ('capture-originals', 'capture-stickers', 'items')
  and (storage.foldername(name))[1] = (select public.current_user_id())
  and public.storage_upload_quota_ok()
);
