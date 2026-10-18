-- Asset Management register: company IT assets (laptops, phones, …).
-- Staging first. Not production until an explicit release.

create table if not exists public.hr_assets (
  id uuid primary key default gen_random_uuid(),
  tag text not null,
  name text not null,
  category text not null,
  manufacturer text not null default '',
  model text not null default '',
  serial_number text not null default '',
  purchase_date text not null default '',
  location text not null,
  status text not null
    check (status in ('Available', 'Checked out', 'Maintenance', 'Retired')),
  assignee_user_id uuid references public.profiles(id) on delete restrict,
  assignee_name text not null default '—',
  notes text not null default '',
  charger_included boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_assets_tag_unique unique (tag),
  constraint hr_assets_tag_format check (tag ~ '^IT-[0-9]+$'),
  constraint hr_assets_name_not_empty check (length(trim(name)) > 0),
  constraint hr_assets_assignee_matches_status check (
    (assignee_user_id is null and status <> 'Checked out')
    or (assignee_user_id is not null and status = 'Checked out')
  )
);

create index if not exists hr_assets_created_idx
  on public.hr_assets (created_at desc);

create index if not exists hr_assets_status_idx
  on public.hr_assets (status, created_at desc);

create or replace function public.touch_hr_assets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists hr_assets_touch_updated_at on public.hr_assets;
create trigger hr_assets_touch_updated_at
before update on public.hr_assets
for each row
execute function public.touch_hr_assets_updated_at();

alter table public.hr_assets enable row level security;

drop policy if exists "hr_assets select authenticated" on public.hr_assets;
create policy "hr_assets select authenticated"
on public.hr_assets
for select
to authenticated
using (true);

drop policy if exists "hr_assets insert own" on public.hr_assets;
create policy "hr_assets insert own"
on public.hr_assets
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "hr_assets update authenticated" on public.hr_assets;
create policy "hr_assets update authenticated"
on public.hr_assets
for update
to authenticated
using (true)
with check (true);

grant select, insert, update on public.hr_assets to authenticated;

do $realtime$
begin
  alter publication supabase_realtime add table public.hr_assets;
exception when duplicate_object then null;
end;
$realtime$;
