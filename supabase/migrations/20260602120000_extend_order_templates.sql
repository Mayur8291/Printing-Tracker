-- Extend order_templates with optional saved images + production handover date.

alter table public.order_templates
  add column if not exists image_paths text[] not null default array[]::text[];

alter table public.order_templates
  add column if not exists expected_handover_to_printing date;

comment on column public.order_templates.image_paths is
  'Storage paths inside the order-template-images bucket. Re-attached as customer assets when the template is used.';
comment on column public.order_templates.expected_handover_to_printing is
  'Default expected handover-to-printing date for production-order templates.';

-- Public bucket for template reference images.
insert into storage.buckets (id, name, public)
values ('order-template-images', 'order-template-images', true)
on conflict (id) do update set public = true;

-- Read: any authenticated user can fetch (URLs are public anyway for the bucket).
drop policy if exists "order template images read authenticated" on storage.objects;
create policy "order template images read authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'order-template-images');

-- Write: only owner can write under their own user-id prefix. Admins can write anywhere in this bucket.
drop policy if exists "order template images insert own" on storage.objects;
create policy "order template images insert own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'order-template-images'
  and (
    public.jwt_user_is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

drop policy if exists "order template images update own" on storage.objects;
create policy "order template images update own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'order-template-images'
  and (
    public.jwt_user_is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

drop policy if exists "order template images delete own" on storage.objects;
create policy "order template images delete own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'order-template-images'
  and (
    public.jwt_user_is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);
