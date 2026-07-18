-- Realtime for facility stock so the inventory UI refreshes availability
-- when the dashboard-stock-api edge function reserves/releases/fulfills stock.
do $realtime$
begin
  alter publication supabase_realtime add table public.inventory_facility_stock;
exception
  when duplicate_object then null;
end;
$realtime$;
