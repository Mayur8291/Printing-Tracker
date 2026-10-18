-- Step 2 of the One Source of Truth roadmap: Procurement.
-- PO lifecycle -> GRN -> QC -> stock (via the Step 1 ledger) -> vendor bill
-- (three-way match) -> debit notes -> payments -> vendor ledger.
--
-- User decisions (2 Sep 2026):
--   1. QC gate default ON: every GRN line lands in qc_hold unless the
--      vendor-item is flagged qc_exempt (falls back to party.default_qc_required).
--   2. PO approval: CEO / anyone with admin access (jwt_user_is_admin gate).
--   3. Tolerances are editable data: po_settings singleton + per-vendor-item
--      over_receipt_pct override. Rate variance tolerance for bill matching.
--
-- Laws applied: money is a document; state machines in the DB (status flips
-- only through functions, enforced by trigger + transaction-local flag);
-- gapless numbers per entity x FY (assigned at approval/posting, so drafts
-- never burn a number); documents immutable once posted/approved; never
-- hard-delete posted paper; audit rows on every document.
--
-- Also upgrades the Step 1 ledger: inv_movement gains to_state so QC can flip
-- state at the SAME location (qc_hold -> good / damaged). Scott API untouched.

-- ---------------------------------------------------------------------------
-- 0. Ledger upgrade: same-location state changes (needed by QC pass/fail).
-- ---------------------------------------------------------------------------

alter table public.inv_movement
  add column if not exists to_state text
  check (to_state in ('good', 'qc_hold', 'damaged'));

-- Replace "from <> to" with "from <> to OR the state changes".
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.inv_movement'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%is distinct from%';
  if v_name is not null then
    execute format('alter table public.inv_movement drop constraint %I', v_name);
  end if;
end;
$$;

alter table public.inv_movement
  add constraint inv_movement_loc_or_state_check check (
    from_location_id is distinct from to_location_id
    or (to_state is not null and to_state <> state)
  );

