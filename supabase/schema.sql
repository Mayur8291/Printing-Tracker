-- Run this in Supabase SQL editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role text not null check (role in ('admin', 'viewer')) default 'viewer',
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;

alter table public.profiles add column if not exists department text;

create table if not exists public.admin_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

create table if not exists public.owners (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.coordinators (
  id bigint generated always as identity primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id bigint generated always as identity primary key,
  order_date date not null,
  owner_name text not null default '',
  customer_name text not null,
  coordinator_name text not null,
  qty integer not null check (qty > 0),
  product_name text not null,
  colors text[] not null default '{}',
  approved_design_url text not null,
  due_date date not null,
  printing_mtrs numeric(12, 2) not null check (printing_mtrs >= 0),
  status text not null check (status in ('new', 'approval_pending', 'printing', 'fusing', 'ironing', 'packing', 'pending', 'on_hold', 'ready')) default 'new',
  remarks text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.orders add column if not exists colors text[] not null default '{}';
alter table public.orders add column if not exists printing_mtrs numeric(12, 2) not null default 0 check (printing_mtrs >= 0);
alter table public.orders add column if not exists owner_name text not null default '';
alter table public.orders drop column if exists printing_cost;
alter table public.orders drop column if exists cost_per_mtr;
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
check (status in ('new', 'approval_pending', 'printing', 'fusing', 'ironing', 'packing', 'pending', 'on_hold', 'ready'));

alter table public.orders add column if not exists is_live boolean not null default false;
alter table public.orders add column if not exists is_complete boolean not null default false;
alter table public.orders add column if not exists order_id text;
alter table public.orders add column if not exists approved_design_images text;

/** Per-size piece counts (XS … 3XL). Keys must match ORDER_SIZE_COLUMNS in App.jsx. */
alter table public.orders add column if not exists size_breakdown jsonb not null default '{}'::jsonb;

alter table public.orders add column if not exists is_production_order boolean not null default false;
alter table public.orders add column if not exists expected_handover_to_printing date;
alter table public.orders add column if not exists received_at_printing timestamptz;

drop trigger if exists trg_enforce_max_live_orders on public.orders;
drop function if exists public.enforce_max_three_live_orders();

create table if not exists public.profile_order_permissions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  can_edit_status boolean not null default true,
  can_edit_remarks boolean not null default false,
  can_edit_due_date boolean not null default false,
  can_edit_qty boolean not null default false,
  can_edit_coordinator_name boolean not null default false,
  can_edit_printing_mtrs boolean not null default false,
  can_edit_received_at_printing boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.profile_order_permissions
  add column if not exists can_edit_printing_mtrs boolean not null default false;

alter table public.profile_order_permissions
  add column if not exists can_create_orders boolean not null default false;

alter table public.profile_order_permissions
  add column if not exists can_edit_approved_design_images boolean not null default true;

alter table public.profile_order_permissions
  add column if not exists can_edit_received_at_printing boolean not null default false;

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.owners enable row level security;
alter table public.coordinators enable row level security;
alter table public.profile_order_permissions enable row level security;

alter table public.admin_emails enable row level security;

drop policy if exists "admin_emails read own email row" on public.admin_emails;
create policy "admin_emails read own email row"
on public.admin_emails
for select
to authenticated
using (
  lower(trim(email)) = lower(trim(coalesce(auth.jwt()->>'email', '')))
);

-- Used in RLS policies instead of subqueries on public.profiles (avoids infinite recursion).
create or replace function public.jwt_user_is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select pr.role = 'admin' from public.profiles pr where pr.id = auth.uid()),
    false
  );
$$;

grant execute on function public.jwt_user_is_admin() to authenticated;
grant execute on function public.jwt_user_is_admin() to service_role;

create or replace function public.jwt_viewer_can_create_orders()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (
      select pr.role = 'viewer' and coalesce(pop.can_create_orders, false)
      from public.profiles pr
      left join public.profile_order_permissions pop on pop.user_id = pr.id
      where pr.id = auth.uid()
    ),
    false
  );
$$;

