-- Enable Supabase Realtime for inventory SKUs so printing order product picker stays in sync.
do $realtime$
begin
  alter publication supabase_realtime add table public.inventory_skus;
exception
  when duplicate_object then null;
end;
$realtime$;
