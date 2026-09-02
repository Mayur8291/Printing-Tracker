-- Step 3 of the One Source of Truth roadmap: B2B orders, job work, dispatch, SLA.
-- so_order/so_line with a DB state machine; confirm allocates reservations
-- against the Step 1 ledger; an order cannot reach 'ready' without reservations
-- covering its lines; a dispatch can never exceed reserved qty; job work moves
-- stock to/from job-worker locations with loss visibility; SLA stage targets
-- are data (sla_policy) measured in business hours (Mon-Sat 09:30-18:30 IST).
--
-- Status flips only through functions (same trigger + transaction-local flag
-- pattern as Step 2). Counter sales are channel='counter' on the same table.
-- Enquiry hand-off deferred (the Support module is live; see DECISIONS.md).
-- Scott API untouched.

-- ---------------------------------------------------------------------------
-- 1. Sales orders
-- ---------------------------------------------------------------------------

create table if not exists public.so_order (
  id uuid primary key default gen_random_uuid(),
  so_no text unique,
  entity_id uuid not null references public.core_entity(id) on delete restrict,
  customer_id uuid not null references public.crm_party(id) on delete restrict,
  channel text not null default 'b2b' check (channel in (
    'b2b', 'counter', 'distributor', 'enquiry', 'ecom_uniware'
  )),
  owner uuid,
  order_date date not null default current_date,
  promised_date date,
  -- Fulfilment location: reservations and dispatches run against this stock.
  location_id uuid not null references public.core_location(id) on delete restrict,
  price_list text,
  branding boolean not null default false,
  note text,
  status text not null default 'draft' check (status in (
    'draft', 'confirmed', 'in_production', 'ready',
    'partially_dispatched', 'dispatched', 'invoiced', 'closed', 'cancelled'
  )),
  status_reason text,
  created_by uuid default auth.uid(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  production_started_at timestamptz,
  ready_at timestamptz,
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists so_order_customer_idx on public.so_order (customer_id, status);
create index if not exists so_order_status_idx on public.so_order (status, order_date desc);
create index if not exists so_order_channel_idx on public.so_order (channel, order_date desc);

-- One row per SKU (per size). The UI may render a size grid; the database
-- never stores "LABEL-QTY" strings (roadmap law).
create table if not exists public.so_line (
  id uuid primary key default gen_random_uuid(),
  so_id uuid not null references public.so_order(id) on delete cascade,
  sku_id uuid not null references public.cat_sku(id) on delete restrict,
  qty numeric(12, 2) not null check (qty > 0),
  rate numeric(12, 2) not null default 0 check (rate >= 0),
  tax_pct numeric(5, 2) not null default 0 check (tax_pct >= 0),
  -- Counters maintained by functions: active reserved qty and dispatched qty.
  qty_reserved numeric(12, 2) not null default 0 check (qty_reserved >= 0),
  qty_dispatched numeric(12, 2) not null default 0 check (qty_dispatched >= 0),
  created_at timestamptz not null default now(),
  unique (so_id, sku_id)
);

create index if not exists so_line_so_idx on public.so_line (so_id);

create or replace function public.so_header_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only draft orders can be deleted — cancel instead';
    end if;
    return old;
  end if;
  if new.status is distinct from old.status and not public.ops_status_change_allowed() then
    raise exception 'Order status changes only through so_confirm / so_set_status / so_post_dispatch / so_cancel';
  end if;
  if old.status <> 'draft' and (
    new.entity_id is distinct from old.entity_id
    or new.customer_id is distinct from old.customer_id
    or new.channel is distinct from old.channel
    or new.location_id is distinct from old.location_id
    or new.order_date is distinct from old.order_date
    or new.so_no is distinct from old.so_no and not public.ops_status_change_allowed()
  ) then
    raise exception 'Confirmed order is immutable — cancel and raise a fresh order to amend';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists so_header_guard_t on public.so_order;
create trigger so_header_guard_t
before update or delete on public.so_order
for each row execute function public.so_header_guard();

create or replace function public.so_line_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.so_order where id = coalesce(new.so_id, old.so_id);

  if tg_op = 'INSERT' then
    if v_status <> 'draft' then
      raise exception 'Lines can only be added to a draft order';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if v_status <> 'draft' then
      raise exception 'Lines can only be removed from a draft order';
    end if;
    return old;
  end if;
  if v_status <> 'draft' and (
    new.sku_id is distinct from old.sku_id
    or new.qty is distinct from old.qty
    or new.rate is distinct from old.rate
    or new.tax_pct is distinct from old.tax_pct
  ) then
    raise exception 'Confirmed order lines are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists so_line_guard_t on public.so_line;
create trigger so_line_guard_t
before insert or update or delete on public.so_line
for each row execute function public.so_line_guard();

-- ---------------------------------------------------------------------------
-- 2. Allocation: reserve available stock (partial allowed; production fills
-- the rest later). Callable repeatedly — tops up to the ordered qty.
-- ---------------------------------------------------------------------------

create or replace function public.so_allocate(p_so_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so public.so_order%rowtype;
  v_line record;
  v_balance numeric;
  v_reserved numeric;
  v_available numeric;
  v_need numeric;
  v_take numeric;
  v_total numeric := 0;
begin
  perform public.ops_assert_admin();

  select * into v_so from public.so_order where id = p_so_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_so.status not in ('confirmed', 'in_production') then
    raise exception 'Only confirmed / in-production orders can allocate (current: %)', v_so.status;
  end if;

  for v_line in
    select * from public.so_line where so_id = p_so_id order by created_at for update
  loop
    v_need := v_line.qty - v_line.qty_reserved - v_line.qty_dispatched;
    if v_need <= 0 then continue; end if;

    select coalesce(qty, 0) into v_balance
    from public.inv_balance
    where sku_id = v_line.sku_id and location_id = v_so.location_id and state = 'good'
    for update;
    v_balance := coalesce(v_balance, 0);

    select coalesce(sum(qty), 0) into v_reserved
    from public.inv_reservation
    where sku_id = v_line.sku_id and location_id = v_so.location_id and status = 'active';

    v_available := v_balance - v_reserved;
    if v_available <= 0 then continue; end if;

    v_take := least(v_need, v_available);
    insert into public.inv_reservation (sku_id, location_id, qty, ref_type, ref_id, created_by)
    values (v_line.sku_id, v_so.location_id, v_take, 'so_order', p_so_id::text, auth.uid());

    update public.so_line
    set qty_reserved = qty_reserved + v_take
    where id = v_line.id;

    v_total := v_total + v_take;
  end loop;

  return v_total;
end;
$$;

-- Confirm: assigns the gapless SO number and allocates whatever is available.
create or replace function public.so_confirm(p_so_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so public.so_order%rowtype;
  v_no text;
begin
  perform public.ops_assert_admin();

  select * into v_so from public.so_order where id = p_so_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_so.status <> 'draft' then
    raise exception 'Only draft orders can be confirmed (current: %)', v_so.status;
  end if;
  if not exists (select 1 from public.so_line where so_id = p_so_id) then
    raise exception 'Order has no lines';
  end if;

  v_no := public.ops_next_doc_no(v_so.entity_id, 'so', v_so.order_date);

  perform set_config('ops.allow_status_change', '1', true);
  update public.so_order
  set status = 'confirmed', so_no = v_no,
      confirmed_by = auth.uid(), confirmed_at = now()
  where id = p_so_id;
  perform set_config('ops.allow_status_change', '', true);

  perform public.so_allocate(p_so_id);

  return v_no;
end;
$$;

-- Manual stage moves with the transition matrix + the ready rule (law from the
-- roadmap: an order cannot move to ready without reservations covering its lines).
create or replace function public.so_set_status(p_so_id uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so public.so_order%rowtype;
  v_ok boolean := false;
  v_short int;
begin
  perform public.ops_assert_admin();

  select * into v_so from public.so_order where id = p_so_id for update;
  if not found then raise exception 'Order not found'; end if;

  v_ok := case
    when v_so.status = 'confirmed' and p_status in ('in_production', 'ready') then true
    when v_so.status = 'in_production' and p_status = 'ready' then true
    when v_so.status = 'dispatched' and p_status in ('invoiced', 'closed') then true
    when v_so.status = 'invoiced' and p_status = 'closed' then true
    else false
  end;
  if not v_ok then
    raise exception 'Transition % → % is not allowed (use so_confirm / so_post_dispatch / so_cancel)',
      v_so.status, p_status;
  end if;

  if p_status = 'ready' then
    select count(*) into v_short
    from public.so_line
    where so_id = p_so_id and qty_reserved + qty_dispatched < qty;
    if v_short > 0 then
      raise exception 'Order cannot be ready: % line(s) not fully reserved — allocate stock first', v_short;
    end if;
  end if;

  perform set_config('ops.allow_status_change', '1', true);
  update public.so_order
  set status = p_status,
      status_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), status_reason),
      production_started_at = case when p_status = 'in_production'
        then coalesce(production_started_at, now()) else production_started_at end,
      ready_at = case when p_status = 'ready' then coalesce(ready_at, now()) else ready_at end
  where id = p_so_id;
  perform set_config('ops.allow_status_change', '', true);
end;
$$;

-- Cancel: releases every active reservation of the order.
create or replace function public.so_cancel(p_so_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so public.so_order%rowtype;
begin
  perform public.ops_assert_admin();
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Cancellation needs a reason';
  end if;

  select * into v_so from public.so_order where id = p_so_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_so.status not in ('draft', 'confirmed', 'in_production', 'ready') then
    raise exception 'Orders with dispatches cannot be cancelled (current: %)', v_so.status;
  end if;

  update public.inv_reservation
  set status = 'released', released_at = now()
  where ref_type = 'so_order' and ref_id = p_so_id::text and status = 'active';

  update public.so_line set qty_reserved = 0 where so_id = p_so_id;

  perform set_config('ops.allow_status_change', '1', true);
  update public.so_order
  set status = 'cancelled', status_reason = trim(p_reason)
  where id = p_so_id;
  perform set_config('ops.allow_status_change', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Dispatch — consumes reservations, moves stock, rolls the order forward.
-- ---------------------------------------------------------------------------

create table if not exists public.so_dispatch (
  id uuid primary key default gen_random_uuid(),
  dispatch_no text unique,
  so_id uuid not null references public.so_order(id) on delete restrict,
  dispatch_date date not null default current_date,
  transporter text,
  lr_no text,
  boxes integer,
  weight_kg numeric(10, 2),
  eway_bill_no text,
  pod_url text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists so_dispatch_so_idx on public.so_dispatch (so_id, created_at desc);

create table if not exists public.so_dispatch_line (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.so_dispatch(id) on delete restrict,
  so_line_id uuid not null references public.so_line(id) on delete restrict,
  qty numeric(12, 2) not null check (qty > 0),
  created_at timestamptz not null default now()
);

create index if not exists so_dispatch_line_dispatch_idx on public.so_dispatch_line (dispatch_id);

-- Dispatches are documents written only by so_post_dispatch; append-only.
create or replace function public.so_dispatch_block_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Dispatches are append-only — corrections are return movements + a note';
end;
$$;

drop trigger if exists so_dispatch_no_change on public.so_dispatch;
create trigger so_dispatch_no_change
before update or delete on public.so_dispatch
for each row execute function public.so_dispatch_block_change();

drop trigger if exists so_dispatch_line_no_change on public.so_dispatch_line;
create trigger so_dispatch_line_no_change
before update or delete on public.so_dispatch_line
for each row execute function public.so_dispatch_block_change();

-- Consume active reservations of one order/sku/location, up to p_qty.
-- Fully-used rows flip to consumed; a partially-used row is shrunk and a
-- consumed row is inserted for the used part (audit keeps every grain).
create or replace function public.so_consume_reservation(
  p_so_id uuid,
  p_sku_id uuid,
  p_location_id uuid,
  p_qty numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.inv_reservation%rowtype;
  v_remaining numeric := p_qty;
begin
  for v_row in
    select * from public.inv_reservation
    where ref_type = 'so_order' and ref_id = p_so_id::text
      and sku_id = p_sku_id and location_id = p_location_id and status = 'active'
    order by created_at
    for update
  loop
    exit when v_remaining <= 0;
    if v_row.qty <= v_remaining then
      update public.inv_reservation
      set status = 'consumed', released_at = now()
      where id = v_row.id;
      v_remaining := v_remaining - v_row.qty;
    else
      update public.inv_reservation
      set qty = qty - v_remaining
      where id = v_row.id;
      insert into public.inv_reservation
        (sku_id, location_id, qty, ref_type, ref_id, status, created_by, created_at, released_at)
      values
        (p_sku_id, p_location_id, v_remaining, 'so_order', p_so_id::text, 'consumed', auth.uid(), v_row.created_at, now());
      v_remaining := 0;
    end if;
  end loop;

  if v_remaining > 0 then
    raise exception 'Reservation shortfall while consuming (% left) — this should never happen', v_remaining;
  end if;
end;
$$;

-- p_lines: [{"so_line_id": "...", "qty": 5}, ...]
create or replace function public.so_post_dispatch(
  p_so_id uuid,
  p_lines jsonb,
  p_dispatch_date date default current_date,
  p_transporter text default null,
  p_lr_no text default null,
  p_boxes integer default null,
  p_weight_kg numeric default null,
  p_eway_bill_no text default null,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_so public.so_order%rowtype;
  v_dispatch_id uuid;
  v_no text;
  v_in record;
  v_line public.so_line%rowtype;
  v_count int := 0;
  v_open int;
begin
  perform public.ops_assert_admin();

  select * into v_so from public.so_order where id = p_so_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_so.status not in ('ready', 'partially_dispatched') then
    raise exception 'Only ready / partially dispatched orders can dispatch (current: %) — mark the order ready first',
      v_so.status;
  end if;

  v_no := public.ops_next_doc_no(v_so.entity_id, 'disp', coalesce(p_dispatch_date, current_date));

  insert into public.so_dispatch
    (dispatch_no, so_id, dispatch_date, transporter, lr_no, boxes, weight_kg, eway_bill_no, note, created_by)
  values
    (v_no, p_so_id, coalesce(p_dispatch_date, current_date),
     nullif(trim(coalesce(p_transporter, '')), ''), nullif(trim(coalesce(p_lr_no, '')), ''),
     p_boxes, p_weight_kg, nullif(trim(coalesce(p_eway_bill_no, '')), ''),
     nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_dispatch_id;

  for v_in in
    select (l->>'so_line_id')::uuid as so_line_id, (l->>'qty')::numeric as qty
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
  loop
    if v_in.qty is null or v_in.qty <= 0 then
      raise exception 'Dispatch quantities must be greater than zero';
    end if;

    select * into v_line from public.so_line where id = v_in.so_line_id for update;
    if not found or v_line.so_id <> p_so_id then
      raise exception 'Dispatch line does not belong to this order';
    end if;
    -- The roadmap rule: a dispatch cannot exceed reserved qty.
    if v_in.qty > v_line.qty_reserved then
      raise exception 'Dispatch % exceeds reserved % for this line', v_in.qty, v_line.qty_reserved;
    end if;
    if v_in.qty > v_line.qty - v_line.qty_dispatched then
      raise exception 'Dispatch % exceeds open order qty %', v_in.qty, v_line.qty - v_line.qty_dispatched;
    end if;

    perform public.so_consume_reservation(p_so_id, v_line.sku_id, v_so.location_id, v_in.qty);

    perform public.inv_post_movement(
      v_line.sku_id, v_so.location_id, null, v_in.qty,
      'good', 'dispatch', 'so_dispatch', v_dispatch_id::text, null, p_note
    );

    insert into public.so_dispatch_line (dispatch_id, so_line_id, qty)
    values (v_dispatch_id, v_in.so_line_id, v_in.qty);

    update public.so_line
    set qty_dispatched = qty_dispatched + v_in.qty,
        qty_reserved = qty_reserved - v_in.qty
    where id = v_in.so_line_id;

    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'Dispatch has no lines';
  end if;

  select count(*) into v_open
  from public.so_line
  where so_id = p_so_id and qty_dispatched < qty;

  perform set_config('ops.allow_status_change', '1', true);
  update public.so_order
  set status = case when v_open = 0 then 'dispatched' else 'partially_dispatched' end,
      dispatched_at = case when v_open = 0 then coalesce(dispatched_at, now()) else dispatched_at end
  where id = p_so_id;
  perform set_config('ops.allow_status_change', '', true);

  return v_no;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Job work — printing / embroidery / sublimation; in-house or job worker.
-- Challan out = inputs move to the worker location; receive = outputs come in
-- (production_out) and consumed inputs burn (consumption). Whatever input
-- remains at the worker location IS the loss/pending — visible as a balance.
-- ---------------------------------------------------------------------------

create table if not exists public.jw_job (
  id uuid primary key default gen_random_uuid(),
  job_no text unique,
  entity_id uuid not null references public.core_entity(id) on delete restrict,
  kind text not null check (kind in ('printing', 'embroidery', 'sublimation', 'stitching', 'other')),
  worker_party_id uuid references public.crm_party(id) on delete restrict,
  in_house boolean not null default false,
  so_id uuid references public.so_order(id) on delete restrict,
  -- Stock source/destination and the worker-side location for movements.
  location_id uuid not null references public.core_location(id) on delete restrict,
  worker_location_id uuid not null references public.core_location(id) on delete restrict,
  expected_date date,
  note text,
  status text not null default 'draft' check (status in ('draft', 'issued', 'received', 'closed', 'cancelled')),
  created_by uuid default auth.uid(),
  issued_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (location_id <> worker_location_id)
);

create index if not exists jw_job_status_idx on public.jw_job (status, created_at desc);

create table if not exists public.jw_job_line (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jw_job(id) on delete cascade,
  direction text not null check (direction in ('input', 'output')),
  sku_id uuid not null references public.cat_sku(id) on delete restrict,
  qty_planned numeric(12, 2) not null check (qty_planned > 0),
  qty_moved numeric(12, 2) not null default 0 check (qty_moved >= 0),
  created_at timestamptz not null default now(),
  unique (job_id, direction, sku_id)
);

create or replace function public.jw_job_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only draft jobs can be deleted — cancel instead';
    end if;
    return old;
  end if;
  if new.status is distinct from old.status and not public.ops_status_change_allowed() then
    raise exception 'Job status changes only through jw_issue / jw_receive / jw_close / jw_cancel';
  end if;
  if old.status not in ('draft') and (
    new.entity_id is distinct from old.entity_id
    or new.location_id is distinct from old.location_id
    or new.worker_location_id is distinct from old.worker_location_id
    or new.job_no is distinct from old.job_no and not public.ops_status_change_allowed()
  ) then
    raise exception 'Issued jobs are immutable';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists jw_job_guard_t on public.jw_job;
create trigger jw_job_guard_t
before update or delete on public.jw_job
for each row execute function public.jw_job_guard();

create or replace function public.jw_job_line_guard()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.jw_job where id = coalesce(new.job_id, old.job_id);
  if tg_op = 'INSERT' then
    if v_status <> 'draft' then
      raise exception 'Lines can only be added to a draft job';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if v_status <> 'draft' then
      raise exception 'Lines can only be removed from a draft job';
    end if;
    return old;
  end if;
  if v_status <> 'draft' and (
    new.direction is distinct from old.direction
    or new.sku_id is distinct from old.sku_id
    or new.qty_planned is distinct from old.qty_planned
  ) then
    raise exception 'Issued job lines are immutable (only qty_moved may change)';
  end if;
  return new;
end;
$$;

drop trigger if exists jw_job_line_guard_t on public.jw_job_line;
create trigger jw_job_line_guard_t
before insert or update or delete on public.jw_job_line
for each row execute function public.jw_job_line_guard();

-- Challan out: move every input line to the worker location.
create or replace function public.jw_issue(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jw_job%rowtype;
  v_line record;
  v_no text;
  v_count int := 0;
begin
  perform public.ops_assert_admin();

  select * into v_job from public.jw_job where id = p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if v_job.status <> 'draft' then
    raise exception 'Only draft jobs can be issued (current: %)', v_job.status;
  end if;
  if not v_job.in_house and v_job.worker_party_id is null then
    raise exception 'Job-worker jobs need a worker party (or mark the job in-house)';
  end if;

  for v_line in
    select * from public.jw_job_line where job_id = p_job_id and direction = 'input' order by created_at
  loop
    v_count := v_count + 1;
    perform public.inv_post_movement(
      v_line.sku_id, v_job.location_id, v_job.worker_location_id, v_line.qty_planned,
      'good', 'transfer', 'jw_job', p_job_id::text, null, 'Job-work challan out'
    );
    update public.jw_job_line set qty_moved = qty_planned where id = v_line.id;
  end loop;

  if v_count = 0 then
    raise exception 'Job has no input lines';
  end if;

  v_no := public.ops_next_doc_no(v_job.entity_id, 'jw', current_date);

  perform set_config('ops.allow_status_change', '1', true);
  update public.jw_job
  set status = 'issued', job_no = v_no, issued_at = now()
  where id = p_job_id;
  perform set_config('ops.allow_status_change', '', true);

  return v_no;
end;
$$;

-- Challan in: outputs arrive (production_out into the main location), consumed
-- inputs burn at the worker location. Unconsumed input stays visible at the
-- worker location = pending/loss. p_outputs/p_consumed: [{"sku_id","qty"}].
create or replace function public.jw_receive(
  p_job_id uuid,
  p_outputs jsonb,
  p_consumed jsonb default '[]'::jsonb,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jw_job%rowtype;
  v_in record;
  v_out_count int := 0;
  v_rows int;
begin
  perform public.ops_assert_admin();

  select * into v_job from public.jw_job where id = p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if v_job.status not in ('issued', 'received') then
    raise exception 'Only issued jobs can receive (current: %)', v_job.status;
  end if;

  for v_in in
    select (o->>'sku_id')::uuid as sku_id, (o->>'qty')::numeric as qty
    from jsonb_array_elements(coalesce(p_outputs, '[]'::jsonb)) o
  loop
    if v_in.qty is null or v_in.qty <= 0 then
      raise exception 'Output quantities must be greater than zero';
    end if;
    v_out_count := v_out_count + 1;

    update public.jw_job_line
    set qty_moved = qty_moved + v_in.qty
    where job_id = p_job_id and direction = 'output' and sku_id = v_in.sku_id;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'SKU is not an output line of this job — add it while the job is draft';
    end if;

    perform public.inv_post_movement(
      v_in.sku_id, null, v_job.location_id, v_in.qty,
      'good', 'production_out', 'jw_job', p_job_id::text, null,
      coalesce(p_note, 'Job-work receipt')
    );
  end loop;

  if v_out_count = 0 then
    raise exception 'Receive needs at least one output line';
  end if;

  for v_in in
    select (c->>'sku_id')::uuid as sku_id, (c->>'qty')::numeric as qty
    from jsonb_array_elements(coalesce(p_consumed, '[]'::jsonb)) c
  loop
    if v_in.qty is null or v_in.qty <= 0 then
      raise exception 'Consumed quantities must be greater than zero';
    end if;
    perform public.inv_post_movement(
      v_in.sku_id, v_job.worker_location_id, null, v_in.qty,
      'good', 'consumption', 'jw_job', p_job_id::text, null,
      coalesce(p_note, 'Job-work input consumed')
    );
  end loop;

  perform set_config('ops.allow_status_change', '1', true);
  update public.jw_job
  set status = 'received', received_at = coalesce(received_at, now())
  where id = p_job_id;
  perform set_config('ops.allow_status_change', '', true);
end;
$$;

-- Return leftover input from the worker location, then close. Any input still
-- at the worker location after close is recorded loss (visible in balances).
create or replace function public.jw_close(p_job_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  perform public.ops_assert_admin();
  select status into v_status from public.jw_job where id = p_job_id for update;
  if v_status is null then raise exception 'Job not found'; end if;
  if v_status <> 'received' then
    raise exception 'Only received jobs can be closed (current: %)', v_status;
  end if;
  perform set_config('ops.allow_status_change', '1', true);
  update public.jw_job
  set status = 'closed', note = coalesce(nullif(trim(coalesce(p_note, '')), ''), note)
  where id = p_job_id;
  perform set_config('ops.allow_status_change', '', true);
end;
$$;

create or replace function public.jw_cancel(p_job_id uuid, p_reason text)
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
  select status into v_status from public.jw_job where id = p_job_id for update;
  if v_status is null then raise exception 'Job not found'; end if;
  if v_status <> 'draft' then
    raise exception 'Issued jobs cannot be cancelled — receive/return the stock and close instead';
  end if;
  perform set_config('ops.allow_status_change', '1', true);
  update public.jw_job set status = 'cancelled', note = trim(p_reason) where id = p_job_id;
  perform set_config('ops.allow_status_change', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. SLA — stage targets as data, measured in business hours
-- (Mon–Sat 09:30–18:30 IST; same working calendar the enquiry SLA uses).
-- ---------------------------------------------------------------------------

create table if not exists public.sla_policy (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in (
    'b2b', 'counter', 'distributor', 'enquiry', 'ecom_uniware'
  )),
  stage text not null check (stage in (
    'confirm_to_production', 'production_to_ready', 'ready_to_dispatch'
  )),
  target_hours numeric(8, 2) not null check (target_hours > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, stage)
);

-- Business hours between two timestamps, Mon–Sat 09:30–18:30 IST.
create or replace function public.ops_business_hours_between(p_from timestamptz, p_to timestamptz)
returns numeric
language plpgsql
immutable
as $$
declare
  v_day date;
  v_start timestamptz;
  v_end timestamptz;
  v_open timestamptz;
  v_close timestamptz;
  v_total numeric := 0;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    return 0;
  end if;

  v_day := (p_from at time zone 'Asia/Kolkata')::date;
  while v_day <= (p_to at time zone 'Asia/Kolkata')::date loop
    -- Sunday off (dow 0).
    if extract(dow from v_day) <> 0 then
      v_open := (v_day::text || ' 09:30')::timestamp at time zone 'Asia/Kolkata';
      v_close := (v_day::text || ' 18:30')::timestamp at time zone 'Asia/Kolkata';
      v_start := greatest(p_from, v_open);
      v_end := least(p_to, v_close);
      if v_end > v_start then
        v_total := v_total + extract(epoch from (v_end - v_start)) / 3600.0;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;

  return round(v_total, 2);
end;
$$;

-- One row per order × applicable stage with elapsed business hours, the target
-- and a breach flag. Open stages measure against now().
create or replace view public.so_sla_view
with (security_invoker = true) as
select
  o.id as so_id,
  o.so_no,
  o.channel,
  o.status,
  o.owner,
  c.legal_name as customer_name,
  s.stage,
  s.target_hours,
  case s.stage
    when 'confirm_to_production' then
      public.ops_business_hours_between(o.confirmed_at, coalesce(o.production_started_at, o.ready_at, o.dispatched_at, now()))
    when 'production_to_ready' then
      public.ops_business_hours_between(o.production_started_at, coalesce(o.ready_at, o.dispatched_at, now()))
    when 'ready_to_dispatch' then
      public.ops_business_hours_between(o.ready_at, coalesce(o.dispatched_at, now()))
  end as elapsed_hours,
  case s.stage
    when 'confirm_to_production' then o.production_started_at is not null
    when 'production_to_ready' then o.ready_at is not null
    when 'ready_to_dispatch' then o.dispatched_at is not null
  end as stage_done,
  case s.stage
    when 'confirm_to_production' then
      public.ops_business_hours_between(o.confirmed_at, coalesce(o.production_started_at, o.ready_at, o.dispatched_at, now())) > s.target_hours
    when 'production_to_ready' then
      public.ops_business_hours_between(o.production_started_at, coalesce(o.ready_at, o.dispatched_at, now())) > s.target_hours
    when 'ready_to_dispatch' then
      public.ops_business_hours_between(o.ready_at, coalesce(o.dispatched_at, now())) > s.target_hours
  end as breached
from public.so_order o
join public.crm_party c on c.id = o.customer_id
join public.sla_policy s on s.channel = o.channel and s.is_active
where o.status not in ('draft', 'cancelled', 'closed')
  and case s.stage
    when 'confirm_to_production' then o.confirmed_at is not null
    when 'production_to_ready' then o.production_started_at is not null
    when 'ready_to_dispatch' then o.ready_at is not null
  end;

-- Open-order overview for the panel.
create or replace view public.so_open_view
with (security_invoker = true) as
select
  o.id, o.so_no, o.status, o.channel, o.order_date, o.promised_date, o.owner,
  o.customer_id, c.legal_name as customer_name,
  o.entity_id, o.location_id,
  sum(l.qty) as qty_ordered,
  sum(l.qty_reserved) as qty_reserved,
  sum(l.qty_dispatched) as qty_dispatched,
  round(sum(l.qty * l.rate), 2) as order_value,
  case
    when o.promised_date is not null and o.promised_date < current_date
         and o.status in ('confirmed', 'in_production', 'ready', 'partially_dispatched')
      then current_date - o.promised_date
    else 0
  end as days_overdue
from public.so_order o
join public.crm_party c on c.id = o.customer_id
left join public.so_line l on l.so_id = o.id
group by o.id, c.legal_name;

-- ---------------------------------------------------------------------------
-- 6. Grants, RLS, audit.
-- ---------------------------------------------------------------------------

revoke execute on function public.so_allocate(uuid) from public, anon;
revoke execute on function public.so_confirm(uuid) from public, anon;
revoke execute on function public.so_set_status(uuid, text, text) from public, anon;
revoke execute on function public.so_cancel(uuid, text) from public, anon;
revoke execute on function public.so_consume_reservation(uuid, uuid, uuid, numeric) from public, anon, authenticated;
revoke execute on function public.so_post_dispatch(uuid, jsonb, date, text, text, integer, numeric, text, text) from public, anon;
revoke execute on function public.jw_issue(uuid) from public, anon;
revoke execute on function public.jw_receive(uuid, jsonb, jsonb, text) from public, anon;
revoke execute on function public.jw_close(uuid, text) from public, anon;
revoke execute on function public.jw_cancel(uuid, text) from public, anon;

grant execute on function public.so_allocate(uuid) to authenticated;
grant execute on function public.so_confirm(uuid) to authenticated;
grant execute on function public.so_set_status(uuid, text, text) to authenticated;
grant execute on function public.so_cancel(uuid, text) to authenticated;
grant execute on function public.so_post_dispatch(uuid, jsonb, date, text, text, integer, numeric, text, text) to authenticated;
grant execute on function public.jw_issue(uuid) to authenticated;
grant execute on function public.jw_receive(uuid, jsonb, jsonb, text) to authenticated;
grant execute on function public.jw_close(uuid, text) to authenticated;
grant execute on function public.jw_cancel(uuid, text) to authenticated;
grant execute on function public.ops_business_hours_between(timestamptz, timestamptz) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'so_order', 'so_line', 'so_dispatch', 'so_dispatch_line',
    'jw_job', 'jw_job_line', 'sla_policy'
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

  -- Drafting documents: admin direct writes (guards enforce immutability).
  -- Dispatches have NO write policies — so_post_dispatch is the only door.
  foreach t in array array['so_order', 'so_line', 'jw_job', 'jw_job_line', 'sla_policy']
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
end;
$$;

-- Audit every document (law 4).
do $$
declare
  t text;
begin
  foreach t in array array['so_order', 'so_dispatch', 'jw_job', 'sla_policy']
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

drop trigger if exists sla_policy_updated_at on public.sla_policy;
create trigger sla_policy_updated_at
before update on public.sla_policy
for each row execute function public.set_updated_at();
