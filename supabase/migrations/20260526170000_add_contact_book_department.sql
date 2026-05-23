alter table public.contact_book_entries
  add column if not exists department text;

create index if not exists contact_book_entries_department_idx
  on public.contact_book_entries (lower(trim(coalesce(department, ''))));
