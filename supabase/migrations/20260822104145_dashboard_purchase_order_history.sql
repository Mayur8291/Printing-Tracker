-- History for Scott Dashboard Purchase Order sheets (not Inventory POs).
-- Voucher rows are reserved on sheet open. History lists only generated_at IS NOT NULL.

alter table public.dashboard_purchase_orders
  add column if not exists generated_at timestamptz,
  add column if not exists supplier_name text,
  add column if not exists coordinator_name text,
  add column if not exists po_date text,
  add column if not exists quantity integer,
  add column if not exists status text not null default 'pending',
  add column if not exists sheet_snapshot jsonb;

alter table public.dashboard_purchase_orders
  drop constraint if exists dashboard_purchase_orders_status_check;

alter table public.dashboard_purchase_orders
  add constraint dashboard_purchase_orders_status_check
  check (status in ('pending', 'completed', 'po_sent', 'po_approved'));

create index if not exists dashboard_purchase_orders_generated_idx
  on public.dashboard_purchase_orders (generated_at desc)
  where generated_at is not null;

grant update on public.dashboard_purchase_orders to authenticated;

drop policy if exists "dashboard purchase orders update authenticated" on public.dashboard_purchase_orders;
create policy "dashboard purchase orders update authenticated"
on public.dashboard_purchase_orders
for update
to authenticated
using (true)
with check (true);

comment on column public.dashboard_purchase_orders.generated_at is
  'Set when user clicks Generate PO. History lists only generated rows.';
comment on column public.dashboard_purchase_orders.supplier_name is
  'Bold Supplier (Bill form) name from R3.';
comment on column public.dashboard_purchase_orders.coordinator_name is
  'Signed-in profile display name at generate time.';
comment on column public.dashboard_purchase_orders.po_date is
  'R12 Dated face DD-Mmm-YY.';
comment on column public.dashboard_purchase_orders.quantity is
  'C42 quantity total (whole numbers).';
comment on column public.dashboard_purchase_orders.status is
  'pending | po_sent | po_approved | completed';
comment on column public.dashboard_purchase_orders.sheet_snapshot is
  'Sheet fields at generate time for View PO.';

notify pgrst, 'reload schema';
