-- Emit order.status_changed on INSERT with webhook status CREATED (DB row stays PENDING).
-- Partners expect these webhook status values: CREATED, PENDING, PROCESSING, COMPLETE, CANCELLED, FAILED.

create or replace function public.notify_scott_order_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous text;
  v_status text;
  v_payload jsonb;
begin
  if tg_op = 'INSERT' then
    v_previous := null;
    v_status := 'CREATED';
  elsif tg_op = 'UPDATE' then
    if new.status is not distinct from old.status then
      return new;
    end if;
    v_previous := old.status;
    v_status := new.status;
  else
    return new;
  end if;

  v_payload := jsonb_build_object(
    'event', 'order.status_changed',
    'event_id', 'evt_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
    'occurred_at', now(),
    'dashboard_order_id', new.id,
    'order_code', new.order_code,
    'previous_status', v_previous,
    'status', v_status
  );

  if v_status = 'COMPLETE' and new.dispatched_at is not null then
    v_payload := v_payload || jsonb_build_object('dispatched_at', new.dispatched_at);
  end if;

  perform public.enqueue_dashboard_webhook('order.status_changed', v_payload);
  return new;
end;
$$;

comment on function public.notify_scott_order_status_changed() is
  'Enqueue order.status_changed webhook. INSERT → status CREATED (row is PENDING). UPDATE → status matches scott_orders.status.';

drop trigger if exists scott_orders_status_changed on public.scott_orders;
create trigger scott_orders_status_changed
after insert or update on public.scott_orders
for each row
execute function public.notify_scott_order_status_changed();

notify pgrst, 'reload schema';
