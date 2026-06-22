-- Rich GRN inward form detail (apparel bora lines + fabric receipt lines).

alter table public.inward_grn_entries
  add column if not exists grn_entry_detail jsonb;

comment on column public.inward_grn_entries.grn_entry_detail is
  'Structured GRN form: type (apparel|fabric), header extras, boras[], fabrics[].';
