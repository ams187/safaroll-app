-- CE QU'APPLE EXIGE D'UNE APP QUI MONTRE LE CONTENU D'AUTRUI (DIRECTIVE 1.2).
--
--   1. filtrer le contenu répréhensible
--   2. un moyen de SIGNALER, avec réponse rapide
--   3. un moyen de BLOQUER un utilisateur abusif
--   4. des coordonnées de contact publiées
--
-- SafaRoll expose cinq surfaces de contenu tiers : les decks publics (nom,
-- description, et les PHOTOS des captures), les classements, la fiche d'un
-- joueur visité, la recherche d'explorateur, la liste d'amis. Aucune n'avait
-- de signalement ni de blocage. Cette migration pose les deux derniers.
--
-- LE POINT 1 N'EST PAS ICI, ET IL FAUT LE DIRE. Filtrer automatiquement des
-- photos demande un service de modération d'images ; ce que cette migration
-- fournit, c'est la voie humaine : tout contenu signalé atterrit dans
-- `abuse_reports`, à traiter sous 24 h. C'est ce qu'Apple accepte pour une
-- fonction sociale de cette taille, pas une dispense.
--
-- POURQUOI `is_blocked` EST `security definer`
--
-- Un blocage doit couper la vue DANS LES DEUX SENS : si Bob me bloque, je ne
-- dois plus le voir non plus, sinon bloquer ne protège personne. Or la RLS de
-- `user_blocks` ne me laisse voir que MES lignes — celles où je suis le
-- bloqueur. Une sous-requête en clair dans une policy ne verrait donc jamais
-- « Bob m'a bloqué ». La fonction traverse, et ne rend qu'un booléen sur une
-- paire dont l'appelant fait partie : rien ne fuit.

create table public.user_blocks (
  blocker_id text not null default public.current_user_id(),
  blocked_id text not null,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);

-- L'index du sens inverse : `is_blocked` interroge les deux colonnes, et la clé
-- primaire ne couvre que (blocker, blocked).
create index user_blocks_blocked_idx on public.user_blocks (blocked_id, blocker_id);

alter table public.user_blocks enable row level security;

create policy "users read own blocks" on public.user_blocks for select to authenticated
using (blocker_id = (select public.current_user_id()));
create policy "users create own blocks" on public.user_blocks for insert to authenticated
with check (blocker_id = (select public.current_user_id()));
create policy "users remove own blocks" on public.user_blocks for delete to authenticated
using (blocker_id = (select public.current_user_id()));

create table public.abuse_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id text not null default public.current_user_id(),
  target_kind text not null check (target_kind in ('deck', 'profile', 'capture')),
  target_id text not null,
  target_user_id text,
  reason text not null check (reason in ('offensive', 'sexual', 'violence', 'harassment', 'spam', 'other')),
  note text,
  status text not null default 'open' check (status in ('open', 'reviewed', 'actioned')),
  created_at timestamptz not null default now()
);

create index abuse_reports_open_idx on public.abuse_reports (status, created_at desc);

alter table public.abuse_reports enable row level security;

-- On peut signaler et relire ses propres signalements. Pas les modifier : un
-- signalement est une déclaration horodatée, pas un brouillon.
create policy "users file reports" on public.abuse_reports for insert to authenticated
with check (reporter_id = (select public.current_user_id()));
create policy "users read own reports" on public.abuse_reports for select to authenticated
using (reporter_id = (select public.current_user_id()));

create or replace function public.is_blocked(other_user_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_blocks b
    where (b.blocker_id = public.current_user_id() and b.blocked_id = other_user_id)
       or (b.blocked_id = public.current_user_id() and b.blocker_id = other_user_id)
  );
$$;

revoke execute on function public.is_blocked(text) from public, anon;
grant execute on function public.is_blocked(text) to authenticated;

