-- Include viewers with email in team chat @-mention directory (even when full_name is empty).

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
     or nullif(trim(p.email), '') is not null
     or p.role = 'admin'
  order by lower(coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.email), ''), 'user'));
$$;
