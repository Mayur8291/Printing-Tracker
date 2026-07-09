-- Enable Supabase Realtime for orders + customer assets so status and uploads sync across users.

do $realtime$
begin
  alter publication supabase_realtime add table public.orders;
exception
  when duplicate_object then null;
end;
$realtime$;

do $realtime$
begin
  alter publication supabase_realtime add table public.order_customer_assets;
exception
  when duplicate_object then null;
end;
$realtime$;
