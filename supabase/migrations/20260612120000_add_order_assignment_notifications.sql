-- Coordinator assignment toasts: insert row when order assigned to another user.
-- Deploy: supabase db push (or run this file in Supabase SQL editor).

create table if not exists public.order_assignment_notifications (
  id bigint generated always as identity primary key,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  order_id bigint not null references public.orders(id) on delete cascade,
  order_display_id text,
  coordinator_name text not null,
  assigned_by_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists order_assignment_notifications_recipient_created_idx
  on public.order_assignment_notifications (recipient_user_id, created_at desc);

alter table public.order_assignment_notifications enable row level security;

drop policy if exists "assignment notifications read own" on public.order_assignment_notifications;
create policy "assignment notifications read own"
on public.order_assignment_notifications
for select
to authenticated
using (recipient_user_id = auth.uid());

drop policy if exists "assignment notifications insert authenticated" on public.order_assignment_notifications;
create policy "assignment notifications insert authenticated"
on public.order_assignment_notifications
for insert
to authenticated
with check (assigned_by_user_id = auth.uid());

do $realtime$
begin
  alter publication supabase_realtime add table public.order_assignment_notifications;
exception
  when duplicate_object then null;
end;
$realtime$;
