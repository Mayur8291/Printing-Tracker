-- Admins can delete outward challans (OC) from Dispatch → Outward.

drop policy if exists "outward challans delete admin" on public.outward_challans;
create policy "outward challans delete admin"
on public.outward_challans
for delete
to authenticated
using (public.jwt_user_is_admin());

drop policy if exists "outward challan packaging delete admin" on storage.objects;
create policy "outward challan packaging delete admin"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'outward-challan-packaging'
  and public.jwt_user_is_admin()
);
