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
alter table public.profiles add column if not exists job_role text;
alter table public.profiles add column if not exists employee_id text;
alter table public.profiles add column if not exists is_active boolean not null default true;

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

create table if not exists public.sales_incharges (
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
  qty integer not null check (qty >= 0),
  product_name text not null,
  colors text[] not null default '{}',
  approved_design_url text not null,
  due_date date not null,
  printing_mtrs numeric(12, 2) not null check (printing_mtrs >= 0),
  status text not null check (status in ('new', 'approval_pending', 'in_production', 'printing', 'fusing', 'ironing', 'packing', 'pending', 'on_hold', 'ready', 'sent_to_dispatch')) default 'new',
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
check (status in ('new', 'approval_pending', 'in_production', 'printing', 'fusing', 'ironing', 'packing', 'pending', 'on_hold', 'ready', 'sent_to_dispatch', 'dispatch_fail', 'dispatched'));

alter table public.orders add column if not exists status_ready_at timestamptz;

alter table public.orders add column if not exists is_live boolean not null default false;
alter table public.orders add column if not exists is_complete boolean not null default false;
alter table public.orders add column if not exists order_id text;
alter table public.orders add column if not exists approved_design_images text;
alter table public.orders add column if not exists approved_design_images_archive text;

alter table public.orders
  add column if not exists post_approved_design_review_status text
    check (
      post_approved_design_review_status is null
      or post_approved_design_review_status in ('pending', 'approved', 'needs_changes')
    );
alter table public.orders add column if not exists post_approved_design_changes_note text;
alter table public.orders add column if not exists post_approved_design_reviewed_by uuid references auth.users(id);
alter table public.orders add column if not exists post_approved_design_reviewed_at timestamptz;

/** Per-size piece counts (XS … 3XL). Keys must match ORDER_SIZE_COLUMNS in App.jsx. */
alter table public.orders add column if not exists size_breakdown jsonb not null default '{}'::jsonb;

alter table public.orders add column if not exists is_production_order boolean not null default false;
alter table public.orders add column if not exists expected_handover_to_printing date;
alter table public.orders add column if not exists sales_incharge_name text;
alter table public.orders add column if not exists size_type text;
alter table public.orders add column if not exists rate_per_piece numeric(12, 2) check (rate_per_piece is null or rate_per_piece >= 0);
alter table public.orders add column if not exists brand text;
alter table public.orders add column if not exists fabric_type text;
alter table public.orders add column if not exists branding boolean;
alter table public.orders add column if not exists branding_type text;
alter table public.orders add column if not exists gsm text;
alter table public.orders add column if not exists atta boolean;
alter table public.orders add column if not exists received_at_printing timestamptz;

alter table public.orders add column if not exists payment_method text;
alter table public.orders add column if not exists payment_screenshot_url text;

alter table public.orders add column if not exists invoice_url text;

alter table public.orders add column if not exists delivery_method text;

alter table public.orders add column if not exists dispatch_sizes_verified jsonb not null default '{}'::jsonb;
alter table public.orders add column if not exists dispatch_sizes_qty_ok boolean;
alter table public.orders add column if not exists dispatch_product_name_ok boolean;
alter table public.orders add column if not exists dispatch_colors_ok boolean;
alter table public.orders add column if not exists dispatch_issue_type text;
alter table public.orders add column if not exists dispatch_verification_failed boolean not null default false;
alter table public.orders add column if not exists dispatch_verified_at timestamptz;
alter table public.orders add column if not exists dispatch_verified_by uuid references auth.users(id);

alter table public.orders drop constraint if exists orders_payment_method_check;
alter table public.orders add constraint orders_payment_method_check
check (
  payment_method is null
  or payment_method in (
    'paid',
    'pi_sent_advance_received',
    'pi_sent_pending_payment'
  )
);

alter table public.orders drop constraint if exists orders_delivery_method_check;
alter table public.orders add constraint orders_delivery_method_check
check (
  delivery_method is null
  or delivery_method in ('self_pickup', 'porter', 'courier_service')
);

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

alter table public.profile_order_permissions
  add column if not exists allowed_dashboard_tabs text[] default null;

alter table public.profile_order_permissions
  add column if not exists editable_dashboard_tabs text[] default null;

alter table public.profile_order_permissions
  add column if not exists can_edit_payment_method boolean not null default false;

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.owners enable row level security;
alter table public.coordinators enable row level security;
alter table public.sales_incharges enable row level security;
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

drop policy if exists "sales_incharges readable by authenticated users" on public.sales_incharges;
create policy "sales_incharges readable by authenticated users"
on public.sales_incharges
for select
to authenticated
using (true);

drop policy if exists "sales_incharges insert admin only" on public.sales_incharges;
create policy "sales_incharges insert admin only"
on public.sales_incharges
for insert
to authenticated
with check (
  public.jwt_user_is_admin()
);

drop policy if exists "sales_incharges delete admin only" on public.sales_incharges;
create policy "sales_incharges delete admin only"
on public.sales_incharges
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
  actor_department text;
  allow_create boolean := false;
  allow_status boolean := false;
  allow_remarks boolean := false;
  allow_due_date boolean := false;
  allow_qty boolean := false;
  allow_coordinator_name boolean := false;
  allow_printing_mtrs boolean := false;
  allow_approved_design_images boolean := true;
  allow_received_at_printing boolean := false;
  allow_payment_method boolean := false;
  allow_sales_review boolean := false;
  has_field_edit boolean := false;
  review_fields_changed boolean := false;
  images_changed boolean := false;
begin
  select role, coalesce(department, '') into actor_role, actor_department
  from public.profiles
  where id = auth.uid();

  allow_sales_review := actor_department ilike '%sales%';

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
      coalesce(pop.can_edit_received_at_printing, false),
      coalesce(pop.can_edit_payment_method, false)
    into allow_create, allow_status, allow_remarks, allow_due_date, allow_qty, allow_coordinator_name, allow_printing_mtrs, allow_approved_design_images, allow_received_at_printing, allow_payment_method
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
      allow_payment_method := false;
    end if;

    images_changed := new.approved_design_images is distinct from old.approved_design_images;
    review_fields_changed :=
      new.post_approved_design_review_status is distinct from old.post_approved_design_review_status
      or new.post_approved_design_changes_note is distinct from old.post_approved_design_changes_note
      or new.post_approved_design_reviewed_by is distinct from old.post_approved_design_reviewed_by
      or new.post_approved_design_reviewed_at is distinct from old.post_approved_design_reviewed_at;

    if images_changed then
      if not allow_approved_design_images then
        raise exception 'Viewer cannot edit approved design images';
      end if;
      return new;
    end if;

    -- Billing: invoice upload only (any workflow status).
    if new.invoice_url is distinct from old.invoice_url
       and new.id is not distinct from old.id
       and new.status is not distinct from old.status
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
       and new.approved_design_images_archive is not distinct from old.approved_design_images_archive
       and new.post_approved_design_review_status is not distinct from old.post_approved_design_review_status
       and new.post_approved_design_changes_note is not distinct from old.post_approved_design_changes_note
       and new.post_approved_design_reviewed_by is not distinct from old.post_approved_design_reviewed_by
       and new.post_approved_design_reviewed_at is not distinct from old.post_approved_design_reviewed_at
       and new.due_date is not distinct from old.due_date
       and new.printing_mtrs is not distinct from old.printing_mtrs
       and new.remarks is not distinct from old.remarks
       and new.payment_method is not distinct from old.payment_method
       and new.payment_screenshot_url is not distinct from old.payment_screenshot_url
       and new.delivery_method is not distinct from old.delivery_method
       and new.created_by is not distinct from old.created_by
       and new.created_at is not distinct from old.created_at
       and new.is_live is not distinct from old.is_live
       and new.is_complete is not distinct from old.is_complete
       and new.is_production_order is not distinct from old.is_production_order
       and new.expected_handover_to_printing is not distinct from old.expected_handover_to_printing
       and new.received_at_printing is not distinct from old.received_at_printing
       and new.status_ready_at is not distinct from old.status_ready_at
    then
      return new;
    end if;

    -- SLA auto-step: new -> pending after 12h, or 10min when delivery is same/next day as order date.
    if old.status = 'new'
       and new.status = 'pending'
       and not old.is_complete
       and not new.is_complete
       and (
         old.created_at <= (now() - interval '12 hours')
         or (
           old.created_at <= (now() - interval '10 minutes')
           and public.order_has_urgent_delivery_window(old.order_date, old.due_date)
         )
       )
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
       and new.approved_design_images_archive is not distinct from old.approved_design_images_archive
       and new.post_approved_design_review_status is not distinct from old.post_approved_design_review_status
       and new.post_approved_design_changes_note is not distinct from old.post_approved_design_changes_note
       and new.post_approved_design_reviewed_by is not distinct from old.post_approved_design_reviewed_by
       and new.post_approved_design_reviewed_at is not distinct from old.post_approved_design_reviewed_at
       and new.due_date is not distinct from old.due_date
       and new.printing_mtrs is not distinct from old.printing_mtrs
       and new.remarks is not distinct from old.remarks
       and new.payment_method is not distinct from old.payment_method
       and new.delivery_method is not distinct from old.delivery_method
       and new.created_by is not distinct from old.created_by
       and new.created_at is not distinct from old.created_at
       and new.is_live is not distinct from old.is_live
       and new.is_production_order is not distinct from old.is_production_order
       and new.expected_handover_to_printing is not distinct from old.expected_handover_to_printing
       and new.received_at_printing is not distinct from old.received_at_printing
       and new.status_ready_at is not distinct from old.status_ready_at
    then
      return new;
    end if;

    has_field_edit :=
      allow_status
      or allow_remarks
      or allow_due_date
      or allow_qty
      or allow_coordinator_name
      or allow_printing_mtrs
      or allow_payment_method
      or allow_approved_design_images
      or allow_received_at_printing
      or (allow_sales_review and review_fields_changed);

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
        or new.post_approved_design_review_status is distinct from old.post_approved_design_review_status
        or new.post_approved_design_changes_note is distinct from old.post_approved_design_changes_note
        or new.post_approved_design_reviewed_by is distinct from old.post_approved_design_reviewed_by
        or new.post_approved_design_reviewed_at is distinct from old.post_approved_design_reviewed_at
        or new.received_at_printing is distinct from old.received_at_printing
        or new.payment_method is distinct from old.payment_method
        or new.payment_screenshot_url is distinct from old.payment_screenshot_url
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

    if review_fields_changed and not allow_sales_review then
      raise exception 'Only sales department users can approve or request design changes';
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
    if not allow_received_at_printing and new.received_at_printing is distinct from old.received_at_printing then
      raise exception 'Viewer cannot edit received date/time to printing';
    end if;
    if not allow_payment_method and new.payment_method is distinct from old.payment_method then
      raise exception 'Viewer cannot edit payment method';
    end if;
    if not allow_payment_method and new.payment_screenshot_url is distinct from old.payment_screenshot_url then
      raise exception 'Viewer cannot edit payment proof';
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

create or replace function public.order_has_urgent_delivery_window(p_order_date date, p_due_date date)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_order_date is not null
    and p_due_date is not null
    and p_due_date >= p_order_date
    and p_due_date <= (p_order_date + 1);
$$;

create or replace function public.promote_stale_new_orders_to_pending()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  promoted_count integer;
begin
  update public.orders
  set status = 'pending'
  where status = 'new'
    and not is_complete
    and (
      created_at <= (now() - interval '12 hours')
      or (
        created_at <= (now() - interval '10 minutes')
        and public.order_has_urgent_delivery_window(order_date, due_date)
      )
    );

  get diagnostics promoted_count = row_count;
  return promoted_count;
end;
$$;

revoke all on function public.promote_stale_new_orders_to_pending() from public;
grant execute on function public.promote_stale_new_orders_to_pending() to authenticated;

-- Team chat (see migration 20260526120000_add_team_chat.sql).
create table if not exists public.team_chat_messages (
  id bigint generated always as identity primary key,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  mentioned_user_ids uuid[] not null default '{}',
  mentioned_order_ids bigint[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint team_chat_body_len check (char_length(trim(body)) >= 1 and char_length(body) <= 4000)
);

create index if not exists team_chat_messages_created_at_idx
  on public.team_chat_messages (created_at desc);

alter table public.team_chat_messages enable row level security;

drop policy if exists "team chat read authenticated" on public.team_chat_messages;
create policy "team chat read authenticated"
on public.team_chat_messages
for select
to authenticated
using (true);

drop policy if exists "team chat insert own" on public.team_chat_messages;
create policy "team chat insert own"
on public.team_chat_messages
for insert
to authenticated
with check (author_id = auth.uid());

drop policy if exists "profiles select team directory" on public.profiles;
create policy "profiles select team directory"
on public.profiles
for select
to authenticated
using (auth.uid() is not null);

alter table public.team_chat_messages
  add column if not exists author_label text;

create or replace function public.list_team_chat_directory()
returns table (
  id uuid,
  full_name text,
  email text,
  department text,
  role text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    p.email,
    p.department,
    p.role
  from public.profiles p
  where nullif(trim(p.full_name), '') is not null
     or p.role = 'admin'
  order by lower(coalesce(nullif(trim(p.full_name), ''), 'admin'));
$$;

revoke all on function public.list_team_chat_directory() from public;
grant execute on function public.list_team_chat_directory() to authenticated;

alter table public.team_chat_messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size bigint;

alter table public.team_chat_messages
  drop constraint if exists team_chat_body_len;

alter table public.team_chat_messages
  add constraint team_chat_body_len check (
    char_length(coalesce(body, '')) <= 4000
    and (
      char_length(trim(coalesce(body, ''))) >= 1
      or nullif(trim(attachment_path), '') is not null
    )
  );

insert into storage.buckets (id, name, public)
values ('team-chat-files', 'team-chat-files', true)
on conflict (id) do update set public = true;

drop policy if exists "team chat files read authenticated" on storage.objects;
create policy "team chat files read authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'team-chat-files');

drop policy if exists "team chat files upload own folder" on storage.objects;
create policy "team chat files upload own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'team-chat-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.purge_expired_team_chat_attachments()
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  purged_count integer := 0;
  rec record;
begin
  for rec in
    select id, attachment_path, body
    from public.team_chat_messages
    where nullif(trim(attachment_path), '') is not null
      and created_at <= (now() - interval '24 hours')
  loop
    delete from storage.objects
    where bucket_id = 'team-chat-files'
      and name = rec.attachment_path;

    if char_length(trim(coalesce(rec.body, ''))) < 1 then
      delete from public.team_chat_messages
      where id = rec.id;
    else
      update public.team_chat_messages
      set
        attachment_path = null,
        attachment_name = null,
        attachment_mime = null,
        attachment_size = null
      where id = rec.id;
    end if;

    purged_count := purged_count + 1;
  end loop;

  return purged_count;
end;
$$;

revoke all on function public.purge_expired_team_chat_attachments() from public;
grant execute on function public.purge_expired_team_chat_attachments() to service_role;

-- Contact Book (see migration 20260526160000_add_contact_book.sql).
create table if not exists public.contact_book_entries (
  id bigint generated always as identity primary key,
  photo_path text,
  name text not null,
  designation text,
  department text,
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

alter table public.contact_book_entries enable row level security;

drop policy if exists "contact book read authenticated" on public.contact_book_entries;
create policy "contact book read authenticated"
on public.contact_book_entries for select to authenticated using (true);

drop policy if exists "contact book insert admin" on public.contact_book_entries;
create policy "contact book insert admin"
on public.contact_book_entries for insert to authenticated with check (public.jwt_user_is_admin());

drop policy if exists "contact book update admin" on public.contact_book_entries;
create policy "contact book update admin"
on public.contact_book_entries for update to authenticated
using (public.jwt_user_is_admin()) with check (public.jwt_user_is_admin());

drop policy if exists "contact book delete admin" on public.contact_book_entries;
create policy "contact book delete admin"
on public.contact_book_entries for delete to authenticated using (public.jwt_user_is_admin());

insert into storage.buckets (id, name, public)
values ('contact-book-photos', 'contact-book-photos', true)
on conflict (id) do update set public = true;

-- Per-job activity timeline (see migration 20260520180000_add_order_activity_log.sql for full definition).
create table if not exists public.order_activity_log (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  event_type text not null,
  message text not null,
  meta jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  actor_label text not null default 'System',
  created_at timestamptz not null default now()
);

create index if not exists order_activity_log_order_id_created_at_idx
  on public.order_activity_log (order_id, created_at desc);

alter table public.order_activity_log enable row level security;

drop policy if exists "order_activity_log select authenticated" on public.order_activity_log;
create policy "order_activity_log select authenticated"
on public.order_activity_log
for select
to authenticated
using (true);

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

insert into storage.buckets (id, name, public)
values ('payment-screenshots', 'payment-screenshots', true)
on conflict (id) do nothing;

drop policy if exists "payment screenshots read authenticated" on storage.objects;
create policy "payment screenshots read authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'payment-screenshots');

drop policy if exists "payment screenshots upload admin" on storage.objects;
create policy "payment screenshots upload admin"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payment-screenshots'
  and public.jwt_user_is_admin()
);

drop policy if exists "payment screenshots upload viewer create" on storage.objects;
create policy "payment screenshots upload viewer create"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payment-screenshots'
  and public.jwt_viewer_can_create_orders()
);

insert into storage.buckets (id, name, public)
values ('order-invoices', 'order-invoices', true)
on conflict (id) do nothing;

drop policy if exists "order invoices read authenticated" on storage.objects;
create policy "order invoices read authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'order-invoices');

drop policy if exists "order invoices upload authenticated" on storage.objects;
create policy "order invoices upload authenticated"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'order-invoices');

drop policy if exists "order invoices update authenticated" on storage.objects;
create policy "order invoices update authenticated"
on storage.objects
for update
to authenticated
using (bucket_id = 'order-invoices')
with check (bucket_id = 'order-invoices');

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

-- Repeat-order templates (see migration 20260601120000_add_order_templates.sql).
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

-- Optional saved images + production handover date (see migration 20260602120000_extend_order_templates.sql).
alter table public.order_templates
  add column if not exists image_paths text[] not null default array[]::text[];
alter table public.order_templates
  add column if not exists expected_handover_to_printing date;

insert into storage.buckets (id, name, public)
values ('order-template-images', 'order-template-images', true)
on conflict (id) do update set public = true;

drop policy if exists "order template images read authenticated" on storage.objects;
create policy "order template images read authenticated"
on storage.objects
for select
to authenticated
using (bucket_id = 'order-template-images');

drop policy if exists "order template images insert own" on storage.objects;
create policy "order template images insert own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'order-template-images'
  and (
    public.jwt_user_is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

drop policy if exists "order template images update own" on storage.objects;
create policy "order template images update own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'order-template-images'
  and (
    public.jwt_user_is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

drop policy if exists "order template images delete own" on storage.objects;
create policy "order template images delete own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'order-template-images'
  and (
    public.jwt_user_is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

-- Per-order commercial values (see migration 20260603120000_add_order_costs.sql).
alter table public.orders
  add column if not exists order_cost numeric(12, 2),
  add column if not exists printing_cost numeric(12, 2);

alter table public.order_templates
  add column if not exists order_cost numeric(12, 2),
  add column if not exists printing_cost numeric(12, 2);

-- Order kind: printing vs regular stock (see migration 20260605120000_add_order_kind.sql).
alter table public.orders
  add column if not exists order_kind text not null default 'printing'
  check (order_kind in ('printing', 'regular_stock'));

alter table public.order_templates
  add column if not exists order_kind text not null default 'printing'
  check (order_kind in ('printing', 'regular_stock'));

-- Shared resource links (see migration 20260604120000_add_shared_resource_links.sql).
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

-- Coordinator assignment notifications (see migration 20260612120000_add_order_assignment_notifications.sql).
create table if not exists public.order_assignment_notifications (
  id bigint generated always as identity primary key,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  order_id bigint not null references public.orders(id) on delete cascade,
  order_display_id text,
  coordinator_name text not null,
  assigned_by_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists order_assignment_notifications_recipient_created_idx
  on public.order_assignment_notifications (recipient_user_id, created_at desc);

alter table public.order_assignment_notifications enable row level security;

drop policy if exists "assignment notifications read own" on public.order_assignment_notifications;
create policy "assignment notifications read own"
on public.order_assignment_notifications
for select
to authenticated
using (recipient_user_id = auth.uid());

drop policy if exists "assignment notifications insert authenticated" on public.order_assignment_notifications;
create policy "assignment notifications insert authenticated"
on public.order_assignment_notifications
for insert
to authenticated
with check (assigned_by_user_id = auth.uid());
