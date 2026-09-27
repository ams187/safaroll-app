-- Épingler publie.
--
-- Un visiteur ne lit que les decks publics (`community reads public decks`).
-- Épingler un deck privé ne montrait donc rien : le profil retombait sur
-- l'ordre par défaut, sans un mot, et le joueur croyait avoir choisi.
--
-- « Montrer sur mon profil » et « rendre visible » sont la même intention. Les
-- séparer en deux réglages, c'est demander à quelqu'un de comprendre la RLS.
-- Dépingler ne dépublie pas en revanche : publier est un choix qui a sa propre
-- valeur (la galerie communautaire), et le retirer serait une conséquence que
-- personne n'a demandée.
create or replace function public.pin_deck(target_deck_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid text := public.current_user_id();
begin
  if target_deck_id is not null
     and not exists (select 1 from public.decks where id = target_deck_id and user_id = uid)
  then
    raise exception 'deck introuvable ou hors de votre compte';
  end if;

  update public.profiles set pinned_deck_id = target_deck_id where user_id = uid;

  if target_deck_id is not null then
    update public.decks set is_public = true where id = target_deck_id and user_id = uid;
  end if;
end;
$$;

revoke all on function public.pin_deck(uuid) from public;
grant execute on function public.pin_deck(uuid) to authenticated;
