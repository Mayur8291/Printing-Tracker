-- Team chat v2: direct messages, groups, conversation-scoped messages.
-- Legacy team wall messages migrate into a "General" group.

create table if not exists public.team_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  title text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint team_chat_group_title check (
    kind <> 'group' or (title is not null and char_length(trim(title)) >= 1 and char_length(title) <= 120)
  )
);

create index if not exists team_chat_conversations_last_message_idx
  on public.team_chat_conversations (last_message_at desc);

create table if not exists public.team_chat_conversation_members (
  conversation_id uuid not null references public.team_chat_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, user_id)
);

create index if not exists team_chat_conversation_members_user_idx
  on public.team_chat_conversation_members (user_id, conversation_id);

alter table public.team_chat_messages
  add column if not exists conversation_id uuid references public.team_chat_conversations(id) on delete cascade,
  add column if not exists gif_url text;

create index if not exists team_chat_messages_conversation_created_idx
  on public.team_chat_messages (conversation_id, created_at desc);

-- Migrate legacy messages into General group
do $migrate$
declare
  general_id uuid;
  creator_id uuid;
begin
  select id into creator_id
  from public.profiles
  where lower(role) = 'admin'
  order by created_at nulls last
  limit 1;

  if creator_id is null then
    select id into creator_id from public.profiles order by created_at nulls last limit 1;
  end if;

  if creator_id is null then
    return;
  end if;

  select id into general_id
  from public.team_chat_conversations
  where kind = 'group' and title = 'General'
  limit 1;

  if general_id is null then
    insert into public.team_chat_conversations (kind, title, created_by)
    values ('group', 'General', creator_id)
    returning id into general_id;
  end if;

  insert into public.team_chat_conversation_members (conversation_id, user_id, role)
  select general_id, p.id, case when p.id = creator_id then 'admin' else 'member' end
  from public.profiles p
  on conflict do nothing;

  update public.team_chat_messages
  set conversation_id = general_id
  where conversation_id is null;
end;
$migrate$;

alter table public.team_chat_conversations enable row level security;
alter table public.team_chat_conversation_members enable row level security;

