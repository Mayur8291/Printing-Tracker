-- Fix task insert RLS: EXISTS on user_annual_goals was subject to goal SELECT RLS,
-- so assigners could not link tasks to assignee-owned goals even after dropdown fix.

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
    or public.jwt_user_owns_goal(goal_id, assignee_id)
  )
);
