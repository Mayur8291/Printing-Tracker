-- Repeat-order templates: pre-defined order sets the user knows will recur.
-- Each row is a single "template" owned by one user; only owner + admin can read/write it.

create table if not exists public.order_templates (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  owner_name text,
  customer_name text,
  coordinator_name text,
  product_name text,
  colors text[] not null default array[]::text[],
  size_breakdown jsonb not null default '{}'::jsonb,
  printing_mtrs numeric(10, 2) not null default 0,
  remarks text,
  is_production_order boolean not null default false,
  payment_method text,
  delivery_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_templates_name_len
    check (char_length(trim(name)) between 1 and 120)
);

create index if not exists order_templates_user_id_idx
  on public.order_templates (user_id, updated_at desc);

alter table public.order_templates enable row level security;

drop policy if exists "order templates read own" on public.order_templates;
create policy "order templates read own"
on public.order_templates
for select to authenticated
using (auth.uid() = user_id or public.jwt_user_is_admin());

drop policy if exists "order templates insert own" on public.order_templates;
create policy "order templates insert own"
on public.order_templates
for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "order templates update own" on public.order_templates;
create policy "order templates update own"
on public.order_templates
for update to authenticated
using (auth.uid() = user_id or public.jwt_user_is_admin())
with check (auth.uid() = user_id or public.jwt_user_is_admin());

drop policy if exists "order templates delete own" on public.order_templates;
create policy "order templates delete own"
on public.order_templates
for delete to authenticated
using (auth.uid() = user_id or public.jwt_user_is_admin());

-- Keep updated_at fresh.
create or replace function public.touch_order_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists order_templates_touch_updated_at on public.order_templates;
create trigger order_templates_touch_updated_at
before update on public.order_templates
for each row execute function public.touch_order_templates_updated_at();
