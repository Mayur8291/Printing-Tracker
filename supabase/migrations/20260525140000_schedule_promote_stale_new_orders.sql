-- Run new→pending promotion every 10 minutes even when no dashboard tab is open.

create extension if not exists pg_cron with schema extensions;

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'promote-stale-new-orders') then
    perform cron.unschedule('promote-stale-new-orders');
  end if;
end;
$cron$;

select cron.schedule(
  'promote-stale-new-orders',
  '*/10 * * * *',
  $$select public.promote_stale_new_orders_to_pending();$$
);
