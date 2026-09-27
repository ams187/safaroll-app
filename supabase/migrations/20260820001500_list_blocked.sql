-- L'ÉCRAN DE DÉBLOCAGE NE PEUT PAS LIRE LES PROFILS QU'IL DOIT MONTRER.
--
-- `20260819234500` a ajouté `not public.is_blocked(user_id)` à la policy de
-- lecture de `public.profiles`. C'est le but — un joueur bloqué disparaît.
-- Conséquence non voulue : la liste « comptes bloqués » joignait `profiles`
-- pour afficher un nom, et tombait sur exactement les lignes que la policy
-- vient de masquer. Elle n'aurait montré que des identifiants bruts.
--
-- Un blocage qu'on ne peut pas défaire est un piège, pas une protection : cette
-- fonction traverse la RLS, et uniquement pour les personnes que L'APPELANT a
-- lui-même bloquées.

create or replace function public.list_blocked()
returns table (user_id text, display_name text, avatar_url text, blocked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select b.blocked_id, p.display_name, p.avatar_url, b.created_at
  from public.user_blocks b
  left join public.profiles p on p.user_id = b.blocked_id
  where b.blocker_id = public.current_user_id()
  order by b.created_at desc;
$$;

revoke execute on function public.list_blocked() from public, anon;
grant execute on function public.list_blocked() to authenticated;
