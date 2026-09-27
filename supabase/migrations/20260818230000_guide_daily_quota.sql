-- Le plafond qui manquait sur le poste le plus cher de l'app.
--
-- Les captures sont comptées depuis le 12 août — 10/jour, 300/jour pour un
-- abonné. Le Guide, lui, n'était compté par rien. Or c'est lui qui coûte : une
-- capture paie une inférence sur un conteneur qu'on loue déjà, une question au
-- Guide paie un modèle de raisonnement au jeton, réflexion comprise, et une
-- image jointe est l'entrée la plus chère du lot.
--
-- POURQUOI ÇA AVAIT ÉTÉ OUBLIÉ. `guide-chat` n'est pas une fonction qui répond
-- à une requête : c'est un relais WebSocket. Il vérifie l'abonnement UNE FOIS,
-- au décrochage, puis transmet tout ce qui passe sans le lire. Les vérifications
-- « une par requête » qui protègent le reste de l'app n'y avaient donc aucun
-- point d'accroche. Le relais compte désormais lui-même, message par message.
--
-- 50 PAR JOUR. Une vraie session de curiosité en fait dix ou quinze. Cinquante,
-- personne ne les voit passer — c'est un plafond contre la boucle, pas contre
-- le joueur. Les réponses de l'atlas (`function_call_output`) ne comptent pas :
-- elles sont provoquées par le modèle, pas par le joueur, et les compter
-- diviserait le plafond réel par deux sans que personne comprenne pourquoi.

create table if not exists public.guide_usage (
  user_id text not null default public.current_user_id(),
  day date not null default (now() at time zone 'utc')::date,
  messages integer not null default 0,
  primary key (user_id, day)
);

alter table public.guide_usage enable row level security;

-- Aucune policy, volontairement : la table n'est ni lue ni écrite par un
-- client. Tout passe par la fonction ci-dessous, qui est `security definer` —
-- un compteur qu'on peut remettre à zéro soi-même ne compte rien.

create or replace function public.consume_guide_message()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  plafond constant integer := 50;
  total integer;
begin
  if uid is null then
    return false;
  end if;

  -- Incrément et lecture en une seule instruction : deux appels concurrents ne
  -- peuvent pas lire la même valeur avant de l'écrire.
  insert into public.guide_usage as u (user_id, day, messages)
  values (uid, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set messages = u.messages + 1
  returning u.messages into total;

  return total <= plafond;
end;
$$;

revoke all on function public.consume_guide_message() from public;
grant execute on function public.consume_guide_message() to authenticated;
