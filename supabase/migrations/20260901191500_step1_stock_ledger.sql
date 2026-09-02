-- Step 1 of the One Source of Truth roadmap: the stock ledger.
-- Law 2: stock is an append-only movement ledger; on-hand is a sum, never edited.
-- Every mutation goes through SECURITY DEFINER functions with row locks
-- (SELECT ... FOR UPDATE) — never client code. inv_movement is insert-only,
-- enforced by trigger. Balances are maintained by the posting function and
-- verified nightly against the ledger (drift alerts + pg_cron).
-- Role gate v1: admin app users and server contexts may post; department roles
-- (warehouse) come later. Scott API tables are untouched.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.inv_movement (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.cat_sku(id) on delete restrict,
  from_location_id uuid references public.core_location(id) on delete restrict,
  to_location_id uuid references public.core_location(id) on delete restrict,
  qty numeric(12, 2) not null check (qty > 0),
  state text not null default 'good' check (state in ('good', 'qc_hold', 'damaged')),
  reason text not null check (reason in (
    'grn', 'qc_pass', 'qc_fail', 'putaway', 'transfer', 'pick', 'dispatch',
    'return_in', 'adjustment', 'kit_build', 'kit_break', 'consumption',
    'production_out', 'cycle_count'
  )),
  ref_type text,
  ref_id text,
  lot text,
  note text,
  actor uuid,
  created_at timestamptz not null default now(),
  check (from_location_id is not null or to_location_id is not null),
  check (from_location_id is distinct from to_location_id)
);

create index if not exists inv_movement_sku_idx
  on public.inv_movement (sku_id, created_at desc);
create index if not exists inv_movement_from_idx
  on public.inv_movement (from_location_id, created_at desc);
create index if not exists inv_movement_to_idx
  on public.inv_movement (to_location_id, created_at desc);
create index if not exists inv_movement_ref_idx
  on public.inv_movement (ref_type, ref_id);

-- Append-only: corrections are reversing movements, never edits.
create or replace function public.inv_movement_block_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'inv_movement is append-only — post a reversing movement instead';
end;
$$;

drop trigger if exists inv_movement_no_update_delete on public.inv_movement;
create trigger inv_movement_no_update_delete
before update or delete on public.inv_movement
for each row execute function public.inv_movement_block_change();

create table if not exists public.inv_balance (
  sku_id uuid not null references public.cat_sku(id) on delete restrict,
  location_id uuid not null references public.core_location(id) on delete restrict,
  state text not null check (state in ('good', 'qc_hold', 'damaged')),
  qty numeric(14, 2) not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (sku_id, location_id, state)
);

