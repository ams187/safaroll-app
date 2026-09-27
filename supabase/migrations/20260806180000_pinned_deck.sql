-- Le deck épinglé : celui qu'on montre quand quelqu'un visite le profil.
--
-- Sur `profiles` et non sur `decks` : un joueur n'a qu'un deck principal, et le
-- porter sur la ligne du joueur rend l'unicité gratuite. Une colonne
-- `decks.is_pinned` aurait demandé un index partiel unique par joueur ET une
-- transaction pour dépingler l'ancien — deux façons de se retrouver avec deux
-- decks principaux ou zéro.
--
-- `on delete set null` : supprimer un deck ne doit pas casser le profil, il
-- retombe simplement sur l'ordre par défaut.
alter table public.profiles
  add column if not exists pinned_deck_id uuid
  references public.decks(id) on delete set null;

comment on column public.profiles.pinned_deck_id is
  'Deck montré en premier sur le profil public. NULL = le plus ancien.';

-- Épingler le deck d'un autre joueur n'aurait aucun sens, et le laisser
-- possible ouvrirait un profil sur un plateau qui ne lui appartient pas.
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
end;
$$;

revoke all on function public.pin_deck(uuid) from public;
grant execute on function public.pin_deck(uuid) to authenticated;
