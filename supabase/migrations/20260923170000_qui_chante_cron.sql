-- « QUI EST-CE ? » : le chant d'un oiseau de la région, joint au push.
--
-- Toutes les heures : la fonction ne retient que les joueurs pour qui il est
-- 18 h (fuseau transmis par l'app), au plus une fois tous les trois jours et
-- dans le budget d'un message discrétionnaire par jour. Même secret Vault que
-- l'aube et la pluie (voir 20260901160000_dawn_chorus_cron.sql).

select cron.unschedule('qui-chante') where exists (select 1 from cron.job where jobname = 'qui-chante');

select cron.schedule(
  'qui-chante',
  '30 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/qui-chante',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-recap-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'recap_secret')),
    body := '{}'::jsonb);
  $$
);
