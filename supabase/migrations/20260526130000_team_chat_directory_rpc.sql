-- Reliable team directory + sender label for chat (works for viewers under RLS).

alter table public.team_chat_messages
  add column if not exists author_label text;

update public.team_chat_messages m
set author_label = coalesce(
  nullif(trim(p.full_name), ''),
  nullif(trim(p.email), ''),
  'User'
)
from public.profiles p
where m.author_id = p.id
  and (m.author_label is null or trim(m.author_label) = '');

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
  order by lower(coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), ''));
$$;

revoke all on function public.list_team_chat_directory() from public;
grant execute on function public.list_team_chat_directory() to authenticated;
