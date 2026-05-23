-- Allow admins to delete design files when purging archived weekly jobs.

drop policy if exists "designs delete admin only" on storage.objects;
create policy "designs delete admin only"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'approved-designs'
  and public.jwt_user_is_admin()
);
