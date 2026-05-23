-- Payment screenshot for "Paid online" orders (create-order flow).

alter table public.orders
  add column if not exists payment_screenshot_url text;

comment on column public.orders.payment_screenshot_url is
  'Public URL of payment proof when payment_method is paid or pi_sent_advance_received.';

insert into storage.buckets (id, name, public)
values ('payment-screenshots', 'payment-screenshots', true)
on conflict (id) do nothing;

drop policy if exists "payment screenshots read authenticated" on storage.objects;
create policy "payment screenshots read authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'payment-screenshots');

drop policy if exists "payment screenshots upload admin" on storage.objects;
create policy "payment screenshots upload admin"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payment-screenshots'
  and public.jwt_user_is_admin()
);

drop policy if exists "payment screenshots upload viewer create" on storage.objects;
create policy "payment screenshots upload viewer create"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payment-screenshots'
  and public.jwt_viewer_can_create_orders()
);
