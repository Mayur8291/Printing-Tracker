-- Separate bill image from package image on inward entries.

alter table public.inward_entries
  add column if not exists bill_photo_path text;

comment on column public.inward_entries.bill_photo_path is
  'Storage path for uploaded bill image.';
