-- Listing limité au propriétaire authentifié, y compris les sous-dossiers.
create or replace function public.list_my_account_files()
returns table(bucket_id text, name text)
language sql security definer set search_path = ''
as $$
  select o.bucket_id, o.name from storage.objects o
  where o.bucket_id in ('capture-originals', 'capture-stickers', 'items')
    and (storage.foldername(o.name))[1] = public.current_user_id()
  order by o.bucket_id, o.name limit 1000;
$$;
revoke all on function public.list_my_account_files() from public, anon;
grant execute on function public.list_my_account_files() to authenticated;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  restant record;
  reste bigint;
begin
  if uid is null then
    raise exception 'Unauthorized';
  end if;

  -- Refuser de purger les lignes tant que l'API Storage n'a pas fini.
  if exists (select 1 from storage.objects
    where bucket_id in ('capture-originals', 'capture-stickers', 'items')
      and (storage.foldername(name))[1] = uid) then
    raise exception 'Account files must be removed via Storage API first';
  end if;

  -- Ce que la cascade ne prend pas.
  delete from public.guide_conversations where user_id = uid;
  delete from public.guide_usage where user_id = uid;
  delete from public.friendships where user_low = uid or user_high = uid;

  delete from public.notification_budget where user_id = uid;

  -- Le reste tombe par cascade depuis `profiles`.
  delete from public.profiles where user_id = uid;

  -- Le balayage. `user_id`, `observer_id`, `user_low`, `user_high` : les quatre
  -- noms sous lesquels un propriétaire apparaît dans ce schéma.
  for restant in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and c.column_name in ('user_id', 'observer_id', 'user_low', 'user_high')
  loop
    execute format(
      'select count(*) from public.%I where %I = $1',
      restant.table_name, restant.column_name
    ) into reste using uid;
    if reste > 0 then
      raise exception
        'Suppression incomplète : % ligne(s) restante(s) dans %.% — ajouter cette table à delete_my_account()',
        reste, restant.table_name, restant.column_name;
    end if;
  end loop;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
