-- Department on inward entries (initial Make Entry step).

alter table public.inward_entries
  add column if not exists department text not null default '';

comment on column public.inward_entries.department is
  'Department selected when the inward entry was created.';
