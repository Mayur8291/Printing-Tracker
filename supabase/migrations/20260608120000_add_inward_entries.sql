-- Inward GRN entries created from Dispatch → Inward tab.

create table if not exists public.inward_entries (
  id bigint generated always as identity primary key,
  grn_no text not null default '',
  for_whom text not null default '',
  supplier text not null default '',
  invoice_no text not null default '',
  product_material text not null default '',
  qty_received text not null default '',
  bora_carton_unit text not null default '',
  location_rack text not null default '',
  received_by text not null default '',
  remark text not null default '',
  package_photo_path text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists inward_entries_created_at_idx on public.inward_entries (created_at desc);
create index if not exists inward_entries_grn_no_idx on public.inward_entries (grn_no);

alter table public.inward_entries enable row level security;

drop policy if exists "inward entries read authenticated" on public.inward_entries;
create policy "inward entries read authenticated"
on public.inward_entries
for select
to authenticated
using (true);

drop policy if exists "inward entries insert dispatch edit" on public.inward_entries;
create policy "inward entries insert dispatch edit"
on public.inward_entries
for insert
to authenticated
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('dispatch')
);

drop policy if exists "inward entries update dispatch edit" on public.inward_entries;
create policy "inward entries update dispatch edit"
on public.inward_entries
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

drop policy if exists "inward entries delete admin" on public.inward_entries;
create policy "inward entries delete admin"
on public.inward_entries
for delete
to authenticated
using (public.jwt_user_is_admin());

insert into storage.buckets (id, name, public)
values ('inward-entry-packaging', 'inward-entry-packaging', true)
on conflict (id) do update set public = true;

drop policy if exists "inward entry packaging read" on storage.objects;
create policy "inward entry packaging read"
on storage.objects
for select
to authenticated
using (bucket_id = 'inward-entry-packaging');

drop policy if exists "inward entry packaging upload" on storage.objects;
create policy "inward entry packaging upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'inward-entry-packaging'
  and (
    public.jwt_user_is_admin()
    or public.jwt_viewer_can_edit_dashboard_tab('dispatch')
  )
);

drop policy if exists "inward entry packaging update" on storage.objects;
create policy "inward entry packaging update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'inward-entry-packaging'
  and (
    public.jwt_user_is_admin()
    or public.jwt_viewer_can_edit_dashboard_tab('dispatch')
  )
)
with check (
  bucket_id = 'inward-entry-packaging'
  and (
    public.jwt_user_is_admin()
    or public.jwt_viewer_can_edit_dashboard_tab('dispatch')
  )
);

drop policy if exists "inward entry packaging delete admin" on storage.objects;
create policy "inward entry packaging delete admin"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'inward-entry-packaging'
  and public.jwt_user_is_admin()
);
