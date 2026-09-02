-- Step 4 of the One Source of Truth roadmap: billing + receivables.
-- Invoices are GENERATED from dispatches (never typed), numbered gapless per
-- entity x GSTIN x FY, immutable once numbered — corrections are credit notes.
-- Receipts allocate across invoices and can never over-allocate. Ageing is a
-- view (NOT DUE / 0-30 / 31-60 / 61-90 / 90+), due date = invoice date +
-- party credit days. ar_followup gives collections a next-action trail.
-- Deferred with decisions logged: GSP e-invoice (IRN/QR), e-way bill API,
-- Tally XML batch, distributor incentive engine (need vendor picks/creds).
-- Scott API untouched.

-- ---------------------------------------------------------------------------
-- 1. GSTIN-scoped gapless numbering (law: per GSTIN per FY).
-- ---------------------------------------------------------------------------

create or replace function public.ops_next_gstin_doc_no(
  p_entity_id uuid,
  p_gstin_id uuid,
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
  values (p_entity_id, p_gstin_id, p_doc_type, v_fy, upper(p_doc_type) || '/' || v_fy || '/', 4)
  on conflict do nothing;

  return public.core_next_sequence(p_entity_id, p_gstin_id, p_doc_type, v_fy);
end;
$$;
revoke execute on function public.ops_next_gstin_doc_no(uuid, uuid, text, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Invoice — generated from a dispatch, one invoice per dispatch.
-- ---------------------------------------------------------------------------

create table if not exists public.bill_invoice (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  entity_id uuid not null references public.core_entity(id) on delete restrict,
  gstin_id uuid not null references public.core_gstin(id) on delete restrict,
  customer_id uuid not null references public.crm_party(id) on delete restrict,
  so_id uuid not null references public.so_order(id) on delete restrict,
  dispatch_id uuid not null unique references public.so_dispatch(id) on delete restrict,
  invoice_date date not null,
  -- GST place of supply, 2-digit state code; intra-state => CGST+SGST.
  place_of_supply text not null check (length(place_of_supply) = 2),
  intra_state boolean not null,
  credit_days integer not null default 0,
  due_date date not null,
  owner uuid,
  subtotal numeric(14, 2) not null,
  igst_amount numeric(14, 2) not null default 0,
  cgst_amount numeric(14, 2) not null default 0,
  sgst_amount numeric(14, 2) not null default 0,
  total numeric(14, 2) not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists bill_invoice_customer_idx on public.bill_invoice (customer_id, due_date);
create index if not exists bill_invoice_entity_idx on public.bill_invoice (entity_id, invoice_date desc);

create table if not exists public.bill_invoice_line (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.bill_invoice(id) on delete restrict,
  dispatch_line_id uuid not null unique references public.so_dispatch_line(id) on delete restrict,
  sku_id uuid not null references public.cat_sku(id) on delete restrict,
  hsn text,
  qty numeric(12, 2) not null check (qty > 0),
  rate numeric(12, 2) not null check (rate >= 0),
  taxable_value numeric(14, 2) not null,
  gst_rate numeric(5, 2) not null default 0,
  igst numeric(14, 2) not null default 0,
  cgst numeric(14, 2) not null default 0,
  sgst numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null,
  created_at timestamptz not null default now()
);

create index if not exists bill_invoice_line_invoice_idx on public.bill_invoice_line (invoice_id);

-- An invoice is immutable once numbered (it is numbered at birth). The only
-- exception is the totals write inside bill_generate_from_dispatch, which
-- runs under the transaction-local flag.
create or replace function public.bill_block_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and public.ops_status_change_allowed() then
    return new;
  end if;
  raise exception 'Invoices, credit notes and receipts are immutable — corrections are credit notes / counter entries';
end;
$$;

drop trigger if exists bill_invoice_no_change on public.bill_invoice;
create trigger bill_invoice_no_change
before update or delete on public.bill_invoice
for each row execute function public.bill_block_change();

drop trigger if exists bill_invoice_line_no_change on public.bill_invoice_line;
create trigger bill_invoice_line_no_change
before update or delete on public.bill_invoice_line
for each row execute function public.bill_block_change();

-- ---------------------------------------------------------------------------
-- 3. Credit note — the only way to correct an issued invoice.
-- ---------------------------------------------------------------------------

create table if not exists public.bill_credit_note (
  id uuid primary key default gen_random_uuid(),
  cn_no text not null unique,
  entity_id uuid not null references public.core_entity(id) on delete restrict,
  gstin_id uuid not null references public.core_gstin(id) on delete restrict,
  customer_id uuid not null references public.crm_party(id) on delete restrict,
  invoice_id uuid not null references public.bill_invoice(id) on delete restrict,
  note_date date not null,
  amount numeric(14, 2) not null check (amount > 0),
  reason text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists bill_credit_note_invoice_idx on public.bill_credit_note (invoice_id);

drop trigger if exists bill_credit_note_no_change on public.bill_credit_note;
create trigger bill_credit_note_no_change
before update or delete on public.bill_credit_note
for each row execute function public.bill_block_change();

-- ---------------------------------------------------------------------------
-- 4. Receipts + allocations (append-only; can never over-allocate).
-- ---------------------------------------------------------------------------

create table if not exists public.ar_receipt (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  customer_id uuid not null references public.crm_party(id) on delete restrict,
  entity_id uuid not null references public.core_entity(id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  received_on date not null,
  mode text not null check (mode in ('bank', 'upi', 'cash', 'cheque', 'adjustment')),
  utr text,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists ar_receipt_customer_idx on public.ar_receipt (customer_id, received_on desc);

create table if not exists public.ar_allocation (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.ar_receipt(id) on delete restrict,
  invoice_id uuid not null references public.bill_invoice(id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (receipt_id, invoice_id)
);

create index if not exists ar_allocation_invoice_idx on public.ar_allocation (invoice_id);

drop trigger if exists ar_receipt_no_change on public.ar_receipt;
create trigger ar_receipt_no_change
before update or delete on public.ar_receipt
for each row execute function public.bill_block_change();

drop trigger if exists ar_allocation_no_change on public.ar_allocation;
create trigger ar_allocation_no_change
before update or delete on public.ar_allocation
for each row execute function public.bill_block_change();

-- ---------------------------------------------------------------------------
-- 5. Collections follow-ups (working documents; admin-editable).
-- ---------------------------------------------------------------------------

create table if not exists public.ar_followup (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.crm_party(id) on delete restrict,
  invoice_id uuid references public.bill_invoice(id) on delete restrict,
  owner uuid,
  next_date date not null,
  note text,
  outcome text,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ar_followup_open_idx on public.ar_followup (status, next_date);

drop trigger if exists ar_followup_updated_at on public.ar_followup;
create trigger ar_followup_updated_at
before update on public.ar_followup
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Functions.
-- ---------------------------------------------------------------------------

-- Invoice outstanding under lock: total − credit notes − receipts allocated.
create or replace function public.ar_invoice_outstanding_locked(p_invoice_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_credited numeric;
  v_received numeric;
begin
  select total into v_total from public.bill_invoice where id = p_invoice_id for update;
  if v_total is null then raise exception 'Invoice not found'; end if;
  select coalesce(sum(amount), 0) into v_credited from public.bill_credit_note where invoice_id = p_invoice_id;
  select coalesce(sum(amount), 0) into v_received from public.ar_allocation where invoice_id = p_invoice_id;
  return v_total - v_credited - v_received;
end;
$$;
revoke execute on function public.ar_invoice_outstanding_locked(uuid) from public, anon, authenticated;

-- Generate the invoice from a dispatch. GST split by place of supply vs the
-- GSTIN's state; rates come from the order lines; HSN from the SKU master.
create or replace function public.bill_generate_from_dispatch(
  p_dispatch_id uuid,
  p_gstin_id uuid,
  p_place_of_supply text default null,
  p_invoice_date date default current_date,
  p_owner uuid default null,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.so_dispatch%rowtype;
  v_so public.so_order%rowtype;
  v_gstin public.core_gstin%rowtype;
  v_customer public.crm_party%rowtype;
  v_pos text;
  v_intra boolean;
  v_no text;
  v_invoice_id uuid;
  v_line record;
  v_taxable numeric;
  v_tax numeric;
  v_line_cgst numeric;
  v_line_sgst numeric;
  v_subtotal numeric := 0;
  v_igst numeric := 0;
  v_cgst numeric := 0;
  v_sgst numeric := 0;
  v_uninvoiced int;
begin
  perform public.ops_assert_admin();

  select * into v_dispatch from public.so_dispatch where id = p_dispatch_id;
  if not found then raise exception 'Dispatch not found'; end if;
  if exists (select 1 from public.bill_invoice where dispatch_id = p_dispatch_id) then
    raise exception 'This dispatch is already invoiced';
  end if;

  select * into v_so from public.so_order where id = v_dispatch.so_id for update;
  select * into v_gstin from public.core_gstin where id = p_gstin_id;
  if not found then raise exception 'GSTIN not found'; end if;
  if v_gstin.entity_id <> v_so.entity_id then
    raise exception 'GSTIN belongs to a different entity than the order';
  end if;
  select * into v_customer from public.crm_party where id = v_so.customer_id;

  v_pos := coalesce(nullif(trim(coalesce(p_place_of_supply, '')), ''), v_gstin.state_code);
  if length(v_pos) <> 2 then
    raise exception 'Place of supply must be a 2-digit state code';
  end if;
  v_intra := (v_pos = v_gstin.state_code);

  v_no := public.ops_next_gstin_doc_no(v_so.entity_id, p_gstin_id, 'inv', p_invoice_date);

  insert into public.bill_invoice
    (invoice_no, entity_id, gstin_id, customer_id, so_id, dispatch_id, invoice_date,
     place_of_supply, intra_state, credit_days, due_date, owner,
     subtotal, igst_amount, cgst_amount, sgst_amount, total, note, created_by)
  values
    (v_no, v_so.entity_id, p_gstin_id, v_so.customer_id, v_so.id, p_dispatch_id, p_invoice_date,
     v_pos, v_intra, coalesce(v_customer.credit_days, 0),
     p_invoice_date + coalesce(v_customer.credit_days, 0), coalesce(p_owner, v_customer.owner_profile_id),
     0, 0, 0, 0, 0, nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_invoice_id;

  for v_line in
    select dl.id as dispatch_line_id, dl.qty, sl.rate, sl.tax_pct, sl.sku_id, s.hsn
    from public.so_dispatch_line dl
    join public.so_line sl on sl.id = dl.so_line_id
    join public.cat_sku s on s.id = sl.sku_id
    where dl.dispatch_id = p_dispatch_id
  loop
    v_taxable := round(v_line.qty * v_line.rate, 2);
    v_tax := round(v_taxable * v_line.tax_pct / 100.0, 2);
    -- Split so the two halves always sum exactly to the tax (no paisa drift).
    v_line_cgst := round(v_tax / 2, 2);
    v_line_sgst := v_tax - v_line_cgst;
    v_subtotal := v_subtotal + v_taxable;
    if v_intra then
      v_cgst := v_cgst + v_line_cgst;
      v_sgst := v_sgst + v_line_sgst;
    else
      v_igst := v_igst + v_tax;
    end if;

    insert into public.bill_invoice_line
      (invoice_id, dispatch_line_id, sku_id, hsn, qty, rate, taxable_value, gst_rate,
       igst, cgst, sgst, line_total)
    values
      (v_invoice_id, v_line.dispatch_line_id, v_line.sku_id, v_line.hsn, v_line.qty, v_line.rate,
       v_taxable, v_line.tax_pct,
       case when v_intra then 0 else v_tax end,
       case when v_intra then v_line_cgst else 0 end,
       case when v_intra then v_line_sgst else 0 end,
       v_taxable + v_tax);
  end loop;

  if not exists (select 1 from public.bill_invoice_line where invoice_id = v_invoice_id) then
    raise exception 'Dispatch has no lines to invoice';
  end if;

  -- Totals are written once under the transaction-local flag; from here on
  -- the immutability trigger rejects every change.
  perform set_config('ops.allow_status_change', '1', true);
  update public.bill_invoice
  set subtotal = v_subtotal,
      igst_amount = v_igst,
      cgst_amount = v_cgst,
      sgst_amount = v_sgst,
      total = v_subtotal + v_igst + v_cgst + v_sgst
  where id = v_invoice_id;
  perform set_config('ops.allow_status_change', '', true);

  -- Order rolls to invoiced when it is fully dispatched and every dispatch
  -- carries an invoice.
  select count(*) into v_uninvoiced
  from public.so_dispatch d
  left join public.bill_invoice i on i.dispatch_id = d.id
  where d.so_id = v_so.id and i.id is null;

  if v_so.status = 'dispatched' and v_uninvoiced = 0 then
    perform set_config('ops.allow_status_change', '1', true);
    update public.so_order set status = 'invoiced' where id = v_so.id;
    perform set_config('ops.allow_status_change', '', true);
  end if;

  return v_no;
end;
$$;

-- Credit note against an invoice; capped at the invoice's outstanding.
create or replace function public.ar_issue_credit_note(
  p_invoice_id uuid,
  p_amount numeric,
  p_reason text,
  p_note_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.bill_invoice%rowtype;
  v_outstanding numeric;
  v_no text;
begin
  perform public.ops_assert_admin();
  if p_amount is null or p_amount <= 0 then
    raise exception 'Credit note amount must be greater than zero';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Credit note needs a reason';
  end if;

  v_outstanding := public.ar_invoice_outstanding_locked(p_invoice_id);
  select * into v_inv from public.bill_invoice where id = p_invoice_id;
  if p_amount > v_outstanding then
    raise exception 'Credit % exceeds invoice outstanding %', p_amount, v_outstanding;
  end if;

  v_no := public.ops_next_gstin_doc_no(v_inv.entity_id, v_inv.gstin_id, 'cn', p_note_date);

  insert into public.bill_credit_note
    (cn_no, entity_id, gstin_id, customer_id, invoice_id, note_date, amount, reason, created_by)
  values
    (v_no, v_inv.entity_id, v_inv.gstin_id, v_inv.customer_id, p_invoice_id, p_note_date,
     p_amount, trim(p_reason), auth.uid());

  return v_no;
end;
$$;

-- Receipt + allocations, all-or-nothing; allocation can never exceed the
-- invoice outstanding or the receipt amount.
-- p_allocations: [{"invoice_id": "...", "amount": 100}, ...]
create or replace function public.ar_record_receipt(
  p_customer_id uuid,
  p_entity_id uuid,
  p_amount numeric,
  p_received_on date,
  p_mode text,
  p_utr text default null,
  p_note text default null,
  p_allocations jsonb default '[]'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt_id uuid;
  v_no text;
  v_alloc record;
  v_alloc_total numeric := 0;
  v_outstanding numeric;
  v_inv_customer uuid;
begin
  perform public.ops_assert_admin();
  if p_amount is null or p_amount <= 0 then
    raise exception 'Receipt amount must be greater than zero';
  end if;

  v_no := public.ops_next_doc_no(p_entity_id, 'rcpt', p_received_on);

  insert into public.ar_receipt
    (receipt_no, customer_id, entity_id, amount, received_on, mode, utr, note, created_by)
  values
    (v_no, p_customer_id, p_entity_id, p_amount, p_received_on, p_mode,
     nullif(trim(coalesce(p_utr, '')), ''), nullif(trim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_receipt_id;

  for v_alloc in
    select (a->>'invoice_id')::uuid as invoice_id, (a->>'amount')::numeric as amount
    from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a
  loop
    if v_alloc.amount is null or v_alloc.amount <= 0 then
      raise exception 'Allocation amounts must be greater than zero';
    end if;

    select customer_id into v_inv_customer from public.bill_invoice where id = v_alloc.invoice_id;
    if v_inv_customer is null then raise exception 'Allocation invoice not found'; end if;
    if v_inv_customer <> p_customer_id then
      raise exception 'Allocation invoice belongs to a different customer';
    end if;

    v_outstanding := public.ar_invoice_outstanding_locked(v_alloc.invoice_id);
    if v_alloc.amount > v_outstanding then
      raise exception 'Allocation % exceeds invoice outstanding %', v_alloc.amount, v_outstanding;
    end if;

    insert into public.ar_allocation (receipt_id, invoice_id, amount)
    values (v_receipt_id, v_alloc.invoice_id, v_alloc.amount);

    v_alloc_total := v_alloc_total + v_alloc.amount;
  end loop;

  if v_alloc_total > p_amount then
    raise exception 'Allocations % exceed the receipt amount %', v_alloc_total, p_amount;
  end if;

  return v_no;
end;
$$;

-- Soft credit check for the order screen (roadmap: warn at confirm; the hard
-- block by role comes with department roles).
create or replace function public.ar_credit_check(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit numeric;
  v_outstanding numeric;
  v_oldest int;
begin
  select credit_limit into v_limit from public.crm_party where id = p_customer_id;

  select
    coalesce(sum(i.total), 0)
      - coalesce((select sum(cn.amount) from public.bill_credit_note cn where cn.customer_id = p_customer_id), 0)
      - coalesce((select sum(r.amount) from public.ar_receipt r where r.customer_id = p_customer_id), 0)
  into v_outstanding
  from public.bill_invoice i
  where i.customer_id = p_customer_id;

  select coalesce(max(current_date - i.due_date), 0) into v_oldest
  from public.bill_invoice i
  where i.customer_id = p_customer_id
    and i.due_date < current_date
    and (i.total
      - coalesce((select sum(cn.amount) from public.bill_credit_note cn where cn.invoice_id = i.id), 0)
      - coalesce((select sum(al.amount) from public.ar_allocation al where al.invoice_id = i.id), 0)) > 0;

  return jsonb_build_object(
    'credit_limit', v_limit,
    'outstanding', v_outstanding,
    'over_limit', (v_limit is not null and v_outstanding > v_limit),
    'oldest_overdue_days', v_oldest
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Views — ageing and customer ledger (one definition, everywhere).
-- ---------------------------------------------------------------------------

create or replace view public.ar_invoice_outstanding_view
with (security_invoker = true) as
select
  i.id, i.invoice_no, i.invoice_date, i.due_date, i.total, i.owner,
  i.customer_id, c.legal_name as customer_name,
  i.entity_id, e.code as entity_code,
  coalesce(cn.credited, 0) as credited,
  coalesce(al.received, 0) as received,
  i.total - coalesce(cn.credited, 0) - coalesce(al.received, 0) as outstanding,
  greatest(current_date - i.due_date, 0) as days_past_due,
  case
    when i.total - coalesce(cn.credited, 0) - coalesce(al.received, 0) <= 0 then 'PAID'
    when current_date <= i.due_date then 'NOT_DUE'
    when current_date - i.due_date <= 30 then '0-30'
    when current_date - i.due_date <= 60 then '31-60'
    when current_date - i.due_date <= 90 then '61-90'
    else '90+'
  end as bucket
from public.bill_invoice i
join public.crm_party c on c.id = i.customer_id
join public.core_entity e on e.id = i.entity_id
left join (
  select invoice_id, sum(amount) as credited from public.bill_credit_note group by invoice_id
) cn on cn.invoice_id = i.id
left join (
  select invoice_id, sum(amount) as received from public.ar_allocation group by invoice_id
) al on al.invoice_id = i.id;

create or replace view public.ar_customer_ledger_view
with (security_invoker = true) as
select
  c.id as customer_id,
  c.legal_name as customer_name,
  c.credit_limit,
  c.credit_days,
  coalesce(inv.invoiced, 0) as invoiced,
  coalesce(cn.credited, 0) as credited,
  coalesce(r.received, 0) as received,
  coalesce(inv.invoiced, 0) - coalesce(cn.credited, 0) - coalesce(r.received, 0) as balance,
  coalesce(od.oldest_overdue_days, 0) as oldest_overdue_days
from public.crm_party c
left join (
  select customer_id, sum(total) as invoiced from public.bill_invoice group by customer_id
) inv on inv.customer_id = c.id
left join (
  select customer_id, sum(amount) as credited from public.bill_credit_note group by customer_id
) cn on cn.customer_id = c.id
left join (
  select customer_id, sum(amount) as received from public.ar_receipt group by customer_id
) r on r.customer_id = c.id
left join (
  select i.customer_id, max(current_date - i.due_date) as oldest_overdue_days
  from public.bill_invoice i
  where i.due_date < current_date
    and (i.total
      - coalesce((select sum(cn2.amount) from public.bill_credit_note cn2 where cn2.invoice_id = i.id), 0)
      - coalesce((select sum(al2.amount) from public.ar_allocation al2 where al2.invoice_id = i.id), 0)) > 0
  group by i.customer_id
) od on od.customer_id = c.id
where c.kind = 'customer'
  and (inv.invoiced is not null or cn.credited is not null or r.received is not null);

-- ---------------------------------------------------------------------------
-- 8. Grants, RLS, audit.
-- ---------------------------------------------------------------------------

revoke execute on function public.bill_generate_from_dispatch(uuid, uuid, text, date, uuid, text) from public, anon;
revoke execute on function public.ar_issue_credit_note(uuid, numeric, text, date) from public, anon;
revoke execute on function public.ar_record_receipt(uuid, uuid, numeric, date, text, text, text, jsonb) from public, anon;
revoke execute on function public.ar_credit_check(uuid) from public, anon;

grant execute on function public.bill_generate_from_dispatch(uuid, uuid, text, date, uuid, text) to authenticated;
grant execute on function public.ar_issue_credit_note(uuid, numeric, text, date) to authenticated;
grant execute on function public.ar_record_receipt(uuid, uuid, numeric, date, text, text, text, jsonb) to authenticated;
grant execute on function public.ar_credit_check(uuid) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'bill_invoice', 'bill_invoice_line', 'bill_credit_note',
    'ar_receipt', 'ar_allocation', 'ar_followup'
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

  -- Money documents have NO direct write policies — the functions are the
  -- only doors. Follow-ups are working documents: admin write.
  execute
    'drop policy if exists "ar_followup admin write" on public.ar_followup;
     create policy "ar_followup admin write" on public.ar_followup
     for all to authenticated
     using (public.jwt_user_is_admin())
     with check (public.jwt_user_is_admin());';
end;
$$;

-- Audit every money document (law 4).
do $$
declare
  t text;
begin
  foreach t in array array['bill_invoice', 'bill_credit_note', 'ar_receipt', 'ar_followup']
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
