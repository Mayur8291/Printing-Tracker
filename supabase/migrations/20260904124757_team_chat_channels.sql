-- Org-wide channels: admin creates and posts; every dashboard user can read, react, copy, forward.

alter table public.team_chat_conversations
  drop constraint if exists team_chat_conversations_kind_check;

alter table public.team_chat_conversations
  add constraint team_chat_conversations_kind_check
  check (kind in ('direct', 'group', 'channel'));

alter table public.team_chat_conversations
  drop constraint if exists team_chat_group_title;

alter table public.team_chat_conversations
  add constraint team_chat_named_title check (
    kind = 'direct'
    or (
      title is not null
      and char_length(trim(title)) >= 1
      and char_length(title) <= 120
    )
  );

create or replace function public.jwt_user_can_post_in_conversation(
  p_conversation_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.jwt_user_in_conversation(p_conversation_id, p_user_id)
    and (
      not exists (
        select 1
        from public.team_chat_conversations c
        where c.id = p_conversation_id
          and c.kind = 'channel'
      )
      or public.jwt_user_is_admin()
    );
$$;

revoke all on function public.jwt_user_can_post_in_conversation(uuid, uuid) from public;
grant execute on function public.jwt_user_can_post_in_conversation(uuid, uuid) to authenticated;

drop policy if exists "team chat messages insert member" on public.team_chat_messages;
create policy "team chat messages insert member"
on public.team_chat_messages
for insert
to authenticated
with check (
  author_id = auth.uid()
  and conversation_id is not null
  and public.jwt_user_can_post_in_conversation(conversation_id)
);

create or replace function public.create_channel_conversation(p_title text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv_id uuid;
  clean_title text := trim(p_title);
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;
  if not public.jwt_user_is_admin() then
    raise exception 'Only an admin can create a channel';
  end if;
  if clean_title is null or char_length(clean_title) < 1 then
    raise exception 'Channel name is required';
  end if;
  if char_length(clean_title) > 120 then
    raise exception 'Channel name is too long';
  end if;

  insert into public.team_chat_conversations (kind, title, created_by)
  values ('channel', clean_title, me)
  returning id into conv_id;

  insert into public.team_chat_conversation_members (conversation_id, user_id, role)
  select conv_id, p.id, case when p.id = me then 'admin' else 'member' end
  from public.profiles p
  on conflict do nothing;

  return conv_id;
end;
$$;

revoke all on function public.create_channel_conversation(text) from public;
grant execute on function public.create_channel_conversation(text) to authenticated;

create or replace function public.team_chat_add_profile_to_channels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.team_chat_conversation_members (conversation_id, user_id, role)
  select c.id, new.id, 'member'
  from public.team_chat_conversations c
  where c.kind = 'channel'
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists team_chat_profile_join_channels on public.profiles;
create trigger team_chat_profile_join_channels
after insert on public.profiles
for each row
execute function public.team_chat_add_profile_to_channels();

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
    and m.deleted_at is null
    and public.jwt_user_in_conversation(m.conversation_id, me)
    and (
      m.author_id = me
      or (
        public.jwt_user_is_admin()
        and exists (
          select 1
          from public.team_chat_conversations c
          where c.id = m.conversation_id
            and c.kind = 'channel'
        )
      )
    );

  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.toggle_team_chat_message_pin(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  next_pinned boolean := false;
  conv_kind text;
begin
  if me is null or p_id is null then
    raise exception 'Not signed in';
  end if;

  select c.kind
  into conv_kind
  from public.team_chat_messages m
  join public.team_chat_conversations c on c.id = m.conversation_id
  where m.id = p_id;

  if conv_kind = 'channel' and not public.jwt_user_is_admin() then
    raise exception 'Only an admin can pin a channel post';
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

notify pgrst, 'reload schema';
