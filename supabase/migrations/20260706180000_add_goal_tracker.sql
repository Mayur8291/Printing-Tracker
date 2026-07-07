-- Annual goals, assignable tasks, and timestamped status remarks.

create table if not exists public.user_annual_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  year integer not null check (year >= 2000 and year <= 2100),
  title text not null,
  description text,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed', 'on_hold')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_annual_goals_title_len check (char_length(trim(title)) >= 1 and char_length(title) <= 500)
);

create index if not exists user_annual_goals_user_year_idx
  on public.user_annual_goals (user_id, year desc);

create table if not exists public.user_goal_tasks (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid references public.user_annual_goals(id) on delete cascade,
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  description text,
  deadline_date date,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_goal_tasks_title_len check (char_length(trim(title)) >= 1 and char_length(title) <= 500)
);

create index if not exists user_goal_tasks_assignee_idx
  on public.user_goal_tasks (assignee_id, deadline_date nulls last);

create index if not exists user_goal_tasks_goal_idx
  on public.user_goal_tasks (goal_id);

create table if not exists public.user_goal_status_remarks (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid references public.user_annual_goals(id) on delete cascade,
  task_id uuid references public.user_goal_tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  previous_status text,
  new_status text not null,
  remark text not null,
  created_at timestamptz not null default now(),
  constraint user_goal_status_remarks_entity check (goal_id is not null or task_id is not null),
  constraint user_goal_status_remarks_remark_len check (char_length(trim(remark)) >= 1 and char_length(remark) <= 4000)
);

create index if not exists user_goal_status_remarks_goal_idx
  on public.user_goal_status_remarks (goal_id, created_at desc);

create index if not exists user_goal_status_remarks_task_idx
  on public.user_goal_status_remarks (task_id, created_at desc);

alter table public.user_annual_goals enable row level security;
alter table public.user_goal_tasks enable row level security;
alter table public.user_goal_status_remarks enable row level security;

-- Security definer helpers avoid RLS recursion between goals ↔ tasks policies.
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

-- Goals: owner + admin read; admin write.
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

drop policy if exists "annual goals admin insert" on public.user_annual_goals;
create policy "annual goals admin insert"
on public.user_annual_goals
for insert
to authenticated
with check (public.jwt_user_is_admin() and created_by = auth.uid());

drop policy if exists "annual goals owner insert" on public.user_annual_goals;
create policy "annual goals owner insert"
on public.user_annual_goals
for insert
to authenticated
with check (
  user_id = auth.uid()
  and created_by = auth.uid()
);

drop policy if exists "annual goals admin update" on public.user_annual_goals;
create policy "annual goals admin update"
on public.user_annual_goals
for update
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

drop policy if exists "annual goals admin delete" on public.user_annual_goals;
create policy "annual goals admin delete"
on public.user_annual_goals
for delete
to authenticated
using (public.jwt_user_is_admin());

drop policy if exists "annual goals owner status update" on public.user_annual_goals;
create policy "annual goals owner status update"
on public.user_annual_goals
for update
to authenticated
using (user_id = auth.uid() and not public.jwt_user_is_admin())
with check (user_id = auth.uid() and not public.jwt_user_is_admin());

-- Tasks: assignee, assigner, goal owner, admin.
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

drop policy if exists "goal tasks admin update" on public.user_goal_tasks;
create policy "goal tasks admin update"
on public.user_goal_tasks
for update
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

drop policy if exists "goal tasks admin delete" on public.user_goal_tasks;
create policy "goal tasks admin delete"
on public.user_goal_tasks
for delete
to authenticated
using (public.jwt_user_is_admin());

drop policy if exists "goal tasks assignee status update" on public.user_goal_tasks;
create policy "goal tasks assignee status update"
on public.user_goal_tasks
for update
to authenticated
using (assignee_id = auth.uid() and not public.jwt_user_is_admin())
with check (assignee_id = auth.uid() and not public.jwt_user_is_admin());

-- Remarks: readable when parent goal/task readable; insert by author.
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

drop policy if exists "goal remarks insert" on public.user_goal_status_remarks;
create policy "goal remarks insert"
on public.user_goal_status_remarks
for insert
to authenticated
with check (author_id = auth.uid());

do $realtime$
begin
  alter publication supabase_realtime add table public.user_annual_goals;
exception when duplicate_object then null;
end;
$realtime$;

do $realtime$
begin
  alter publication supabase_realtime add table public.user_goal_tasks;
exception when duplicate_object then null;
end;
$realtime$;

do $realtime$
begin
  alter publication supabase_realtime add table public.user_goal_status_remarks;
exception when duplicate_object then null;
end;
$realtime$;
