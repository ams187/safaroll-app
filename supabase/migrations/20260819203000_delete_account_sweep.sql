-- Les tables que la cascade ne touche pas — et la garantie qu'on n'en oubliera
-- pas une de plus.
--
-- La migration précédente a posé `on delete cascade` sur les neuf clés
-- étrangères qui pointaient vers `profiles`. Trois tables portent pourtant un
-- propriétaire SANS clé étrangère, donc sans cascade :
--
--   guide_conversations   l'historique complet des discussions avec le Guide —
--                         la donnée la plus personnelle de l'app
--   guide_usage           le compteur quotidien
--   friendships           `user_low` / `user_high`, deux colonnes, aucune FK
--
-- Elles seraient restées en base après une demande de suppression.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LE BALAYAGE, ET POURQUOI IL EXISTE
--
-- Ajouter trois `delete` règle aujourd'hui. Le problème est demain : la
-- prochaine table à porter un `user_id` sera écrite par quelqu'un qui ne lira
-- pas ce fichier, et « oublier une table » signifie ici garder des données
-- personnelles après avoir promis de les effacer. Silencieusement.
--
-- Alors la fonction VÉRIFIE son propre travail : après les suppressions, elle
-- parcourt le catalogue à la recherche d'une ligne qui appartiendrait encore au
-- compte, et lève si elle en trouve une. La suppression échoue bruyamment au
-- lieu de mentir — et comme tout est dans une transaction, rien n'est perdu à
-- moitié. Le jour où ça pète, le message nomme la table à ajouter.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  restant record;
  reste bigint;
begin
  if uid is null then
    raise exception 'Unauthorized';
  end if;

  -- Les fichiers AVANT la ligne : l'inverse laisserait des photos dans le
  -- stockage sans plus aucune trace pour les retrouver.
  delete from storage.objects
  where bucket_id in ('capture-originals', 'capture-stickers', 'items')
    and (storage.foldername(name))[1] = uid;

  -- Ce que la cascade ne prend pas.
  delete from public.guide_conversations where user_id = uid;
  delete from public.guide_usage where user_id = uid;
  delete from public.friendships where user_low = uid or user_high = uid;

  -- Le reste tombe par cascade depuis `profiles`.
  delete from public.profiles where user_id = uid;

  -- Le balayage. `user_id`, `observer_id`, `user_low`, `user_high` : les quatre
  -- noms sous lesquels un propriétaire apparaît dans ce schéma.
  for restant in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and c.column_name in ('user_id', 'observer_id', 'user_low', 'user_high')
  loop
    execute format(
      'select count(*) from public.%I where %I = $1',
      restant.table_name, restant.column_name
    ) into reste using uid;
    if reste > 0 then
      raise exception
        'Suppression incomplète : % ligne(s) restante(s) dans %.% — ajouter cette table à delete_my_account()',
        reste, restant.table_name, restant.column_name;
    end if;
  end loop;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
