-- Uses the existing Vault recap_secret / RECAP_SECRET pair. No public token.
create function private.safari_request_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
declare secret text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name='recap_secret' limit 1;
  if secret is not null then
    perform net.http_post(
      url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/safari-live',
      headers:=jsonb_build_object('Content-Type','application/json','x-recap-secret',secret),
      body:='{}'::jsonb, timeout_milliseconds:=5000);
  end if;
  return new;
exception when others then
  -- The outbox stays pending. An unavailable push transport must not lose a photo.
  raise warning 'Safari delivery deferred: %', sqlerrm;
  return new;
end $$;
revoke all on function private.safari_request_delivery() from public,anon,authenticated;
create trigger safari_deliver after insert or update of revision on public.safari_activity_outbox
  for each row execute function private.safari_request_delivery();

select cron.schedule('safari-live','* * * * *', $$
  select net.http_post(
    url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/safari-live',
    headers:=jsonb_build_object('Content-Type','application/json','x-recap-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='recap_secret')),
    body:='{}'::jsonb);
$$);
