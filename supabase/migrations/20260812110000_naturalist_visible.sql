-- L'abonnement devient VISIBLE des autres.
--
-- POURQUOI IL FAUT TOUCHER AU SERVEUR POUR UN BADGE
--
-- `is_naturalist()` ne répond que sur SOI, et RLS ne rend au joueur que sa
-- propre ligne de `profiles`. Un badge que son porteur est le seul à voir ne
-- distingue personne : ce qui fait sa valeur, c'est le regard des autres. Il
-- faut donc que le drapeau sorte par les deux portes qui montrent déjà des
-- joueurs — le Registre et la fiche publique.
--
-- CE QUI SORT, ET CE QUI RESTE DEDANS
--
-- Un booléen, rien de plus. Ni la date d'échéance, ni le plan, ni le
-- fournisseur : le voisin n'a pas à savoir si tu paies à la semaine ou à vie,
-- et une date d'expiration en clair dirait à tout le monde quand te relancer.
--
-- La colonne reste inécrivable depuis l'app (aucune policy d'écriture, cf.
-- `20260808100000_naturalist_entitlement.sql`) : elle ne se lit qu'en sortie de
-- ces deux fonctions `security definer`.

-- `register_board` change de forme : une colonne de plus, donc `create or
-- replace` ne suffit pas — Postgres refuse de remplacer une fonction dont le
-- type de retour change.
drop function if exists public.register_board(text, text);

create or replace function public.register_board(board text, scope text default 'global')
returns table (
  rank bigint,
  user_id text,
  display_name text,
  avatar_url text,
  score bigint,
  is_me boolean,
  is_naturalist boolean
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
    select
      scored.uid,
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
    placed.r,
    placed.uid,
    p.display_name,
    p.avatar_url,
    placed.n,
    placed.uid = public.current_user_id(),
    p.is_naturalist
  from placed
  join public.profiles p on p.user_id = placed.uid
  where placed.r <= 100 or placed.uid = public.current_user_id()
  order by placed.r, p.display_name;
$$;

revoke execute on function public.register_board(text, text) from public, anon;
grant execute on function public.register_board(text, text) to authenticated;

-- La fiche publique. Son type de retour ne bouge pas (jsonb), donc une clé de
-- plus suffit.
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
    'isNaturalist', p.is_naturalist,
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

revoke execute on function public.community_profile(text) from public, anon;
grant execute on function public.community_profile(text) to authenticated;