-- inv_post_movement now takes an optional destination state.
drop function if exists public.inv_post_movement(uuid, uuid, uuid, numeric, text, text, text, text, text, text);
create or replace function public.inv_post_movement(
  p_sku_id uuid,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_qty numeric,
  p_state text default 'good',
  p_reason text default 'adjustment',
  p_ref_type text default null,
  p_ref_id text default null,
  p_lot text default null,
  p_note text default null,
  p_to_state text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_to_state text := coalesce(p_to_state, p_state);
begin
  perform public.inv_assert_can_post();

  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;
  if p_from_location_id is null and p_to_location_id is null then
    raise exception 'Movement needs a from or a to location';
  end if;
  if p_from_location_id is not distinct from p_to_location_id
     and v_to_state = p_state then
    raise exception 'Same-location movement must change state';
  end if;
  if p_reason in ('adjustment', 'cycle_count') and coalesce(trim(p_note), '') = '' then
    raise exception 'Adjustments need a reason note';
  end if;

  if p_from_location_id is not null then
    perform public.inv_apply_balance(p_sku_id, p_from_location_id, p_state, -p_qty);
  end if;
  if p_to_location_id is not null then
    perform public.inv_apply_balance(p_sku_id, p_to_location_id, v_to_state, p_qty);
  end if;

  insert into public.inv_movement (
    sku_id, from_location_id, to_location_id, qty, state, to_state, reason,
    ref_type, ref_id, lot, note, actor
  )
  values (
    p_sku_id, p_from_location_id, p_to_location_id, p_qty, p_state,
    case when v_to_state <> p_state then v_to_state else null end,
    p_reason, p_ref_type, p_ref_id, p_lot,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.inv_post_movement(uuid, uuid, uuid, numeric, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.inv_post_movement(uuid, uuid, uuid, numeric, text, text, text, text, text, text, text) to authenticated;

-- Drift recompute must credit the destination with the destination state.
create or replace function public.inv_recompute_drift()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alerts int := 0;
begin
  insert into public.inv_drift_alert (sku_id, location_id, state, ledger_qty, balance_qty)
  select
    coalesce(l.sku_id, b.sku_id),
    coalesce(l.location_id, b.location_id),
    coalesce(l.state, b.state),
    coalesce(l.ledger_qty, 0),
    coalesce(b.qty, 0)
  from (
    select sku_id, location_id, state, sum(delta) as ledger_qty
    from (
      select sku_id, to_location_id as location_id,
             coalesce(to_state, state) as state, qty as delta
      from public.inv_movement where to_location_id is not null
      union all
      select sku_id, from_location_id as location_id, state, -qty as delta
      from public.inv_movement where from_location_id is not null
    ) m
    group by sku_id, location_id, state
  ) l
  full outer join public.inv_balance b
    on b.sku_id = l.sku_id and b.location_id = l.location_id and b.state = l.state
  where coalesce(l.ledger_qty, 0) <> coalesce(b.qty, 0);

  get diagnostics v_alerts = row_count;
  return v_alerts;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Shared helpers.
-- ---------------------------------------------------------------------------

-- General admin gate for ops-platform documents (same policy as inv_assert_can_post:
-- admin app users, or server contexts where auth.uid() is null).
create or replace function public.ops_assert_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.jwt_user_is_admin() then
    raise exception 'Only admin (CEO / admin access) can do this';
  end if;
end;
$$;
revoke execute on function public.ops_assert_admin() from public, anon;

-- Indian financial year label: 2026-04-01 -> '2026-27'.
create or replace function public.ops_fy_label(p_date date)
returns text
language sql
immutable
as $$
  select case
    when extract(month from p_date) >= 4
      then extract(year from p_date)::int::text || '-' || right((extract(year from p_date)::int + 1)::text, 2)
    else (extract(year from p_date)::int - 1)::text || '-' || right(extract(year from p_date)::int::text, 2)
  end;
$$;

-- Gapless number with auto-provisioned sequence row (prefix DOC/FY/).
create or replace function public.ops_next_doc_no(
  p_entity_id uuid,
  p_doc_type text,
  p_date date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fy text := public.ops_fy_label(p_date);
begin
  insert into public.core_sequence (entity_id, gstin_id, doc_type, fy_label, prefix, pad_width)
  values (p_entity_id, null, p_doc_type, v_fy, upper(p_doc_type) || '/' || v_fy || '/', 4)
  on conflict do nothing;

  return public.core_next_sequence(p_entity_id, null, p_doc_type, v_fy);
end;
$$;
revoke execute on function public.ops_next_doc_no(uuid, text, date) from public, anon, authenticated;

-- Transaction-local flag: status columns may only change inside our functions.
create or replace function public.ops_status_change_allowed()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('ops.allow_status_change', true), '') = '1';
$$;

-- ---------------------------------------------------------------------------
-- 2. Editable tolerances (decision 3) + vendor-item override.
-- ---------------------------------------------------------------------------

create table if not exists public.po_settings (
  id smallint primary key default 1 check (id = 1),
  over_receipt_tolerance_pct numeric(5, 2) not null default 5 check (over_receipt_tolerance_pct >= 0),
  rate_variance_tolerance_pct numeric(5, 2) not null default 2 check (rate_variance_tolerance_pct >= 0),
  msme_due_cap_days integer not null default 45 check (msme_due_cap_days > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.po_settings (id) values (1) on conflict (id) do nothing;

alter table public.crm_vendor_item
  add column if not exists over_receipt_pct numeric(5, 2)
  check (over_receipt_pct is null or over_receipt_pct >= 0);

-- ---------------------------------------------------------------------------
-- 3. Purchase orders.
-- Status machine: draft -> approved -> partially_received -> fulfilled -> closed;
-- short_closed from approved/partially_received; cancelled from draft/approved
-- (before any receipt). "sent/open" from the roadmap are deferred until PO
-- PDF/email exists — documented in DECISIONS.md.
-- ---------------------------------------------------------------------------

create table if not exists public.po_purchase_order (
  id uuid primary key default gen_random_uuid(),
  po_no text unique,
  entity_id uuid not null references public.core_entity(id) on delete restrict,
  vendor_id uuid not null references public.crm_party(id) on delete restrict,
  order_date date not null default current_date,
  expected_date date,
  delivery_location_id uuid not null references public.core_location(id) on delete restrict,
  credit_days integer not null default 0 check (credit_days >= 0),
  payment_terms text,
  note text,
  status text not null default 'draft' check (status in (
    'draft', 'approved', 'partially_received', 'fulfilled',
    'closed', 'short_closed', 'cancelled'
  )),
  status_reason text,
  created_by uuid default auth.uid(),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists po_purchase_order_vendor_idx
  on public.po_purchase_order (vendor_id, status);
create index if not exists po_purchase_order_status_idx
  on public.po_purchase_order (status, order_date desc);

create table if not exists public.po_line (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.po_purchase_order(id) on delete cascade,
  sku_id uuid not null references public.cat_sku(id) on delete restrict,
  qty_ordered numeric(12, 2) not null check (qty_ordered > 0),
  rate numeric(12, 2) not null check (rate >= 0),
  tax_pct numeric(5, 2) not null default 0 check (tax_pct >= 0),
  expected_date date,
  qty_received numeric(12, 2) not null default 0 check (qty_received >= 0),
  qty_rejected numeric(12, 2) not null default 0 check (qty_rejected >= 0),
  qty_cancelled numeric(12, 2) not null default 0 check (qty_cancelled >= 0),
  created_at timestamptz not null default now(),
  unique (po_id, sku_id)
);

create index if not exists po_line_po_idx on public.po_line (po_id);

-- Header guard: commercial fields freeze after draft; status flips only via functions.
create or replace function public.po_header_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only draft POs can be deleted — cancel or short-close instead';
    end if;
    return old;
  end if;
  if new.status is distinct from old.status and not public.ops_status_change_allowed() then
    raise exception 'PO status changes only through po_approve / po_cancel / po_short_close / po_close';
  end if;
  if old.status <> 'draft' and (
    new.entity_id is distinct from old.entity_id
    or new.vendor_id is distinct from old.vendor_id
    or new.order_date is distinct from old.order_date
    or new.delivery_location_id is distinct from old.delivery_location_id
    or new.credit_days is distinct from old.credit_days
    or new.po_no is distinct from old.po_no and not public.ops_status_change_allowed()
  ) then
    raise exception 'Approved PO is immutable — short-close and raise a fresh PO to amend';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists po_header_guard_t on public.po_purchase_order;
create trigger po_header_guard_t
before update or delete on public.po_purchase_order
for each row execute function public.po_header_guard();

-- Line guard: lines editable only while the PO is draft; after that only the
-- received/rejected/cancelled counters (maintained by functions) may move.
create or replace function public.po_line_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status
  from public.po_purchase_order
  where id = coalesce(new.po_id, old.po_id);

  if tg_op = 'INSERT' then
    if v_status <> 'draft' then
      raise exception 'Lines can only be added to a draft PO';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if v_status <> 'draft' then
      raise exception 'Lines can only be removed from a draft PO';
    end if;
    return old;
  end if;
  if v_status <> 'draft' and (
    new.sku_id is distinct from old.sku_id
    or new.qty_ordered is distinct from old.qty_ordered
    or new.rate is distinct from old.rate
    or new.tax_pct is distinct from old.tax_pct
  ) then
    raise exception 'Approved PO lines are immutable — short-close and raise a fresh PO';
  end if;
  return new;
end;
$$;

drop trigger if exists po_line_guard_t on public.po_line;
create trigger po_line_guard_t
before insert or update or delete on public.po_line
for each row execute function public.po_line_guard();

-- Approve: admin only (decision 2); assigns the gapless PO number.
create or replace function public.po_approve(p_po_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.po_purchase_order%rowtype;
  v_no text;
begin
  perform public.ops_assert_admin();

  select * into v_po from public.po_purchase_order where id = p_po_id for update;
  if not found then raise exception 'PO not found'; end if;
  if v_po.status <> 'draft' then
    raise exception 'Only draft POs can be approved (current: %)', v_po.status;
  end if;
  if not exists (select 1 from public.po_line where po_id = p_po_id) then
    raise exception 'PO has no lines';
  end if;

  v_no := public.ops_next_doc_no(v_po.entity_id, 'po', v_po.order_date);

  perform set_config('ops.allow_status_change', '1', true);
  update public.po_purchase_order
  set status = 'approved', po_no = v_no,
      approved_by = auth.uid(), approved_at = now()
  where id = p_po_id;
  perform set_config('ops.allow_status_change', '', true);

  return v_no;
end;
$$;

create or replace function public.po_cancel(p_po_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.po_purchase_order%rowtype;
begin
  perform public.ops_assert_admin();
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancellation needs a reason';
  end if;

  select * into v_po from public.po_purchase_order where id = p_po_id for update;
  if not found then raise exception 'PO not found'; end if;
  if v_po.status not in ('draft', 'approved') then
    raise exception 'Only draft/approved POs with no receipts can be cancelled (current: %)', v_po.status;
  end if;
  if exists (select 1 from public.po_line where po_id = p_po_id and qty_received > 0) then
    raise exception 'PO already has receipts — short-close it instead';
  end if;

  perform set_config('ops.allow_status_change', '1', true);
  update public.po_purchase_order
  set status = 'cancelled', status_reason = trim(p_reason)
  where id = p_po_id;
  perform set_config('ops.allow_status_change', '', true);
end;
$$;

-- Short close: kill the pending qty, keep what was received.
create or replace function public.po_short_close(p_po_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.po_purchase_order%rowtype;
begin
  perform public.ops_assert_admin();
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Short close needs a reason';
  end if;

  select * into v_po from public.po_purchase_order where id = p_po_id for update;
  if not found then raise exception 'PO not found'; end if;
  if v_po.status not in ('approved', 'partially_received') then
    raise exception 'Only approved/partially received POs can be short-closed (current: %)', v_po.status;
  end if;

  update public.po_line
  set qty_cancelled = qty_cancelled + greatest(qty_ordered - qty_received - qty_cancelled, 0)
  where po_id = p_po_id;

  perform set_config('ops.allow_status_change', '1', true);
  update public.po_purchase_order
  set status = 'short_closed', status_reason = trim(p_reason)
  where id = p_po_id;
  perform set_config('ops.allow_status_change', '', true);
end;
$$;

-- Close: bookkeeping end state once fulfilled and billed.
create or replace function public.po_close(p_po_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform public.ops_assert_admin();
  select status into v_status from public.po_purchase_order where id = p_po_id for update;
  if v_status is null then raise exception 'PO not found'; end if;
  if v_status <> 'fulfilled' then
    raise exception 'Only fulfilled POs can be closed (current: %)', v_status;
  end if;
  perform set_config('ops.allow_status_change', '1', true);
  update public.po_purchase_order set status = 'closed' where id = p_po_id;
  perform set_config('ops.allow_status_change', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. GRN (goods receipt) + QC.
-- Draft GRNs are working paper (admin-writable); po_post_grn moves stock,
-- assigns the gapless GRN number and freezes the document.
-- ---------------------------------------------------------------------------

create table if not exists public.po_grn (
  id uuid primary key default gen_random_uuid(),
  grn_no text unique,
  entity_id uuid not null references public.core_entity(id) on delete restrict,
  vendor_id uuid not null references public.crm_party(id) on delete restrict,
  location_id uuid not null references public.core_location(id) on delete restrict,
  received_date date not null default current_date,
  lr_no text,
  transporter text,
  bundles integer,
  handed_over_to text,
  checked_by text,
  note text,
  status text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  created_by uuid default auth.uid(),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists po_grn_vendor_idx on public.po_grn (vendor_id, received_date desc);

create table if not exists public.po_grn_line (
  id uuid primary key default gen_random_uuid(),
  grn_id uuid not null references public.po_grn(id) on delete cascade,
  po_line_id uuid not null references public.po_line(id) on delete restrict,
  qty numeric(12, 2) not null check (qty > 0),
  qc_required boolean,
  qty_qc_pass numeric(12, 2) not null default 0 check (qty_qc_pass >= 0),
  qty_qc_fail numeric(12, 2) not null default 0 check (qty_qc_fail >= 0),
  qc_note text,
  created_at timestamptz not null default now(),
  unique (grn_id, po_line_id)
);

create index if not exists po_grn_line_po_line_idx on public.po_grn_line (po_line_id);

create or replace function public.po_grn_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Posted GRNs cannot be deleted — corrections are debit notes / reversing movements';
    end if;
    return old;
  end if;
  if new.status is distinct from old.status and not public.ops_status_change_allowed() then
    raise exception 'GRN status changes only through po_post_grn';
  end if;
  if old.status = 'posted' and not public.ops_status_change_allowed() then
    raise exception 'Posted GRN is immutable';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists po_grn_guard_t on public.po_grn;
create trigger po_grn_guard_t
before update or delete on public.po_grn
for each row execute function public.po_grn_guard();

-- Lines: free while draft; after posting only the QC counters may move.
create or replace function public.po_grn_line_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.po_grn where id = coalesce(new.grn_id, old.grn_id);

  if tg_op = 'INSERT' then
    if v_status <> 'draft' then
      raise exception 'Lines can only be added to a draft GRN';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if v_status <> 'draft' then
      raise exception 'Lines can only be removed from a draft GRN';
    end if;
    return old;
  end if;
  if v_status <> 'draft' and (
    new.po_line_id is distinct from old.po_line_id
    or new.qty is distinct from old.qty
  ) then
    raise exception 'Posted GRN lines are immutable (only QC results may be recorded)';
  end if;
  return new;
end;
$$;

drop trigger if exists po_grn_line_guard_t on public.po_grn_line;
create trigger po_grn_line_guard_t
before insert or update or delete on public.po_grn_line
for each row execute function public.po_grn_line_guard();

-- Post the GRN: tolerance check, stock in (qc_hold or good), PO counters, number.
create or replace function public.po_post_grn(p_grn_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grn public.po_grn%rowtype;
  v_line record;
  v_settings public.po_settings%rowtype;
  v_tolerance numeric;
  v_pending numeric;
  v_allowed numeric;
  v_qc boolean;
  v_no text;
  v_line_count int := 0;
begin
  perform public.ops_assert_admin();

  select * into v_grn from public.po_grn where id = p_grn_id for update;
  if not found then raise exception 'GRN not found'; end if;
  if v_grn.status <> 'draft' then
    raise exception 'Only draft GRNs can be posted (current: %)', v_grn.status;
  end if;

  select * into v_settings from public.po_settings where id = 1;

  for v_line in
    select gl.id as grn_line_id, gl.qty as grn_qty,
           pl.id as po_line_id, pl.sku_id, pl.qty_ordered, pl.qty_received, pl.qty_cancelled,
           po.id as po_id, po.status as po_status, po.vendor_id as po_vendor_id
    from public.po_grn_line gl
    join public.po_line pl on pl.id = gl.po_line_id
    join public.po_purchase_order po on po.id = pl.po_id
    where gl.grn_id = p_grn_id
    order by gl.created_at
    for update of pl, po
  loop
    v_line_count := v_line_count + 1;

    if v_line.po_vendor_id <> v_grn.vendor_id then
      raise exception 'GRN vendor does not match the PO vendor';
    end if;
    if v_line.po_status not in ('approved', 'partially_received') then
      raise exception 'PO is % — only approved/partially received POs can receive goods', v_line.po_status;
    end if;

    -- Over-receipt tolerance: vendor-item override, else global setting (decision 3).
    select coalesce(vi.over_receipt_pct, v_settings.over_receipt_tolerance_pct)
    into v_tolerance
    from (select 1) x
    left join public.crm_vendor_item vi
      on vi.vendor_id = v_grn.vendor_id and vi.sku_id = v_line.sku_id;

    v_pending := v_line.qty_ordered - v_line.qty_received - v_line.qty_cancelled;
    v_allowed := v_pending + v_line.qty_ordered * v_tolerance / 100.0;
    if v_line.grn_qty > v_allowed then
      raise exception 'Over-receipt: pending % plus tolerance % pct of ordered allows %, GRN has %',
        v_pending, v_tolerance, round(v_allowed, 2), v_line.grn_qty;
    end if;

    -- QC gate (decision 1): vendor-item qc_exempt wins; else the vendor default.
    select case
      when vi.id is not null then not vi.qc_exempt
      else coalesce(p.default_qc_required, true)
    end
    into v_qc
    from public.crm_party p
    left join public.crm_vendor_item vi
      on vi.vendor_id = p.id and vi.sku_id = v_line.sku_id
    where p.id = v_grn.vendor_id;
    v_qc := coalesce(v_qc, true);

    perform public.inv_post_movement(
      v_line.sku_id, null, v_grn.location_id, v_line.grn_qty,
      case when v_qc then 'qc_hold' else 'good' end,
      'grn', 'po_grn', p_grn_id::text, null, null
    );

    update public.po_grn_line set qc_required = v_qc where id = v_line.grn_line_id;

    update public.po_line
    set qty_received = qty_received + v_line.grn_qty
    where id = v_line.po_line_id;
  end loop;

  if v_line_count = 0 then
    raise exception 'GRN has no lines';
  end if;

  -- Roll PO statuses forward for every touched PO.
  perform set_config('ops.allow_status_change', '1', true);
  update public.po_purchase_order po
  set status = case
    when agg.total_pending <= 0 then 'fulfilled'
    else 'partially_received'
  end
  from (
    -- Only positive pending counts: over-receipt on one line must not mask
    -- another line that is still short.
    select pl.po_id, sum(greatest(pl.qty_ordered - pl.qty_received - pl.qty_cancelled, 0)) as total_pending
    from public.po_line pl
    where pl.po_id in (
      select distinct pl2.po_id
      from public.po_grn_line gl
      join public.po_line pl2 on pl2.id = gl.po_line_id
      where gl.grn_id = p_grn_id
    )
    group by pl.po_id
  ) agg
  where po.id = agg.po_id
    and po.status in ('approved', 'partially_received');

  v_no := public.ops_next_doc_no(v_grn.entity_id, 'grn', v_grn.received_date);

  update public.po_grn
  set status = 'posted', grn_no = v_no, posted_at = now()
  where id = p_grn_id;
  perform set_config('ops.allow_status_change', '', true);

  return v_no;
end;
$$;

-- QC result on a posted GRN line: qc_hold -> good (pass) / damaged (fail),
-- same location, using the new to_state ledger support.
create or replace function public.po_record_qc(
  p_grn_line_id uuid,
  p_qty_pass numeric,
  p_qty_fail numeric,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.po_grn_line%rowtype;
  v_grn public.po_grn%rowtype;
  v_sku uuid;
  v_remaining numeric;
begin
  perform public.ops_assert_admin();

  if coalesce(p_qty_pass, 0) < 0 or coalesce(p_qty_fail, 0) < 0
     or coalesce(p_qty_pass, 0) + coalesce(p_qty_fail, 0) <= 0 then
    raise exception 'QC needs a positive pass and/or fail quantity';
  end if;
  if coalesce(p_qty_fail, 0) > 0 and coalesce(trim(p_note), '') = '' then
    raise exception 'QC failures need a note (it backs the debit note)';
  end if;

  select * into v_line from public.po_grn_line where id = p_grn_line_id for update;
  if not found then raise exception 'GRN line not found'; end if;

  select * into v_grn from public.po_grn where id = v_line.grn_id for update;
  if v_grn.status <> 'posted' then
    raise exception 'QC can only be recorded on a posted GRN';
  end if;
  if not coalesce(v_line.qc_required, false) then
    raise exception 'This line is QC-exempt — stock already landed as good';
  end if;

  v_remaining := v_line.qty - v_line.qty_qc_pass - v_line.qty_qc_fail;
  if coalesce(p_qty_pass, 0) + coalesce(p_qty_fail, 0) > v_remaining then
    raise exception 'QC quantities exceed the % still in QC hold', v_remaining;
  end if;

  select sku_id into v_sku from public.po_line where id = v_line.po_line_id;

  if coalesce(p_qty_pass, 0) > 0 then
    perform public.inv_post_movement(
      v_sku, v_grn.location_id, v_grn.location_id, p_qty_pass,
      'qc_hold', 'qc_pass', 'po_grn_line', p_grn_line_id::text, null, p_note, 'good'
    );
  end if;
  if coalesce(p_qty_fail, 0) > 0 then
    perform public.inv_post_movement(
      v_sku, v_grn.location_id, v_grn.location_id, p_qty_fail,
      'qc_hold', 'qc_fail', 'po_grn_line', p_grn_line_id::text, null, p_note, 'damaged'
    );
    update public.po_line
    set qty_rejected = qty_rejected + p_qty_fail
    where id = v_line.po_line_id;
  end if;

  update public.po_grn_line
  set qty_qc_pass = qty_qc_pass + coalesce(p_qty_pass, 0),
      qty_qc_fail = qty_qc_fail + coalesce(p_qty_fail, 0),
      qc_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), qc_note)
  where id = p_grn_line_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Payables: vendor bills (three-way match), debit notes, payments.
-- ---------------------------------------------------------------------------

create table if not exists public.ap_bill (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.crm_party(id) on delete restrict,
  entity_id uuid not null references public.core_entity(id) on delete restrict,
  bill_no text not null,
  bill_date date not null,
  credit_days integer check (credit_days >= 0),
  due_date date,
  msme_capped boolean not null default false,
  subtotal numeric(14, 2) not null default 0 check (subtotal >= 0),
  tax_amount numeric(14, 2) not null default 0 check (tax_amount >= 0),
  total numeric(14, 2) not null default 0 check (total >= 0),
  match_status text check (match_status in ('matched', 'override')),
  override_reason text,
  note text,
  status text not null default 'draft' check (status in ('draft', 'approved', 'cancelled')),
  created_by uuid default auth.uid(),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The same vendor invoice can never be entered twice.
  unique (vendor_id, bill_no)
);

create index if not exists ap_bill_vendor_idx on public.ap_bill (vendor_id, bill_date desc);
create index if not exists ap_bill_status_idx on public.ap_bill (status, due_date);

create table if not exists public.ap_bill_line (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.ap_bill(id) on delete cascade,
  grn_line_id uuid not null references public.po_grn_line(id) on delete restrict,
  qty numeric(12, 2) not null check (qty > 0),
  rate numeric(12, 2) not null check (rate >= 0),
  tax_pct numeric(5, 2) not null default 0 check (tax_pct >= 0),
  created_at timestamptz not null default now(),
  -- One bill line per GRN line: double billing is structurally impossible.
  unique (grn_line_id)
);

create or replace function public.ap_bill_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Approved bills cannot be deleted — use a debit note';
    end if;
    return old;
  end if;
  if new.status is distinct from old.status and not public.ops_status_change_allowed() then
    raise exception 'Bill status changes only through ap_approve_bill / ap_cancel_bill';
  end if;
  if old.status <> 'draft' and not public.ops_status_change_allowed() then
    raise exception 'Approved bill is immutable — corrections are debit notes';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ap_bill_guard_t on public.ap_bill;
create trigger ap_bill_guard_t
before update or delete on public.ap_bill
for each row execute function public.ap_bill_guard();

create or replace function public.ap_bill_line_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.ap_bill where id = coalesce(new.bill_id, old.bill_id);
  if v_status <> 'draft' then
    raise exception 'Bill lines are frozen once the bill leaves draft';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists ap_bill_line_guard_t on public.ap_bill_line;
create trigger ap_bill_line_guard_t
before insert or update or delete on public.ap_bill_line
for each row execute function public.ap_bill_line_guard();

-- Three-way match + approval. Variances beyond tolerance block approval
-- unless an override reason is given (recorded on the document).
create or replace function public.ap_approve_bill(
  p_bill_id uuid,
  p_override_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill public.ap_bill%rowtype;
  v_settings public.po_settings%rowtype;
  v_vendor public.crm_party%rowtype;
  v_line record;
  v_variances text := '';
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_credit_days integer;
  v_due date;
  v_capped boolean := false;
begin
  perform public.ops_assert_admin();

  select * into v_bill from public.ap_bill where id = p_bill_id for update;
  if not found then raise exception 'Bill not found'; end if;
  if v_bill.status <> 'draft' then
    raise exception 'Only draft bills can be approved (current: %)', v_bill.status;
  end if;

  select * into v_settings from public.po_settings where id = 1;
  select * into v_vendor from public.crm_party where id = v_bill.vendor_id;

  for v_line in
    select bl.qty as bill_qty, bl.rate as bill_rate, bl.tax_pct,
           gl.qty as grn_qty, gl.qty_qc_fail,
           pl.rate as po_rate, s.sku_code as sku_code,
           g.vendor_id as grn_vendor_id, g.status as grn_status
    from public.ap_bill_line bl
    join public.po_grn_line gl on gl.id = bl.grn_line_id
    join public.po_grn g on g.id = gl.grn_id
    join public.po_line pl on pl.id = gl.po_line_id
    join public.cat_sku s on s.id = pl.sku_id
    where bl.bill_id = p_bill_id
  loop
    if v_line.grn_vendor_id <> v_bill.vendor_id then
      raise exception 'Bill line references a GRN of a different vendor';
    end if;
    if v_line.grn_status <> 'posted' then
      raise exception 'Bill lines must reference posted GRNs';
    end if;
    -- Qty check: never pay for more than physically received (hard stop).
    if v_line.bill_qty > v_line.grn_qty then
      raise exception 'Billed qty % exceeds received qty % for %',
        v_line.bill_qty, v_line.grn_qty, v_line.sku_code;
    end if;
    -- Rate check: variance beyond tolerance needs an override reason.
    if v_line.po_rate > 0
       and abs(v_line.bill_rate - v_line.po_rate) / v_line.po_rate * 100.0
           > v_settings.rate_variance_tolerance_pct then
      v_variances := v_variances || format('%s: PO rate %s vs bill rate %s; ',
        v_line.sku_code, v_line.po_rate, v_line.bill_rate);
    end if;

    v_subtotal := v_subtotal + v_line.bill_qty * v_line.bill_rate;
    v_tax := v_tax + v_line.bill_qty * v_line.bill_rate * v_line.tax_pct / 100.0;
  end loop;

  if v_subtotal = 0 then
    raise exception 'Bill has no lines';
  end if;

  if v_variances <> '' and coalesce(trim(p_override_reason), '') = '' then
    raise exception 'Rate variance beyond tolerance (% pct): % Give an override reason to approve anyway',
      v_settings.rate_variance_tolerance_pct, v_variances;
  end if;

  -- Due date: vendor credit days, MSME-capped for micro/small vendors (payment
  -- within the statutory window — default 45 days, editable in po_settings).
  v_credit_days := coalesce(v_bill.credit_days, v_vendor.credit_days, 0);
  if v_vendor.msme_category in ('micro', 'small')
     and v_credit_days > v_settings.msme_due_cap_days then
    v_credit_days := v_settings.msme_due_cap_days;
    v_capped := true;
  end if;
  v_due := v_bill.bill_date + v_credit_days;

  perform set_config('ops.allow_status_change', '1', true);
  update public.ap_bill
  set status = 'approved',
      match_status = case when v_variances = '' then 'matched' else 'override' end,
      override_reason = case when v_variances = '' then null else trim(p_override_reason) end,
      subtotal = round(v_subtotal, 2),
      tax_amount = round(v_tax, 2),
      total = round(v_subtotal + v_tax, 2),
      credit_days = v_credit_days,
      due_date = v_due,
      msme_capped = v_capped,
      approved_by = auth.uid(),
      approved_at = now()
  where id = p_bill_id;
  perform set_config('ops.allow_status_change', '', true);
end;
$$;

create or replace function public.ap_cancel_bill(p_bill_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform public.ops_assert_admin();
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancellation needs a reason';
  end if;
  select status into v_status from public.ap_bill where id = p_bill_id for update;
  if v_status is null then raise exception 'Bill not found'; end if;
  if v_status <> 'draft' then
    raise exception 'Approved bills cannot be cancelled — use a debit note';
  end if;
  if exists (select 1 from public.ap_payment_allocation where bill_id = p_bill_id) then
    raise exception 'Bill already has payments allocated';
  end if;
  perform set_config('ops.allow_status_change', '1', true);
  update public.ap_bill set status = 'cancelled', note = coalesce(note || ' | ', '') || 'Cancelled: ' || trim(p_reason)
  where id = p_bill_id;
  perform set_config('ops.allow_status_change', '', true);
end;
$$;

-- Debit notes: rejections / shortages / rate corrections against a vendor.
create table if not exists public.ap_debit_note (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.crm_party(id) on delete restrict,
  entity_id uuid not null references public.core_entity(id) on delete restrict,
  bill_id uuid references public.ap_bill(id) on delete restrict,
  grn_id uuid references public.po_grn(id) on delete restrict,
  note_date date not null default current_date,
  amount numeric(14, 2) not null check (amount > 0),
  reason text not null,
  status text not null default 'open' check (status in ('open', 'settled', 'cancelled')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ap_debit_note_vendor_idx on public.ap_debit_note (vendor_id, status);

-- Payments: written only by ap_record_payment (no direct write policies).
create table if not exists public.ap_payment (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.crm_party(id) on delete restrict,
  entity_id uuid not null references public.core_entity(id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  paid_on date not null default current_date,
  mode text not null default 'bank' check (mode in ('bank', 'upi', 'cash', 'cheque', 'adjustment')),
  utr text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.ap_payment_allocation (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.ap_payment(id) on delete restrict,
  bill_id uuid not null references public.ap_bill(id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists ap_payment_allocation_bill_idx on public.ap_payment_allocation (bill_id);

-- Payments and allocations are append-only (corrections = counter entries).
create or replace function public.ap_payment_block_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Payments are append-only — record a correcting entry instead';
end;
$$;

drop trigger if exists ap_payment_no_change on public.ap_payment;
create trigger ap_payment_no_change
before update or delete on public.ap_payment
for each row execute function public.ap_payment_block_change();

drop trigger if exists ap_payment_allocation_no_change on public.ap_payment_allocation;
create trigger ap_payment_allocation_no_change
before update or delete on public.ap_payment_allocation
for each row execute function public.ap_payment_block_change();

-- p_allocations: [{"bill_id": "...", "amount": 123.45}, ...]
create or replace function public.ap_record_payment(
  p_vendor_id uuid,
  p_entity_id uuid,
  p_amount numeric,
  p_paid_on date,
  p_mode text,
  p_utr text default null,
  p_note text default null,
  p_allocations jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id uuid;
  v_alloc record;
  v_alloc_total numeric := 0;
  v_bill public.ap_bill%rowtype;
  v_already numeric;
begin
  perform public.ops_assert_admin();

  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  insert into public.ap_payment (vendor_id, entity_id, amount, paid_on, mode, utr, note, created_by)
  values (p_vendor_id, p_entity_id, p_amount, coalesce(p_paid_on, current_date),
          coalesce(p_mode, 'bank'), nullif(trim(coalesce(p_utr, '')), ''),
          nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_payment_id;

  for v_alloc in
    select (a->>'bill_id')::uuid as bill_id, (a->>'amount')::numeric as amount
    from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a
  loop
    if v_alloc.amount is null or v_alloc.amount <= 0 then
      raise exception 'Allocation amounts must be greater than zero';
    end if;

    select * into v_bill from public.ap_bill where id = v_alloc.bill_id for update;
    if not found then raise exception 'Allocated bill not found'; end if;
    if v_bill.vendor_id <> p_vendor_id then
      raise exception 'Bill % belongs to a different vendor', v_bill.bill_no;
    end if;
    if v_bill.status <> 'approved' then
      raise exception 'Bill % is % — only approved bills can be paid', v_bill.bill_no, v_bill.status;
    end if;

    select coalesce(sum(amount), 0) into v_already
    from public.ap_payment_allocation where bill_id = v_alloc.bill_id;

    if v_already + v_alloc.amount > v_bill.total then
      raise exception 'Allocation exceeds bill % outstanding (total %, already allocated %)',
        v_bill.bill_no, v_bill.total, v_already;
    end if;

    insert into public.ap_payment_allocation (payment_id, bill_id, amount)
    values (v_payment_id, v_alloc.bill_id, v_alloc.amount);

    v_alloc_total := v_alloc_total + v_alloc.amount;
  end loop;

  if v_alloc_total > p_amount then
    raise exception 'Allocations (%) exceed the payment amount (%)', v_alloc_total, p_amount;
  end if;

  return v_payment_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Reporting views (law 8) — security_invoker so RLS applies.
-- ---------------------------------------------------------------------------

create or replace view public.po_active_view
with (security_invoker = true) as
select
  po.id, po.po_no, po.status, po.order_date, po.expected_date,
  po.vendor_id, v.legal_name as vendor_name,
  po.entity_id, po.delivery_location_id,
  sum(pl.qty_ordered) as qty_ordered,
  sum(pl.qty_received) as qty_received,
  sum(pl.qty_ordered - pl.qty_received - pl.qty_cancelled) as qty_pending,
  round(sum(pl.qty_ordered * pl.rate), 2) as order_value,
  round(sum((pl.qty_ordered - pl.qty_received - pl.qty_cancelled) * pl.rate), 2) as pending_value,
  case
    when po.expected_date is not null and po.expected_date < current_date
         and po.status in ('approved', 'partially_received')
      then current_date - po.expected_date
    else 0
  end as days_overdue
from public.po_purchase_order po
join public.crm_party v on v.id = po.vendor_id
left join public.po_line pl on pl.po_id = po.id
group by po.id, v.legal_name;

create or replace view public.ap_bill_outstanding_view
with (security_invoker = true) as
select
  b.id, b.bill_no, b.bill_date, b.due_date, b.msme_capped, b.match_status,
  b.vendor_id, v.legal_name as vendor_name, b.entity_id,
  b.total,
  coalesce(pa.paid, 0) as paid,
  b.total - coalesce(pa.paid, 0) as outstanding,
  case
    when b.due_date is not null and b.due_date < current_date
         and b.total - coalesce(pa.paid, 0) > 0
      then current_date - b.due_date
    else 0
  end as days_overdue
from public.ap_bill b
join public.crm_party v on v.id = b.vendor_id
left join (
  select bill_id, sum(amount) as paid
  from public.ap_payment_allocation
  group by bill_id
) pa on pa.bill_id = b.id
where b.status = 'approved';

create or replace view public.ap_vendor_ledger_view
with (security_invoker = true) as
select
  v.id as vendor_id,
  v.legal_name as vendor_name,
  v.msme_category,
  coalesce(b.billed, 0) as billed,
  coalesce(d.debits, 0) as debit_notes,
  coalesce(p.paid, 0) as paid,
  coalesce(b.billed, 0) - coalesce(d.debits, 0) - coalesce(p.paid, 0) as balance
from public.crm_party v
left join (
  select vendor_id, sum(total) as billed
  from public.ap_bill where status = 'approved' group by vendor_id
) b on b.vendor_id = v.id
left join (
  select vendor_id, sum(amount) as debits
  from public.ap_debit_note where status = 'open' group by vendor_id
) d on d.vendor_id = v.id
left join (
  select vendor_id, sum(amount) as paid
  from public.ap_payment group by vendor_id
) p on p.vendor_id = v.id
where v.kind = 'vendor' and v.merged_into_id is null;

create or replace view public.po_vendor_performance_view
with (security_invoker = true) as
select
  v.id as vendor_id,
  v.legal_name as vendor_name,
  count(distinct po.id) as po_count,
  coalesce(sum(pl.qty_received), 0) as qty_received,
  coalesce(sum(pl.qty_rejected), 0) as qty_rejected,
  case when coalesce(sum(pl.qty_received), 0) > 0
    then round(sum(pl.qty_rejected) / sum(pl.qty_received) * 100, 2)
    else 0
  end as rejection_pct,
  case when count(distinct po.id) filter (where po.status in ('fulfilled', 'closed')) > 0
    then round(
      count(distinct po.id) filter (
        where po.status in ('fulfilled', 'closed')
          and (po.expected_date is null or exists (
            select 1 from public.po_grn g
            join public.po_grn_line gl2 on gl2.grn_id = g.id
            join public.po_line pl2 on pl2.id = gl2.po_line_id
            where pl2.po_id = po.id and g.received_date <= po.expected_date
          ))
      )::numeric
      / count(distinct po.id) filter (where po.status in ('fulfilled', 'closed')) * 100, 2)
    else null
  end as on_time_pct
from public.crm_party v
join public.po_purchase_order po on po.vendor_id = v.id and po.status <> 'cancelled'
left join public.po_line pl on pl.po_id = po.id
group by v.id, v.legal_name;

-- ---------------------------------------------------------------------------
-- 7. Grants, RLS, audit.
-- Drafting documents (PO, GRN, bill, debit note) = admin direct writes;
-- everything that moves stock/money or flips status = definer functions only.
-- ---------------------------------------------------------------------------

revoke execute on function public.po_approve(uuid) from public, anon;
revoke execute on function public.po_cancel(uuid, text) from public, anon;
revoke execute on function public.po_short_close(uuid, text) from public, anon;
revoke execute on function public.po_close(uuid) from public, anon;
revoke execute on function public.po_post_grn(uuid) from public, anon;
revoke execute on function public.po_record_qc(uuid, numeric, numeric, text) from public, anon;
revoke execute on function public.ap_approve_bill(uuid, text) from public, anon;
revoke execute on function public.ap_cancel_bill(uuid, text) from public, anon;
revoke execute on function public.ap_record_payment(uuid, uuid, numeric, date, text, text, text, jsonb) from public, anon;

grant execute on function public.po_approve(uuid) to authenticated;
grant execute on function public.po_cancel(uuid, text) to authenticated;
grant execute on function public.po_short_close(uuid, text) to authenticated;
grant execute on function public.po_close(uuid) to authenticated;
grant execute on function public.po_post_grn(uuid) to authenticated;
grant execute on function public.po_record_qc(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.ap_approve_bill(uuid, text) to authenticated;
grant execute on function public.ap_cancel_bill(uuid, text) to authenticated;
grant execute on function public.ap_record_payment(uuid, uuid, numeric, date, text, text, text, jsonb) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'po_settings', 'po_purchase_order', 'po_line', 'po_grn', 'po_grn_line',
    'ap_bill', 'ap_bill_line', 'ap_debit_note', 'ap_payment', 'ap_payment_allocation'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'drop policy if exists "%s read authenticated" on public.%I;
       create policy "%s read authenticated" on public.%I
       for select to authenticated using (true);',
      t, t, t, t
    );
  end loop;

  -- Admin direct writes on drafting documents (guards above enforce immutability).
  foreach t in array array[
    'po_settings', 'po_purchase_order', 'po_line', 'po_grn', 'po_grn_line',
    'ap_bill', 'ap_bill_line', 'ap_debit_note'
  ]
  loop
    execute format(
      'drop policy if exists "%s admin write" on public.%I;
       create policy "%s admin write" on public.%I
       for all to authenticated
       using (public.jwt_user_is_admin())
       with check (public.jwt_user_is_admin());',
      t, t, t, t
    );
  end loop;
  -- ap_payment / ap_payment_allocation: NO write policies — function is the only door.
end;
$$;

-- Audit every document table (law 4).
do $$
declare
  t text;
begin
  foreach t in array array[
    'po_settings', 'po_purchase_order', 'po_grn',
    'ap_bill', 'ap_debit_note', 'ap_payment'
  ]
  loop
    execute format(
      'drop trigger if exists %I_audit on public.%I;
       create trigger %I_audit
       after insert or update or delete on public.%I
       for each row execute function public.audit_row_change();',
      t, t, t, t
    );
  end loop;
end;
$$;

-- updated_at maintenance on po_settings (documents handle it in their guards).
drop trigger if exists po_settings_updated_at on public.po_settings;
create trigger po_settings_updated_at
before update on public.po_settings
for each row execute function public.set_updated_at();
