-- Per-order commercial values: order_cost = customer billing, printing_cost = vendor cost.
alter table public.orders
  add column if not exists order_cost numeric(12, 2),
  add column if not exists printing_cost numeric(12, 2);

comment on column public.orders.order_cost is
  'Amount charged to the customer for this order, in the local currency.';
comment on column public.orders.printing_cost is
  'Printing / vendor cost for this order, in the local currency.';

-- Mirror onto order templates so repeats carry the costs forward.
alter table public.order_templates
  add column if not exists order_cost numeric(12, 2),
  add column if not exists printing_cost numeric(12, 2);

comment on column public.order_templates.order_cost is
  'Default order cost (customer billing) saved with the template.';
comment on column public.order_templates.printing_cost is
  'Default printing / vendor cost saved with the template.';
