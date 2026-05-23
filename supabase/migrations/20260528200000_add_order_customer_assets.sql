-- Customer files on create job (PDF / any type). Auto-delete after 48 hours.

create table if not exists public.order_customer_assets (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create index if not exists order_customer_assets_order_id_idx
  on public.order_customer_assets (order_id);

create index if not exists order_customer_assets_uploaded_at_idx
  on public.order_customer_assets (uploaded_at);

alter table public.order_customer_assets enable row level security;

drop policy if exists "order customer assets read authenticated" on public.order_customer_assets;
create policy "order customer assets read authenticated"
on public.order_customer_assets
for select
to authenticated
using (true);

drop policy if exists "order customer assets insert authenticated" on public.order_customer_assets;
create policy "order customer assets insert authenticated"
on public.order_customer_assets
for insert
to authenticated
with check (true);

insert into storage.buckets (id, name, public)
values ('order-customer-assets', 'order-customer-assets', true)
on conflict (id) do nothing;

drop policy if exists "order customer assets storage read authenticated" on storage.objects;
create policy "order customer assets storage read authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'order-customer-assets');

drop policy if exists "order customer assets storage upload authenticated" on storage.objects;
create policy "order customer assets storage upload authenticated"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'order-customer-assets');

drop policy if exists "order customer assets storage update authenticated" on storage.objects;
create policy "order customer assets storage update authenticated"
on storage.objects
for update
to authenticated
using (bucket_id = 'order-customer-assets')
with check (bucket_id = 'order-customer-assets');

create or replace function public.purge_expired_order_customer_assets()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  purged_count integer := 0;
  rec record;
begin
  for rec in
    select id, storage_path
    from public.order_customer_assets
    where uploaded_at <= (now() - interval '48 hours')
  loop
    delete from storage.objects
    where bucket_id = 'order-customer-assets'
      and name = rec.storage_path;

    delete from public.order_customer_assets
    where id = rec.id;

    purged_count := purged_count + 1;
  end loop;

  return purged_count;
end;
$$;

revoke all on function public.purge_expired_order_customer_assets() from public;
grant execute on function public.purge_expired_order_customer_assets() to service_role;

create extension if not exists pg_cron with schema extensions;

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'purge-expired-order-customer-assets') then
    perform cron.unschedule('purge-expired-order-customer-assets');
  end if;
end;
$cron$;

select cron.schedule(
  'purge-expired-order-customer-assets',
  '30 * * * *',
  $$select public.purge_expired_order_customer_assets();$$
);
