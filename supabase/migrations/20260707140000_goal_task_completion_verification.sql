-- Completion timestamps + admin verification for goals and tasks.

alter table public.user_annual_goals
  add column if not exists completed_at timestamptz,
  add column if not exists admin_verified_at timestamptz,
  add column if not exists admin_verified_by uuid references public.profiles(id) on delete set null;

alter table public.user_goal_tasks
  add column if not exists completed_at timestamptz,
  add column if not exists admin_verified_at timestamptz,
  add column if not exists admin_verified_by uuid references public.profiles(id) on delete set null;

update public.user_annual_goals
set completed_at = coalesce(completed_at, updated_at)
where status = 'completed' and completed_at is null;

update public.user_goal_tasks
set completed_at = coalesce(completed_at, updated_at)
where status = 'completed' and completed_at is null;
