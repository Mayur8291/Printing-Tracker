-- Allow dispatch editors to update outward challans (barcode + packaging path after create).

drop policy if exists "outward challans update dispatch edit" on public.outward_challans;
create policy "outward challans update dispatch edit"
on public.outward_challans
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