-- Bloquer rompt l'amitié dans le même mouvement. Laisser la ligne d'amitié
-- vivante derrière un blocage, c'est garder une porte que les deux écrans
-- devraient ensuite penser à fermer chacun de leur côté.
create or replace function public.block_user(target_user_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
begin
  if me is null or target_user_id is null or me = target_user_id then
    raise exception 'blocage impossible';
  end if;
  insert into public.user_blocks (blocker_id, blocked_id)
  values (me, target_user_id)
  on conflict do nothing;
  delete from public.friendships f
  where least(me, target_user_id) = f.user_low
    and greatest(me, target_user_id) = f.user_high;
end;
$$;

revoke execute on function public.block_user(text) from public, anon;
grant execute on function public.block_user(text) to authenticated;

create or replace function public.unblock_user(target_user_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.user_blocks
  where blocker_id = public.current_user_id() and blocked_id = target_user_id;
$$;

revoke execute on function public.unblock_user(text) from public, anon;
grant execute on function public.unblock_user(text) to authenticated;

-- ─── LES SURFACES, UNE PAR UNE ────────────────────────────────────────────

drop policy "owners and community read decks" on public.decks;
create policy "owners and community read decks"
on public.decks for select to authenticated
using (
  user_id = (select public.current_user_id())
  or (is_public and not public.is_blocked(user_id))
);

drop policy "owners and public deck readers read captures" on public.animal_captures;
create policy "owners and public deck readers read captures"
on public.animal_captures for select to authenticated
using (
  user_id = (select public.current_user_id())
  or (
    not public.is_blocked(user_id)
    and exists (
      select 1 from public.deck_cards dc
      join public.decks d on d.id = dc.deck_id
      where dc.capture_id = animal_captures.id and d.is_public
    )
  )
);

drop policy "authenticated users read profiles" on public.profiles;
create policy "authenticated users read profiles"
on public.profiles for select to authenticated
using (
  user_id = (select public.current_user_id())
  or not public.is_blocked(user_id)
);

-- ─── LES RPC `security definer` TRAVERSENT LA RLS ─────────────────────────
--
-- Les policies ci-dessus ne protègent que les requêtes qui passent par les
-- tables. Les cinq fonctions qui alimentent la communauté sont
-- `security definer` : elles s'exécutent avec les droits du propriétaire et
-- ignorent toute policy. Chacune doit donc filtrer elle-même, sinon un joueur
-- bloqué reste visible au podium, dans la recherche et sur sa fiche.

create or replace function public.community_leaderboard(period text)
returns table (
  rank bigint, user_id text, display_name text,
  avatar_url text, species_count bigint, is_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with counted as (
    select c.user_id as uid, count(distinct c.scientific_name) as n
    from public.animal_captures c
    join public.profiles p on p.user_id = c.user_id and p.community_visible
    where c.status in ('ready', 'needs_review')
      and c.scientific_name is not null
      and (period <> 'month' or c.captured_at >= date_trunc('month', now()))
    group by c.user_id
  ),
  placed as (
    -- rank(), pas row_number() : à égalité on partage la place, comme sur un podium.
    select rank() over (order by counted.n desc) as r, counted.uid, counted.n
    from counted
  )
  select placed.r, placed.uid, p.display_name, p.avatar_url, placed.n,
    placed.uid = public.current_user_id()
  from placed
  join public.profiles p on p.user_id = placed.uid
  where (placed.r <= 100 or placed.uid = public.current_user_id())
    -- Le rang est calculé AVANT le filtre : retirer un joueur bloqué laisse un
    -- trou dans la numérotation, et c'est juste — sa place existe, on la cache.
    and not public.is_blocked(placed.uid)
  order by placed.r, p.display_name;
$$;

revoke execute on function public.community_leaderboard(text) from public, anon;
grant execute on function public.community_leaderboard(text) to authenticated;

create or replace function public.find_explorer(handle text)
returns table (user_id text, display_name text, username text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.display_name, p.username, p.avatar_url
  from public.profiles p
  where p.community_visible
    and p.username is not null
    -- `@marie` et `marie` sont la même personne : le préfixe est un ornement
    -- d'affichage, pas une partie de l'identifiant.
    and lower(p.username) = lower(ltrim(trim(handle), '@'))
    and p.user_id <> public.current_user_id()
    and not public.is_blocked(p.user_id)
  limit 1;
$$;

revoke execute on function public.find_explorer(text) from public, anon;
grant execute on function public.find_explorer(text) to authenticated;

create or replace function public.list_friends()
returns table (user_id text, display_name text, avatar_url text, status text, direction text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when f.user_low = public.current_user_id() then f.user_high else f.user_low end,
    p.display_name, p.avatar_url, f.status,
    case
      when f.status = 'accepted' then 'friend'
      when f.requested_by = public.current_user_id() then 'out'
      else 'in'
    end
  from public.friendships f
  join public.profiles p
    on p.user_id = case when f.user_low = public.current_user_id() then f.user_high else f.user_low end
  where public.current_user_id() in (f.user_low, f.user_high)
    and p.community_visible
    -- `block_user` supprime déjà l'amitié ; ce filtre couvre le cas d'un blocage
    -- posé sans amitié préalable, puis d'une demande arrivée entre-temps.
    and not public.is_blocked(p.user_id)
  order by f.status, p.display_name;
$$;

revoke execute on function public.list_friends() from public, anon;
grant execute on function public.list_friends() to authenticated;

-- Bloquer sans fermer la porte des invitations ne bloque rien : la personne
-- reviendrait par une demande d'ami, notification comprise.
create or replace function public.request_friend(target_user_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  lo text := least(uid, target_user_id);
  hi text := greatest(uid, target_user_id);
  existing public.friendships%rowtype;
begin
  if uid is null or uid = target_user_id then raise exception 'Invalid target'; end if;
  if public.is_blocked(target_user_id) then raise exception 'Player unavailable'; end if;
  -- Un joueur retiré de la communauté n'est pas invitable : son profil est
  -- illisible, l'inviter n'aurait aucun effet visible.
  if not exists (
    select 1 from public.profiles
    where user_id = target_user_id and community_visible
  ) then raise exception 'Player unavailable'; end if;

  select * into existing from public.friendships where user_low = lo and user_high = hi;
  if found then
    if existing.status = 'accepted' then return 'accepted'; end if;
    -- L'autre avait demandé le premier : on scelle.
    if existing.requested_by <> uid then
      update public.friendships set status = 'accepted', responded_at = now()
      where user_low = lo and user_high = hi;
      return 'accepted';
    end if;
    return 'pending';
  end if;

  insert into public.friendships (user_low, user_high, requested_by)
  values (lo, hi, uid);
  return 'pending';
end;
$$;

revoke execute on function public.request_friend(text) from public, anon;
grant execute on function public.request_friend(text) to authenticated;

-- `register_board` et `community_profile` viennent d'être recréées par
-- `20260819230000` pour le renommage premium ; on les repose ici avec le
-- filtre, sans quoi le podium et la fiche visitée resteraient des angles morts.

create or replace function public.register_board(board text, scope text default 'global')
returns table (
  rank bigint, user_id text, display_name text,
  avatar_url text, score bigint, is_me boolean, is_premium boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with circle as (
    select case when f.user_low = public.current_user_id() then f.user_high else f.user_low end as uid
    from public.friendships f
    where f.status = 'accepted'
      and public.current_user_id() in (f.user_low, f.user_high)
    union all
    select public.current_user_id()
  ),
  scored as (
    select
      c.user_id as uid,
      case board
        when 'captures' then count(*)
        when 'atlas' then count(distinct c.scientific_name)
        when 'semaine' then count(distinct c.scientific_name)
          filter (where c.captured_at >= date_trunc('week', now()))
        when 'saison' then count(distinct c.scientific_name)
          filter (where c.captured_at >= date_trunc('month', now()))
        when 'trouvailles' then count(distinct c.scientific_name)
          filter (where s.rarity in ('very_rare', 'ultra_rare', 'epic', 'mythic', 'legendary'))
        when 'maitrise' then coalesce(sum(
          case s.rarity
            when 'legendary' then 700 when 'mythic' then 610 when 'epic' then 520
            when 'ultra_rare' then 425 when 'very_rare' then 330 when 'rare' then 240
            when 'uncommon' then 160 else 100
          end
        ) filter (where c.scientific_name is not null), 0)
        else count(distinct c.scientific_name)
      end as n
    from public.animal_captures c
    join public.profiles p on p.user_id = c.user_id and p.community_visible
    left join public.species_catalog s on s.scientific_name = c.scientific_name
    where c.status in ('ready', 'needs_review')
      and c.scientific_name is not null
      and (scope <> 'friends' or c.user_id in (select uid from circle))
    group by c.user_id
  ),
  mastered as (
    select d.user_id as uid, sum(
      case s.rarity
        when 'legendary' then 700 when 'mythic' then 610 when 'epic' then 520
        when 'ultra_rare' then 425 when 'very_rare' then 330 when 'rare' then 240
        when 'uncommon' then 160 else 100
      end
    ) as n
    from (
      select distinct c.user_id, c.scientific_name
      from public.animal_captures c
      join public.profiles p on p.user_id = c.user_id and p.community_visible
      where c.status in ('ready', 'needs_review') and c.scientific_name is not null
        and (scope <> 'friends' or c.user_id in (select uid from circle))
    ) d
    left join public.species_catalog s on s.scientific_name = d.scientific_name
    group by d.user_id
  ),
  final as (
    select scored.uid,
      case when board = 'maitrise' then coalesce(mastered.n, 0) else scored.n end as n
    from scored
    left join mastered on mastered.uid = scored.uid
  ),
  placed as (
    select rank() over (order by final.n desc) as r, final.uid, final.n
    from final
    where final.n > 0
  )
  select
    placed.r, placed.uid, p.display_name, p.avatar_url, placed.n,
    placed.uid = public.current_user_id(),
    p.is_premium and (p.premium_until is null or p.premium_until > now())
  from placed
  join public.profiles p on p.user_id = placed.uid
  where (placed.r <= 100 or placed.uid = public.current_user_id())
    and not public.is_blocked(placed.uid)
  order by placed.r, p.display_name;
$$;

revoke execute on function public.register_board(text, text) from public, anon;
grant execute on function public.register_board(text, text) to authenticated;

create or replace function public.community_profile(target_user_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'userId', p.user_id,
    'displayName', p.display_name,
    'avatarUrl', p.avatar_url,
    'isPremium', p.is_premium and (p.premium_until is null or p.premium_until > now()),
    'bio', p.bio,
    'joinedAt', floor(extract(epoch from p.created_at) * 1000),
    'captureCount', (
      select count(*) from public.animal_captures c
      where c.user_id = p.user_id and c.status in ('ready', 'needs_review')
    ),
    'species', (
      select coalesce(jsonb_agg(grouped.entry order by grouped.first_at desc), '[]'::jsonb)
      from (
        select
          min(c.captured_at) as first_at,
          jsonb_build_object(
            'scientificName', c.scientific_name,
            'commonName', max(c.common_name),
            'rarity', max(c.rarity),
            'firstSeenAt', floor(extract(epoch from min(c.captured_at)) * 1000)
          ) as entry
        from public.animal_captures c
        where c.user_id = p.user_id
          and c.status in ('ready', 'needs_review')
          and c.scientific_name is not null
        group by c.scientific_name
      ) grouped
    )
  )
  from public.profiles p
  where p.user_id = target_user_id
    and p.community_visible
    and not public.is_blocked(p.user_id);
$$;

revoke execute on function public.community_profile(text) from public, anon;
grant execute on function public.community_profile(text) to authenticated;

-- Le signalement. Une ligne, horodatée, avec l'auteur visé quand on le connaît —
-- c'est lui qu'un traitement devra suspendre, pas seulement le contenu.
create or replace function public.report_content(
  kind text, target_id text, reason text, note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := public.current_user_id();
  author text;
begin
  if me is null then raise exception 'non authentifié'; end if;
  if kind = 'deck' then
    select d.user_id into author from public.decks d where d.id = target_id::uuid;
  elsif kind = 'capture' then
    select c.user_id into author from public.animal_captures c where c.id = target_id::uuid;
  else
    author := target_id;
  end if;
  insert into public.abuse_reports (reporter_id, target_kind, target_id, target_user_id, reason, note)
  values (me, kind, target_id, author, reason, nullif(btrim(note), ''));
end;
$$;

revoke execute on function public.report_content(text, text, text, text) from public, anon;
grant execute on function public.report_content(text, text, text, text) to authenticated;
