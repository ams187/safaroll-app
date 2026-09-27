-- LES ENVOIS PLANIFIÉS : CHŒUR DE L'AUBE ET BILAN MENSUEL.
--
-- LE SECRET N'EST PAS ICI, ET C'EST LE POINT.
--
-- Une première version écrivait `x-recap-secret` en clair dans ce fichier.
-- Une migration part dans git : le secret aurait été lisible par quiconque a
-- accès au dépôt, et `{"force": true}` sur le chœur de l'aube arrose TOUS les
-- joueurs à n'importe quelle heure. Un secret dans un fichier versionné n'est
-- plus un secret, même dans un dépôt privé — il survit aux forks, aux clones,
-- aux sauvegardes et aux anciens collaborateurs.
--
-- Il vit donc dans **Supabase Vault**, chiffré au repos, posé une fois hors
-- migration :
--
--   select vault.create_secret('<valeur>', 'recap_secret', '…');
--
-- et relu ici à chaque exécution. Le rotationner ne demande plus de toucher au
-- code : on remplace la valeur dans Vault et dans les secrets de la fonction.
--
-- POURQUOI TOUTES LES QUINZE MINUTES POUR L'AUBE
--
-- L'aube n'a pas d'heure : elle dépend de la date ET de la position. Le même
-- joueur la vit trois heures plus tard en décembre qu'en juin. La fonction ne
-- regarde que ceux dont l'aube tombe dans les quinze prochaines minutes ; le
-- cron ne décide de rien, il donne l'occasion.
--
-- L'IDEMPOTENCE EST GÉOMÉTRIQUE : le créneau de la fonction vaut exactement
-- cette période, donc un joueur ne peut y tomber qu'une fois par jour. Rien à
-- mémoriser, et une exécution rejouée ne double personne.
-- `scripts/check-dawn-chorus.ts` vérifie que les deux valeurs ne divergent pas.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- Rejouable : on retire d'abord une éventuelle planification précédente.
select cron.unschedule('dawn-chorus') where exists (select 1 from cron.job where jobname = 'dawn-chorus');
select cron.unschedule('monthly-recap') where exists (select 1 from cron.job where jobname = 'monthly-recap');

select cron.schedule(
  'dawn-chorus',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/dawn-chorus',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-recap-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'recap_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Le bilan mensuel : le 1er à 10 h UTC. Un récapitulatif se lit le matin, et il
-- n'a aucune raison d'être à la minute près.
select cron.schedule(
  'monthly-recap',
  '0 10 1 * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/monthly-recap',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-recap-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'recap_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
