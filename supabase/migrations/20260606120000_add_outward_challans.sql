-- Outward challans (OC) created from Dispatch → Outward tab.

create table if not exists public.outward_challans (
  id bigint generated always as identity primary key,
  oc_date date not null default current_date,
  sender text not null default '',
  product_material text not null default '',
  purpose text not null default '',
  mode_of_transport text not null,
  sent_to text not null default '',
  sender_contact text not null default '',
  receiver_contact text not null default '',
  packaging_photo_path text,
  barcode_value text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint outward_challans_transport_check check (
    mode_of_transport in (
      'makali_vehicle',
      'porter_rapido',
      'transport',
      'bus_service',
      'other'
    )
  )
);

create index if not exists outward_challans_oc_date_idx on public.outward_challans (oc_date desc);
create index if not exists outward_challans_barcode_idx on public.outward_challans (barcode_value);

alter table public.outward_challans enable row level security;

drop policy if exists "outward challans read authenticated" on public.outward_challans;
create policy "outward challans read authenticated"
on public.outward_challans
for select
to authenticated
using (true);

drop policy if exists "outward challans insert dispatch edit" on public.outward_challans;
create policy "outward challans insert dispatch edit"
on public.outward_challans
for insert
to authenticated
with check (
  public.jwt_user_is_admin()
  or public.jwt_viewer_can_edit_dashboard_tab('dispatch')
);

insert into storage.buckets (id, name, public)
values ('outward-challan-packaging', 'outward-challan-packaging', true)
on conflict (id) do update set public = true;

drop policy if exists "outward challan packaging read" on storage.objects;
create policy "outward challan packaging read"
on storage.objects
for select
to authenticated
using (bucket_id = 'outward-challan-packaging');

drop policy if exists "outward challan packaging upload" on storage.objects;
create policy "outward challan packaging upload"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'outward-challan-packaging'
  and (
    public.jwt_user_is_admin()
    or public.jwt_viewer_can_edit_dashboard_tab('dispatch')
  )
);

drop policy if exists "outward challan packaging update" on storage.objects;
create policy "outward challan packaging update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'outward-challan-packaging'
  and (
    public.jwt_user_is_admin()
    or public.jwt_viewer_can_edit_dashboard_tab('dispatch')
  )
)
with check (
  bucket_id = 'outward-challan-packaging'
  and (
    public.jwt_user_is_admin()
    or public.jwt_viewer_can_edit_dashboard_tab('dispatch')
  )
);
