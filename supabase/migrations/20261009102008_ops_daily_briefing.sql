-- Daily ops briefing: SQL queue per user, follow-up task link, morning notify.
-- Staging first. Does not place orders or mutate money.

create table if not exists public.ops_followup_task_link (
  id uuid primary key default gen_random_uuid(),
  assignee_id uuid not null references public.profiles(id) on delete cascade,
  source_kind text not null
    check (source_kind in ('open_job', 'production', 'pending_pay', 'ar_invoice')),
  source_id text not null,
  task_id uuid not null references public.user_goal_tasks(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists ops_followup_task_link_assignee_source_uidx
  on public.ops_followup_task_link (assignee_id, source_kind, source_id);

create index if not exists ops_followup_task_link_task_idx
  on public.ops_followup_task_link (task_id);

alter table public.ops_followup_task_link enable row level security;

drop policy if exists "ops followup link read own" on public.ops_followup_task_link;
create policy "ops followup link read own"
on public.ops_followup_task_link
for select
to authenticated
using (assignee_id = auth.uid() or public.jwt_user_is_admin());

drop policy if exists "ops followup link insert own" on public.ops_followup_task_link;
create policy "ops followup link insert own"
on public.ops_followup_task_link
for insert
to authenticated
with check (assignee_id = auth.uid());

drop policy if exists "ops followup link delete own" on public.ops_followup_task_link;
create policy "ops followup link delete own"
on public.ops_followup_task_link
for delete
to authenticated
using (assignee_id = auth.uid() or public.jwt_user_is_admin());

create table if not exists public.ops_briefing_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  briefing_date date not null,
  open_jobs_count integer not null default 0,
  production_count integer not null default 0,
  pending_pay_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (recipient_user_id, briefing_date)
);

create index if not exists ops_briefing_notifications_recipient_idx
  on public.ops_briefing_notifications (recipient_user_id, created_at desc);

alter table public.ops_briefing_notifications enable row level security;

drop policy if exists "ops briefing notifications read own" on public.ops_briefing_notifications;
create policy "ops briefing notifications read own"
on public.ops_briefing_notifications
for select
to authenticated
using (recipient_user_id = auth.uid());

-- Inserts only from security definer cron function.

create or replace view public.rpt_ops_my_open_jobs
with (security_invoker = true) as
select
  o.id as order_pk,
  o.order_id as code,
  o.customer_name,
  o.status,
  o.due_date,
  o.created_at,
  o.is_production_order,
  case
    when o.due_date is not null and o.due_date < current_date then 'Overdue'
    when o.due_date is not null and o.due_date <= current_date + 3 then 'Due soon'
    when o.created_at < now() - interval '7 days' then 'Open 7+ days'
    else 'Open — follow up'
  end as why
from public.orders o
where o.created_by = auth.uid()
  and coalesce(o.is_complete, false) = false;

comment on view public.rpt_ops_my_open_jobs is
  'Incomplete printing jobs created by the current user. Law 8 follow-up queue.';

create or replace view public.rpt_ops_my_production
with (security_invoker = true) as
select
  o.id as order_pk,
  o.order_id as code,
  o.customer_name,
  o.status,
  o.due_date,
  o.created_at,
  case
    when o.due_date is not null and o.due_date < current_date then 'Production overdue'
    else 'In production — follow up'
  end as why
from public.orders o
where o.created_by = auth.uid()
  and coalesce(o.is_complete, false) = false
  and coalesce(o.is_production_order, false) = true;

comment on view public.rpt_ops_my_production is
  'Incomplete production jobs created by the current user.';

create or replace view public.rpt_ops_my_pending_pay
with (security_invoker = true) as
select
  'pending_pay'::text as source_kind,
  o.id::text as source_id,
  o.order_id as code,
  o.customer_name,
  o.job_sheet_pending_amount as amount,
  ('Job sheet pending ₹' || trim(to_char(o.job_sheet_pending_amount, 'FM999999990.00'))) as why
from public.orders o
where o.created_by = auth.uid()
  and coalesce(o.job_sheet_full_paid, false) = false
  and coalesce(o.job_sheet_pending_amount, 0) > 0
union all
select
  'ar_invoice'::text,
  v.id::text,
  v.invoice_no,
  v.customer_name,
  v.outstanding,
  ('AR ' || coalesce(v.bucket, 'open') || ' ₹' || trim(to_char(v.outstanding, 'FM999999990.00')))
from public.ar_invoice_outstanding_view v
where public.jwt_user_is_admin()
  and v.owner = auth.uid()
  and coalesce(v.outstanding, 0) > 0
  and coalesce(v.bucket, '') is distinct from 'PAID';

comment on view public.rpt_ops_my_pending_pay is
  'Job-sheet pending pay for the current user; admins also see AR they own.';

grant select on public.rpt_ops_my_open_jobs to authenticated;
grant select on public.rpt_ops_my_production to authenticated;
grant select on public.rpt_ops_my_pending_pay to authenticated;
grant select on public.ops_followup_task_link to authenticated;
grant insert, delete on public.ops_followup_task_link to authenticated;
grant select on public.ops_briefing_notifications to authenticated;

create or replace function public.ops_user_owns_queue_row(
  p_uid uuid,
  p_kind text,
  p_source_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_uid is null or p_kind is null or p_source_id is null then
    return false;
  end if;
  if p_kind = 'open_job' then
    return exists (
      select 1 from public.orders o
      where o.created_by = p_uid
        and o.id::text = p_source_id
        and coalesce(o.is_complete, false) = false
    );
  end if;
  if p_kind = 'production' then
    return exists (
      select 1 from public.orders o
      where o.created_by = p_uid
        and o.id::text = p_source_id
        and coalesce(o.is_complete, false) = false
        and coalesce(o.is_production_order, false) = true
    );
  end if;
  if p_kind = 'pending_pay' then
    return exists (
      select 1 from public.orders o
      where o.created_by = p_uid
        and o.id::text = p_source_id
        and coalesce(o.job_sheet_full_paid, false) = false
        and coalesce(o.job_sheet_pending_amount, 0) > 0
    );
  end if;
  if p_kind = 'ar_invoice' then
    return public.jwt_user_is_admin()
      and exists (
        select 1 from public.ar_invoice_outstanding_view v
        where v.owner = p_uid
          and v.id::text = p_source_id
          and coalesce(v.outstanding, 0) > 0
          and coalesce(v.bucket, '') is distinct from 'PAID'
      );
  end if;
  return false;
end;
$$;

revoke all on function public.ops_user_owns_queue_row(uuid, text, text) from public;
grant execute on function public.ops_user_owns_queue_row(uuid, text, text) to authenticated;

create or replace function public.ops_create_followup_task(
  p_source_kind text,
  p_source_id text,
  p_title text,
  p_description text default null
)
returns public.user_goal_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing_id uuid;
  existing_status text;
  new_task public.user_goal_tasks;
  title_text text := nullif(trim(coalesce(p_title, '')), '');
begin
  if uid is null then
    raise exception 'Sign in required';
  end if;
  if p_source_kind not in ('open_job', 'production', 'pending_pay', 'ar_invoice') then
    raise exception 'Unknown follow-up kind';
  end if;
  if nullif(trim(coalesce(p_source_id, '')), '') is null then
    raise exception 'Missing source';
  end if;
  if title_text is null then
    raise exception 'Task title required';
  end if;
  if not public.ops_user_owns_queue_row(uid, p_source_kind, trim(p_source_id)) then
    raise exception 'That item is not in your follow-up queue';
  end if;

  select l.task_id, t.status
    into existing_id, existing_status
  from public.ops_followup_task_link l
  join public.user_goal_tasks t on t.id = l.task_id
  where l.assignee_id = uid
    and l.source_kind = p_source_kind
    and l.source_id = trim(p_source_id);

  if existing_id is not null and existing_status in ('pending', 'in_progress') then
    select * into new_task from public.user_goal_tasks where id = existing_id;
    return new_task;
  end if;

  if existing_id is not null then
    delete from public.ops_followup_task_link
    where assignee_id = uid
      and source_kind = p_source_kind
      and source_id = trim(p_source_id);
  end if;

  insert into public.user_goal_tasks (
    goal_id, assignee_id, assigned_by, title, description, deadline_date, priority, status
  ) values (
    null,
    uid,
    uid,
    title_text,
    nullif(trim(coalesce(p_description, '')), ''),
    (timezone('Asia/Kolkata', now()))::date,
    'P1',
    'pending'
  )
  returning * into new_task;

  insert into public.ops_followup_task_link (assignee_id, source_kind, source_id, task_id)
  values (uid, p_source_kind, trim(p_source_id), new_task.id);

  insert into public.user_goal_task_notifications (
    recipient_user_id, task_id, task_title, assigned_by_user_id, deadline_date
  ) values (
    uid, new_task.id, new_task.title, uid, new_task.deadline_date
  );

  return new_task;
end;
$$;

revoke all on function public.ops_create_followup_task(text, text, text, text) from public;
grant execute on function public.ops_create_followup_task(text, text, text, text) to authenticated;

create or replace function public.ops_insert_daily_briefings()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  d date := (timezone('Asia/Kolkata', now()))::date;
  inserted int := 0;
  p record;
  jobs int;
  prod int;
  pay int;
begin
  for p in
    select id from public.profiles where coalesce(is_active, true) = true
  loop
    select count(*) into jobs
    from public.orders o
    where o.created_by = p.id
      and coalesce(o.is_complete, false) = false;

    select count(*) into prod
    from public.orders o
    where o.created_by = p.id
      and coalesce(o.is_complete, false) = false
      and coalesce(o.is_production_order, false) = true;

    select count(*) into pay
    from public.orders o
    where o.created_by = p.id
      and coalesce(o.job_sheet_full_paid, false) = false
      and coalesce(o.job_sheet_pending_amount, 0) > 0;

    if exists (select 1 from public.profiles pr where pr.id = p.id and pr.role = 'admin') then
      pay := pay + (
        select count(*)
        from public.ar_invoice_outstanding_view v
        where v.owner = p.id
          and coalesce(v.outstanding, 0) > 0
          and coalesce(v.bucket, '') is distinct from 'PAID'
      );
    end if;

    if jobs + prod + pay <= 0 then
      continue;
    end if;

    insert into public.ops_briefing_notifications (
      recipient_user_id, briefing_date, open_jobs_count, production_count, pending_pay_count
    ) values (p.id, d, jobs, prod, pay)
    on conflict (recipient_user_id, briefing_date) do nothing;

    if found then
      inserted := inserted + 1;
    end if;
  end loop;
  return inserted;
end;
$$;

revoke all on function public.ops_insert_daily_briefings() from public;
grant execute on function public.ops_insert_daily_briefings() to postgres;

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'ops-daily-briefing') then
    perform cron.unschedule('ops-daily-briefing');
  end if;
  perform cron.schedule(
    'ops-daily-briefing',
    '30 3 * * *',
    $$select public.ops_insert_daily_briefings();$$
  );
exception when others then
  raise notice 'ops-daily-briefing cron skipped: %', sqlerrm;
end;
$cron$;

do $realtime$
begin
  alter publication supabase_realtime add table public.ops_briefing_notifications;
exception when duplicate_object then null;
end;
$realtime$;

do $realtime2$
begin
  alter publication supabase_realtime add table public.ops_followup_task_link;
exception when duplicate_object then null;
end;
$realtime2$;

notify pgrst, 'reload schema';
