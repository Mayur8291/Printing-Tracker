-- Purchase Order sheet voucher numbers (cell R11).
-- Format: PO/{yy}-{yy+1}/{seq}  e.g. PO/26-27/392
-- Financial year is 1 Apr → 31 Mar (India). Sequence is per FY.

create table if not exists public.dashboard_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  voucher_code text not null,
  fy_code text not null,
  seq integer not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint dashboard_purchase_orders_voucher_unique unique (voucher_code),
  constraint dashboard_purchase_orders_fy_seq_unique unique (fy_code, seq),
  constraint dashboard_purchase_orders_seq_positive check (seq > 0)
);

create index if not exists dashboard_purchase_orders_fy_seq_idx
  on public.dashboard_purchase_orders (fy_code, seq desc);

create index if not exists dashboard_purchase_orders_created_idx
  on public.dashboard_purchase_orders (created_at desc);

comment on table public.dashboard_purchase_orders is
  'Scott Dashboard Purchase Order vouchers. PO/{fy}/{seq}. FY starts 1 April.';

grant select, insert on public.dashboard_purchase_orders to authenticated;
grant all on public.dashboard_purchase_orders to service_role;

alter table public.dashboard_purchase_orders enable row level security;

drop policy if exists "dashboard purchase orders select authenticated" on public.dashboard_purchase_orders;
create policy "dashboard purchase orders select authenticated"
on public.dashboard_purchase_orders
for select
to authenticated
using (true);

drop policy if exists "dashboard purchase orders insert authenticated" on public.dashboard_purchase_orders;
create policy "dashboard purchase orders insert authenticated"
on public.dashboard_purchase_orders
for insert
to authenticated
with check (created_by is null or created_by = auth.uid());

notify pgrst, 'reload schema';
