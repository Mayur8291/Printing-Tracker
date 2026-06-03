-- Admin-managed links to shared drives, Excel sheets, etc.
create table if not exists public.shared_resource_links (
  id bigint generated always as identity primary key,
  title text not null,
  url text not null,
  description text,
  category text not null default 'other',
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_resource_links_title_len
    check (char_length(trim(title)) between 1 and 200),
  constraint shared_resource_links_url_len
    check (char_length(trim(url)) between 8 and 2048),
  constraint shared_resource_links_category_check
    check (category in ('sharepoint', 'excel', 'other'))
);

create index if not exists shared_resource_links_sort_idx
  on public.shared_resource_links (sort_order asc, title asc);

alter table public.shared_resource_links enable row level security;

drop policy if exists "shared links read authenticated" on public.shared_resource_links;
create policy "shared links read authenticated"
on public.shared_resource_links
for select to authenticated
using (true);

drop policy if exists "shared links insert admin" on public.shared_resource_links;
create policy "shared links insert admin"
on public.shared_resource_links
for insert to authenticated
with check (public.jwt_user_is_admin());

drop policy if exists "shared links update admin" on public.shared_resource_links;
create policy "shared links update admin"
on public.shared_resource_links
for update to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

drop policy if exists "shared links delete admin" on public.shared_resource_links;
create policy "shared links delete admin"
on public.shared_resource_links
for delete to authenticated
using (public.jwt_user_is_admin());

create or replace function public.touch_shared_resource_links_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists shared_resource_links_touch_updated_at on public.shared_resource_links;
create trigger shared_resource_links_touch_updated_at
before update on public.shared_resource_links
for each row execute function public.touch_shared_resource_links_updated_at();
