-- L'abonnement Naturaliste, côté serveur.
--
-- POURQUOI CETTE COLONNE EXISTE
--
-- Jusqu'ici l'abonnement n'était qu'un booléen MMKV sur le téléphone
-- (`src/lib/naturalist.ts`). Ça suffisait tant qu'il ne débloquait que de
-- l'affichage. L'« Identification Pro » change la donne : elle déclenche un
-- appel à un modèle qui coûte plus cher, donc la décision doit être prise là
-- où le client ne peut pas mentir.
--
-- PERSONNE NE PEUT L'ÉCRIRE DEPUIS L'APP
--
-- Aucune policy d'écriture n'est ajoutée : la colonne n'est modifiable que par
-- `service_role`. C'est le webhook RevenueCat qui l'écrira quand il existera.
-- Un joueur qui pourrait se l'accorder rendrait le contrôle décoratif.
--
-- Pour tester avant RevenueCat, une ligne suffit :
--   update public.profiles set is_naturalist = true where user_id = '<clerk_sub>';

alter table public.profiles
  add column if not exists is_naturalist boolean not null default false;

comment on column public.profiles.is_naturalist is
  'Abonnement Naturaliste. Écrit uniquement par service_role (webhook RevenueCat).';

-- Le serveur lit l'abonnement de l'appelant. `security definer` parce que la
-- fonction est appelée depuis l'edge function avec le JWT du joueur, et que
-- RLS ne rend que sa propre ligne — ce qui suffit, mais la fonction rend un
-- booléen franc plutôt qu'un select à interpréter.
create or replace function public.is_naturalist()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_naturalist from public.profiles p where p.user_id = public.current_user_id()),
    false
  );
$$;

revoke execute on function public.is_naturalist() from public, anon;
grant execute on function public.is_naturalist() to authenticated;

-- Le recours a-t-il déjà été joué sur cette capture ?
--
-- Sans cette trace, une capture que le gros modèle laisse douteuse
-- reproposerait « Identification Pro » indéfiniment : on vendrait deux fois le
-- même recours, et le joueur tournerait en rond au lieu de corriger à la main
-- — ce qui, là, tranche pour de bon.
alter table public.animal_captures
  add column if not exists pro_identified_at timestamptz;

comment on column public.animal_captures.pro_identified_at is
  'Quand le recours « Identification Pro » a été joué. Non nul = déjà relancé.';