create or replace function public.jwt_user_in_conversation(p_conversation_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_conversation_id is not null
    and p_user_id is not null
    and exists (
      select 1
      from public.team_chat_conversation_members m
      where m.conversation_id = p_conversation_id
        and m.user_id = p_user_id
    );
$$;

grant execute on function public.jwt_user_in_conversation(uuid, uuid) to authenticated;

drop policy if exists "team chat conversations select member" on public.team_chat_conversations;
create policy "team chat conversations select member"
on public.team_chat_conversations
for select
to authenticated
using (public.jwt_user_in_conversation(id));

drop policy if exists "team chat conversations insert" on public.team_chat_conversations;
create policy "team chat conversations insert"
on public.team_chat_conversations
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "team chat conversations update member" on public.team_chat_conversations;
create policy "team chat conversations update member"
on public.team_chat_conversations
for update
to authenticated
using (public.jwt_user_in_conversation(id))
with check (public.jwt_user_in_conversation(id));

drop policy if exists "team chat members select member" on public.team_chat_conversation_members;
create policy "team chat members select member"
on public.team_chat_conversation_members
for select
to authenticated
using (public.jwt_user_in_conversation(conversation_id));

drop policy if exists "team chat members insert" on public.team_chat_conversation_members;
create policy "team chat members insert"
on public.team_chat_conversation_members
for insert
to authenticated
with check (
  public.jwt_user_in_conversation(conversation_id)
  or exists (
    select 1 from public.team_chat_conversations c
    where c.id = conversation_id and c.created_by = auth.uid()
  )
);

drop policy if exists "team chat read authenticated" on public.team_chat_messages;
create policy "team chat messages select member"
on public.team_chat_messages
for select
to authenticated
using (
  conversation_id is not null
  and public.jwt_user_in_conversation(conversation_id)
);

drop policy if exists "team chat insert own" on public.team_chat_messages;
create policy "team chat messages insert member"
on public.team_chat_messages
for insert
to authenticated
with check (
  author_id = auth.uid()
  and conversation_id is not null
  and public.jwt_user_in_conversation(conversation_id)
);

-- Direct chat: get existing or create 1:1 conversation
create or replace function public.get_or_create_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv_id uuid;
begin
  if me is null or p_other_user_id is null or me = p_other_user_id then
    raise exception 'Invalid direct conversation users';
  end if;

  if not exists (select 1 from public.profiles where id = p_other_user_id) then
    raise exception 'User not found';
  end if;

  select c.id into conv_id
  from public.team_chat_conversations c
  where c.kind = 'direct'
    and exists (
      select 1 from public.team_chat_conversation_members m
      where m.conversation_id = c.id and m.user_id = me
    )
    and exists (
      select 1 from public.team_chat_conversation_members m
      where m.conversation_id = c.id and m.user_id = p_other_user_id
    )
    and 2 = (
      select count(*) from public.team_chat_conversation_members m
      where m.conversation_id = c.id
    )
  limit 1;

  if conv_id is not null then
    return conv_id;
  end if;

  insert into public.team_chat_conversations (kind, title, created_by)
  values ('direct', null, me)
  returning id into conv_id;

  insert into public.team_chat_conversation_members (conversation_id, user_id, role)
  values
    (conv_id, me, 'admin'),
    (conv_id, p_other_user_id, 'member');

  return conv_id;
end;
$$;

grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;

-- Create group with members (creator + selected users)
create or replace function public.create_group_conversation(p_title text, p_member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv_id uuid;
  member_id uuid;
  clean_title text := trim(p_title);
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;
  if clean_title is null or char_length(clean_title) < 1 then
    raise exception 'Group name is required';
  end if;

  insert into public.team_chat_conversations (kind, title, created_by)
  values ('group', clean_title, me)
  returning id into conv_id;

  insert into public.team_chat_conversation_members (conversation_id, user_id, role)
  values (conv_id, me, 'admin')
  on conflict do nothing;

  if p_member_ids is not null then
    foreach member_id in array p_member_ids loop
      if member_id is not null and member_id <> me then
        insert into public.team_chat_conversation_members (conversation_id, user_id, role)
        values (conv_id, member_id, 'member')
        on conflict do nothing;
      end if;
    end loop;
  end if;

  return conv_id;
end;
$$;

grant execute on function public.create_group_conversation(text, uuid[]) to authenticated;

-- Mark conversation read for current user
create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.jwt_user_in_conversation(p_conversation_id) then
    raise exception 'Not a member of this conversation';
  end if;

  update public.team_chat_conversation_members
  set last_read_at = now()
  where conversation_id = p_conversation_id
    and user_id = auth.uid();
end;
$$;

grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- Keep attachments for conversation messages; only purge legacy (no conversation_id)
create or replace function public.purge_expired_team_chat_attachments()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  purged_count integer := 0;
  rec record;
begin
  for rec in
    select id, attachment_path, body
    from public.team_chat_messages
    where conversation_id is null
      and nullif(trim(attachment_path), '') is not null
      and created_at <= (now() - interval '24 hours')
  loop
    delete from storage.objects
    where bucket_id = 'team-chat-files'
      and name = rec.attachment_path;

    if char_length(trim(coalesce(rec.body, ''))) < 1 and nullif(trim(coalesce(rec.gif_url, '')), '') is null then
      delete from public.team_chat_messages where id = rec.id;
    else
      update public.team_chat_messages
      set attachment_path = null, attachment_name = null, attachment_mime = null, attachment_size = null
      where id = rec.id;
    end if;

    purged_count := purged_count + 1;
  end loop;

  return purged_count;
end;
$$;

-- Relax body constraint: allow gif_url or attachment without body
alter table public.team_chat_messages drop constraint if exists team_chat_body_len;
alter table public.team_chat_messages add constraint team_chat_body_len check (
  char_length(body) <= 4000
  and (
    char_length(trim(body)) >= 1
    or nullif(trim(coalesce(attachment_path, '')), '') is not null
    or nullif(trim(coalesce(gif_url, '')), '') is not null
  )
);

do $realtime$
begin
  alter publication supabase_realtime add table public.team_chat_conversations;
exception when duplicate_object then null;
end;
$realtime$;

do $realtime$
begin
  alter publication supabase_realtime add table public.team_chat_conversation_members;
exception when duplicate_object then null;
end;
$realtime$;
