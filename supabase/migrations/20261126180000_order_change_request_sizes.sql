-- Change requests edit quantity by size. Coordinator and order status are no longer requested.

create or replace function public.submit_order_change_request(
  p_order_id bigint,
  p_changes jsonb,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_name text := 'User';
  ord public.orders%rowtype;
  note text := nullif(btrim(coalesce(p_note, '')), '');
  built jsonb := '{}'::jsonb;
  lines text[] := '{}';
  summary text;
  from_text text;
  to_text text;
  request_id uuid;
  rec record;
  from_sizes jsonb := '{}'::jsonb;
  to_sizes jsonb := '{}'::jsonb;
  size_key text;
  size_value text;
  from_sum integer := 0;
  to_sum integer := 0;
  has_sizes boolean := false;
begin
  if actor is null then
    raise exception 'Sign in to request a change';
  end if;
  if note is null then
    raise exception 'Write a note for the change';
  end if;
  if char_length(note) > 500 then
    raise exception 'The note must be 500 characters or less';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Change at least one field';
  end if;

  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'User')
    into actor_name
  from public.profiles
  where id = actor;
  if actor_name is null then
    raise exception 'Your profile was not found';
  end if;

  select * into ord from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;
  if ord.order_kind in ('job_sheet', 'sample_job_sheet') then
    raise exception 'Change requests are for printing orders';
  end if;
  if ord.status = 'cancelled' then
    raise exception 'A cancelled order cannot be changed this way';
  end if;
  if exists (
    select 1 from public.order_change_requests
    where order_id = p_order_id and status = 'pending'
  ) then
    raise exception 'A change is already waiting on this order';
  end if;

  if jsonb_typeof(ord.size_breakdown) = 'object' then
    for rec in select e.key, e.value from jsonb_each(ord.size_breakdown) e
    loop
      if (rec.value #>> '{}') ~ '^[0-9]+$' and (rec.value #>> '{}')::integer > 0 then
        from_sizes := from_sizes || jsonb_build_object(rec.key, rec.value #>> '{}');
      end if;
    end loop;
  end if;
  has_sizes := from_sizes <> '{}'::jsonb;

  if has_sizes and p_changes ? 'sizes' and jsonb_typeof(p_changes->'sizes') = 'object' then
    to_sizes := from_sizes;
    for rec in select e.key, e.value from jsonb_each(p_changes->'sizes') e
    loop
      size_key := btrim(rec.key);
      size_value := btrim(coalesce(rec.value #>> '{}', ''));
      if size_key !~ '^[A-Za-z0-9][A-Za-z0-9_+-]{0,20}$' then
        raise exception 'That size name cannot be used';
      end if;
      if size_value !~ '^[0-9]+$' then
        raise exception 'Each size must be a whole number';
      end if;
      if size_value::integer = 0 then
        to_sizes := to_sizes - size_key;
      else
        to_sizes := to_sizes || jsonb_build_object(size_key, size_value::integer::text);
      end if;
    end loop;

    if to_sizes is distinct from from_sizes then
      built := built || jsonb_build_object('sizes', jsonb_build_object('from', from_sizes, 'to', to_sizes));
      for rec in
        select distinct keys.key
        from (
          select jsonb_object_keys(from_sizes) as key
          union
          select jsonb_object_keys(to_sizes)
        ) keys
        order by keys.key
      loop
        if coalesce(from_sizes->>rec.key, '0') is distinct from coalesce(to_sizes->>rec.key, '0') then
          lines := array_append(
            lines,
            rec.key || ': ' || coalesce(from_sizes->>rec.key, '0') || ' → ' || coalesce(to_sizes->>rec.key, '0')
          );
        end if;
      end loop;
      select coalesce(sum((e.value #>> '{}')::integer), 0) into from_sum from jsonb_each(from_sizes) e;
      select coalesce(sum((e.value #>> '{}')::integer), 0) into to_sum from jsonb_each(to_sizes) e;
      if to_sum is distinct from coalesce(ord.qty, 0) then
        built := built || jsonb_build_object(
          'qty',
          jsonb_build_object('from', coalesce(ord.qty::text, ''), 'to', to_sum::text)
        );
        lines := array_append(lines, public.order_change_field_line('qty', coalesce(ord.qty::text, ''), to_sum::text));
      end if;
    end if;
  elsif not has_sizes and p_changes ? 'qty' and (p_changes->>'qty') ~ '^[0-9]+$' then
    to_text := (p_changes->>'qty')::integer::text;
    from_text := coalesce(ord.qty::text, '');
    if to_text is distinct from from_text then
      built := built || jsonb_build_object('qty', jsonb_build_object('from', from_text, 'to', to_text));
      lines := array_append(lines, public.order_change_field_line('qty', from_text, to_text));
    end if;
  elsif not has_sizes and p_changes ? 'qty' then
    raise exception 'Qty must be a whole number';
  end if;

  if p_changes ? 'due_date' and btrim(coalesce(p_changes->>'due_date', '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    to_text := (btrim(p_changes->>'due_date'))::date::text;
    from_text := coalesce(ord.due_date::text, '');
    if to_text is distinct from from_text then
      built := built || jsonb_build_object('due_date', jsonb_build_object('from', from_text, 'to', to_text));
      lines := array_append(lines, public.order_change_field_line('due_date', from_text, to_text));
    end if;
  elsif p_changes ? 'due_date' and btrim(coalesce(p_changes->>'due_date', '')) <> '' then
    raise exception 'Delivery date must be a real date';
  end if;

  if p_changes ? 'product_name' then
    to_text := btrim(coalesce(p_changes->>'product_name', ''));
    if to_text = '' then
      raise exception 'Product name cannot be empty';
    end if;
    from_text := coalesce(btrim(ord.product_name), '');
    if to_text is distinct from from_text then
      built := built || jsonb_build_object('product_name', jsonb_build_object('from', from_text, 'to', to_text));
      lines := array_append(lines, public.order_change_field_line('product_name', from_text, to_text));
    end if;
  end if;

  if p_changes ? 'remarks' then
    to_text := btrim(coalesce(p_changes->>'remarks', ''));
    from_text := coalesce(btrim(ord.remarks), '');
    if to_text is distinct from from_text then
      built := built || jsonb_build_object('remarks', jsonb_build_object('from', from_text, 'to', to_text));
      lines := array_append(lines, public.order_change_field_line('remarks', from_text, to_text));
    end if;
  end if;

  if built = '{}'::jsonb then
    raise exception 'Change at least one field';
  end if;

  lines := array_append(lines, 'Note: ' || note);
  summary := array_to_string(lines, E'\n');

  insert into public.order_change_requests (
    order_id, changes, note, summary, requested_by, requested_by_label
  ) values (
    p_order_id, built, note, summary, actor, actor_name
  )
  returning id into request_id;

  insert into public.order_activity_log (
    order_id, event_type, message, meta, actor_id, actor_label
  ) values (
    p_order_id,
    'order_change_requested',
    'Change requested' || E'\n' || summary,
    jsonb_build_object('request_id', request_id, 'changes', built, 'note', note),
    actor,
    actor_name
  );

  return request_id;
end;
$$;

create or replace function public.review_order_change_request(
  p_request_id uuid,
  p_decision text,
  p_review_note text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_name text := 'User';
  req public.order_change_requests%rowtype;
  ord public.orders%rowtype;
  decision text := lower(btrim(coalesce(p_decision, '')));
  review_note text := nullif(btrim(coalesce(p_review_note, '')), '');
  summary text;
  field text;
  from_text text;
  live_text text;
  rec record;
  live_sizes jsonb := '{}'::jsonb;
  size_numbers jsonb := '{}'::jsonb;
  size_sum integer := 0;
begin
  if actor is null then
    raise exception 'Sign in to review a change';
  end if;
  if not public.jwt_can_review_order_changes() then
    raise exception 'You cannot accept or deny order changes';
  end if;
  if decision not in ('accepted', 'denied') then
    raise exception 'Choose accept or deny';
  end if;
  if decision = 'denied' and review_note is null then
    raise exception 'Write why the change is denied';
  end if;
  if review_note is not null and char_length(review_note) > 500 then
    raise exception 'The note must be 500 characters or less';
  end if;

  select coalesce(nullif(btrim(full_name), ''), nullif(btrim(email), ''), 'User')
    into actor_name
  from public.profiles
  where id = actor;

  select * into req from public.order_change_requests where id = p_request_id for update;
  if not found then
    raise exception 'Change request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'This change was already reviewed';
  end if;
  if req.requested_by = actor and not public.jwt_user_is_admin() then
    raise exception 'Someone else has to accept or deny this request';
  end if;

  select * into ord from public.orders where id = req.order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  if decision = 'accepted' then
    if req.changes ? 'sizes' then
      if jsonb_typeof(ord.size_breakdown) = 'object' then
        for rec in select e.key, e.value from jsonb_each(ord.size_breakdown) e
        loop
          if (rec.value #>> '{}') ~ '^[0-9]+$' and (rec.value #>> '{}')::integer > 0 then
            live_sizes := live_sizes || jsonb_build_object(rec.key, rec.value #>> '{}');
          end if;
        end loop;
      end if;
      if live_sizes is distinct from coalesce(req.changes->'sizes'->'from', '{}'::jsonb) then
        raise exception 'This order changed after the request. Deny it and ask again.';
      end if;
      select coalesce(
        jsonb_object_agg(e.key, (e.value #>> '{}')::integer) filter (
          where (e.value #>> '{}') ~ '^[0-9]+$' and (e.value #>> '{}')::integer > 0
        ),
        '{}'::jsonb
      )
        into size_numbers
      from jsonb_each(coalesce(req.changes->'sizes'->'to', '{}'::jsonb)) e;
      select coalesce(sum((e.value #>> '{}')::integer), 0)
        into size_sum
      from jsonb_each(coalesce(req.changes->'sizes'->'to', '{}'::jsonb)) e
      where (e.value #>> '{}') ~ '^[0-9]+$';
    end if;

    foreach field in array ARRAY['qty', 'due_date', 'remarks', 'product_name']
    loop
      if req.changes ? field then
        from_text := coalesce(req.changes->field->>'from', '');
        live_text := case field
          when 'qty' then coalesce(ord.qty::text, '')
          when 'due_date' then coalesce(ord.due_date::text, '')
          when 'remarks' then coalesce(btrim(ord.remarks), '')
          when 'product_name' then coalesce(btrim(ord.product_name), '')
          else ''
        end;
        if live_text is distinct from from_text then
          raise exception 'This order changed after the request. Deny it and ask again.';
        end if;
      end if;
    end loop;

    perform set_config('app.order_change_apply', 'on', true);
    update public.orders
    set
      size_breakdown = case
        when req.changes ? 'sizes' then size_numbers
        else size_breakdown
      end,
      qty = case
        when req.changes ? 'sizes' then size_sum
        when req.changes ? 'qty' then (req.changes->'qty'->>'to')::integer
        else qty
      end,
      due_date = case
        when req.changes ? 'due_date' then (req.changes->'due_date'->>'to')::date
        else due_date
      end,
      remarks = case
        when req.changes ? 'remarks' then nullif(req.changes->'remarks'->>'to', '')
        else remarks
      end,
      product_name = case
        when req.changes ? 'product_name' then req.changes->'product_name'->>'to'
        else product_name
      end
    where id = ord.id;
    perform set_config('app.order_change_apply', 'off', true);
  end if;

  update public.order_change_requests
  set
    status = decision,
    reviewed_by = actor,
    reviewed_by_label = actor_name,
    reviewed_at = now(),
    review_note = review_note
  where id = req.id;

  summary := req.summary;
  if review_note is not null then
    summary := summary || E'\n' || 'Review note: ' || review_note;
  end if;

  insert into public.order_activity_log (
    order_id, event_type, message, meta, actor_id, actor_label
  ) values (
    req.order_id,
    case when decision = 'accepted' then 'order_change_accepted' else 'order_change_denied' end,
    case when decision = 'accepted' then 'Change accepted' else 'Change denied' end || E'\n' || summary,
    jsonb_strip_nulls(jsonb_build_object(
      'request_id', req.id,
      'changes', req.changes,
      'decision', decision,
      'review_note', review_note
    )),
    actor,
    actor_name
  );

  return decision;
end;
$$;
