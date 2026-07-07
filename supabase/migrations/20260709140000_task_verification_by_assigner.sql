-- Task completion verified by assigner (who assigned the task), not assignee.

drop policy if exists "goal tasks assignee verify completion" on public.user_goal_tasks;
drop policy if exists "goal tasks assigner verify completion" on public.user_goal_tasks;
create policy "goal tasks assigner verify completion"
on public.user_goal_tasks
for update
to authenticated
using (
  assigned_by = auth.uid()
  and status = 'completed'
)
with check (assigned_by = auth.uid());
