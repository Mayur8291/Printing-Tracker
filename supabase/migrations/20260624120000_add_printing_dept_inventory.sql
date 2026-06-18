-- Printing department consumables: ink CMYKW, rolls, powder, cleaning solution + refill audit log.

create table if not exists public.printing_dept_inventory_state (
  id int primary key default 1 check (id = 1),
  ink_cyan numeric(14, 2) not null default 0 check (ink_cyan >= 0),
  ink_magenta numeric(14, 2) not null default 0 check (ink_magenta >= 0),
  ink_yellow numeric(14, 2) not null default 0 check (ink_yellow >= 0),
  ink_black numeric(14, 2) not null default 0 check (ink_black >= 0),
  ink_white numeric(14, 2) not null default 0 check (ink_white >= 0),
  roll_count numeric(14, 2) not null default 0 check (roll_count >= 0),
  powder_kg numeric(14, 2) not null default 0 check (powder_kg >= 0),
  cleaning_solution_count numeric(14, 2) not null default 0 check (cleaning_solution_count >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.printing_dept_inventory_state (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.printing_dept_refill_log (
  id bigint generated always as identity primary key,
  material_key text not null,
  quantity_added numeric(14, 2) not null check (quantity_added > 0),
  quantity_after numeric(14, 2) not null check (quantity_after >= 0),
  refilled_by uuid not null references auth.users(id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists printing_dept_refill_log_created_idx
  on public.printing_dept_refill_log (created_at desc);

alter table public.printing_dept_inventory_state enable row level security;
alter table public.printing_dept_refill_log enable row level security;

drop policy if exists "printing dept inventory read" on public.printing_dept_inventory_state;
create policy "printing dept inventory read"
on public.printing_dept_inventory_state
for select
to authenticated
using (true);

drop policy if exists "printing dept inventory write" on public.printing_dept_inventory_state;
create policy "printing dept inventory write"
on public.printing_dept_inventory_state
for all
to authenticated
using (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('printing_department')
)
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('printing_department')
);

drop policy if exists "printing dept refill log read" on public.printing_dept_refill_log;
create policy "printing dept refill log read"
on public.printing_dept_refill_log
for select
to authenticated
using (true);

drop policy if exists "printing dept refill log insert" on public.printing_dept_refill_log;
create policy "printing dept refill log insert"
on public.printing_dept_refill_log
for insert
to authenticated
with check (
  refilled_by = auth.uid()
  and (
    public.jwt_user_is_admin()
    or public.jwt_viewer_can_edit_dashboard_tab('printing_department')
  )
);
