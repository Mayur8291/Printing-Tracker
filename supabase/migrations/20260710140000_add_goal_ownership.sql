-- Goal ownership: top-level grouping above goal → tasks (e.g. department, area of responsibility).
-- Nullable for existing goals — users assign ownership in the UI after deploy.

alter table public.user_annual_goals
  add column if not exists ownership text;

comment on column public.user_annual_goals.ownership is
  'Ownership / area label grouping goals (e.g. Sales, Operations). Null = uncategorized until user assigns.';

alter table public.user_annual_goals
  drop constraint if exists user_annual_goals_ownership_len;

alter table public.user_annual_goals
  add constraint user_annual_goals_ownership_len
  check (
    ownership is null
    or (char_length(trim(ownership)) >= 1 and char_length(ownership) <= 200)
  );

create index if not exists user_annual_goals_user_year_ownership_idx
  on public.user_annual_goals (user_id, year, ownership);

-- Extend assign-task goal picker RPC (must drop first — return type adds ownership column).
drop function if exists public.get_goals_for_task_assignment(uuid, integer);

create function public.get_goals_for_task_assignment(p_assignee_id uuid, p_year integer)
returns table (
  id uuid,
  user_id uuid,
  year integer,
  title text,
  description text,
  ownership text,
  status text,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  completed_at timestamptz,
  admin_verified_at timestamptz,
  admin_verified_by uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.id,
    g.user_id,
    g.year,
    g.title,
    g.description,
    g.ownership,
    g.status,
    g.created_by,
    g.created_at,
    g.updated_at,
    g.completed_at,
    g.admin_verified_at,
    g.admin_verified_by
  from public.user_annual_goals g
  where g.user_id = p_assignee_id
    and g.year = p_year
    and auth.uid() is not null
    and exists (select 1 from public.profiles p where p.id = p_assignee_id)
  order by g.ownership nulls last, g.created_at asc;
$$;

grant execute on function public.get_goals_for_task_assignment(uuid, integer) to authenticated;
