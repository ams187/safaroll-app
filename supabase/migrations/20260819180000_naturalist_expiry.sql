-- L'abonnement, écrit par RevenueCat plutôt qu'à la main.
--
-- `is_naturalist` existait depuis le 8 août avec, en commentaire, la manière de
-- l'activer : `update public.profiles set is_naturalist = true where ...`. À la
-- main. Aucun code ne l'écrivait — donc un joueur qui payait recevait 403 sur
-- `guide-chat`, `guide-search` et `guide-title`. Il payait, et n'avait rien.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE DATE ET PAS SEULEMENT UN BOOLÉEN
--
-- Un webhook, ça se perd : RevenueCat réessaie, mais un `EXPIRATION` qui
-- n'arrive jamais laisserait un abonnement résilié actif POUR TOUJOURS. Le
-- booléen seul n'a aucun moyen de s'en apercevoir.
--
-- `naturalist_until` porte la date que RevenueCat nous donne à chaque
-- renouvellement. Le droit s'éteint tout seul à cette date, même si plus aucun
-- message n'arrive. Le webhook devient une optimisation — il avance la date —
-- au lieu d'être un maillon dont la perte se paie en accès gratuit à vie.
--
-- `null` = illimité. C'est le cas des octrois manuels : une invitation, un
-- compte de test, un geste commercial. Ceux-là n'expirent pas.

alter table public.profiles
  add column if not exists naturalist_until timestamptz;

comment on column public.profiles.naturalist_until is
  'Fin du droit SafaRoll+, telle que RevenueCat l''annonce. NULL = sans limite (octroi manuel).';

create or replace function public.is_naturalist()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.is_naturalist
        and (p.naturalist_until is null or p.naturalist_until > now())
      from public.profiles p
      where p.user_id = public.current_user_id()
    ),
    false
  );
$$;

revoke execute on function public.is_naturalist() from public, anon;
grant execute on function public.is_naturalist() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- LE TROU QUI ÉTAIT DÉJÀ LÀ
--
-- `profiles` porte `grant select, insert, update ... to authenticated` et une
-- policy qui ne vérifie QUE le propriétaire de la ligne. Autrement dit :
--
--   update profiles set is_naturalist = true where user_id = <le mien>;
--
-- passait. N'importe quel joueur pouvait s'offrir SafaRoll+ depuis le client,
-- avec la clé publique. Ça n'avait aucune conséquence tant que personne
-- n'écrivait la colonne — ça en a une le jour où elle vaut de l'argent.
--
-- Un déclencheur plutôt que des droits colonne par colonne : les droits
-- imposent d'énumérer TOUTES les autres colonnes, et la prochaine ajoutée
-- serait silencieusement interdite en écriture. Ici on nomme les deux colonnes
-- à protéger, et rien d'autre ne bouge.
--
-- Pas `security definer` : le déclencheur doit voir le rôle de l'APPELANT.
-- PostgREST fait `set local role authenticated` pour un client et
-- `service_role` pour la clé de service — c'est précisément la distinction
-- qu'on veut lire.

create or replace function public.profiles_guard_entitlement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_role <> 'service_role' then
    new.is_naturalist := old.is_naturalist;
    new.naturalist_until := old.naturalist_until;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_entitlement on public.profiles;

create trigger profiles_guard_entitlement
before update on public.profiles
for each row execute function public.profiles_guard_entitlement();