create table if not exists public.inv_reservation (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.cat_sku(id) on delete restrict,
  location_id uuid not null references public.core_location(id) on delete restrict,
  qty numeric(12, 2) not null check (qty > 0),
  ref_type text,
  ref_id text,
  status text not null default 'active' check (status in ('active', 'released', 'consumed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create index if not exists inv_reservation_active_idx
  on public.inv_reservation (sku_id, location_id) where status = 'active';

create table if not exists public.inv_count_session (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.core_location(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'posted', 'cancelled')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  posted_at timestamptz
);

create table if not exists public.inv_count_line (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inv_count_session(id) on delete cascade,
  sku_id uuid not null references public.cat_sku(id) on delete restrict,
  state text not null default 'good' check (state in ('good', 'qc_hold', 'damaged')),
  expected_qty numeric(14, 2),
  counted_qty numeric(14, 2) not null check (counted_qty >= 0),
  created_at timestamptz not null default now(),
  unique (session_id, sku_id, state)
);

create table if not exists public.inv_drift_alert (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null,
  location_id uuid not null,
  state text not null,
  ledger_qty numeric(14, 2) not null,
  balance_qty numeric(14, 2) not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Role gate: admin app users and server contexts (auth.uid() is null) only.
-- ---------------------------------------------------------------------------

create or replace function public.inv_assert_can_post()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.jwt_user_is_admin() then
    raise exception 'Only admin can move stock (department roles come in a later step)';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Balance maintenance — always through a locked row; never negative.
-- ---------------------------------------------------------------------------

create or replace function public.inv_apply_balance(
  p_sku_id uuid,
  p_location_id uuid,
  p_state text,
  p_delta numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qty numeric;
begin
  insert into public.inv_balance (sku_id, location_id, state, qty)
  values (p_sku_id, p_location_id, p_state, 0)
  on conflict (sku_id, location_id, state) do nothing;

  select qty into v_qty
  from public.inv_balance
  where sku_id = p_sku_id and location_id = p_location_id and state = p_state
  for update;

  if v_qty + p_delta < 0 then
    raise exception 'Insufficient stock: have %, movement needs %', v_qty, abs(p_delta);
  end if;

  update public.inv_balance
  set qty = qty + p_delta, updated_at = now()
  where sku_id = p_sku_id and location_id = p_location_id and state = p_state;
end;
$$;

-- ---------------------------------------------------------------------------
-- inv_post_movement — the only door for stock changes.
-- ---------------------------------------------------------------------------

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
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.inv_assert_can_post();

  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be greater than zero';
  end if;
  if p_from_location_id is null and p_to_location_id is null then
    raise exception 'Movement needs a from or a to location';
  end if;
  if p_reason in ('adjustment', 'cycle_count') and coalesce(trim(p_note), '') = '' then
    raise exception 'Adjustments need a reason note';
  end if;

  if p_from_location_id is not null then
    perform public.inv_apply_balance(p_sku_id, p_from_location_id, p_state, -p_qty);
  end if;
  if p_to_location_id is not null then
    perform public.inv_apply_balance(p_sku_id, p_to_location_id, p_state, p_qty);
  end if;

  insert into public.inv_movement (
    sku_id, from_location_id, to_location_id, qty, state, reason,
    ref_type, ref_id, lot, note, actor
  )
  values (
    p_sku_id, p_from_location_id, p_to_location_id, p_qty, p_state, p_reason,
    p_ref_type, p_ref_id, p_lot, nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reservations — available = balance − active reservations, checked under lock.
-- ---------------------------------------------------------------------------

create or replace function public.inv_reserve(
  p_sku_id uuid,
  p_location_id uuid,
  p_qty numeric,
  p_ref_type text default null,
  p_ref_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_reserved numeric;
  v_id uuid;
begin
  perform public.inv_assert_can_post();

  if p_qty is null or p_qty <= 0 then
    raise exception 'Reservation quantity must be greater than zero';
  end if;

  select qty into v_balance
  from public.inv_balance
  where sku_id = p_sku_id and location_id = p_location_id and state = 'good'
  for update;

  if v_balance is null then
    raise exception 'No stock at this location for this SKU';
  end if;

  select coalesce(sum(qty), 0) into v_reserved
  from public.inv_reservation
  where sku_id = p_sku_id and location_id = p_location_id and status = 'active';

  if v_balance - v_reserved < p_qty then
    raise exception 'Insufficient available stock: on-hand %, reserved %, asked %',
      v_balance, v_reserved, p_qty;
  end if;

  insert into public.inv_reservation (sku_id, location_id, qty, ref_type, ref_id, created_by)
  values (p_sku_id, p_location_id, p_qty, p_ref_type, p_ref_id, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.inv_release_reservation(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.inv_assert_can_post();

  update public.inv_reservation
  set status = 'released', released_at = now()
  where id = p_reservation_id and status = 'active';
  -- Idempotent: already released/consumed rows are left as they are.
end;
$$;

-- ---------------------------------------------------------------------------
-- Kit build / break — paired movements sharing one reference (law 2).
-- ---------------------------------------------------------------------------

create or replace function public.inv_kit_build(
  p_kit_sku_id uuid,
  p_qty numeric,
  p_location_id uuid,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := gen_random_uuid()::text;
  v_component record;
  v_count int := 0;
begin
  perform public.inv_assert_can_post();

  for v_component in
    select component_sku_id, qty from public.cat_kit where kit_sku_id = p_kit_sku_id
  loop
    v_count := v_count + 1;
    perform public.inv_post_movement(
      v_component.component_sku_id, p_location_id, null,
      v_component.qty * p_qty, 'good', 'kit_build', 'kit_build', v_ref, null, p_note
    );
  end loop;

  if v_count = 0 then
    raise exception 'This SKU has no kit components (cat_kit)';
  end if;

  perform public.inv_post_movement(
    p_kit_sku_id, null, p_location_id,
    p_qty, 'good', 'kit_build', 'kit_build', v_ref, null, p_note
  );

  return v_ref;
end;
$$;

create or replace function public.inv_kit_break(
  p_kit_sku_id uuid,
  p_qty numeric,
  p_location_id uuid,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := gen_random_uuid()::text;
  v_component record;
  v_count int := 0;
begin
  perform public.inv_assert_can_post();

  perform public.inv_post_movement(
    p_kit_sku_id, p_location_id, null,
    p_qty, 'good', 'kit_break', 'kit_break', v_ref, null, p_note
  );

  for v_component in
    select component_sku_id, qty from public.cat_kit where kit_sku_id = p_kit_sku_id
  loop
    v_count := v_count + 1;
    perform public.inv_post_movement(
      v_component.component_sku_id, null, p_location_id,
      v_component.qty * p_qty, 'good', 'kit_break', 'kit_break', v_ref, null, p_note
    );
  end loop;

  if v_count = 0 then
    raise exception 'This SKU has no kit components (cat_kit)';
  end if;

  return v_ref;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cycle counts — session + lines (working documents, admin-writable directly);
-- posting turns variances into cycle_count adjustment movements.
-- ---------------------------------------------------------------------------

create or replace function public.inv_count_line_fill_expected()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location uuid;
begin
  if new.expected_qty is null then
    select location_id into v_location from public.inv_count_session where id = new.session_id;
    select coalesce(qty, 0) into new.expected_qty
    from public.inv_balance
    where sku_id = new.sku_id and location_id = v_location and state = new.state;
    new.expected_qty := coalesce(new.expected_qty, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists inv_count_line_expected on public.inv_count_line;
create trigger inv_count_line_expected
before insert on public.inv_count_line
for each row execute function public.inv_count_line_fill_expected();

create or replace function public.inv_count_post(p_session_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.inv_count_session%rowtype;
  v_line record;
  v_variance numeric;
  v_adjusted int := 0;
begin
  perform public.inv_assert_can_post();

  select * into v_session from public.inv_count_session where id = p_session_id for update;
  if not found then
    raise exception 'Count session not found';
  end if;
  if v_session.status <> 'open' then
    raise exception 'Count session is % — only open sessions can post', v_session.status;
  end if;

  for v_line in
    select * from public.inv_count_line where session_id = p_session_id
  loop
    v_variance := v_line.counted_qty - coalesce(v_line.expected_qty, 0);
    if v_variance > 0 then
      perform public.inv_post_movement(
        v_line.sku_id, null, v_session.location_id, v_variance, v_line.state,
        'cycle_count', 'inv_count_session', p_session_id::text, null,
        'Cycle count variance (found more than expected)'
      );
      v_adjusted := v_adjusted + 1;
    elsif v_variance < 0 then
      perform public.inv_post_movement(
        v_line.sku_id, v_session.location_id, null, abs(v_variance), v_line.state,
        'cycle_count', 'inv_count_session', p_session_id::text, null,
        'Cycle count variance (found less than expected)'
      );
      v_adjusted := v_adjusted + 1;
    end if;
  end loop;

  update public.inv_count_session
  set status = 'posted', posted_at = now()
  where id = p_session_id;

  return v_adjusted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Drift check — recompute balances from the ledger; alert on any mismatch.
-- ---------------------------------------------------------------------------

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
      select sku_id, to_location_id as location_id, state, qty as delta
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

do $$
begin
  perform cron.schedule(
    'inv-drift-nightly',
    '0 21 * * *',  -- 21:00 UTC = 02:30 IST
    $job$select public.inv_recompute_drift()$job$
  );
exception when others then
  raise notice 'pg_cron schedule skipped: %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants + RLS. Reads for signed-in users; NO direct write policies on the
-- ledger, balances or reservations — the definer functions are the only door.
-- Count sessions/lines are working documents: admin may write directly.
-- ---------------------------------------------------------------------------

revoke execute on function public.inv_assert_can_post() from public, anon;
revoke execute on function public.inv_apply_balance(uuid, uuid, text, numeric) from public, anon, authenticated;
revoke execute on function public.inv_post_movement(uuid, uuid, uuid, numeric, text, text, text, text, text, text) from public, anon;
revoke execute on function public.inv_reserve(uuid, uuid, numeric, text, text) from public, anon;
revoke execute on function public.inv_release_reservation(uuid) from public, anon;
revoke execute on function public.inv_kit_build(uuid, numeric, uuid, text) from public, anon;
revoke execute on function public.inv_kit_break(uuid, numeric, uuid, text) from public, anon;
revoke execute on function public.inv_count_post(uuid) from public, anon;
revoke execute on function public.inv_recompute_drift() from public, anon, authenticated;

grant execute on function public.inv_post_movement(uuid, uuid, uuid, numeric, text, text, text, text, text, text) to authenticated;
grant execute on function public.inv_reserve(uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.inv_release_reservation(uuid) to authenticated;
grant execute on function public.inv_kit_build(uuid, numeric, uuid, text) to authenticated;
grant execute on function public.inv_kit_break(uuid, numeric, uuid, text) to authenticated;
grant execute on function public.inv_count_post(uuid) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'inv_movement', 'inv_balance', 'inv_reservation',
    'inv_count_session', 'inv_count_line', 'inv_drift_alert'
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
end;
$$;

drop policy if exists "inv_count_session admin write" on public.inv_count_session;
create policy "inv_count_session admin write"
on public.inv_count_session
for all
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

drop policy if exists "inv_count_line admin write" on public.inv_count_line;
create policy "inv_count_line admin write"
on public.inv_count_line
for all
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

drop policy if exists "inv_drift_alert admin update" on public.inv_drift_alert;
create policy "inv_drift_alert admin update"
on public.inv_drift_alert
for update
to authenticated
using (public.jwt_user_is_admin())
with check (public.jwt_user_is_admin());

-- Audit reservations and count sessions (state-changing documents).
drop trigger if exists inv_reservation_audit on public.inv_reservation;
create trigger inv_reservation_audit
after insert or update or delete on public.inv_reservation
for each row execute function public.audit_row_change();

drop trigger if exists inv_count_session_audit on public.inv_count_session;
create trigger inv_count_session_audit
after insert or update or delete on public.inv_count_session
for each row execute function public.audit_row_change();
