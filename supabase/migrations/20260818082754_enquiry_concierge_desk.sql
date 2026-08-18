-- Concierge desk fields on enquiries: order ownership, pick/SLA, photos, close feedback.
-- Status values stay new / assigned / in_progress / resolved / closed (Enquiry tab format).

alter table public.enquiries
  add column if not exists order_id text,
  add column if not exists order_type text not null default 'regular',
  add column if not exists help_topic text not null default 'enquiry',
  add column if not exists ownership_verified boolean not null default false,
  add column if not exists assigned_because_unknown boolean not null default false,
  add column if not exists picked_at timestamptz,
  add column if not exists sla_escalated_at timestamptz,
  add column if not exists escalated_to_id uuid references public.profiles(id) on delete set null,
  add column if not exists closed_at timestamptz,
  add column if not exists feedback_rating text,
  add column if not exists feedback_comment text,
  add column if not exists feedback_at timestamptz,
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.enquiries drop constraint if exists enquiries_order_type_check;
alter table public.enquiries
  add constraint enquiries_order_type_check
  check (order_type in ('regular', 'customized'));

alter table public.enquiries drop constraint if exists enquiries_help_topic_check;
alter table public.enquiries
  add constraint enquiries_help_topic_check
  check (help_topic in ('enquiry', 'product_issue', 'regular'));

alter table public.enquiries drop constraint if exists enquiries_feedback_rating_check;
alter table public.enquiries
  add constraint enquiries_feedback_rating_check
  check (
    feedback_rating is null
    or feedback_rating in ('Very Good', 'Good', 'Average', 'Poor', 'Very Poor')
  );

create index if not exists enquiries_unpicked_sla_idx
  on public.enquiries (created_at)
  where picked_at is null and status in ('new', 'assigned');

create index if not exists enquiries_escalated_to_idx
  on public.enquiries (escalated_to_id)
  where escalated_to_id is not null;

create table if not exists public.enquiry_sla_escalations (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id) on delete cascade,
  enquiry_code text not null,
  customer_name text not null,
  order_id text,
  assignee_id uuid references public.profiles(id) on delete set null,
  assignee_name text not null,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists enquiry_sla_escalations_enquiry_uidx
  on public.enquiry_sla_escalations (enquiry_id);

create index if not exists enquiry_sla_escalations_recipient_idx
  on public.enquiry_sla_escalations (recipient_user_id, created_at desc);

create index if not exists enquiry_sla_escalations_enquiry_idx
  on public.enquiry_sla_escalations (enquiry_id, created_at desc);

alter table public.enquiry_sla_escalations enable row level security;

drop policy if exists "enquiry sla escalations select scoped" on public.enquiry_sla_escalations;
create policy "enquiry sla escalations select scoped"
on public.enquiry_sla_escalations
for select
to authenticated
using (
  public.jwt_user_is_admin()
  or recipient_user_id = auth.uid()
);

drop policy if exists "enquiry sla escalations insert staff" on public.enquiry_sla_escalations;
create policy "enquiry sla escalations insert staff"
on public.enquiry_sla_escalations
for insert
to authenticated
with check (
  public.jwt_user_is_admin()
  or exists (
    select 1
    from public.enquiries e
    where e.id = enquiry_id
      and (e.assignee_id = auth.uid() or e.created_by = auth.uid())
  )
);

-- Gargi (or other SLA fallback) can read and update escalated tickets.
drop policy if exists "enquiries select scoped" on public.enquiries;
create policy "enquiries select scoped"
on public.enquiries
for select
to authenticated
using (
  public.jwt_user_is_admin()
  or assignee_id = auth.uid()
  or created_by = auth.uid()
  or escalated_to_id = auth.uid()
);

drop policy if exists "enquiries update sla fallback" on public.enquiries;
create policy "enquiries update sla fallback"
on public.enquiries
for update
to authenticated
using (escalated_to_id = auth.uid())
with check (escalated_to_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('enquiry-attachments', 'enquiry-attachments', true)
on conflict (id) do update set public = true;

drop policy if exists "enquiry attachments read authenticated" on storage.objects;
create policy "enquiry attachments read authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'enquiry-attachments');

drop policy if exists "enquiry attachments upload own folder" on storage.objects;
create policy "enquiry attachments upload own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'enquiry-attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

do $realtime$
begin
  alter publication supabase_realtime add table public.enquiry_sla_escalations;
exception when duplicate_object then null;
end;
$realtime$;
