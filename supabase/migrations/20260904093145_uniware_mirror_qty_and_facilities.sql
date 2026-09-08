-- Extra Uniware snapshot buckets so Available is not the only qty shown.
-- inventory = available; blocked / open sale / putaway still sit in the warehouse.

alter table public.uni_inventory_mirror
  add column if not exists qty_blocked numeric(14, 2) not null default 0,
  add column if not exists qty_open_sale numeric(14, 2) not null default 0,
  add column if not exists qty_putaway numeric(14, 2) not null default 0;

comment on column public.uni_inventory_mirror.qty is
  'Uniware available quantity (inventorySnapshots.inventory).';
comment on column public.uni_inventory_mirror.qty_blocked is
  'Uniware inventoryBlocked.';
comment on column public.uni_inventory_mirror.qty_open_sale is
  'Uniware openSale (allocated to orders).';
comment on column public.uni_inventory_mirror.qty_putaway is
  'Uniware putawayPending.';

notify pgrst, 'reload schema';