grant execute on function public.jwt_viewer_can_create_orders() to authenticated;
grant execute on function public.jwt_viewer_can_create_orders() to service_role;

-- Profiles policies (split: own row + admin can list all)
drop policy if exists "profiles select own or admin" on public.profiles;
drop policy if exists "profiles select own" on public.profiles;
drop policy if exists "profiles select all as admin" on public.profiles;

create policy "profiles select own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "profiles select all as admin"
on public.profiles
for select
to authenticated
using (public.jwt_user_is_admin());

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles upsert own" on public.profiles;
-- Profile rows are usually created by auth trigger; insert-own allows self-heal when missing.

drop policy if exists "profile order permissions read own or admin" on public.profile_order_permissions;
create policy "profile order permissions read own or admin"
on public.profile_order_permissions
for select
to authenticated
using (
  user_id = auth.uid()
  or public.jwt_user_is_admin()
);

drop policy if exists "profile order permissions upsert admin" on public.profile_order_permissions;
create policy "profile order permissions upsert admin"
on public.profile_order_permissions
for all
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

-- Admins may update viewer rows (e.g. full_name) for support; cannot target admin rows (see USING).
drop policy if exists "profiles update admin viewers" on public.profiles;
create policy "profiles update admin viewers"
on public.profiles
for update
to authenticated
using (public.jwt_user_is_admin() and role = 'viewer')
with check (public.jwt_user_is_admin() and role = 'viewer');

create or replace function public.enforce_profile_update_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    if new.role = 'admin'
      and old.role = 'viewer'
      and exists (
        select 1
        from auth.users u
        join public.admin_emails a on lower(trim(a.email)) = lower(trim(u.email::text))
        where u.id = new.id
      ) then
      return new;
    end if;
    raise exception 'Role cannot be changed by client update';
  end if;

  if new.department is distinct from old.department
    and auth.uid() = new.id
    and not public.jwt_user_is_admin() then
    raise exception 'Department can only be set by an administrator';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_profile_update_scope on public.profiles;
create trigger trg_enforce_profile_update_scope
before update on public.profiles
for each row execute procedure public.enforce_profile_update_scope();

-- Orders policies
drop policy if exists "orders readable by authenticated users" on public.orders;
create policy "orders readable by authenticated users"
on public.orders
for select
to authenticated
using (true);

drop policy if exists "owners readable by authenticated users" on public.owners;
create policy "owners readable by authenticated users"
on public.owners
for select
to authenticated
using (true);

drop policy if exists "owners insert admin only" on public.owners;
create policy "owners insert admin only"
on public.owners
for insert
to authenticated
with check (
  public.jwt_user_is_admin()
);

drop policy if exists "owners update admin only" on public.owners;
create policy "owners update admin only"
on public.owners
for update
to authenticated
using (
  public.jwt_user_is_admin()
)
with check (
  public.jwt_user_is_admin()
);

drop policy if exists "owners delete admin only" on public.owners;
create policy "owners delete admin only"
on public.owners
for delete
to authenticated
using (
  public.jwt_user_is_admin()
);

drop policy if exists "coordinators readable by authenticated users" on public.coordinators;
create policy "coordinators readable by authenticated users"
on public.coordinators
for select
to authenticated
using (true);

drop policy if exists "coordinators insert admin only" on public.coordinators;
create policy "coordinators insert admin only"
on public.coordinators
for insert
to authenticated
with check (
  public.jwt_user_is_admin()
);

drop policy if exists "coordinators update admin only" on public.coordinators;
create policy "coordinators update admin only"
on public.coordinators
for update
to authenticated
using (
  public.jwt_user_is_admin()
)
with check (
  public.jwt_user_is_admin()
);

drop policy if exists "coordinators delete admin only" on public.coordinators;
create policy "coordinators delete admin only"
on public.coordinators
for delete
to authenticated
using (
  public.jwt_user_is_admin()
);

drop policy if exists "orders insert admin only" on public.orders;
create policy "orders insert admin only"
on public.orders
for insert
to authenticated
with check (
  public.jwt_user_is_admin()
);

