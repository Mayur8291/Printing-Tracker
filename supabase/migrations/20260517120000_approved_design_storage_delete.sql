-- Allow deleting post-approved design files from storage.
drop policy if exists "designs delete admin only" on storage.objects;
create policy "designs delete admin only"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'approved-designs'
  and public.jwt_user_is_admin()
);

drop policy if exists "designs delete post approved path" on storage.objects;
create policy "designs delete post approved path"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'approved-designs'
  and name like 'post-approved/%'
);
