-- Post-approval design images (separate from mockups in approved_design_url).
alter table public.orders add column if not exists approved_design_images text;

alter table public.profile_order_permissions
  add column if not exists can_edit_approved_design_images boolean not null default true;

drop policy if exists "designs upload post approved path" on storage.objects;
create policy "designs upload post approved path"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'approved-designs'
  and name like 'post-approved/%'
);

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
