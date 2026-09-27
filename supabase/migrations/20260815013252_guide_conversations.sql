create table public.guide_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default public.current_user_id(),
  title text not null default 'Nouvelle discussion' check (char_length(title) between 1 and 120),
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  previous_response_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index guide_conversations_owner_updated_idx
  on public.guide_conversations (user_id, updated_at desc);

alter table public.guide_conversations enable row level security;

create policy "owners read guide conversations"
on public.guide_conversations for select to authenticated
using (user_id = (select public.current_user_id()));

create policy "owners create guide conversations"
on public.guide_conversations for insert to authenticated
with check (user_id = (select public.current_user_id()));

create policy "owners update guide conversations"
on public.guide_conversations for update to authenticated
using (user_id = (select public.current_user_id()))
with check (user_id = (select public.current_user_id()));

create policy "owners delete guide conversations"
on public.guide_conversations for delete to authenticated
using (user_id = (select public.current_user_id()));

create trigger guide_conversations_set_updated_at
before update on public.guide_conversations
for each row execute function public.set_updated_at();
