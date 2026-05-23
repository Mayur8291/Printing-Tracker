-- Team chat: all authenticated users can read/write messages; @users and #orders in body.

create table if not exists public.team_chat_messages (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  mentioned_user_ids uuid[] not null default '{}',
  mentioned_order_ids bigint[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint team_chat_body_len check (char_length(trim(body)) >= 1 and char_length(body) <= 4000)
);

create index if not exists team_chat_messages_created_at_idx
  on public.team_chat_messages (created_at desc);

alter table public.team_chat_messages enable row level security;

drop policy if exists "team chat read authenticated" on public.team_chat_messages;
create policy "team chat read authenticated"
on public.team_chat_messages
for select
to authenticated
using (true);

drop policy if exists "team chat insert own" on public.team_chat_messages;
create policy "team chat insert own"
on public.team_chat_messages
for insert
to authenticated
with check (author_id = auth.uid());

-- Let every logged-in user see names/emails for @ mentions (RLS OR with existing profile policies).
drop policy if exists "profiles select team directory" on public.profiles;
create policy "profiles select team directory"
on public.profiles
for select
to authenticated
using (auth.uid() is not null);

do $realtime$
begin
  alter publication supabase_realtime add table public.team_chat_messages;
exception
  when duplicate_object then null;
end;
$realtime$;
