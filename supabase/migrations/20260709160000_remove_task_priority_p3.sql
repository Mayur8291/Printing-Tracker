-- Remove P3; P2 is lowest priority and default.

update public.user_goal_tasks set priority = 'P2' where priority = 'P3';

alter table public.user_goal_tasks drop constraint if exists user_goal_tasks_priority_check;

alter table public.user_goal_tasks
  alter column priority set default 'P2';

alter table public.user_goal_tasks
  add constraint user_goal_tasks_priority_check
    check (priority in ('P0', 'P1', 'P2'));
