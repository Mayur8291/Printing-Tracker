-- Task priority for assign workflow (P0 highest → P3 default).

alter table public.user_goal_tasks
  add column if not exists priority text not null default 'P3'
    check (priority in ('P0', 'P1', 'P2', 'P3'));

create index if not exists user_goal_tasks_assignee_priority_idx
  on public.user_goal_tasks (assignee_id, priority, deadline_date nulls last);
