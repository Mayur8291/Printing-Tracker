-- Enable Supabase Realtime for all dashboard-visible tables (cross-user live sync).

do $realtime$
declare
  tbl text;
begin
  foreach tbl in array array[
    'owners',
    'coordinators',
    'sales_incharges',
    'profiles',
    'outward_challans',
    'inward_entries',
    'inward_grn_entries',
    'contact_book_entries',
    'shared_resource_links',
    'dealers',
    'dealer_daily_reports',
    'inventory_style_parents',
    'inventory_stock_movements',
    'inventory_alert_settings',
    'inventory_suppliers',
    'inventory_warehouses',
    'printing_dept_inventory_state',
    'printing_dept_refill_log',
    'printing_dept_inventory_thresholds',
    'printing_utilization_entries'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    exception
      when duplicate_object then null;
    end;
  end loop;
end;
$realtime$;
