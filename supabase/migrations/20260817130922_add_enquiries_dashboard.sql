-- Enquiry dashboard: customer enquiries + admin assignment to team members.

create sequence if not exists public.enquiry_code_seq start 1;

create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  enquiry_code text not null unique,
  customer_name text not null,
  customer_phone text,
  customer_email text,
  product_details text,
  source text,
  notes text,
  status text not null default 'new'
    check (status in ('new', 'assigned', 'in_progress', 'resolved', 'closed')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  assignee_id uuid references public.profiles(id) on delete set null,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists enquiries_status_created_idx
  on public.enquiries (status, created_at desc);

create index if not exists enquiries_assignee_idx
  on public.enquiries (assignee_id, status, created_at desc);

create index if not exists enquiries_created_by_idx
  on public.enquiries (created_by, created_at desc);

create or replace function public.set_enquiry_code()
returns trigger
language plpgsql
as $$
begin
  if new.enquiry_code is null or trim(new.enquiry_code) = '' then
    new.enquiry_code := 'ENQ-' || lpad(nextval('public.enquiry_code_seq')::text, 5, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists enquiries_set_code on public.enquiries;
create trigger enquiries_set_code
before insert on public.enquiries
for each row
execute function public.set_enquiry_code();

create or replace function public.touch_enquiries_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists enquiries_touch_updated_at on public.enquiries;
create trigger enquiries_touch_updated_at
before update on public.enquiries
for each row
execute function public.touch_enquiries_updated_at();

-- Assignment notifications (assignee inbox; wired to NotificationsPanel later).
create table if not exists public.enquiry_assignment_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  enquiry_id uuid not null references public.enquiries(id) on delete cascade,
  enquiry_code text not null,
  customer_name text not null,
  assigned_by_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists enquiry_assignment_notifications_recipient_idx
  on public.enquiry_assignment_notifications (recipient_user_id, created_at desc);

alter table public.enquiries enable row level security;
alter table public.enquiry_assignment_notifications enable row level security;

-- Read: admin sees all; assignee and creator see their rows.
drop policy if exists "enquiries select scoped" on public.enquiries;
create policy "enquiries select scoped"
on public.enquiries
for select
to authenticated
using (
  public.jwt_user_is_admin()
  or assignee_id = auth.uid()
  or created_by = auth.uid()
);

drop policy if exists "enquiries insert authenticated" on public.enquiries;
create policy "enquiries insert authenticated"
on public.enquiries
for insert
to authenticated
with check (created_by = auth.uid());

-- Admin full update (assign user, status, fields).
drop policy if exists "enquiries update admin" on public.enquiries;
create policy "enquiries update admin"
on public.enquiries
for update
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

-- Assignee may update status/notes on their enquiries (not reassign).
drop policy if exists "enquiries update assignee" on public.enquiries;
create policy "enquiries update assignee"
on public.enquiries
for update
to authenticated
using (assignee_id = auth.uid())
with check (assignee_id = auth.uid());

drop policy if exists "enquiries delete admin" on public.enquiries;
create policy "enquiries delete admin"
on public.enquiries
for delete
to authenticated
using (public.jwt_user_is_admin());

drop policy if exists "enquiry assignment notifications read own" on public.enquiry_assignment_notifications;
create policy "enquiry assignment notifications read own"
on public.enquiry_assignment_notifications
for select
to authenticated
using (recipient_user_id = auth.uid());

drop policy if exists "enquiry assignment notifications insert" on public.enquiry_assignment_notifications;
create policy "enquiry assignment notifications insert"
on public.enquiry_assignment_notifications
for insert
to authenticated
with check (assigned_by_user_id = auth.uid());

do $realtime$
begin
  alter publication supabase_realtime add table public.enquiries;
exception when duplicate_object then null;
end;
$realtime$;

do $realtime$
begin
  alter publication supabase_realtime add table public.enquiry_assignment_notifications;
exception when duplicate_object then null;
end;
$realtime$;
