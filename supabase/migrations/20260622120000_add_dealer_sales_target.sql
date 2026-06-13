-- Annual sales target per dealer (admin sets). Monitored quarterly; daily feed; weekly progress.

alter table public.dealers
  add column if not exists sales_target bigint not null default 0 check (sales_target >= 0);

comment on column public.dealers.sales_target is 'Annual distributor sales target amount';