drop policy if exists "orders insert viewer with create permission" on public.orders;
create policy "orders insert viewer with create permission"
on public.orders
for insert
to authenticated
with check (
  public.jwt_viewer_can_create_orders()
  and created_by = auth.uid()
);

drop policy if exists "orders update viewer and admin" on public.orders;
create policy "orders update viewer and admin"
on public.orders
for update
to authenticated
using (true)
with check (true);

drop policy if exists "orders delete admin only" on public.orders;
create policy "orders delete admin only"
on public.orders
for delete
to authenticated
using (public.jwt_user_is_admin());

create or replace function public.enforce_order_update_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  allow_create boolean := false;
  allow_status boolean := false;
  allow_remarks boolean := false;
  allow_due_date boolean := false;
  allow_qty boolean := false;
  allow_coordinator_name boolean := false;
  allow_printing_mtrs boolean := false;
  allow_approved_design_images boolean := true;
  allow_received_at_printing boolean := false;
  has_field_edit boolean := false;
begin
  select role into actor_role from public.profiles where id = auth.uid();

  if actor_role = 'admin' then
    return new;
  end if;

  if actor_role = 'viewer' then
    select
      coalesce(pop.can_create_orders, false),
      coalesce(pop.can_edit_status, true),
      coalesce(pop.can_edit_remarks, false),
      coalesce(pop.can_edit_due_date, false),
      coalesce(pop.can_edit_qty, false),
      coalesce(pop.can_edit_coordinator_name, false),
      coalesce(pop.can_edit_printing_mtrs, false),
      coalesce(pop.can_edit_approved_design_images, true),
      coalesce(pop.can_edit_received_at_printing, false)
    into allow_create, allow_status, allow_remarks, allow_due_date, allow_qty, allow_coordinator_name, allow_printing_mtrs, allow_approved_design_images, allow_received_at_printing
    from public.profile_order_permissions pop
    where pop.user_id = auth.uid();

    if not found then
      allow_create := false;
      allow_status := true;
      allow_remarks := false;
      allow_due_date := false;
      allow_qty := false;
      allow_coordinator_name := false;
      allow_printing_mtrs := false;
      allow_approved_design_images := true;
      allow_received_at_printing := false;
    end if;

    -- SLA auto-step: new -> pending after 12h, status only (enforced staleness on created_at).
    if old.status = 'new'
       and new.status = 'pending'
       and not old.is_complete
       and not new.is_complete
       and old.created_at <= (now() - interval '12 hours')
       and new.id is not distinct from old.id
       and new.order_date is not distinct from old.order_date
       and new.order_id is not distinct from old.order_id
       and new.owner_name is not distinct from old.owner_name
       and new.customer_name is not distinct from old.customer_name
       and new.coordinator_name is not distinct from old.coordinator_name
       and new.qty is not distinct from old.qty
       and new.size_breakdown is not distinct from old.size_breakdown
       and new.product_name is not distinct from old.product_name
       and new.colors is not distinct from old.colors
       and new.approved_design_url is not distinct from old.approved_design_url
       and new.approved_design_images is not distinct from old.approved_design_images
       and new.due_date is not distinct from old.due_date
       and new.printing_mtrs is not distinct from old.printing_mtrs
       and new.remarks is not distinct from old.remarks
       and new.created_by is not distinct from old.created_by
       and new.created_at is not distinct from old.created_at
       and new.is_live is not distinct from old.is_live
       and new.is_production_order is not distinct from old.is_production_order
       and new.expected_handover_to_printing is not distinct from old.expected_handover_to_printing
       and new.received_at_printing is not distinct from old.received_at_printing
    then
      return new;
    end if;

    has_field_edit := allow_status or allow_remarks or allow_due_date or allow_qty or allow_coordinator_name or allow_printing_mtrs or allow_approved_design_images or allow_received_at_printing;

    if old.created_by is not distinct from auth.uid()
      and allow_create
      and not has_field_edit
      and (
        new.status is distinct from old.status
        or new.remarks is distinct from old.remarks
        or new.due_date is distinct from old.due_date
        or new.qty is distinct from old.qty
        or new.coordinator_name is distinct from old.coordinator_name
        or new.printing_mtrs is distinct from old.printing_mtrs
        or new.approved_design_images is distinct from old.approved_design_images
        or new.received_at_printing is distinct from old.received_at_printing
      ) then
      raise exception 'Orders you created cannot be edited after saving. Ask an admin to grant field access if you need to update this job.';
    end if;

    if new.order_date is distinct from old.order_date
      or new.owner_name is distinct from old.owner_name
      or new.customer_name is distinct from old.customer_name
      or new.product_name is distinct from old.product_name
      or new.colors is distinct from old.colors
      or new.approved_design_url is distinct from old.approved_design_url
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.is_live is distinct from old.is_live
      or new.is_complete is distinct from old.is_complete then
      raise exception 'Viewer is not allowed to edit those fields';
    end if;

    if not allow_printing_mtrs and new.printing_mtrs is distinct from old.printing_mtrs then
      raise exception 'Viewer cannot edit printing mtrs';
    end if;

    if not allow_status and new.status is distinct from old.status then
      raise exception 'Viewer cannot edit status';
    end if;
    if not allow_remarks and new.remarks is distinct from old.remarks then
      raise exception 'Viewer cannot edit remarks';
    end if;
    if not allow_due_date and new.due_date is distinct from old.due_date then
      raise exception 'Viewer cannot edit due date';
    end if;
    if not allow_qty and new.qty is distinct from old.qty then
      raise exception 'Viewer cannot edit qty';
    end if;
    if not allow_coordinator_name and new.coordinator_name is distinct from old.coordinator_name then
      raise exception 'Viewer cannot edit coordinator';
    end if;
    if not allow_approved_design_images and new.approved_design_images is distinct from old.approved_design_images then
      raise exception 'Viewer cannot edit approved design images';
    end if;
    if not allow_received_at_printing and new.received_at_printing is distinct from old.received_at_printing then
      raise exception 'Viewer cannot edit received date/time to printing';
    end if;
    return new;
  end if;

  raise exception 'No valid role for order update';
