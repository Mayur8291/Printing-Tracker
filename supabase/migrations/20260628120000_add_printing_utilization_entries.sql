-- Printing utilization: daily metres printed and pcs fused (immutable after save).

create table if not exists public.printing_utilization_entries (
  id bigint generated always as identity primary key,
  printing_metres numeric(14, 2) not null check (printing_metres > 0),
  pcs_fused integer not null check (pcs_fused > 0),
  created_by uuid not null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists printing_utilization_entries_created_at_idx
  on public.printing_utilization_entries (created_at desc);

alter table public.printing_utilization_entries enable row level security;

drop policy if exists "printing utilization read" on public.printing_utilization_entries;
create policy "printing utilization read"
on public.printing_utilization_entries
for select
to authenticated
using (true);

drop policy if exists "printing utilization insert" on public.printing_utilization_entries;
create policy "printing utilization insert"
on public.printing_utilization_entries
for insert
to authenticated
with check (
  created_by = auth.uid()
  and (
    public.jwt_user_is_admin()
    or public.jwt_viewer_can_edit_dashboard_tab('printing_department')
  )
);
