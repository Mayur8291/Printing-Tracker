-- Put the typed cancellation reason on the history row.
-- The first inject missed staging because the stored function uses CRLF.

do $inject$
declare
  src text;
begin
  src := pg_get_functiondef('public.log_order_activity()'::regprocedure);
  if position('Order cancelled. Reason' in src) > 0 then
    return;
  end if;
  src := regexp_replace(
    src,
    'format\([[:space:]]+''Status updated: %s → %s'',[[:space:]]+public\.status_label\(old\.status\),[[:space:]]+public\.status_label\(new\.status\)[[:space:]]+\)',
    'case
        when new.status = ''cancelled'' and nullif(trim(new.cancellation_reason), '''') is not null then
          format(''Order cancelled. Reason: %s'', trim(new.cancellation_reason))
        else format(
          ''Status updated: %s → %s'',
          public.status_label(old.status),
          public.status_label(new.status)
        )
      end',
    'n'
  );
  if position('Order cancelled. Reason' in src) = 0 then
    raise exception 'Could not store cancellation reason on order history';
  end if;
  execute src;
end;
$inject$;
