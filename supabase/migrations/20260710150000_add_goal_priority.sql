-- Goal priority (P0 / P1 / P2) — same scale as tasks.

alter table public.user_annual_goals
  add column if not exists priority text not null default 'P2'
  check (priority in ('P0', 'P1', 'P2'));

comment on column public.user_annual_goals.priority is
  'Goal priority: P0 top, P1 medium, P2 default.';

update public.user_annual_goals set priority = 'P2' where priority is null;

drop function if exists public.get_goals_for_task_assignment(uuid, integer);

create function public.get_goals_for_task_assignment(p_assignee_id uuid, p_year integer)
returns table (
  id uuid,
  user_id uuid,
  year integer,
  title text,
  description text,
  ownership text,
  priority text,
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
    g.priority,
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
  order by g.ownership nulls last, g.priority, g.created_at asc;
$$;

grant execute on function public.get_goals_for_task_assignment(uuid, integer) to authenticated;
