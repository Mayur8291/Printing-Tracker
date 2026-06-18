-- Printing inventory: per-material low-stock thresholds + admin notifications.

create table if not exists public.printing_dept_inventory_thresholds (
  material_key text primary key,
  low_stock_threshold numeric(14, 2) not null default 0 check (low_stock_threshold >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.printing_dept_inventory_thresholds (material_key, low_stock_threshold)
values
  ('ink_cyan', 0),
  ('ink_magenta', 0),
  ('ink_yellow', 0),
  ('ink_black', 0),
  ('ink_white', 0),
  ('roll_count', 0),
  ('powder_kg', 0),
  ('cleaning_solution_count', 0)
on conflict (material_key) do nothing;

alter table public.printing_dept_inventory_thresholds enable row level security;

drop policy if exists "printing dept thresholds read" on public.printing_dept_inventory_thresholds;
create policy "printing dept thresholds read"
on public.printing_dept_inventory_thresholds
for select
to authenticated
using (true);

drop policy if exists "printing dept thresholds write" on public.printing_dept_inventory_thresholds;
create policy "printing dept thresholds write"
on public.printing_dept_inventory_thresholds
for all
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

create table if not exists public.printing_dept_inventory_notifications (
  id bigint generated always as identity primary key,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  material_key text not null,
  material_label text not null default '',
  current_stock numeric(14, 2) not null check (current_stock >= 0),
  threshold_qty numeric(14, 2) not null check (threshold_qty > 0),
  triggered_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists printing_dept_inventory_notifications_recipient_created_idx
  on public.printing_dept_inventory_notifications (recipient_user_id, created_at desc);

alter table public.printing_dept_inventory_notifications enable row level security;

drop policy if exists "printing dept inventory notifications read own" on public.printing_dept_inventory_notifications;
create policy "printing dept inventory notifications read own"
on public.printing_dept_inventory_notifications
for select
to authenticated
using (recipient_user_id = auth.uid());

drop policy if exists "printing dept inventory notifications insert edit" on public.printing_dept_inventory_notifications;
create policy "printing dept inventory notifications insert edit"
on public.printing_dept_inventory_notifications
for insert
to authenticated
with check (
  triggered_by_user_id = auth.uid()
  and (
    public.jwt_user_is_admin()
    or public.jwt_viewer_can_edit_dashboard_tab('printing_department')
  )
);

do $realtime$
begin
  alter publication supabase_realtime add table public.printing_dept_inventory_notifications;
exception
  when duplicate_object then null;
end;
$realtime$;
