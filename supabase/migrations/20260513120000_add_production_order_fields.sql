-- Production order flag + expected handover date for printing
alter table public.orders add column if not exists is_production_order boolean not null default false;
alter table public.orders add column if not exists expected_handover_to_printing date;