end;
$$;

drop trigger if exists trg_enforce_order_update_scope on public.orders;
create trigger trg_enforce_order_update_scope
before update on public.orders
for each row execute procedure public.enforce_order_update_scope();

-- Optional: auto profile row creation on signup with viewer role.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.admin_emails (email)
  values ('admin@scott.com')
  on conflict (email) do nothing;

  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    lower(trim(new.email::text)),
    case
      when exists (
        select 1 from public.admin_emails a
        where lower(a.email) = lower(new.email)
      ) then 'admin'
      else 'viewer'
    end
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(nullif(profiles.full_name, ''), excluded.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

insert into storage.buckets (id, name, public)
values ('approved-designs', 'approved-designs', true)
on conflict (id) do nothing;

drop policy if exists "designs read all authenticated" on storage.objects;
create policy "designs read all authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'approved-designs');

drop policy if exists "designs upload admin only" on storage.objects;
create policy "designs upload admin only"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'approved-designs'
  and public.jwt_user_is_admin()
);

drop policy if exists "designs upload viewer can create orders" on storage.objects;
create policy "designs upload viewer can create orders"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'approved-designs'
  and public.jwt_viewer_can_create_orders()
);

drop policy if exists "designs upload post approved path" on storage.objects;
create policy "designs upload post approved path"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'approved-designs'
  and name like 'post-approved/%'
);

drop policy if exists "designs delete admin only" on storage.objects;
create policy "designs delete admin only"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'approved-designs'
  and public.jwt_user_is_admin()
);

drop policy if exists "designs delete post approved path" on storage.objects;
create policy "designs delete post approved path"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'approved-designs'
  and name like 'post-approved/%'
);

insert into public.admin_emails (email)
values ('admin@scott.com')
on conflict (email) do nothing;

-- Backfill profile emails from auth (run after adding column).
update public.profiles p
set email = lower(trim(u.email::text))
from auth.users u
where p.id = u.id
  and (p.email is null or p.email = '');

-- Promote already-created users whose email exists in admin_emails.
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and exists (
    select 1 from public.admin_emails a
    where lower(a.email) = lower(u.email)
  );
