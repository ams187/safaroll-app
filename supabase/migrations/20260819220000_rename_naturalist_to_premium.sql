-- « Naturaliste » désignait deux choses différentes, et c'était le problème.
--
-- Le jeu a des GRADES : le joueur monte de « Curieux » à « Naturaliste », c'est
-- une progression qui se mérite et qui ne s'achète pas (`naturalistTitle`).
-- L'abonnement portait le même mot. Deux sens pour un nom, dans une app où l'un
-- récompense et l'autre se vend.
--
-- L'abonnement devient `premium`. Le grade garde son nom, il était là avant.
--
-- ─────────────────────────────────────────────────────────────────────────
-- BASCULE COORDONNÉE
--
-- Quatre fonctions déployées lisent ces colonnes (`guide-chat`, `guide-search`,
-- `guide-title`, `revenuecat-webhook`). Elles sont redéployées dans la foulée :
-- entre cette migration et ce déploiement, le Guide rend 403. Quelques
-- secondes, sur une app qui n'est pas publiée.
--
-- `alter ... rename` plutôt qu'une nouvelle colonne : les données suivent, et
-- il ne reste pas une colonne morte que quelqu'un finira par relire.

alter table public.profiles rename column is_naturalist to is_premium;
alter table public.profiles rename column naturalist_until to premium_until;

comment on column public.profiles.is_premium is
  'Abonnement SafaRoll+ actif. Écrit UNIQUEMENT par le webhook RevenueCat (clé de service).';
comment on column public.profiles.premium_until is
  'Fin du droit SafaRoll+, telle que RevenueCat l''annonce. NULL = sans limite (octroi manuel).';

drop function if exists public.is_naturalist();

create or replace function public.is_premium()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select p.is_premium
        and (p.premium_until is null or p.premium_until > now())
      from public.profiles p
      where p.user_id = public.current_user_id()
    ),
    false
  );
$$;

revoke execute on function public.is_premium() from public, anon;
grant execute on function public.is_premium() to authenticated;

-- Le verrou suit le renommage : sans ça, un joueur pourrait de nouveau s'offrir
-- l'abonnement depuis le client. Les colonnes ont changé de nom, pas de rôle.
create or replace function public.profiles_guard_entitlement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_role <> 'service_role' then
    new.is_premium := old.is_premium;
    new.premium_until := old.premium_until;
  end if;
  return new;
end;
$$;
