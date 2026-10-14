-- The first slab seed stored ₹ per square meter (legacy ₹/sq in ÷ 0.0254²).
-- Quotes are ₹ per square inch. Put an untouched seed back to rate_per_sq_in.
-- A rate an admin already changed is left as stored.

update public.print_calculator_settings
set
  internal_rate_1_10 = case
    when internal_rate_1_10 = round((rate_per_sq_in / (0.0254 * 0.0254))::numeric, 4) then rate_per_sq_in
    else internal_rate_1_10
  end,
  internal_rate_11_200 = case
    when internal_rate_11_200 = round((rate_per_sq_in / (0.0254 * 0.0254))::numeric, 4) then rate_per_sq_in
    else internal_rate_11_200
  end,
  internal_rate_201_1000 = case
    when internal_rate_201_1000 = round((rate_per_sq_in / (0.0254 * 0.0254))::numeric, 4) then rate_per_sq_in
    else internal_rate_201_1000
  end,
  customer_rate_1_10 = case
    when customer_rate_1_10 = round((rate_per_sq_in / (0.0254 * 0.0254))::numeric, 4) then rate_per_sq_in
    else customer_rate_1_10
  end,
  customer_rate_11_200 = case
    when customer_rate_11_200 = round((rate_per_sq_in / (0.0254 * 0.0254))::numeric, 4) then rate_per_sq_in
    else customer_rate_11_200
  end,
  customer_rate_201_1000 = case
    when customer_rate_201_1000 = round((rate_per_sq_in / (0.0254 * 0.0254))::numeric, 4) then rate_per_sq_in
    else customer_rate_201_1000
  end
where id = 1;

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
