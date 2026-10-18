-- Support inbox: notify assignee + admins on every enquiry update (not only assign).
-- Staging first (scvojtvgnkmbupvyslmb). Production only on explicit release.

alter table public.enquiry_assignment_notifications
  add column if not exists kind text not null default 'assigned',
  add column if not exists summary text;

alter table public.enquiry_assignment_notifications
  drop constraint if exists enquiry_assignment_notifications_kind_check;

alter table public.enquiry_assignment_notifications
  add constraint enquiry_assignment_notifications_kind_check
  check (kind in (
    'created', 'assigned', 'status', 'details', 'reached_out',
    'verified', 'contacted', 'closed', 'feedback'
  ));

comment on column public.enquiry_assignment_notifications.kind is
  'Support event: assigned, status, reached_out, details, …';
comment on column public.enquiry_assignment_notifications.summary is
  'Short line for the Notifications inbox (what changed).';

create or replace function public.notify_enquiry_watchers(
  p_enquiry_id uuid,
  p_kind text,
  p_summary text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_enq record;
  v_kind text := coalesce(nullif(trim(p_kind), ''), 'status');
  v_inserted integer := 0;
begin
  if v_actor is null or p_enquiry_id is null then
    return 0;
  end if;
  if v_kind not in (
    'created', 'assigned', 'status', 'details', 'reached_out',
    'verified', 'contacted', 'closed', 'feedback'
  ) then
    v_kind := 'status';
  end if;

  select e.enquiry_code, e.customer_name, e.assignee_id, e.assigned_by, e.created_by
    into v_enq
  from public.enquiries e
  where e.id = p_enquiry_id;
  if not found then
    return 0;
  end if;

  insert into public.enquiry_assignment_notifications (
    recipient_user_id,
    enquiry_id,
    enquiry_code,
    customer_name,
    assigned_by_user_id,
    kind,
    summary
  )
  select distinct
    r.u,
    p_enquiry_id,
    coalesce(nullif(trim(v_enq.enquiry_code), ''), 'Enquiry'),
    coalesce(nullif(trim(v_enq.customer_name), ''), 'Customer'),
    v_actor,
    v_kind,
    nullif(trim(p_summary), '')
  from (
    select v_enq.assignee_id as u
    union
    select v_enq.assigned_by
    union
    select p.id from public.profiles p where p.role = 'admin'
    union
    select sa.user_id from public.support_admins sa
  ) r
  where r.u is not null
    and r.u <> v_actor;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.notify_enquiry_watchers(uuid, text, text) from public;
grant execute on function public.notify_enquiry_watchers(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
