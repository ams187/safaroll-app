-- Le durcissement d'avant-prod.
--
-- Quatre défauts qui ne se voient pas à un utilisateur et se paient à mille.
--
--   L'ÉNERGIE N'EXISTAIT QUE DANS L'APP
--   `remainingCaptureEnergy` compte dix captures par jour côté téléphone, et
--   c'est tout. Un client modifié en prenait autant qu'il voulait — chaque
--   capture déclenchant une inférence Modal, deux requêtes GBIF et un objet de
--   stockage. Une limite qui vit chez celui qu'elle limite n'est pas une
--   limite.
--
--   LA DATE DE CAPTURE ÉTAIT CELLE QU'ON VOULAIT
--   `p_captured_at` arrivait du client sans borne. L'antidater contournait
--   l'énergie (le compteur lit le jour courant) ET truquait les classements,
--   qui se calculent tous sur `captured_at`.
--
--   NEUF COLONNES MORTES
--   Les notes de terrain, les faits Wikipédia et les sons d'animaux ont été
--   retirés du produit ; leurs colonnes sont restées. `pro_identified_at` date
--   de l'« Identification Pro », supprimée quand le gros modèle est devenu
--   celui de tout le monde.
--
--   LES CLASSEMENTS N'AVAIENT PAS D'INDEX
--   Six classements filtrent sur `captured_at` et groupent par joueur. Le seul
--   index existant porte sur `created_at`, qui n'est pas la même date — celle
--   d'une capture prise hors réseau est postérieure de plusieurs heures.

-- ---------------------------------------------------------------- 1. énergie
--
-- Dix par jour, comme `DAILY_CAPTURE_ENERGY` dans `capture-energy.ts`. Les
-- deux valeurs doivent bouger ensemble : celle-ci décide, celle du client
-- annonce. Un abonné n'est pas compté.
--
-- La fenêtre est le jour UTC. Le client, lui, compte en heure locale — ils ne
-- coïncident pas partout, et c'est voulu : le serveur est un GARDE-FOU contre
-- l'abus, pas la règle affichée. Il laisse donc passer un peu plus large que
-- ce que l'app promet, plutôt que de refuser une capture que le joueur croyait
-- avoir le droit de prendre.
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

  if not coalesce((select p.is_naturalist from public.profiles p where p.user_id = uid), false) then
    select count(*) into taken
    from public.animal_captures c
    where c.user_id = uid and c.created_at >= date_trunc('day', now());
    if taken >= 10 then raise exception 'Daily capture energy exhausted'; end if;
  end if;

  -- La date est BORNÉE, pas refusée : une capture prise hors réseau et envoyée
  -- au retour du signal est légitime, et sa date l'est aussi. Sept jours
  -- couvrent largement la file d'attente ; au-delà, c'est une main qui écrit.
  -- Le futur, lui, ne se justifie jamais.
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

revoke execute on function public.create_capture(text, text, text, double precision, timestamptz, text, double precision, double precision) from public, anon;
grant execute on function public.create_capture(text, text, text, double precision, timestamptz, text, double precision, double precision) to authenticated;

-- ----------------------------------------------------------------- 2. index
--
-- L'index que tous les classements réclament : par joueur, par date de
-- CAPTURE, et seulement sur les lignes qui comptent. Partiel, donc il ignore
-- les captures en cours et les échecs — qu'aucun classement ne lit.
create index if not exists animal_captures_user_captured_idx
  on public.animal_captures (user_id, captured_at desc)
  where status in ('ready', 'needs_review');

-- Les six classements joignent `profiles` sur ce drapeau avant tout le reste.
create index if not exists profiles_community_visible_idx
  on public.profiles (user_id)
  where community_visible;

-- ------------------------------------------------------- 3. colonnes mortes
alter table public.animal_captures
  drop column if exists pro_identified_at;

alter table public.species_catalog
  drop column if exists field_note,
  drop column if exists facts,
  drop column if exists facts_source_url,
  drop column if exists sound_url,
  drop column if exists sound_credit,
  drop column if exists sound_license,
  drop column if exists sound_source_url,
  drop column if exists sound_checked_at;
