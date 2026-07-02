-- Include avatar_path in team chat directory for shadcn avatars in chat UI.
-- Must DROP first: PostgreSQL cannot change RETURNS TABLE signature via CREATE OR REPLACE.

drop function if exists public.list_team_chat_directory();

create function public.list_team_chat_directory()
returns table (
  id uuid,
  full_name text,
  email text,
  department text,
  role text,
  avatar_path text
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
    p.role,
    p.avatar_path
  from public.profiles p
  where nullif(trim(p.full_name), '') is not null
     or nullif(trim(p.email), '') is not null
     or p.role = 'admin'
  order by lower(coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'user'));
$$;

revoke all on function public.list_team_chat_directory() from public;
grant execute on function public.list_team_chat_directory() to authenticated;
