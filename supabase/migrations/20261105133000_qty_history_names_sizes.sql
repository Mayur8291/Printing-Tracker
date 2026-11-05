-- Quantity history names the increase or decrease and the sizes that moved.

create or replace function public.order_size_adjustment_text(old_breakdown jsonb, new_breakdown jsonb)
returns text
language plpgsql
immutable
as $$
declare
  rec record;
  old_raw text;
  new_raw text;
  old_n numeric;
  new_n numeric;
  delta numeric;
  parts text[] := array[]::text[];
begin
  old_breakdown := case when jsonb_typeof(old_breakdown) = 'object' then old_breakdown else '{}'::jsonb end;
  new_breakdown := case when jsonb_typeof(new_breakdown) = 'object' then new_breakdown else '{}'::jsonb end;

  for rec in
    select key
    from (
      select jsonb_object_keys(old_breakdown) as key
      union
      select jsonb_object_keys(new_breakdown)
    ) keys
    order by
      case key
        when 'XXS' then 1
        when 'XS' then 2
        when 'S' then 3
        when 'M' then 4
        when 'L' then 5
        when 'XL' then 6
        when '2XL' then 7
        when 'XXL' then 7
        when '3XL' then 8
        when '4XL' then 9
        when '5XL' then 10
        else 100
      end,
      key
  loop
    old_raw := nullif(old_breakdown ->> rec.key, '');
    new_raw := nullif(new_breakdown ->> rec.key, '');
    if old_raw is not distinct from new_raw then
      continue;
    end if;

    if coalesce(old_raw, '0') ~ '^[0-9]+(\.[0-9]+)?$'
       or coalesce(new_raw, '0') ~ '^[0-9]+(\.[0-9]+)?$'
       or old_raw is null
       or new_raw is null then
      old_n := case
        when coalesce(old_raw, '0') ~ '^[0-9]+(\.[0-9]+)?$' then old_raw::numeric
        else 0
      end;
      new_n := case
        when coalesce(new_raw, '0') ~ '^[0-9]+(\.[0-9]+)?$' then new_raw::numeric
        else 0
      end;
      if old_n = new_n then
        continue;
      end if;
      delta := new_n - old_n;
      parts := parts || format(
        '%s %s → %s (%s%s)',
        rec.key,
        trim(to_char(old_n, 'FM999999990.##')),
        trim(to_char(new_n, 'FM999999990.##')),
        case when delta > 0 then '+' else '' end,
        trim(to_char(delta, 'FM999999990.##'))
      );
    else
      parts := parts || format(
        '%s %s → %s',
        rec.key,
        coalesce(old_raw, '0'),
        coalesce(new_raw, '0')
      );
    end if;
  end loop;

  return coalesce(array_to_string(parts, ', '), '');
end;
$$;

comment on function public.order_size_adjustment_text(jsonb, jsonb) is
  'Human line of size qty changes, e.g. M 30 → 32 (+2). Empty when nothing moved.';

do $inject$
declare
  src text;
begin
  src := pg_get_functiondef('public.log_order_activity()'::regprocedure);
  if position('Quantity increased by' in src) > 0 then
    return;
  end if;

  src := regexp_replace(
    src,
    'format\(''Quantity updated: %s → %s'', old\.qty, new\.qty\)',
    $rep$case
          when coalesce(new.qty, 0) > coalesce(old.qty, 0) then
            format(
              'Quantity increased by %s: %s → %s%s',
              trim(to_char(coalesce(new.qty, 0) - coalesce(old.qty, 0), 'FM999999990.##')),
              coalesce(old.qty, 0),
              coalesce(new.qty, 0),
              case
                when public.order_size_adjustment_text(old.size_breakdown, new.size_breakdown) <> '' then
                  '. Sizes: ' || public.order_size_adjustment_text(old.size_breakdown, new.size_breakdown)
                else ''
              end
            )
          when coalesce(new.qty, 0) < coalesce(old.qty, 0) then
            format(
              'Quantity decreased by %s: %s → %s%s',
              trim(to_char(coalesce(old.qty, 0) - coalesce(new.qty, 0), 'FM999999990.##')),
              coalesce(old.qty, 0),
              coalesce(new.qty, 0),
              case
                when public.order_size_adjustment_text(old.size_breakdown, new.size_breakdown) <> '' then
                  '. Sizes: ' || public.order_size_adjustment_text(old.size_breakdown, new.size_breakdown)
                else ''
              end
            )
          else
            format(
              'Quantity updated: %s → %s%s',
              old.qty,
              new.qty,
              case
                when public.order_size_adjustment_text(old.size_breakdown, new.size_breakdown) <> '' then
                  '. Sizes: ' || public.order_size_adjustment_text(old.size_breakdown, new.size_breakdown)
                else ''
              end
            )
        end$rep$,
    'n'
  );

  src := regexp_replace(
    src,
    '''Size breakdown updated''',
    $rep$coalesce(
          nullif(public.order_size_adjustment_text(old.size_breakdown, new.size_breakdown), ''),
          'Size breakdown updated'
        )$rep$,
    'n'
  );

  if position('Quantity increased by' in src) = 0 then
    raise exception 'Could not store size detail on quantity history';
  end if;

  execute src;
end;
$inject$;

notify pgrst, 'reload schema';
