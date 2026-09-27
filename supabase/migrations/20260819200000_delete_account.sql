-- Supprimer son compte, depuis l'app.
--
-- Directive Apple 5.1.1(v) : une app qui permet de créer un compte doit
-- permettre de le supprimer, sans passer par un site ni par un e-mail. C'est un
-- refus garanti à la revue, et c'était le dernier de la liste.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POURQUOI ON RÉPARE LES CLÉS ÉTRANGÈRES D'ABORD
--
-- Neuf tables référencent `profiles(user_id)` SANS `on delete cascade`. Un
-- `delete from profiles` échouait donc sur la première d'entre elles.
--
-- On pourrait énumérer les suppressions à la main dans le bon ordre. Ce serait
-- juste aujourd'hui et faux dans six mois : la prochaine table ajoutée serait
-- oubliée, et « oublier une table » veut dire ici GARDER DES DONNÉES
-- PERSONNELLES APRÈS UNE DEMANDE DE SUPPRESSION. On laisse donc Postgres tenir
-- la liste : il connaît les dépendances et leur ordre mieux que nous.
--
-- La boucle ci-dessous reconstruit chaque contrainte à l'identique — mêmes
-- colonnes, même table cible — avec la cascade en plus.

do $$
declare
  c record;
  colonnes text;
  cibles text;
begin
  for c in
    select con.oid, con.conname, con.conrelid::regclass::text as source,
           con.confrelid::regclass::text as cible, con.confupdtype
    from pg_constraint con
    where con.confrelid = 'public.profiles'::regclass
      and con.contype = 'f'
      and con.confdeltype <> 'c'
  loop
    select string_agg(quote_ident(a.attname), ', ' order by k.ord)
      into colonnes
      from pg_constraint con2
      cross join lateral unnest(con2.conkey) with ordinality k(attnum, ord)
      join pg_attribute a on a.attrelid = con2.conrelid and a.attnum = k.attnum
     where con2.oid = c.oid;

    select string_agg(quote_ident(a.attname), ', ' order by k.ord)
      into cibles
      from pg_constraint con2
      cross join lateral unnest(con2.confkey) with ordinality k(attnum, ord)
      join pg_attribute a on a.attrelid = con2.confrelid and a.attnum = k.attnum
     where con2.oid = c.oid;

    execute format('alter table %s drop constraint %I', c.source, c.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%s) references %s (%s) on update %s on delete cascade',
      c.source, c.conname, colonnes, c.cible, cibles,
      case c.confupdtype when 'c' then 'cascade' when 'n' then 'set null' else 'no action' end
    );
    raise notice 'cascade posée sur %.%', c.source, c.conname;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- LA SUPPRESSION ELLE-MÊME
--
-- `security definer` parce qu'elle touche `storage.objects`, que le joueur ne
-- peut pas vider lui-même. Elle ne prend AUCUN paramètre : l'identité vient du
-- jeton, jamais de l'appelant. Un argument `p_user_id` serait une porte pour
-- supprimer le compte de quelqu'un d'autre.
--
-- Les fichiers PARTENT AVANT la ligne. L'inverse laisserait des photos dans le
-- stockage sans plus aucune trace pour les retrouver : de la donnée personnelle
-- orpheline, exactement ce qu'on vient de promettre d'effacer.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
begin
  if uid is null then
    raise exception 'Unauthorized';
  end if;

  delete from storage.objects
  where bucket_id in ('capture-originals', 'capture-stickers', 'items')
    and (storage.foldername(name))[1] = uid;

  -- Tout le reste tombe par cascade.
  delete from public.profiles where user_id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
