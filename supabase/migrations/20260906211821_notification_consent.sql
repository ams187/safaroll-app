-- No historical account is opted in. Email permission is independent of push.
-- Version matches the migration applied through the project MCP.
create table public.notification_consents (
  user_id text primary key default public.current_user_id() references public.profiles(user_id) on delete cascade,
  monthly_email boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.notification_consents enable row level security;
revoke all on public.notification_consents from anon, authenticated;
grant select, insert (user_id, monthly_email), update (user_id, monthly_email)
  on public.notification_consents to authenticated;
grant all on public.notification_consents to service_role;
create policy own_consent on public.notification_consents to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));
create function public.stamp_notification_consent() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.stamp_notification_consent() from public;
create trigger stamp_notification_consent before update on public.notification_consents
for each row execute function public.stamp_notification_consent();
