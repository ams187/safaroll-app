-- Every write to a deck was failing, so every reorder snapped back.
--
-- `bird_deck_cards` has `unique (deck_id, position) deferrable initially
-- immediate`, and all three deck-writing functions defer it before moving
-- cards around — they have to, because swapping two cards means two rows
-- briefly holding the same position inside one UPDATE.
--
-- They deferred it by unqualified name, from inside `set search_path = ''`:
--
--   set constraints bird_deck_cards_deck_id_position_key deferred;
--
-- and SET CONSTRAINTS resolves an unqualified name through the search path —
-- "The current schema search path is used to find the first matching name if
-- no schema name is specified." With the path empty there is nothing to search,
-- so the statement never reached the constraint. Whichever way that lands
-- (name not found, or found-but-not-deferred) the outcome is the same: the
-- unique check stayed immediate, the swap tripped it, and the whole RPC threw.
--
-- The client did exactly what it should with a failed mutation — dropped its
-- optimistic order and re-rendered the server's. That is the "I swap two cards,
-- I let go, and it goes back" — the drag was fine, the write never happened.
--
-- Same one-line fault in all three, so all three are replaced. Only the
-- constraint name is schema-qualified; the bodies are otherwise untouched.

create or replace function public.place_deck_card(target_deck_id uuid, target_capture_id uuid, target_position integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  current_position smallint;
  occupant_id uuid;
  member_count integer;
begin
  set constraints public.bird_deck_cards_deck_id_position_key deferred;
  if target_position < 0 or target_position > 7 then raise exception 'Invalid slot'; end if;
  if not exists (select 1 from public.bird_decks where id = target_deck_id and user_id = uid) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from public.bird_captures where id = target_capture_id and user_id = uid) then raise exception 'Not allowed'; end if;

  select position into current_position from public.bird_deck_cards
  where deck_id = target_deck_id and capture_id = target_capture_id for update;
  select id into occupant_id from public.bird_deck_cards
  where deck_id = target_deck_id and position = target_position for update;

  if current_position = target_position then return; end if;
  if current_position is not null then
    if occupant_id is not null then
      update public.bird_deck_cards
      set position = case when id = occupant_id then current_position else target_position end
      where id = occupant_id or (deck_id = target_deck_id and capture_id = target_capture_id);
    else
      update public.bird_deck_cards set position = target_position where deck_id = target_deck_id and capture_id = target_capture_id;
    end if;
    return;
  end if;

  if occupant_id is not null then
    delete from public.bird_deck_cards where id = occupant_id;
  else
    select count(*) into member_count from public.bird_deck_cards where deck_id = target_deck_id;
    if member_count >= 8 then raise exception 'Deck is full'; end if;
  end if;
  insert into public.bird_deck_cards (user_id, deck_id, capture_id, position)
  values (uid, target_deck_id, target_capture_id, target_position);
end;
$$;

create or replace function public.toggle_deck_card(target_deck_id uuid, target_capture_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  existing_id uuid;
  next_position integer;
begin
  set constraints public.bird_deck_cards_deck_id_position_key deferred;
  if not exists (select 1 from public.bird_decks where id = target_deck_id and user_id = uid)
    or not exists (select 1 from public.bird_captures where id = target_capture_id and user_id = uid)
  then raise exception 'Not allowed'; end if;
  select id into existing_id from public.bird_deck_cards where deck_id = target_deck_id and capture_id = target_capture_id;
  if existing_id is not null then
    delete from public.bird_deck_cards where id = existing_id;
    with ordered as (
      select id, row_number() over (order by position) - 1 as next_position
      from public.bird_deck_cards where deck_id = target_deck_id
    )
    update public.bird_deck_cards c set position = ordered.next_position
    from ordered where c.id = ordered.id;
    return false;
  end if;
  select coalesce(max(position) + 1, 0) into next_position from public.bird_deck_cards where deck_id = target_deck_id;
  if next_position >= 8 then raise exception 'Deck is full'; end if;
  insert into public.bird_deck_cards (user_id, deck_id, capture_id, position)
  values (uid, target_deck_id, target_capture_id, next_position);
  return true;
end;
$$;

create or replace function public.reorder_deck_cards(target_deck_id uuid, target_capture_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid text := public.current_user_id();
begin
  if cardinality(target_capture_ids) > 8 or cardinality(target_capture_ids) <> (select count(distinct value) from unnest(target_capture_ids) value) then
    raise exception 'Invalid deck order';
  end if;
  if not exists (select 1 from public.bird_decks where id = target_deck_id and user_id = uid) then raise exception 'Not allowed'; end if;
  if cardinality(target_capture_ids) <> (select count(*) from public.bird_deck_cards where deck_id = target_deck_id)
    or exists (
      select 1 from unnest(target_capture_ids) value
      where not exists (select 1 from public.bird_deck_cards where deck_id = target_deck_id and capture_id = value)
    )
  then raise exception 'Deck cards changed'; end if;
  set constraints public.bird_deck_cards_deck_id_position_key deferred;
  update public.bird_deck_cards c set position = ordered.position
  from (select value as capture_id, ordinality - 1 as position from unnest(target_capture_ids) with ordinality) ordered
  where c.deck_id = target_deck_id and c.capture_id = ordered.capture_id;
end;
$$;

-- The name above is the one Postgres generated for the unnamed `unique
-- (deck_id, position)`. Pin it, so a future rename breaks the migration rather
-- than the deck: `SET CONSTRAINTS` on a name that resolves to nothing is
-- exactly the failure this migration exists to fix, and it is invisible until
-- someone drags a card.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.bird_deck_cards'::regclass
      and conname = 'bird_deck_cards_deck_id_position_key'
      and condeferrable
  ) then
    raise exception 'bird_deck_cards_deck_id_position_key is missing or not deferrable';
  end if;
end;
$$;
