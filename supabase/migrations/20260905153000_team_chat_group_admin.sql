-- Group creator is already admin. These RPCs let group admins add people,
-- promote admins, remove members, and set the group photo.

alter table public.team_chat_conversations
  add column if not exists avatar_path text;

create or replace function public.jwt_user_is_group_admin(
  p_conversation_id uuid,
  p_user_id uuid default auth.uid()
)
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
      from public.team_chat_conversations c
      join public.team_chat_conversation_members m
        on m.conversation_id = c.id
       and m.user_id = p_user_id
      where c.id = p_conversation_id
        and c.kind = 'group'
        and m.role = 'admin'
    );
$$;

grant execute on function public.jwt_user_is_group_admin(uuid, uuid) to authenticated;

create or replace function public.team_chat_conversations_avatar_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.avatar_path is distinct from new.avatar_path
    and not public.jwt_user_is_group_admin(new.id)
  then
    raise exception 'Only group admins can change the group photo';
  end if;
  return new;
end;
$$;

drop trigger if exists team_chat_conversations_avatar_guard on public.team_chat_conversations;
create trigger team_chat_conversations_avatar_guard
before update on public.team_chat_conversations
for each row
execute function public.team_chat_conversations_avatar_guard();

create or replace function public.add_group_conversation_members(
  p_conversation_id uuid,
  p_member_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  member_id uuid;
  added integer := 0;
begin
  if not public.jwt_user_is_group_admin(p_conversation_id) then
    raise exception 'Only group admins can add people';
  end if;

  if p_member_ids is null then
    return 0;
  end if;

  foreach member_id in array p_member_ids loop
    if member_id is null or member_id = auth.uid() then
      continue;
    end if;
    if not exists (select 1 from public.profiles where id = member_id) then
      continue;
    end if;

    insert into public.team_chat_conversation_members (conversation_id, user_id, role)
    values (p_conversation_id, member_id, 'member')
    on conflict do nothing;

    if found then
      added := added + 1;
    end if;
  end loop;

  return added;
end;
$$;

grant execute on function public.add_group_conversation_members(uuid, uuid[]) to authenticated;

create or replace function public.remove_group_conversation_member(
  p_conversation_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
  admin_count integer;
begin
  if not public.jwt_user_is_group_admin(p_conversation_id) then
    raise exception 'Only group admins can remove people';
  end if;
  if p_user_id is null then
    raise exception 'Person required';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Admins cannot remove themselves';
  end if;

  select m.role into target_role
  from public.team_chat_conversation_members m
  where m.conversation_id = p_conversation_id
    and m.user_id = p_user_id;

  if target_role is null then
    raise exception 'Person is not in this group';
  end if;

  if target_role = 'admin' then
    select count(*) into admin_count
    from public.team_chat_conversation_members m
    where m.conversation_id = p_conversation_id
      and m.role = 'admin';
    if admin_count <= 1 then
      raise exception 'Cannot remove the last group admin';
    end if;
  end if;

  delete from public.team_chat_conversation_members
  where conversation_id = p_conversation_id
    and user_id = p_user_id;
end;
$$;

grant execute on function public.remove_group_conversation_member(uuid, uuid) to authenticated;

create or replace function public.set_group_conversation_member_role(
  p_conversation_id uuid,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.jwt_user_is_group_admin(p_conversation_id) then
    raise exception 'Only group admins can change roles';
  end if;
  if p_role is distinct from 'admin' then
    raise exception 'Group admins can only make people admins';
  end if;
  if p_user_id is null then
    raise exception 'Person required';
  end if;
  if not exists (
    select 1
    from public.team_chat_conversation_members m
    where m.conversation_id = p_conversation_id
      and m.user_id = p_user_id
  ) then
    raise exception 'Person is not in this group';
  end if;

  update public.team_chat_conversation_members
  set role = 'admin'
  where conversation_id = p_conversation_id
    and user_id = p_user_id;
end;
$$;

grant execute on function public.set_group_conversation_member_role(uuid, uuid, text) to authenticated;

create or replace function public.set_group_conversation_avatar(
  p_conversation_id uuid,
  p_avatar_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.jwt_user_is_group_admin(p_conversation_id) then
    raise exception 'Only group admins can change the group photo';
  end if;
  if p_avatar_path is null or char_length(trim(p_avatar_path)) < 1 then
    raise exception 'Photo path required';
  end if;

  update public.team_chat_conversations
  set avatar_path = trim(p_avatar_path)
  where id = p_conversation_id
    and kind = 'group';

  if not found then
    raise exception 'Group not found';
  end if;
end;
$$;

grant execute on function public.set_group_conversation_avatar(uuid, text) to authenticated;

insert into storage.buckets (id, name, public)
values ('team-chat-group-avatars', 'team-chat-group-avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "group avatars read authenticated" on storage.objects;
create policy "group avatars read authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'team-chat-group-avatars');

drop policy if exists "group avatars insert admin" on storage.objects;
create policy "group avatars insert admin"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'team-chat-group-avatars'
  and public.jwt_user_is_group_admin(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "group avatars update admin" on storage.objects;
create policy "group avatars update admin"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'team-chat-group-avatars'
  and public.jwt_user_is_group_admin(((storage.foldername(name))[1])::uuid)
)
with check (
  bucket_id = 'team-chat-group-avatars'
  and public.jwt_user_is_group_admin(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "group avatars delete admin" on storage.objects;
create policy "group avatars delete admin"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'team-chat-group-avatars'
  and public.jwt_user_is_group_admin(((storage.foldername(name))[1])::uuid)
);
