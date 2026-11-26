-- Printing order change requests.
-- A user asks for a change. Admin, or a viewer the admin marks, accepts or denies it.
-- The request, the decision, and the fields are written to order history.

alter table public.profile_order_permissions
  add column if not exists can_review_order_changes boolean not null default false;

comment on column public.profile_order_permissions.can_review_order_changes is
  'When true, this viewer may accept or deny printing order change requests. Admin can always review.';

create table if not exists public.order_change_requests (
  id uuid primary key default gen_random_uuid(),
  order_id bigint not null references public.orders(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'denied')),
  changes jsonb not null,
  note text not null,
  summary text not null,
  requested_by uuid not null references public.profiles(id),
  requested_by_label text not null,
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_by_label text,
  reviewed_at timestamptz,
  review_note text,
  constraint order_change_requests_changes_object check (jsonb_typeof(changes) = 'object'),
  constraint order_change_requests_note_not_blank check (btrim(note) <> '')
);

create unique index if not exists order_change_requests_one_pending
  on public.order_change_requests (order_id)
  where status = 'pending';

create index if not exists order_change_requests_pending_requested_at
  on public.order_change_requests (requested_at desc)
  where status = 'pending';

alter table public.order_change_requests enable row level security;

drop policy if exists "order change requests read requester reviewer or admin" on public.order_change_requests;
create policy "order change requests read requester reviewer or admin"
on public.order_change_requests
for select
to authenticated
using (
  requested_by = auth.uid()
  or public.jwt_user_is_admin()
  or exists (
    select 1
    from public.profile_order_permissions pop
    where pop.user_id = auth.uid()
      and pop.can_review_order_changes
  )
);

create or replace function public.jwt_can_review_order_changes()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.jwt_user_is_admin()
    or coalesce(
      (
        select pop.can_review_order_changes
        from public.profile_order_permissions pop
        where pop.user_id = auth.uid()
      ),
      false
    );
$$;

grant execute on function public.jwt_can_review_order_changes() to authenticated;

create or replace function public.order_change_display(field text, value text)
returns text
language sql
immutable
as $$
  select case
    when field = 'status' then case coalesce(value, '')
      when 'new' then 'New Orders'
      when 'approval_pending' then 'Approval Pending'
      when 'in_production' then 'In Production'
      when 'printing' then 'Printing'
      when 'fusing' then 'Fusing'
      when 'ironing' then 'Ironing'
      when 'packing' then 'Packing'
      when 'pending' then 'Pending'
      when 'ready' then 'Ready to Dispatch'
      when 'sent_to_dispatch' then 'Sent to Dispatch'
      when '' then '—'
      else value
    end
    else coalesce(nullif(value, ''), '—')
  end;
$$;

create or replace function public.order_change_field_line(field text, from_value text, to_value text)
returns text
language sql
immutable
as $$
  select case field
    when 'qty' then 'Qty'
    when 'due_date' then 'Delivery date'
    when 'remarks' then 'Remarks'
    when 'product_name' then 'Product name'
    when 'status' then 'Order status'
    when 'coordinator_name' then 'Coordinator'
    else field
  end
  || ': '
  || public.order_change_display(field, from_value)
  || ' → '
  || public.order_change_display(field, to_value);
$$;

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
  allowed_status text[] := array[
    'new', 'approval_pending', 'in_production', 'printing', 'fusing',
    'ironing', 'packing', 'pending', 'ready', 'sent_to_dispatch'
  ];
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

  if p_changes ? 'qty' and (p_changes->>'qty') ~ '^[0-9]+$' then
    to_text := (p_changes->>'qty')::integer::text;
    from_text := coalesce(ord.qty::text, '');
    if to_text is distinct from from_text then
      built := built || jsonb_build_object('qty', jsonb_build_object('from', from_text, 'to', to_text));
      lines := array_append(lines, public.order_change_field_line('qty', from_text, to_text));
    end if;
  elsif p_changes ? 'qty' then
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

  if p_changes ? 'coordinator_name' then
    to_text := btrim(coalesce(p_changes->>'coordinator_name', ''));
    from_text := coalesce(btrim(ord.coordinator_name), '');
    if to_text is distinct from from_text then
      built := built || jsonb_build_object('coordinator_name', jsonb_build_object('from', from_text, 'to', to_text));
      lines := array_append(lines, public.order_change_field_line('coordinator_name', from_text, to_text));
    end if;
  end if;

  if p_changes ? 'status' then
    to_text := btrim(coalesce(p_changes->>'status', ''));
    if not (to_text = any(allowed_status)) then
      raise exception 'That order status cannot be requested';
    end if;
    from_text := coalesce(ord.status, '');
    if to_text is distinct from from_text then
      built := built || jsonb_build_object('status', jsonb_build_object('from', from_text, 'to', to_text));
      lines := array_append(lines, public.order_change_field_line('status', from_text, to_text));
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

grant execute on function public.submit_order_change_request(bigint, jsonb, text) to authenticated;

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
    foreach field in array ARRAY['qty', 'due_date', 'remarks', 'product_name', 'status', 'coordinator_name']
    loop
      if req.changes ? field then
        from_text := coalesce(req.changes->field->>'from', '');
        live_text := case field
          when 'qty' then coalesce(ord.qty::text, '')
          when 'due_date' then coalesce(ord.due_date::text, '')
          when 'remarks' then coalesce(btrim(ord.remarks), '')
          when 'product_name' then coalesce(btrim(ord.product_name), '')
          when 'status' then coalesce(ord.status, '')
          when 'coordinator_name' then coalesce(btrim(ord.coordinator_name), '')
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
      qty = case
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
      end,
      status = case
        when req.changes ? 'status' then req.changes->'status'->>'to'
        else status
      end,
      coordinator_name = case
        when req.changes ? 'coordinator_name' then nullif(req.changes->'coordinator_name'->>'to', '')
        else coordinator_name
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

grant execute on function public.review_order_change_request(uuid, text, text) to authenticated;

do $$
declare
  src text;
  patched text;
  needle text;
  insert_sql text;
begin
  select pg_get_functiondef(p.oid)
    into src
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'enforce_order_update_scope';

  needle := $n$
  if current_setting('app.auto_complete_sent_to_dispatch', true) = 'on' then
    return new;
  end if;$n$;
  insert_sql := $n$
  if current_setting('app.auto_complete_sent_to_dispatch', true) = 'on' then
    return new;
  end if;

  if current_setting('app.order_change_apply', true) = 'on' then
    return new;
  end if;$n$;
  patched := replace(src, needle, insert_sql);
  if patched = src then
    raise exception 'order change apply guard did not match the live function';
  end if;
  execute patched;
end $$;
