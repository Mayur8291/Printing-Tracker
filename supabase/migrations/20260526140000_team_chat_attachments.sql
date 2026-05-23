-- Chat attachments in storage; message text in DB. Display names = profiles.full_name only.

alter table public.team_chat_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size bigint;

alter table public.team_chat_messages
  alter column body set default '';

update public.team_chat_messages m
set author_label = nullif(trim(p.full_name), '')
from public.profiles p
where m.author_id = p.id;

alter table public.team_chat_messages
  drop constraint if exists team_chat_body_len;

alter table public.team_chat_messages
  add constraint team_chat_body_len check (
    char_length(coalesce(body, '')) <= 4000
    and (
      char_length(trim(coalesce(body, ''))) >= 1
      or nullif(trim(attachment_path), '') is not null
    )
  );

create or replace function public.list_team_chat_directory()
returns table (
  id uuid,
  full_name text,
  email text,
  department text,
  role text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    p.email,
    p.department,
    p.role
  from public.profiles p
  where nullif(trim(p.full_name), '') is not null
     or p.role = 'admin'
  order by lower(coalesce(nullif(trim(p.full_name), ''), 'admin'));
$$;

insert into storage.buckets (id, name, public)
values ('team-chat-files', 'team-chat-files', true)
on conflict (id) do update set public = true;

drop policy if exists "team chat files read authenticated" on storage.objects;
create policy "team chat files read authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'team-chat-files');

drop policy if exists "team chat files upload own folder" on storage.objects;
create policy "team chat files upload own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'team-chat-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);
