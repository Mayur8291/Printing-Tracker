-- Contact Book: team directory entries; admins manage, all authenticated users can view.

create table if not exists public.contact_book_entries (
  id bigint generated always as identity primary key,
  photo_path text,
  name text not null,
  designation text,
  contact_number text,
  alternate_contact_number text,
  date_of_birth date,
  address text,
  email text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_book_name_len check (char_length(trim(name)) >= 1 and char_length(name) <= 200)
);

create index if not exists contact_book_entries_name_idx
  on public.contact_book_entries (lower(trim(name)));

alter table public.contact_book_entries enable row level security;

drop policy if exists "contact book read authenticated" on public.contact_book_entries;
create policy "contact book read authenticated"
on public.contact_book_entries
for select
to authenticated
using (true);

drop policy if exists "contact book insert admin" on public.contact_book_entries;
create policy "contact book insert admin"
on public.contact_book_entries
for insert
to authenticated
with check (public.jwt_user_is_admin());

drop policy if exists "contact book update admin" on public.contact_book_entries;
create policy "contact book update admin"
on public.contact_book_entries
for update
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

drop policy if exists "contact book delete admin" on public.contact_book_entries;
create policy "contact book delete admin"
on public.contact_book_entries
for delete
to authenticated
using (public.jwt_user_is_admin());

insert into storage.buckets (id, name, public)
values ('contact-book-photos', 'contact-book-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "contact book photos read authenticated" on storage.objects;
create policy "contact book photos read authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'contact-book-photos');

drop policy if exists "contact book photos upload admin" on storage.objects;
create policy "contact book photos upload admin"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'contact-book-photos'
  and public.jwt_user_is_admin()
);

drop policy if exists "contact book photos update admin" on storage.objects;
create policy "contact book photos update admin"
on storage.objects
for update
to authenticated
using (bucket_id = 'contact-book-photos' and public.jwt_user_is_admin())
with check (bucket_id = 'contact-book-photos' and public.jwt_user_is_admin());

drop policy if exists "contact book photos delete admin" on storage.objects;
create policy "contact book photos delete admin"
on storage.objects
for delete
to authenticated
using (bucket_id = 'contact-book-photos' and public.jwt_user_is_admin());
