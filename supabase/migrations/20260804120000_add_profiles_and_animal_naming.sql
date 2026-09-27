create table public.profiles (
  user_id text primary key default public.current_user_id(),
  display_name text not null check (char_length(display_name) between 1 and 40),
  username text check (username is null or char_length(username) between 2 and 32),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 2048),
  bio text not null default '' check (char_length(bio) <= 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_username_key
  on public.profiles (lower(username))
  where username is not null;

alter table public.profiles enable row level security;

create policy "authenticated users read profiles"
  on public.profiles for select to authenticated using (true);
create policy "users create own profile"
  on public.profiles for insert to authenticated
  with check (user_id = (select public.current_user_id()));
create policy "users update own profile"
  on public.profiles for update to authenticated
  using (user_id = (select public.current_user_id()))
  with check (user_id = (select public.current_user_id()));

revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Preserve every existing owner before user-owned rows receive profile FKs.
with users as (
  select user_id from public.expeditions
  union select user_id from public.bird_captures
  union select user_id from public.identification_reports
  union select user_id from public.bird_decks
  union select user_id from public.bird_deck_cards
  union select user_id from public.bird_deck_likes
  union select user_id from public.items
  union select user_id from public.spaces
  union select user_id from public.space_items
), names as (
  select user_id, max(author_name) as display_name
  from public.bird_decks
  group by user_id
)
insert into public.profiles (user_id, display_name)
select users.user_id, left(coalesce(nullif(names.display_name, ''), 'Explorer'), 40)
from users
left join names using (user_id)
where users.user_id is not null;

alter table public.expeditions
  add constraint expeditions_user_id_fkey foreign key (user_id) references public.profiles(user_id);
alter table public.bird_captures
  add constraint bird_captures_user_id_fkey foreign key (user_id) references public.profiles(user_id);
alter table public.identification_reports
  add constraint identification_reports_user_id_fkey foreign key (user_id) references public.profiles(user_id);
alter table public.bird_decks
  add constraint bird_decks_user_id_fkey foreign key (user_id) references public.profiles(user_id);
alter table public.bird_deck_cards
  add constraint bird_deck_cards_user_id_fkey foreign key (user_id) references public.profiles(user_id);
alter table public.bird_deck_likes
  add constraint bird_deck_likes_user_id_fkey foreign key (user_id) references public.profiles(user_id);
alter table public.items
  add constraint items_user_id_fkey foreign key (user_id) references public.profiles(user_id);
alter table public.spaces
  add constraint spaces_user_id_fkey foreign key (user_id) references public.profiles(user_id);
alter table public.space_items
  add constraint space_items_user_id_fkey foreign key (user_id) references public.profiles(user_id);

create index bird_deck_cards_user_idx on public.bird_deck_cards (user_id);

alter table public.bird_captures rename to animal_captures;
alter table public.bird_decks rename to decks;
alter table public.bird_deck_cards rename to deck_cards;
alter table public.bird_deck_likes rename to deck_likes;

-- PostgreSQL keeps old constraint/index names when a table is renamed. Rename
-- them too so introspection, logs and future migrations use SafaRoll's domain.
do $$
declare
  entry record;
  renamed text;
begin
  for entry in
    select conrelid, conname
    from pg_constraint
    where connamespace = 'public'::regnamespace and conname like 'bird\_%' escape '\'
  loop
    renamed := replace(replace(replace(replace(
      entry.conname,
      'bird_deck_cards', 'deck_cards'),
      'bird_deck_likes', 'deck_likes'),
      'bird_decks', 'decks'),
      'bird_captures', 'animal_captures');
    execute format('alter table %s rename constraint %I to %I', entry.conrelid::regclass, entry.conname, renamed);
  end loop;

  for entry in
    select c.oid, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'i' and c.relname like 'bird\_%' escape '\'
  loop
    renamed := replace(replace(replace(replace(
      entry.relname,
      'bird_deck_cards', 'deck_cards'),
      'bird_deck_likes', 'deck_likes'),
      'bird_decks', 'decks'),
      'bird_captures', 'animal_captures');
    execute format('alter index %s rename to %I', entry.oid::regclass, renamed);
  end loop;
end;
$$;

-- PL/pgSQL bodies are stored as source text, so table renames do not rewrite
-- them automatically. Recreate every affected function with the new names.
do $$
declare
  entry record;
  definition text;
begin
  for entry in
    select p.oid, pg_get_functiondef(p.oid) as definition
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and pg_get_functiondef(p.oid) ilike '%bird\_%' escape '\'
  loop
    definition := replace(replace(replace(replace(replace(
      entry.definition,
      'public.bird_deck_cards', 'public.deck_cards'),
      'public.bird_deck_likes', 'public.deck_likes'),
      'public.bird_decks', 'public.decks'),
      'public.bird_captures', 'public.animal_captures'),
      'bird_deck_cards_deck_id_position_key', 'deck_cards_deck_id_position_key');
    execute definition;
  end loop;
end;
$$;

create or replace function public.ensure_default_decks(author_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := public.current_user_id();
  deck_count integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select count(*) into deck_count from public.decks where user_id = uid;
  if deck_count > 5 then raise exception 'Deck limit exceeded'; end if;
  for i in deck_count + 1..5 loop
    insert into public.decks (user_id, name) values (uid, 'Deck ' || i);
  end loop;
end;
$$;

alter table public.decks drop column author_name;

alter publication supabase_realtime add table public.profiles;
notify pgrst, 'reload schema';
