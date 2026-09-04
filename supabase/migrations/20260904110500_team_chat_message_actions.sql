-- Staging: reply, react, soft-delete, forward metadata, pin for team chat messages.

alter table public.team_chat_messages
  add column if not exists reply_to_message_id bigint references public.team_chat_messages(id) on delete set null,
  add column if not exists forwarded_from_message_id bigint references public.team_chat_messages(id) on delete set null,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references public.profiles(id) on delete set null;

create index if not exists team_chat_messages_reply_to_idx
  on public.team_chat_messages (reply_to_message_id)
  where reply_to_message_id is not null;

create index if not exists team_chat_messages_pinned_idx
  on public.team_chat_messages (conversation_id, pinned_at)
  where pinned_at is not null and deleted_at is null;

create table if not exists public.team_chat_message_reactions (
  message_id bigint not null references public.team_chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id),
  constraint team_chat_reaction_emoji_len check (char_length(trim(emoji)) >= 1 and char_length(emoji) <= 16)
);

alter table public.team_chat_message_reactions enable row level security;

create or replace function public.jwt_user_can_react_to_message(p_message_id bigint, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_message_id is not null
    and p_user_id is not null
    and exists (
      select 1
      from public.team_chat_messages m
      where m.id = p_message_id
        and m.deleted_at is null
        and public.jwt_user_in_conversation(m.conversation_id, p_user_id)
    );
$$;

revoke all on function public.jwt_user_can_react_to_message(bigint, uuid) from public;
grant execute on function public.jwt_user_can_react_to_message(bigint, uuid) to authenticated;

drop policy if exists "team chat reactions select member" on public.team_chat_message_reactions;
create policy "team chat reactions select member"
on public.team_chat_message_reactions
for select
to authenticated
using (public.jwt_user_can_react_to_message(message_id));

drop policy if exists "team chat reactions insert own" on public.team_chat_message_reactions;
create policy "team chat reactions insert own"
on public.team_chat_message_reactions
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.jwt_user_can_react_to_message(message_id)
);

drop policy if exists "team chat reactions update own" on public.team_chat_message_reactions;
create policy "team chat reactions update own"
on public.team_chat_message_reactions
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and public.jwt_user_can_react_to_message(message_id));

drop policy if exists "team chat reactions delete own" on public.team_chat_message_reactions;
create policy "team chat reactions delete own"
on public.team_chat_message_reactions
for delete
to authenticated
using (user_id = auth.uid());

create or replace function public.soft_delete_team_chat_messages(p_ids bigint[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  n integer := 0;
begin
  if me is null or p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  update public.team_chat_messages m
  set
    deleted_at = now(),
    deleted_by = me
  from (
    select id
    from public.team_chat_messages
    where id = any(p_ids)
    for update
  ) locked
  where m.id = locked.id
    and m.author_id = me
    and m.deleted_at is null
    and public.jwt_user_in_conversation(m.conversation_id, me);

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.soft_delete_team_chat_messages(bigint[]) from public;
grant execute on function public.soft_delete_team_chat_messages(bigint[]) to authenticated;

create or replace function public.toggle_team_chat_message_pin(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  next_pinned boolean := false;
begin
  if me is null or p_id is null then
    raise exception 'Not signed in';
  end if;

  update public.team_chat_messages m
  set
    pinned_at = case when m.pinned_at is null then now() else null end,
    pinned_by = case when m.pinned_at is null then me else null end
  from (
    select id, pinned_at
    from public.team_chat_messages
    where id = p_id
    for update
  ) locked
  where m.id = locked.id
    and m.deleted_at is null
    and public.jwt_user_in_conversation(m.conversation_id, me)
  returning (m.pinned_at is not null) into next_pinned;

  if not found then
    raise exception 'Cannot pin this message';
  end if;

  return next_pinned;
end;
$$;

revoke all on function public.toggle_team_chat_message_pin(bigint) from public;
grant execute on function public.toggle_team_chat_message_pin(bigint) to authenticated;

create or replace function public.set_team_chat_message_reaction(p_id bigint, p_emoji text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := trim(coalesce(p_emoji, ''));
  current_emoji text;
begin
  if me is null or p_id is null or char_length(clean) < 1 then
    raise exception 'Invalid reaction';
  end if;

  if not public.jwt_user_can_react_to_message(p_id, me) then
    raise exception 'Cannot react to this message';
  end if;

  select r.emoji
  into current_emoji
  from public.team_chat_message_reactions r
  where r.message_id = p_id and r.user_id = me
  for update;

  if current_emoji is not null and current_emoji = clean then
    delete from public.team_chat_message_reactions
    where message_id = p_id and user_id = me;
    return null;
  end if;

  insert into public.team_chat_message_reactions (message_id, user_id, emoji)
  values (p_id, me, clean)
  on conflict (message_id, user_id) do update
    set emoji = excluded.emoji,
        created_at = now();

  return clean;
end;
$$;

revoke all on function public.set_team_chat_message_reaction(bigint, text) from public;
grant execute on function public.set_team_chat_message_reaction(bigint, text) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'team_chat_message_reactions'
  ) then
    alter publication supabase_realtime add table public.team_chat_message_reactions;
  end if;
end
$$;

notify pgrst, 'reload schema';
