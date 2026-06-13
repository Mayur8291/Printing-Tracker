-- Multiple GRN rows per inward entry (labels generated per GRN).

create table if not exists public.inward_grn_entries (
  id bigint generated always as identity primary key,
  inward_entry_id bigint not null references public.inward_entries(id) on delete cascade,
  grn_no text not null default '',
  for_whom text not null default '',
  supplier text not null default '',
  invoice_no text not null default '',
  qty_received text not null default '',
  bora_carton_unit text not null default '',
  location_rack text not null default '',
  received_by text not null default '',
  remark text not null default '',
  size_breakdown jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inward_grn_entries_inward_entry_id_idx
  on public.inward_grn_entries (inward_entry_id, created_at asc);

create index if not exists inward_grn_entries_grn_no_idx
  on public.inward_grn_entries (grn_no);

-- Move legacy single GRN columns into the new table.
insert into public.inward_grn_entries (
  inward_entry_id,
  grn_no,
  for_whom,
  supplier,
  invoice_no,
  qty_received,
  bora_carton_unit,
  location_rack,
  received_by,
  remark,
  size_breakdown,
  created_by,
  created_at
)
select
  id,
  grn_no,
  for_whom,
  supplier,
  invoice_no,
  qty_received,
  bora_carton_unit,
  location_rack,
  received_by,
  remark,
  size_breakdown,
  created_by,
  created_at
from public.inward_entries
where trim(coalesce(grn_no, '')) <> ''
  and not exists (
    select 1
    from public.inward_grn_entries g
    where g.inward_entry_id = inward_entries.id
  );

alter table public.inward_grn_entries enable row level security;

drop policy if exists "inward grn entries read authenticated" on public.inward_grn_entries;
create policy "inward grn entries read authenticated"
on public.inward_grn_entries
for select
to authenticated
using (true);

drop policy if exists "inward grn entries insert dispatch edit" on public.inward_grn_entries;
create policy "inward grn entries insert dispatch edit"
on public.inward_grn_entries
for insert
to authenticated
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('dispatch')
);

drop policy if exists "inward grn entries update dispatch edit" on public.inward_grn_entries;
create policy "inward grn entries update dispatch edit"
on public.inward_grn_entries
for update
to authenticated
using (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('dispatch')
)
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('dispatch')
);

drop policy if exists "inward grn entries delete admin" on public.inward_grn_entries;
create policy "inward grn entries delete admin"
on public.inward_grn_entries
for delete
to authenticated
using (public.jwt_user_is_admin());
