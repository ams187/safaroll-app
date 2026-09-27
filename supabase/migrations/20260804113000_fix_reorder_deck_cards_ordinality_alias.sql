-- `reorder_deck_cards` never ran its UPDATE. Reproduced against the live
-- database, calling the RPC exactly as the app does:
--
--   status 400 {"code":"42703","message":"column \"value\" does not exist"}
--
-- The last statement read:
--
--   from (select value as capture_id, ordinality - 1 as position
--         from unnest(target_capture_ids) with ordinality) ordered
--
-- `WITH ORDINALITY` names its columns after the function — `unnest` and
-- `ordinality` — and the only way to call the first one `value` is to alias the
-- whole thing, `AS t(value, ordinality)`. Two statements earlier in the same
-- function do exactly that (`from unnest(target_capture_ids) value`, where the
-- alias names both the table and its single column), which is why they parsed
-- and this one did not.
--
-- plpgsql plans a statement the first time it reaches it, so the function ran
-- all of its validation, then threw at the line that does the work. Every
-- reorder failed, the client dropped its optimistic order, and the deck snapped
-- back to what the server still had.
--
-- Columns are named outright here rather than aliased back into `value`.

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
  from (
    select entry.capture_id, entry.ordinal - 1 as position
    from unnest(target_capture_ids) with ordinality as entry(capture_id, ordinal)
  ) ordered
  where c.deck_id = target_deck_id and c.capture_id = ordered.capture_id;
end;
$$;
