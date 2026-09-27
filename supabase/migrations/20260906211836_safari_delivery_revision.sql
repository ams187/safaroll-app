-- A fresh state (especially end/leave) is not a retry of the previous state.
-- Version matches the migration applied through the project MCP.
create or replace function private.safari_enqueue() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.safari_activity_outbox(run_id,revision) values(new.id,new.revision)
    on conflict(run_id) do update set revision=excluded.revision,
      attempted_at=null,sent_at=null,error=null;
  return new;
end $$;
revoke all on function private.safari_enqueue() from public,anon,authenticated;
