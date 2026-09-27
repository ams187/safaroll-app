-- Ramène les captures fictives dans le présent.
--
-- `supabase db query` n'exécute QU'UNE instruction, et il bute sur les
-- commentaires en tête. D'où le filtre :
--
--   bunx supabase db query --linked "$(grep -v '^--' scripts/refresh-seed-dates.sql | tr '\n' ' ')"
--
-- POURQUOI CE SCRIPT EXISTE
--
-- `seed-community.sql` fige des dates au moment où on le lance. Le classement
-- « semaine » ne compte que depuis `date_trunc('week', now())` — donc le lundi
-- suivant, les quinze joueurs fictifs en sortent d'un bloc et l'écran
-- communauté n'affiche plus que le compte réel. Rien n'est cassé : les données
-- ont simplement vieilli d'une semaine.
--
-- CE QU'IL FAIT, ET CE QU'IL PRÉSERVE
--
-- Un décalage UNIFORME, calculé pour que la capture la plus récente tombe
-- aujourd'hui. Tous les intervalles sont conservés : l'étalement voulu par le
-- seed — une partie ce mois-ci, le reste dans le passé — reste intact, et les
-- onglets Semaine / Saison / Toujours continuent de raconter trois histoires
-- différentes. Un simple `captured_at = now()` sur tout écraserait ça.
--
-- Relançable autant de fois que nécessaire, et sans effet le jour même.

with decalage as (
  select (current_date - max(captured_at)::date) as jours
  from public.animal_captures
  where user_id like 'seed_%'
)
update public.animal_captures c
set captured_at = c.captured_at + (d.jours || ' days')::interval
from decalage d
where c.user_id like 'seed_%'
  and d.jours > 0;

-- Ce que voit désormais chaque classement.
select
  (select count(*) from public.register_board('semaine')) as semaine,
  (select count(*) from public.register_board('saison'))  as saison,
  (select count(*) from public.register_board('atlas'))   as atlas,
  (select max(captured_at)::date from public.animal_captures where user_id like 'seed_%') as derniere_capture;
