-- UN SEUL MESSAGE DISCRÉTIONNAIRE PAR JOUR ET PAR JOUEUR.
--
-- LE DÉFAUT QUE ÇA RÉPARE
--
-- Chaque moteur est sobre pour lui-même : le chœur de l'aube n'envoie qu'à
-- l'aube, « après la pluie » qu'après une pluie, la fenêtre saisonnière qu'au
-- changement de fenêtre. Mais RIEN ne les coordonnait. Un matin de septembre
-- pluvieux où une espèce quitte la région, le même joueur recevait trois
-- messages avant huit heures.
--
-- Trois messages justes valent moins qu'un seul : le joueur ne les lit pas
-- comme trois informations, il les lit comme une app qui insiste. Et c'est le
-- moment où l'on coupe les notifications — un geste sans retour.
--
-- CE QUI EST COMPTÉ, ET CE QUI NE L'EST PAS
--
-- Seuls les messages DISCRÉTIONNAIRES : ceux que l'app choisit d'envoyer.
-- « Ta carte est prête » et la première mondiale n'y entrent pas — ils
-- répondent à une action du joueur, ne demandent rien, et se taire serait une
-- perte d'information, pas une politesse.
--
-- POURQUOI UNE TABLE PLUTÔT QU'UN TAG
--
-- Deux fonctions serveur doivent s'accorder sur le même compteur, dans la même
-- minute. Un tag OneSignal est écrit par l'app, lu de façon asynchrone, et
-- deux crons qui se croisent y liraient tous deux « rien envoyé ». Une ligne
-- avec une contrainte d'unicité tranche : la seconde insertion échoue, et le
-- second moteur se tait.

create table if not exists public.notification_budget (
  user_id text not null,
  sent_on date not null default (now() at time zone 'utc')::date,
  source text not null,
  created_at timestamptz not null default now(),
  -- LA CONTRAINTE EST LE MÉCANISME, PAS UNE PRÉCAUTION.
  -- C'est elle qui arbitre entre deux crons simultanés : le premier insère, le
  -- second reçoit une violation et renonce. Aucun verrou à poser, aucune course
  -- à gérer dans le code.
  primary key (user_id, sent_on)
);

alter table public.notification_budget enable row level security;

-- Aucune politique : seules les fonctions serveur y touchent, avec la clé de
-- service qui contourne RLS. Un client n'a aucune raison de lire ou d'écrire
-- ici, et RLS activé sans politique est le refus par défaut.

create index if not exists notification_budget_purge_idx
  on public.notification_budget (sent_on);

-- Les lignes d'hier ne servent plus à rien. On purge à l'insertion plutôt que
-- par un cron de plus : la table reste petite sans tâche à surveiller.
create or replace function public.reserver_notification(p_source text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
begin
  delete from public.notification_budget
   where sent_on < (now() at time zone 'utc')::date - 1;

  insert into public.notification_budget (user_id, source)
  values (current_setting('request.jwt.claim.sub', true), p_source)
  on conflict (user_id, sent_on) do nothing;

  get diagnostics ok = row_count;
  return ok;
end;
$$;

revoke all on function public.reserver_notification(text) from public, anon, authenticated;
