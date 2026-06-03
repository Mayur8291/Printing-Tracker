-- Optional size breakdown on inward GRN entries (same shape as orders.size_breakdown).

alter table public.inward_entries
  add column if not exists size_breakdown jsonb;

comment on column public.inward_entries.size_breakdown is
  'Optional map of size label to quantity; omitted or null when not captured.';
