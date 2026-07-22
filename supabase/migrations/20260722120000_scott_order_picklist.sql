-- Picklist metadata on Scott RMP orders (dashboard warehouse flow).
-- Generated from Ready Stock Order detail → sets status PROCESSING via edge function.

alter table public.scott_orders
  add column if not exists picklist_no text,
  add column if not exists picklist_generated_at timestamptz;

comment on column public.scott_orders.picklist_no is
  'Warehouse picklist number (e.g. PK39506). Set when picklist is first generated.';

comment on column public.scott_orders.picklist_generated_at is
  'When the picklist was first generated for this order.';

create unique index if not exists scott_orders_picklist_no_idx
  on public.scott_orders (picklist_no)
  where picklist_no is not null;

notify pgrst, 'reload schema';
