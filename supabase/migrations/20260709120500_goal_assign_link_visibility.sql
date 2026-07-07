-- Allow task assigners to list an assignee's goals for "Link to goal" and link tasks to those goals.

create or replace function public.get_goals_for_task_assignment(p_assignee_id uuid, p_year integer)
returns table (
  id uuid,
  user_id uuid,
  year integer,
  title text,
  description text,
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
  order by g.created_at asc;
$$;

grant execute on function public.get_goals_for_task_assignment(uuid, integer) to authenticated;

drop policy if exists "goal tasks insert" on public.user_goal_tasks;
create policy "goal tasks insert"
on public.user_goal_tasks
for insert
to authenticated
with check (
  assigned_by = auth.uid()
  and (
    public.jwt_user_is_admin()
    or goal_id is null
    or public.jwt_user_owns_goal(goal_id)
    or exists (
      select 1
      from public.user_annual_goals g
      where g.id = goal_id
        and g.user_id = assignee_id
    )
  )
);
