-- The community space: a leaderboard of distinct species, and visitable player
-- profiles. Both cross RLS on purpose — a player can only ever read their own
-- captures, so ranking everyone requires `security definer` — and both are
-- therefore aggregates-only by construction: counts, names of species, never a
-- photo, never a coordinate, never a capture row.

-- One switch, not a privacy matrix. Off: out of the leaderboard, profile
-- unreadable. The RPCs filter on it at the source — an event that is never
-- returned cannot leak through a client bug.
alter table public.profiles
  add column community_visible boolean not null default true;

-- Distinct species per visible player, ranked. `period` is 'month' (since the
-- 1st, resets everyone — a newcomer can exist in week one) or 'all'.
--
-- The window is over `captured_at`, not `created_at`: the month asks "what did
-- you see this month", and an import of an old photo should not count as this
-- month's safari.
--
-- Returns the top 100 plus the caller's own row wherever it ranks — the pinned
-- "you are 114th" line must exist even when the player is far off the board.
create or replace function public.community_leaderboard(period text)
returns table (
  rank bigint,
  user_id text,
  display_name text,
  avatar_url text,
  species_count bigint,
  is_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with counted as (
    select
      c.user_id as uid,
      count(distinct c.scientific_name) as n
    from public.animal_captures c
    join public.profiles p on p.user_id = c.user_id and p.community_visible
    where c.status in ('ready', 'needs_review')
      and c.scientific_name is not null
      and (
        period <> 'month'
        or c.captured_at >= date_trunc('month', now())
      )
    group by c.user_id
  ),
  placed as (
    -- rank(), not row_number(): equal counts share a place, like any podium.
    select rank() over (order by counted.n desc) as r, counted.uid, counted.n
    from counted
  )
  select
    placed.r,
    placed.uid,
    p.display_name,
    p.avatar_url,
    placed.n,
    placed.uid = public.current_user_id()
  from placed
  join public.profiles p on p.user_id = placed.uid
  where placed.r <= 100 or placed.uid = public.current_user_id()
  order by placed.r, p.display_name;
$$;

-- A visitable player: identity, capture count, and their species as a list of
-- names — enough for the visitor's client to draw the ones it also owns with
-- its own artwork and the rest as silhouettes. Their decks are NOT here: public
-- decks are already readable through RLS, the client fetches them directly.
--
-- NULL when the player does not exist or has switched community_visible off —
-- indistinguishable on purpose.
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
    'bio', p.bio,
    'joinedAt', floor(extract(epoch from p.created_at) * 1000),
    'captureCount', (
      select count(*)
      from public.animal_captures c
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
  where p.user_id = target_user_id and p.community_visible;
$$;

revoke execute on function public.community_leaderboard(text) from public, anon;
revoke execute on function public.community_profile(text) from public, anon;
grant execute on function public.community_leaderboard(text) to authenticated;
grant execute on function public.community_profile(text) to authenticated;
