alter table public.outward_challans
  add column if not exists receiver_name text not null default '';
