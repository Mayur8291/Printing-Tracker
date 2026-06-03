-- OC form: quantity, bora/carton count, full barcode payload.

alter table public.outward_challans
  add column if not exists quantity text not null default '';

alter table public.outward_challans
  add column if not exists bora_carton_count text not null default '';

alter table public.outward_challans
  add column if not exists barcode_payload jsonb;
