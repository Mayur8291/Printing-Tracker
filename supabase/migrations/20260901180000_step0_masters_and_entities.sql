-- Step 0 of the One Source of Truth roadmap (docs/ONE_SOURCE_OF_TRUTH_ROADMAP.md).
-- Masters and entities: core_ (entities, GSTINs, sequences, locations),
-- cat_ (brand, style, colour, sku, kit, channel listing, GST slabs),
-- crm_ (party, gstin, address, contact, bank, vendor item), hr_employee,
-- plus audit_log with row-change triggers on every master.
-- Laws enforced here (docs/laws.md): one master per entity; unique normalized
-- names; merges keep history (merged_into_id); audit on every master; RLS in DB.
-- Scott API tables/functions are untouched; existing SKU codes will be imported
-- into cat_sku exactly as-is (never renamed).

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- audit_log — one row per insert/update/delete on every master table.
-- security definer so the trigger can write regardless of the actor's RLS.
-- ---------------------------------------------------------------------------

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_row jsonb,
  new_row jsonb,
  actor uuid,
  at timestamptz not null default now()
);

create index if not exists audit_log_table_row_idx
  on public.audit_log (table_name, row_id, at desc);

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (table_name, row_id, action, new_row, actor)
    values (tg_table_name, new.id::text, tg_op, to_jsonb(new), auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (table_name, row_id, action, old_row, new_row, actor)
    values (tg_table_name, new.id::text, tg_op, to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  else
    insert into public.audit_log (table_name, row_id, action, old_row, actor)
    values (tg_table_name, old.id::text, tg_op, to_jsonb(old), auth.uid());
    return old;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- core_entity — legal entities; core_gstin — every seller GSTIN (15 today).
-- Every future document carries entity_id + gstin_id.
-- ---------------------------------------------------------------------------

create table if not exists public.core_entity (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  legal_name text not null,
  trade_name text,
  pan text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists core_entity_norm_name_idx
  on public.core_entity (lower(regexp_replace(legal_name, '\s+', ' ', 'g')));

create table if not exists public.core_gstin (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.core_entity(id) on delete restrict,
  gstin text not null unique check (length(gstin) = 15),
  state_code text generated always as (substring(gstin from 1 for 2)) stored,
  registered_address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- core_sequence — gapless document numbering per entity × gstin × doc type × FY.
-- Allocation only through core_next_sequence() which locks the row.
create table if not exists public.core_sequence (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.core_entity(id) on delete restrict,
  gstin_id uuid references public.core_gstin(id) on delete restrict,
  doc_type text not null,
  fy_label text not null,
  prefix text not null default '',
  pad_width smallint not null default 4,
  next_number bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists core_sequence_scope_idx
  on public.core_sequence (
    entity_id,
    coalesce(gstin_id, '00000000-0000-0000-0000-000000000000'::uuid),
    doc_type,
    fy_label
  );

create or replace function public.core_next_sequence(
  p_entity_id uuid,
  p_gstin_id uuid,
  p_doc_type text,
  p_fy_label text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.core_sequence%rowtype;
begin
  select * into v_row
  from public.core_sequence
  where entity_id = p_entity_id
    and gstin_id is not distinct from p_gstin_id
    and doc_type = p_doc_type
    and fy_label = p_fy_label
  for update;

  if not found then
    raise exception 'No sequence configured for entity %, doc type %, FY %',
      p_entity_id, p_doc_type, p_fy_label;
  end if;

  update public.core_sequence
  set next_number = v_row.next_number + 1
  where id = v_row.id;

  return v_row.prefix || lpad(v_row.next_number::text, v_row.pad_width, '0');
end;
$$;

revoke execute on function public.core_next_sequence(uuid, uuid, text, text) from public, anon;
grant execute on function public.core_next_sequence(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Catalog: brand → style → colour → sku (one row per size), kits, listings,
-- GST slabs (rate by price band as data, with effective dates).
-- ---------------------------------------------------------------------------

create table if not exists public.cat_gst_slab (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rate_percent numeric(5, 2) not null check (rate_percent >= 0),
  price_band_min numeric(12, 2),
  price_band_max numeric(12, 2),
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cat_brand (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cat_brand_norm_name_idx
  on public.cat_brand (lower(regexp_replace(name, '\s+', ' ', 'g')));

insert into public.cat_brand (name)
values
  ('Scott'), ('AWG'), ('Zenshark'), ('Cutiepaw'),
  ('Holydrip'), ('Not Funny'), ('Giordano'), ('UCB')
on conflict do nothing;

create table if not exists public.cat_style (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  brand_id uuid references public.cat_brand(id) on delete restrict,
  category text,
  size_type text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cat_colour (
  id uuid primary key default gen_random_uuid(),
  style_id uuid not null references public.cat_style(id) on delete restrict,
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (style_id, code)
);

-- colour_id is nullable so legacy/Uniware SKUs can be imported first and
-- structured into style/colour before Step 1 (stock ledger) goes live.
-- sku_code is inherited exactly as it exists today (incl. Scott integration codes).
create table if not exists public.cat_sku (
  id uuid primary key default gen_random_uuid(),
  sku_code text not null unique,
  colour_id uuid references public.cat_colour(id) on delete restrict,
  barcode text,
  size_label text,
  size_order smallint,
  hsn text,
  gst_slab_id uuid references public.cat_gst_slab(id) on delete restrict,
  item_kind text not null default 'finished_good'
    check (item_kind in ('finished_good', 'raw_material', 'packaging', 'consumable')),
  is_kit boolean not null default false,
  uom text not null default 'pcs',
  weight_grams numeric(10, 2),
  standard_cost numeric(12, 2),
  mrp numeric(12, 2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cat_sku_barcode_idx
  on public.cat_sku (barcode)
  where barcode is not null;

create table if not exists public.cat_kit (
  id uuid primary key default gen_random_uuid(),
  kit_sku_id uuid not null references public.cat_sku(id) on delete restrict,
  component_sku_id uuid not null references public.cat_sku(id) on delete restrict,
  qty numeric(10, 2) not null check (qty > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kit_sku_id, component_sku_id),
  check (kit_sku_id <> component_sku_id)
);

create table if not exists public.cat_channel_listing (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.cat_sku(id) on delete restrict,
  channel text not null,
  listing_code text not null,
  entity_id uuid references public.core_entity(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sku_id, channel, entity_id)
);

create index if not exists cat_channel_listing_code_idx
  on public.cat_channel_listing (channel, listing_code);

-- ---------------------------------------------------------------------------
-- CRM: one party master for customers, vendors, job workers, transporters,
-- principals. parent_id for branches; merged_into_id keeps merge history.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_party (
  id uuid primary key default gen_random_uuid(),
  kind text not null
    check (kind in ('customer', 'vendor', 'job_worker', 'transporter', 'principal')),
  legal_name text not null,
  trade_name text,
  segment text,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  credit_days integer not null default 0 check (credit_days >= 0),
  credit_limit numeric(14, 2),
  price_list text,
  pan text,
  parent_id uuid references public.crm_party(id) on delete restrict,
  merged_into_id uuid references public.crm_party(id) on delete restrict,
  msme_udyam_number text,
  msme_category text check (msme_category in ('micro', 'small', 'medium')),
  lead_time_days integer,
  payment_terms text,
  default_qc_required boolean not null default true,
  rating numeric(3, 1),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Unique normalized name per kind among live (unmerged) masters.
create unique index if not exists crm_party_norm_name_idx
  on public.crm_party (kind, lower(regexp_replace(legal_name, '\s+', ' ', 'g')))
  where merged_into_id is null;

create index if not exists crm_party_kind_active_idx
  on public.crm_party (kind, is_active);

create table if not exists public.crm_party_gstin (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.crm_party(id) on delete cascade,
  gstin text not null check (length(gstin) = 15),
  state_code text generated always as (substring(gstin from 1 for 2)) stored,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (party_id, gstin)
);

create table if not exists public.crm_address (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.crm_party(id) on delete cascade,
  kind text not null default 'billing' check (kind in ('billing', 'shipping', 'other')),
  line1 text not null,
  line2 text,
  city text,
  state text,
  pincode text,
  country text not null default 'India',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_contact (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.crm_party(id) on delete cascade,
  name text not null,
  designation text,
  phone text,
  email text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bank details live in their own table so RLS can lock them to admin/accounts.
create table if not exists public.crm_party_bank (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.crm_party(id) on delete cascade,
  account_name text,
  account_number text,
  ifsc text,
  bank_name text,
  branch text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_vendor_item (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.crm_party(id) on delete cascade,
  sku_id uuid not null references public.cat_sku(id) on delete restrict,
  last_rate numeric(12, 2),
  moq numeric(12, 2),
  lead_time_days integer,
  qc_exempt boolean not null default false,
  preferred_rank smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vendor_id, sku_id)
);

-- ---------------------------------------------------------------------------
-- core_location — warehouses, zones, bins and virtual locations, each with one
-- owner system (law 5). party_id links job-worker / distributor locations.
-- Created after crm_party because of the party_id FK.
-- ---------------------------------------------------------------------------

create table if not exists public.core_location (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('warehouse', 'zone', 'bin', 'virtual')),
  virtual_kind text check (virtual_kind in (
    'qc_hold', 'damaged', 'in_transit', 'job_worker',
    'amazon_fc', 'distributor', 'uniware_facility'
  )),
  owner_system text not null default 'platform'
    check (owner_system in ('platform', 'uniware', 'external')),
  parent_id uuid references public.core_location(id) on delete restrict,
  party_id uuid references public.crm_party(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'virtual') = (virtual_kind is not null))
);

-- ---------------------------------------------------------------------------
-- hr_employee — people master, linked to auth via profiles.
-- ---------------------------------------------------------------------------

create table if not exists public.hr_employee (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique references public.profiles(id) on delete set null,
  employee_code text unique,
  full_name text not null,
  department text,
  tier smallint check (tier between 1 and 6),
  manager_id uuid references public.hr_employee(id) on delete set null,
  in_time time,
  status text not null default 'active' check (status in ('active', 'on_leave', 'exited')),
  joined_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at + audit triggers on every master.
-- core_sequence gets no audit trigger: one row per allocated number would flood
-- the log; the numbered documents themselves are the audit trail (DECISIONS.md).
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'core_entity', 'core_gstin', 'core_sequence', 'core_location',
    'cat_gst_slab', 'cat_brand', 'cat_style', 'cat_colour', 'cat_sku',
    'cat_kit', 'cat_channel_listing',
    'crm_party', 'crm_party_gstin', 'crm_address', 'crm_contact',
    'crm_party_bank', 'crm_vendor_item',
    'hr_employee'
  ]
  loop
    execute format(
      'drop trigger if exists %I on public.%I;
       create trigger %I before update on public.%I
       for each row execute function public.set_updated_at();',
      t || '_touch_updated_at', t, t || '_touch_updated_at', t
    );

    if t <> 'core_sequence' then
      execute format(
        'drop trigger if exists %I on public.%I;
         create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_row_change();',
        t || '_audit', t, t || '_audit', t
      );
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: read for signed-in users, write admin-only (jwt_user_is_admin), except
-- crm_party_bank (admin-only for everything) and audit_log (admin read, no
-- direct writes — the definer trigger inserts).
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'core_entity', 'core_gstin', 'core_sequence', 'core_location',
    'cat_gst_slab', 'cat_brand', 'cat_style', 'cat_colour', 'cat_sku',
    'cat_kit', 'cat_channel_listing',
    'crm_party', 'crm_party_gstin', 'crm_address', 'crm_contact',
    'crm_vendor_item',
    'hr_employee'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);

    execute format(
      'drop policy if exists "%s read authenticated" on public.%I;
       create policy "%s read authenticated" on public.%I
       for select to authenticated using (true);',
      t, t, t, t
    );

    execute format(
      'drop policy if exists "%s admin write" on public.%I;
       create policy "%s admin write" on public.%I
       for all to authenticated
       using (public.jwt_user_is_admin())
       with check (public.jwt_user_is_admin());',
      t, t, t, t
    );
  end loop;
end;
$$;

alter table public.crm_party_bank enable row level security;

drop policy if exists "crm_party_bank admin only" on public.crm_party_bank;
create policy "crm_party_bank admin only"
on public.crm_party_bank
for all
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

alter table public.audit_log enable row level security;

drop policy if exists "audit_log admin read" on public.audit_log;
create policy "audit_log admin read"
on public.audit_log
for select
to authenticated
using (public.jwt_user_is_admin());
