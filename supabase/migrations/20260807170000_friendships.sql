-- Les amis, et pourquoi ils comptent plus que le classement mondial.
--
-- Être 3 128ᵉ sur la Terre ne veut rien dire et ne motive personne. Être 2ᵉ sur
-- cinq amis, si. Le classement global donne l'échelle ; les amis donnent
-- l'enjeu. Les six mesures du Registre gagnent donc un filtre « Amis » — la
-- fonction est déjà écrite pour ça, il ne lui manquait que la liste.
--
-- UNE SEULE LIGNE PAR PAIRE
--
-- Pas deux lignes symétriques à tenir d'accord : une amitié est UN fait entre
-- deux personnes. La contrainte ordonne les deux identifiants, donc (A,B) et
-- (B,A) sont la même ligne et le doublon est impossible par construction —
-- pas par vigilance applicative.
--
-- `requested_by` garde qui a demandé, ce que l'ordre alphabétique perd. Sans
-- lui, on ne saurait plus à qui montrer « accepter » et à qui montrer « en
-- attente ».

create table public.friendships (
  -- Toujours le plus petit des deux identifiants. Le trigger l'impose.
  user_low text not null,
  user_high text not null,
  requested_by text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (user_low, user_high),
  constraint friendship_is_ordered check (user_low < user_high),
  constraint friendship_requester_is_a_party check (requested_by in (user_low, user_high))
);

create index friendships_high_idx on public.friendships (user_high);

alter table public.friendships enable row level security;

-- On ne voit que les amitiés dont on fait partie. Une demande adressée à
-- quelqu'un d'autre n'est lisible par personne.
create policy friendships_are_mine on public.friendships
  for select using (public.current_user_id() in (user_low, user_high));

/**
 * Demander en ami. Idempotent : redemander ne crée rien.
 *
 * Si l'autre avait déjà demandé, la demande se transforme en acceptation —
 * deux personnes qui s'invitent mutuellement sont manifestement d'accord, et
 * leur faire cliquer une fois de plus n'apporte rien.
 */
create or replace function public.request_friend(target_user_id text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  lo text := least(uid, target_user_id);
  hi text := greatest(uid, target_user_id);
  existing public.friendships%rowtype;
begin
  if uid is null or uid = target_user_id then raise exception 'Invalid target'; end if;
  -- Un joueur retiré de la communauté n'est pas invitable : son profil est
  -- illisible, l'inviter n'aurait aucun effet visible.
  if not exists (
    select 1 from public.profiles
    where user_id = target_user_id and community_visible
  ) then raise exception 'Player unavailable'; end if;

  select * into existing from public.friendships where user_low = lo and user_high = hi;
  if found then
    if existing.status = 'accepted' then return 'accepted'; end if;
    -- L'autre avait demandé le premier : on scelle.
    if existing.requested_by <> uid then
      update public.friendships set status = 'accepted', responded_at = now()
      where user_low = lo and user_high = hi;
      return 'accepted';
    end if;
    return 'pending';
  end if;

  insert into public.friendships (user_low, user_high, requested_by)
  values (lo, hi, uid);
  return 'pending';
end;
$$;

/** Accepter, ou retirer — refus et rupture sont le même geste : la ligne part. */
create or replace function public.respond_friend(target_user_id text, accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  lo text := least(uid, target_user_id);
  hi text := greatest(uid, target_user_id);
begin
  if uid is null then raise exception 'Unauthorized'; end if;
  if not accept then
    delete from public.friendships where user_low = lo and user_high = hi;
    return 'none';
  end if;
  -- On n'accepte QUE ce qu'on n'a pas demandé soi-même : sinon n'importe qui
  -- s'auto-ajouterait à la liste d'amis d'un autre.
  update public.friendships set status = 'accepted', responded_at = now()
  where user_low = lo and user_high = hi and status = 'pending' and requested_by <> uid;
  if not found then raise exception 'No pending request'; end if;
  return 'accepted';
end;
$$;

/**
 * Mes amis et mes demandes, en une seule liste.
 *
 * `direction` dit quoi afficher : 'in' attend ma réponse, 'out' attend la
 * sienne, 'friend' est scellé. Un écran qui devrait recouper deux requêtes pour
 * savoir quel bouton dessiner finirait par se tromper.
 */
create or replace function public.list_friends()
returns table (
  user_id text,
  display_name text,
  avatar_url text,
  status text,
  direction text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when f.user_low = public.current_user_id() then f.user_high else f.user_low end,
    p.display_name,
    p.avatar_url,
    f.status,
    case
      when f.status = 'accepted' then 'friend'
      when f.requested_by = public.current_user_id() then 'out'
      else 'in'
    end
  from public.friendships f
  join public.profiles p
    on p.user_id = case when f.user_low = public.current_user_id() then f.user_high else f.user_low end
  where public.current_user_id() in (f.user_low, f.user_high)
    and p.community_visible
  order by f.status, p.display_name;
$$;

revoke execute on function public.request_friend(text) from public, anon;
revoke execute on function public.respond_friend(text, boolean) from public, anon;
revoke execute on function public.list_friends() from public, anon;
grant execute on function public.request_friend(text) to authenticated;
grant execute on function public.respond_friend(text, boolean) to authenticated;
grant execute on function public.list_friends() to authenticated;
