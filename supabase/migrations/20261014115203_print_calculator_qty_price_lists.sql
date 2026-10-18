-- Print cost calculator: internal team and customer rates, ₹ per square inch,
-- for copy slabs 1–10, 11–200, and 201–1000.

insert into public.print_calculator_settings (id, rate_per_sq_in)
values (1, 1)
on conflict (id) do nothing;

alter table public.print_calculator_settings
  add column if not exists internal_rate_1_10 numeric(14, 4),
  add column if not exists internal_rate_11_200 numeric(14, 4),
  add column if not exists internal_rate_201_1000 numeric(14, 4),
  add column if not exists customer_rate_1_10 numeric(14, 4),
  add column if not exists customer_rate_11_200 numeric(14, 4),
  add column if not exists customer_rate_201_1000 numeric(14, 4);

-- Copy the legacy ₹ per square inch into every slab until an admin saves real breaks.
update public.print_calculator_settings
set
  internal_rate_1_10 = coalesce(internal_rate_1_10, rate_per_sq_in),
  internal_rate_11_200 = coalesce(internal_rate_11_200, rate_per_sq_in),
  internal_rate_201_1000 = coalesce(internal_rate_201_1000, rate_per_sq_in),
  customer_rate_1_10 = coalesce(customer_rate_1_10, rate_per_sq_in),
  customer_rate_11_200 = coalesce(customer_rate_11_200, rate_per_sq_in),
  customer_rate_201_1000 = coalesce(customer_rate_201_1000, rate_per_sq_in)
where id = 1;

alter table public.print_calculator_settings
  alter column internal_rate_1_10 set not null,
  alter column internal_rate_11_200 set not null,
  alter column internal_rate_201_1000 set not null,
  alter column customer_rate_1_10 set not null,
  alter column customer_rate_11_200 set not null,
  alter column customer_rate_201_1000 set not null;

alter table public.print_calculator_settings
  drop constraint if exists print_calculator_internal_rate_1_10_pos,
  drop constraint if exists print_calculator_internal_rate_11_200_pos,
  drop constraint if exists print_calculator_internal_rate_201_1000_pos,
  drop constraint if exists print_calculator_customer_rate_1_10_pos,
  drop constraint if exists print_calculator_customer_rate_11_200_pos,
  drop constraint if exists print_calculator_customer_rate_201_1000_pos;

alter table public.print_calculator_settings
  add constraint print_calculator_internal_rate_1_10_pos check (internal_rate_1_10 > 0),
  add constraint print_calculator_internal_rate_11_200_pos check (internal_rate_11_200 > 0),
  add constraint print_calculator_internal_rate_201_1000_pos check (internal_rate_201_1000 > 0),
  add constraint print_calculator_customer_rate_1_10_pos check (customer_rate_1_10 > 0),
  add constraint print_calculator_customer_rate_11_200_pos check (customer_rate_11_200 > 0),
  add constraint print_calculator_customer_rate_201_1000_pos check (customer_rate_201_1000 > 0);

comment on table public.print_calculator_settings is
  'Singleton print-cost rates in ₹ per square inch. Internal team and customer each have slabs for 1–10, 11–200, and 201–1000 copies. Legacy rate_per_sq_in is the seed only.';

comment on column public.print_calculator_settings.internal_rate_1_10 is
  'Internal team ₹ per square inch for 1–10 copies.';
comment on column public.print_calculator_settings.internal_rate_11_200 is
  'Internal team ₹ per square inch for 11–200 copies.';
comment on column public.print_calculator_settings.internal_rate_201_1000 is
  'Internal team ₹ per square inch for 201–1000 copies. Also used above 1000.';
comment on column public.print_calculator_settings.customer_rate_1_10 is
  'Customer ₹ per square inch for 1–10 copies.';
comment on column public.print_calculator_settings.customer_rate_11_200 is
  'Customer ₹ per square inch for 11–200 copies.';
comment on column public.print_calculator_settings.customer_rate_201_1000 is
  'Customer ₹ per square inch for 201–1000 copies. Also used above 1000.';

notify pgrst, 'reload schema';
