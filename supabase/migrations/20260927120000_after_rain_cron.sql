-- APRÈS LA PLUIE : planification horaire de la fonction `after-rain`.
--
-- La fonction ne retient que les joueurs pour qui il est 8 h (fuseau transmis
-- par l'app) après une pluie réelle. Même secret Vault que l'aube et « Qui
-- est-ce ? » (voir 20260901160000_dawn_chorus_cron.sql).

select cron.unschedule('after-rain') where exists (select 1 from cron.job where jobname = 'after-rain');

select cron.schedule(
  'after-rain',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/after-rain',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-recap-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'recap_secret')),
    body := '{}'::jsonb);
  $$
);
