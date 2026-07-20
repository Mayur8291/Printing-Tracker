-- Realtime for Scott orders so the Ready Stock Order tab updates live
-- when the order API (app/backend) creates or progresses an order.
do $realtime$
begin
  alter publication supabase_realtime add table public.scott_orders;
exception
  when duplicate_object then null;
end;
$realtime$;

do $realtime$
begin
  alter publication supabase_realtime add table public.scott_order_items;
exception
  when duplicate_object then null;
end;
$realtime$;
