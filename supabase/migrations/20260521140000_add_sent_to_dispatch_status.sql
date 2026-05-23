-- Status: Sent to Dispatch; track when order entered Ready to Dispatch (48h alert).

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
check (
  status in (
    'new',
    'approval_pending',
    'printing',
    'fusing',
    'ironing',
    'packing',
    'pending',
    'on_hold',
    'ready',
    'sent_to_dispatch'
  )
);

alter table public.orders add column if not exists status_ready_at timestamptz;

-- Start 48h clock for orders already Ready to Dispatch (bypass RLS trigger — no auth user during migration).
alter table public.orders disable trigger trg_enforce_order_update_scope;
update public.orders
set status_ready_at = now()
where status = 'ready' and status_ready_at is null;
alter table public.orders enable trigger trg_enforce_order_update_scope;

create or replace function public.track_status_ready_at()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    if new.status = 'ready' then
      new.status_ready_at := now();
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'ready' then
      new.status_ready_at := now();
    elsif old.status = 'ready' then
      new.status_ready_at := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_track_status_ready_at on public.orders;
create trigger trg_track_status_ready_at
before insert or update on public.orders
for each row execute function public.track_status_ready_at();

create or replace function public.status_label(code text)
returns text
language sql
immutable
as $$
  select case code
    when 'new' then 'New Orders'
    when 'approval_pending' then 'Approval Pending'
    when 'printing' then 'Printing'
    when 'fusing' then 'Fusing'
    when 'ironing' then 'Ironing'
    when 'packing' then 'Packing'
    when 'pending' then 'Pending'
    when 'on_hold' then 'On hold'
    when 'ready' then 'Ready to Dispatch'
    when 'sent_to_dispatch' then 'Sent to Dispatch'
    else coalesce(code, '—')
  end;
$$;
