-- Chercher un explorateur par son identifiant, pour l'ajouter à son cercle.
--
-- POURQUOI UNE RPC PLUTÔT QU'UN SELECT
--
-- `profiles` est protégée par RLS : un joueur ne lit que sa propre ligne. Sans
-- ça, n'importe qui listerait tous les comptes de l'app. Chercher quelqu'un
-- exige donc de franchir RLS, et ce qui sort d'ici est le strict minimum pour
-- dessiner un bouton : un identifiant, un nom, un avatar. Jamais une capture,
-- jamais une coordonnée, jamais un compteur.
--
-- LA RECHERCHE EST EXACTE, PAS FLOUE
--
-- Un `like '%…%'` transformerait ce point d'entrée en annuaire : taper « a »
-- rendrait la moitié des joueurs. On exige l'identifiant complet — c'est ce
-- qu'on partage à quelqu'un qu'on connaît, et ça ne permet pas d'explorer la
-- base au hasard.
--
-- La casse est ignorée : personne ne retient si son ami écrit son pseudo en
-- majuscules, et un échec silencieux sur une casse ferait passer la
-- fonctionnalité pour cassée.

create or replace function public.find_explorer(handle text)
returns table (
  user_id text,
  display_name text,
  username text,
  avatar_url text
)
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
  limit 1;
$$;

revoke execute on function public.find_explorer(text) from public, anon;
grant execute on function public.find_explorer(text) to authenticated;

-- Mon propre identifiant, pour pouvoir le partager. `list_friends` ne le rend
-- pas — il ne parle que des autres.
create or replace function public.my_handle()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select username from public.profiles where user_id = public.current_user_id();
$$;

revoke execute on function public.my_handle() from public, anon;
grant execute on function public.my_handle() to authenticated;
