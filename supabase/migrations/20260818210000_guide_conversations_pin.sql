-- Épingler une discussion, et renommer sans la faire remonter.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LE PIÈGE, ET C'EST TOUT L'INTÉRÊT DE CE FICHIER
--
-- `guide_conversations` portait `public.set_updated_at()`, la fonction partagée
-- qui pose `now()` à CHAQUE écriture, sans regarder ce qui a changé. Avec un
-- historique trié par `updated_at desc`, renommer une discussion de la semaine
-- dernière la propulserait en tête — et l'épingler aussi.
--
-- On ne touche pas à la fonction partagée : d'autres tables en dépendent et
-- pour elles le comportement est juste. Cette table reçoit le sien, qui ne
-- déplace la discussion que si son CONTENU a bougé.

alter table public.guide_conversations
  add column if not exists pinned boolean not null default false;

create or replace function public.guide_conversations_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Renommer ou épingler, ce n'est pas écrire dans la discussion.
  if new.messages is not distinct from old.messages
     and new.previous_response_id is not distinct from old.previous_response_id then
    new.updated_at := old.updated_at;
    return new;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists guide_conversations_set_updated_at on public.guide_conversations;

create trigger guide_conversations_touch
before update on public.guide_conversations
for each row execute function public.guide_conversations_touch();

-- L'ordre de lecture est désormais « épinglées d'abord, puis les plus
-- récentes » : l'index le suit, sinon chaque ouverture du tiroir trie 50 lignes
-- en mémoire pour rien.
drop index if exists public.guide_conversations_owner_updated_idx;

create index if not exists guide_conversations_owner_pinned_updated_idx
  on public.guide_conversations (user_id, pinned desc, updated_at desc);
