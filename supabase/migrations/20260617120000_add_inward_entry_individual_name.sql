-- Name when department is Individual / Personal on inward entries.

alter table public.inward_entries
  add column if not exists individual_name text not null default '';

comment on column public.inward_entries.individual_name is
  'Person name when department is Individual / Personal.';
