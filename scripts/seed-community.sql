-- Joueurs fictifs pour peupler le leaderboard pendant le développement.
--
--   supabase db query --linked "$(cat scripts/seed-community.sql)"
--
-- Tout est préfixé `seed_` — pour tout effacer :
--   delete from public.animal_captures where user_id like 'seed_%';
--   delete from public.profiles where user_id like 'seed_%';
--
-- Les espèces sortent du vrai catalogue (ordre md5 salé par joueur, donc des
-- collections qui se recoupent sans être identiques), les dates se partagent
-- entre ce mois-ci et le passé pour que les onglets Mois/Toujours racontent
-- deux histoires différentes. Pas de photos : ces captures n'ont pas d'objet
-- storage, mais ni le classement ni le profil public n'en lisent.

with seeds(uid, dname, monthly, older) as (
  values
    ('seed_lea',   'Léa',   14, 8),
    ('seed_karim', 'Karim', 11, 12),
    ('seed_emma',  'Emma',   9, 7),
    ('seed_nico',  'Nico',   8, 3),
    ('seed_sarah', 'Sarah',  6, 9),
    ('seed_tom',   'Tom',    5, 4),
    ('seed_ines',  'Inès',   5, 2),
    ('seed_hugo',  'Hugo',   4, 6),
    ('seed_jade',  'Jade',   3, 4),
    ('seed_lucas', 'Lucas',  3, 1),
    ('seed_nina',  'Nina',   2, 5),
    ('seed_max',   'Max',    2, 1),
    ('seed_zoe',   'Zoé',    1, 3),
    ('seed_adam',  'Adam',   1, 0),
    ('seed_mia',   'Mia',    0, 4)
),
profiles_in as (
  insert into public.profiles (user_id, display_name, avatar_url)
  select uid, dname, 'https://i.pravatar.cc/150?u=' || uid
  from seeds
  on conflict (user_id) do nothing
  returning user_id
),
cleaned as (
  -- Rejouable : on repart de zéro côté captures à chaque exécution.
  delete from public.animal_captures where user_id like 'seed_%'
  returning id
)
insert into public.animal_captures
  (user_id, status, original_path, capture_source, aspect_ratio, captured_at,
   scientific_name, common_name, in_atlas, confidence, rarity)
select
  s.uid,
  'ready',
  s.uid || '/seed-' || picked.rn || '.jpg',
  'camera',
  1.33,
  case
    -- Ce mois-ci : dans les dernières 72h, jamais dans le futur, jamais avant le 1er.
    when picked.rn <= s.monthly
      then greatest(date_trunc('month', now()), now() - ((picked.rn * 7) % 72) * interval '1 hour')
    -- Le passé : entre 1 et 7 mois en arrière.
    else now() - (30 + ((picked.rn * 13) % 180)) * interval '1 day'
  end,
  picked.scientific_name,
  picked.vernacular_name,
  true,
  0.9,
  (array['common','common','common','uncommon','uncommon','rare','ultra_rare'])[1 + (picked.rn % 7)]
from seeds s
cross join lateral (
  select ranked.scientific_name, ranked.vernacular_name, ranked.rn
  from (
    select c.scientific_name, c.vernacular_name,
           row_number() over (order by md5(s.uid || c.scientific_name)) as rn
    from public.species_catalog c
    where c.scientific_name is not null
  ) ranked
  where ranked.rn <= s.monthly + s.older
) picked;
