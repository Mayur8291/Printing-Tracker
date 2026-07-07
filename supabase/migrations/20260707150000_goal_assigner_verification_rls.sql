-- Assignee / goal owner verify completion (not admin).

alter table public.user_goal_task_notifications
  alter column task_id drop not null;

drop policy if exists "goal tasks assigner verify completion" on public.user_goal_tasks;
drop policy if exists "goal tasks assignee verify completion" on public.user_goal_tasks;
create policy "goal tasks assignee verify completion"
on public.user_goal_tasks
for update
to authenticated
using (
  assignee_id = auth.uid()
  and status = 'completed'
)
with check (assignee_id = auth.uid());

drop policy if exists "annual goals creator verify completion" on public.user_annual_goals;
drop policy if exists "annual goals owner verify completion" on public.user_annual_goals;
create policy "annual goals owner verify completion"
on public.user_annual_goals
for update
to authenticated
using (
  user_id = auth.uid()
  and status = 'completed'
)
with check (user_id = auth.uid());
