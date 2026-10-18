-- Enquiry status "opened": worker opened the ticket but took no action yet.
-- Sits between assigned and in_progress. Not a pick — SLA keeps counting.
-- Staging first (scvojtvgnkmbupvyslmb). Production only on explicit release.

alter table public.enquiries drop constraint if exists enquiries_status_check;
alter table public.enquiries
  add constraint enquiries_status_check
  check (status in ('new', 'assigned', 'opened', 'in_progress', 'resolved', 'closed'));

alter table public.enquiries
  add column if not exists opened_at timestamptz;

comment on column public.enquiries.opened_at is 'First time the assignee / tag holder / SLA fallback opened the ticket (status opened).';

-- SLA partial index must also cover "opened" rows.
drop index if exists public.enquiries_unpicked_sla_idx;
create index if not exists enquiries_unpicked_sla_idx
  on public.enquiries (created_at)
  where picked_at is null and status in ('new', 'assigned', 'opened');

notify pgrst, 'reload schema';
