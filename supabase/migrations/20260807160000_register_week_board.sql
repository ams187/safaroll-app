-- Le classement de la semaine, et il passe en premier.
--
-- POURQUOI IL MANQUAIT ET POURQUOI IL COMPTE
--
-- Les cinq mesures d'origine se comptaient toutes en mois ou en cumul. Or
-- c'est la fenêtre COURTE qui ramène un joueur : l'atlas demande des mois de
-- collection, et celui qui a trois ans de retard n'y rattrapera jamais
-- personne. Sept jours, si — et lundi matin tout le monde repart à zéro.
--
-- `date_trunc('week')` de Postgres commence le lundi (ISO-8601), ce que tout le
-- monde lit comme « cette semaine ».
--
-- Le reste de la fonction est inchangé : voir 20260807150000 pour le détail des
-- mesures et la raison du `security definer`.

create or replace function public.register_board(board text)
returns table (
  rank bigint,
  user_id text,
  display_name text,
  avatar_url text,
  score bigint,
  is_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with scored as (
    select
      c.user_id as uid,
      case board
        when 'captures' then count(*)
        when 'atlas' then count(distinct c.scientific_name)
        when 'semaine' then count(distinct c.scientific_name)
          -- `week` de Postgres commence le LUNDI (ISO-8601), ce qui est la
          -- convention que tout le monde lit comme « cette semaine ».
          filter (where c.captured_at >= date_trunc('week', now()))
        when 'saison' then count(distinct c.scientific_name)
          filter (where c.captured_at >= date_trunc('month', now()))
        when 'trouvailles' then count(distinct c.scientific_name)
          filter (where s.rarity in ('very_rare', 'ultra_rare', 'epic', 'mythic', 'legendary'))
        -- La maîtrise pèse chaque espèce DISTINCTE par sa rareté : compter les
        -- captures récompenserait dix photos du même moineau autant qu'une
        -- panthère des neiges.
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
    group by c.user_id
  ),
  -- La maîtrise doit sommer une rareté par ESPÈCE, pas par capture. On
  -- dédoublonne donc en amont pour elle seule.
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
    -- rank(), not row_number(): deux joueurs à égalité partagent leur place.
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
    placed.uid = public.current_user_id()
  from placed
  join public.profiles p on p.user_id = placed.uid
  -- Cent lignes, PLUS la tienne où qu'elle soit : la ligne ancrée en bas de
  -- l'écran doit exister même quand le joueur est 3 000ᵉ.
  where placed.r <= 100 or placed.uid = public.current_user_id()
  order by placed.r, p.display_name;
$$;

revoke execute on function public.register_board(text) from public, anon;
grant execute on function public.register_board(text) to authenticated;
