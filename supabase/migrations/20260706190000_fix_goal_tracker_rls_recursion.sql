-- Fix infinite RLS recursion between user_annual_goals and user_goal_tasks.
-- Cross-table EXISTS in policies caused circular policy evaluation.

create or replace function public.jwt_goal_has_task_for_user(p_goal_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_goal_id is not null
    and p_user_id is not null
    and exists (
      select 1
      from public.user_goal_tasks t
      where t.goal_id = p_goal_id
        and (t.assignee_id = p_user_id or t.assigned_by = p_user_id)
    );
$$;

create or replace function public.jwt_user_owns_goal(p_goal_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_goal_id is not null
    and p_user_id is not null
    and exists (
      select 1
      from public.user_annual_goals g
      where g.id = p_goal_id
        and g.user_id = p_user_id
    );
$$;

create or replace function public.jwt_user_can_read_goal_task(p_task_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_task_id is not null
    and p_user_id is not null
    and exists (
      select 1
      from public.user_goal_tasks t
      where t.id = p_task_id
        and (
          t.assignee_id = p_user_id
          or t.assigned_by = p_user_id
        )
    );
$$;

drop policy if exists "annual goals select" on public.user_annual_goals;
create policy "annual goals select"
on public.user_annual_goals
for select
to authenticated
using (
  user_id = auth.uid()
  or public.jwt_user_is_admin()
  or public.jwt_goal_has_task_for_user(id)
);

drop policy if exists "goal tasks select" on public.user_goal_tasks;
create policy "goal tasks select"
on public.user_goal_tasks
for select
to authenticated
using (
  assignee_id = auth.uid()
  or assigned_by = auth.uid()
  or public.jwt_user_is_admin()
  or public.jwt_user_owns_goal(goal_id)
);

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
  )
);

drop policy if exists "goal remarks select" on public.user_goal_status_remarks;
create policy "goal remarks select"
on public.user_goal_status_remarks
for select
to authenticated
using (
  author_id = auth.uid()
  or public.jwt_user_is_admin()
  or public.jwt_user_owns_goal(goal_id)
  or public.jwt_user_can_read_goal_task(task_id)
);
