-- Extra supplier fields for GSTIN, address, and material type traded.

alter table public.inventory_suppliers
  add column if not exists gstin text not null default '',
  add column if not exists address text not null default '',
  add column if not exists supplier_type text not null default 'other'
    check (supplier_type in ('fabric', 'trim', 'other'));

notify pgrst, 'reload schema';
