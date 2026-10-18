-- All Dashboard API writes share a transaction, stock row locks and durable result.
-- No existing data is copied, rebalanced, or activated by this migration.
create schema if not exists private;
create table if not exists private.dashboard_mutation_results_v1 (
  request_id text primary key check(length(request_id) between 8 and 160),
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.dashboard_mutation_results_v1 enable row level security;
revoke all on private.dashboard_mutation_results_v1 from public, anon, authenticated, service_role;

create or replace function public.dashboard_mutation_result_v1(p_request_id text)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('request_id',request_id,'request',request,'response',response)
  from private.dashboard_mutation_results_v1 where request_id=p_request_id;
$$;
revoke all on function public.dashboard_mutation_result_v1(text) from public,anon,authenticated;
grant execute on function public.dashboard_mutation_result_v1(text) to service_role;

create or replace function public.dashboard_mutate_v1(
  p_request_id text,p_action text,p_target text,p_body jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_request jsonb:=jsonb_build_object('action',p_action,'target',p_target,'body',p_body);
  v_prior private.dashboard_mutation_results_v1%rowtype;
  v_order public.scott_orders%rowtype;
  v_res public.inventory_stock_reservations%rowtype;
  v_stock public.inventory_facility_stock%rowtype;
  v_item jsonb; v_row record; v_sku uuid; v_qty numeric; v_delta numeric;
  v_facility text; v_order_code text; v_res_id text; v_order_id text;
  v_now timestamptz:=clock_timestamp(); v_items jsonb; v_changed jsonb:='[]';
  v_result jsonb; v_response jsonb; v_status text; v_trigger text;
  v_results jsonb:='[]'; v_adjustment text; v_before numeric; v_before_map jsonb:='{}'; v_low jsonb;
begin
  if p_request_id is null or p_request_id !~ '^[A-Za-z0-9_-]{8,160}$' or p_action is null
    or jsonb_typeof(p_body) is distinct from 'object'
    or p_action not in ('reserve','release','fulfill','adjust','create','edit','cancel','status') then
    raise exception 'INVALID_REQUEST' using errcode='22023';
  end if;
  -- One lock ordering for every API write, including legacy clients without a key.
  -- The coarse lock deliberately favors correctness at this service's current volume.
  perform pg_catalog.pg_advisory_xact_lock(64513,1);
  v_now:=clock_timestamp();
  select * into v_prior from private.dashboard_mutation_results_v1 where request_id=p_request_id;
  if found then
    if v_prior.request is distinct from v_request then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;
    return v_prior.response;
  end if;
  -- Business rejection rolls back ALL line writes, but its result is retained below.
  begin
    if p_action in ('edit','cancel','status') then
      select * into v_order from public.scott_orders where id=p_target for update;
      if not found then raise exception 'ORDER_NOT_FOUND' using errcode='P0002'; end if;
      v_now:=greatest(v_now,v_order.updated_at+interval '1 microsecond');
      v_facility:=v_order.facility_code; v_order_code:=v_order.order_code;
      v_order_id:=v_order.id; v_res_id:=v_order.reservation_id;
      if p_body ? 'expected_updated_at' and
        (p_body->>'expected_updated_at')::timestamptz is distinct from v_order.updated_at then
        raise exception 'ORDER_VERSION_CONFLICT' using errcode='40001';
      end if;
      if p_action='cancel' and v_order.status='CANCELLED' then
        v_result:=jsonb_build_object('dashboard_order_id',v_order.id,'order_code',v_order.order_code,
          'status',v_order.status,'cancelled_at',v_order.cancelled_at);
      elsif p_action='status' and v_order.status=p_body->>'status' then
        v_result:=jsonb_build_object('dashboard_order_id',v_order.id,'order_code',v_order.order_code,
          'status',v_order.status,'updated_at',v_order.updated_at);
      elsif v_order.status not in ('PENDING','PROCESSING') then
        raise exception 'ORDER_NOT_EDITABLE' using errcode='23514';
      end if;
    end if;

    if v_result is null and p_action in ('create','reserve','adjust') then
      v_facility:=nullif(btrim(p_body->>'facility_code'),'');
      v_order_code:=nullif(btrim(p_body->>'order_code'),'');
      if v_facility is null or (p_action<>'adjust' and v_order_code is null) then
        raise exception 'INVALID_REQUEST' using errcode='22023'; end if;
      if p_action='create' then
        select * into v_order from public.scott_orders where order_code=v_order_code
          and status in ('PENDING','PROCESSING','COMPLETE') for update;
        if found then
          v_response:=jsonb_build_object('status',409,'body',jsonb_build_object('error','ORDER_EXISTS',
            'details',jsonb_build_object('dashboard_order_id',v_order.id,'status',v_order.status)));
        end if;
      end if;
    end if;

    if v_result is null and v_response is null and
      (p_action in ('reserve','create','adjust') or (p_action='edit' and p_body ? 'items')) then
      v_items:=p_body->'items';
      if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) not between 1 and 250 then
        raise exception 'INVALID_ITEMS' using errcode='22023'; end if;
      -- Validate every input line before canonicalizing repeated SKU quantities.
      if exists(select 1 from jsonb_array_elements(v_items) x
        where jsonb_typeof(x)<>'object' or nullif(btrim(x->>'sku_code'),'') is null
          or jsonb_typeof(x->case when p_action='adjust' then 'delta' else 'quantity' end) is distinct from 'number') then
        raise exception 'INVALID_ITEMS' using errcode='22023'; end if;
      if p_action='adjust' then
        if (select count(distinct x->>'sku_code') from jsonb_array_elements(v_items)x)<>jsonb_array_length(v_items) then
          raise exception 'DUPLICATE_ADJUSTMENT_SKU' using errcode='22023'; end if;
      else
        if exists(select 1 from jsonb_array_elements(v_items)x where (x->>'quantity')::numeric<=0
          or (x->>'quantity')::numeric<>round((x->>'quantity')::numeric,2)) then
          raise exception 'INVALID_QUANTITY' using errcode='22023'; end if;
        select jsonb_agg(g.first_item||jsonb_build_object('quantity',g.quantity) order by g.sku_code) into v_items
        from(select x->>'sku_code' as sku_code,sum((x->>'quantity')::numeric) as quantity,
          (jsonb_agg(x order by ordinal))->0 as first_item
          from jsonb_array_elements(v_items) with ordinality a(x,ordinal) group by x->>'sku_code')g;
      end if;
      if p_action in ('create','reserve') then
        select * into v_res from public.inventory_stock_reservations
          where order_code=v_order_code and facility_code=v_facility and status='RESERVED' for update;
        if found then
          -- Existing reserve may only be reused for exactly the same SKU/item quantities.
          if (select jsonb_agg(jsonb_build_object('sku_code',sku_code,'item_code',item_code,'quantity',quantity) order by sku_code)
              from public.inventory_stock_reservation_items where reservation_id=v_res.id)
            is distinct from (select jsonb_agg(jsonb_build_object('sku_code',x->>'sku_code','item_code',coalesce(x->>'item_code',''),
              'quantity',(x->>'quantity')::numeric) order by x->>'sku_code') from jsonb_array_elements(v_items)x) then
            raise exception 'RESERVATION_CONFLICT' using errcode='23514'; end if;
          v_res_id:=v_res.id;
        end if;
      end if;
      if p_action='edit' then
        select * into v_res from public.inventory_stock_reservations where id=v_res_id for update;
        if not found or v_res.status<>'RESERVED' then raise exception 'RESERVATION_NOT_EDITABLE' using errcode='23514'; end if;
        -- Credit own old hold and replace inside this same transaction. Any rejection restores it.
        for v_row in select * from public.inventory_stock_reservation_items where reservation_id=v_res_id order by sku_id loop
          select on_hand_qty-reserved_qty into v_before from public.inventory_facility_stock
            where sku_id=v_row.sku_id and facility_code=v_facility for update;
          v_before_map:=v_before_map||jsonb_build_object(v_row.sku_code,v_before);
          update public.inventory_facility_stock set reserved_qty=reserved_qty-v_row.quantity,updated_at=v_now
            where sku_id=v_row.sku_id and facility_code=v_facility;
        end loop;
        delete from public.inventory_stock_reservation_items where reservation_id=v_res_id;
        delete from public.scott_order_items where order_id=v_order_id;
      end if;
      if p_action='adjust' then
        if length(btrim(coalesce(p_body->>'reason',''))) not between 3 and 500 then
          raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
        v_adjustment:='adj_'||replace(gen_random_uuid()::text,'-','');
        insert into public.inventory_stock_adjustments(id,facility_code,reason,applied_at)
          values(v_adjustment,v_facility,p_body->>'reason',v_now);
      elsif v_res_id is null then
        v_res_id:='rsv_'||replace(gen_random_uuid()::text,'-','');
        insert into public.inventory_stock_reservations(id,order_code,facility_code,expires_at)
          values(v_res_id,v_order_code,v_facility,v_now+interval '24 hours');
      end if;
      for v_item in select x from jsonb_array_elements(v_items)x order by x->>'sku_code' loop
        select id into strict v_sku from public.inventory_skus where sku_code=v_item->>'sku_code' for update;
        insert into public.inventory_facility_stock(sku_id,facility_code) values(v_sku,v_facility)
          on conflict(sku_id,facility_code) do nothing;
        select * into strict v_stock from public.inventory_facility_stock
          where sku_id=v_sku and facility_code=v_facility for update;
        v_before:=v_stock.on_hand_qty-v_stock.reserved_qty;
        if not v_before_map ? (v_item->>'sku_code') then
          v_before_map:=v_before_map||jsonb_build_object(v_item->>'sku_code',v_before);
        end if;
        if p_action='adjust' then
          v_delta:=(v_item->>'delta')::numeric;
          if v_delta=0 or abs(v_delta)>999999999999 or v_delta<>round(v_delta,2) then
            raise exception 'INVALID_DELTA' using errcode='22023'; end if;
          if v_stock.on_hand_qty+v_delta<v_stock.reserved_qty then
            raise exception 'INSUFFICIENT_STOCK' using errcode='23514'; end if;
          update public.inventory_facility_stock set on_hand_qty=on_hand_qty+v_delta,updated_at=v_now where id=v_stock.id;
          insert into public.inventory_stock_adjustment_items(adjustment_id,sku_id,sku_code,delta,qty_before,qty_after)
            values(v_adjustment,v_sku,v_item->>'sku_code',v_delta,v_stock.on_hand_qty,v_stock.on_hand_qty+v_delta);
          insert into public.inventory_stock_movements(sku_id,movement_type,qty,reason,reference)
            values(v_sku,case when v_delta>0 then 'IN' else 'OUT' end,v_delta,p_body->>'reason',v_adjustment);
          update public.inventory_skus set stock_qty=(select sum(on_hand_qty)
            from public.inventory_facility_stock where sku_id=v_sku) where id=v_sku;
          v_results:=v_results||jsonb_build_array(jsonb_build_object('sku_code',v_item->>'sku_code','before',v_before,'after',v_before+v_delta));
        elsif p_action='edit' or v_res.id is null then
          v_qty:=(v_item->>'quantity')::numeric;
          if v_qty<=0 or v_qty<>round(v_qty,2) or v_qty>999999999999 then
            raise exception 'INVALID_QUANTITY' using errcode='22023'; end if;
          if v_before<v_qty then raise exception 'INSUFFICIENT_STOCK' using errcode='23514'; end if;
          update public.inventory_facility_stock set reserved_qty=reserved_qty+v_qty,updated_at=v_now where id=v_stock.id;
          insert into public.inventory_stock_reservation_items(reservation_id,sku_id,sku_code,item_code,quantity)
            values(v_res_id,v_sku,v_item->>'sku_code',coalesce(v_item->>'item_code',''),v_qty);
        end if;
        select on_hand_qty-reserved_qty into v_qty from public.inventory_facility_stock where id=v_stock.id;
        v_changed:=v_changed||jsonb_build_array(jsonb_build_object('sku_code',v_item->>'sku_code','previous_stock',v_before,'current_stock',v_qty));
      end loop;
      if p_action='reserve' then v_result:=jsonb_build_object('reservation_id',v_res_id,'order_code',v_order_code,'status','RESERVED','expires_at',coalesce(v_res.expires_at,v_now+interval '24 hours'));
      elsif p_action='adjust' then v_result:=jsonb_build_object('adjustment_id',v_adjustment,'applied_at',v_now,'results',v_results);
      end if;
    end if;

    if v_result is null and v_response is null and p_action in ('create','edit') then
      if p_action='create' then
        v_order_id:='ord_'||replace(gen_random_uuid()::text,'-','');
        insert into public.scott_orders(id,order_code,facility_code,due_on,customer,shipping_address,payment,comment,reservation_id,created_at,updated_at)
          values(v_order_id,v_order_code,v_facility,(p_body->>'due_on')::timestamptz,coalesce(p_body->'customer','{}'),
            coalesce(p_body->'shipping_address','{}'),coalesce(p_body->'payment','{}'),coalesce(p_body->>'comment',''),v_res_id,v_now,v_now);
      else
        update public.scott_orders set
          due_on=case when p_body?'due_on' then (p_body->>'due_on')::timestamptz else due_on end,
          shipping_address=case when p_body?'shipping_address' then p_body->'shipping_address' else shipping_address end,
          customer=case when p_body?'customer' then p_body->'customer' else customer end,
          comment=case when p_body?'comment' then p_body->>'comment' else comment end,updated_at=v_now where id=v_order_id;
      end if;
      if v_items is not null then
        insert into public.scott_order_items(order_id,item_code,sku_code,quantity,unit_price)
          select v_order_id,coalesce(x->>'item_code',''),x->>'sku_code',(x->>'quantity')::numeric,coalesce((x->>'unit_price')::numeric,0)
            from jsonb_array_elements(v_items)x;
      end if;
      v_result:=jsonb_build_object('dashboard_order_id',v_order_id,'order_code',v_order_code,'status',coalesce(v_order.status,'PENDING'),'updated_at',v_now,'created_at',coalesce(v_order.created_at,v_now));
    end if;

    if v_result is null and p_action in ('release','fulfill','cancel','status') then
      if p_action in ('release','fulfill') then v_res_id:=p_target; end if;
      v_status:=case when p_action='cancel' then 'CANCELLED' else p_body->>'status' end;
      if p_action='status' and (v_status is null or v_status not in ('PROCESSING','COMPLETE','FAILED')) then
        raise exception 'INVALID_STATUS' using errcode='22023'; end if;
      select * into v_res from public.inventory_stock_reservations where id=v_res_id for update;
      if not found then raise exception 'RESERVATION_NOT_FOUND' using errcode='P0002'; end if;
      v_facility:=v_res.facility_code;
      if p_action in ('release','fulfill') and exists(select 1 from public.scott_orders where reservation_id=v_res_id) then
        raise exception 'ORDER_OWNS_RESERVATION' using errcode='23514'; end if;
      if p_action='fulfill' and v_res.status='RELEASED' then raise exception 'RESERVATION_RELEASED' using errcode='23514'; end if;
      if p_action='release' and v_res.status='FULFILLED' then raise exception 'ALREADY_FULFILLED' using errcode='23514'; end if;
      if (p_action in ('release','fulfill','cancel') or v_status in ('COMPLETE','FAILED')) and v_res.status='RESERVED' then
        for v_row in select * from public.inventory_stock_reservation_items where reservation_id=v_res_id order by sku_id loop
          select * into strict v_stock from public.inventory_facility_stock where sku_id=v_row.sku_id and facility_code=v_facility for update;
          v_delta:=case when p_action='fulfill' or v_status='COMPLETE' then v_row.quantity else 0 end;
          update public.inventory_facility_stock set reserved_qty=reserved_qty-v_row.quantity,on_hand_qty=on_hand_qty-v_delta,updated_at=v_now where id=v_stock.id;
          if v_delta>0 then
            insert into public.inventory_stock_movements(sku_id,movement_type,qty,reason,reference) values(v_row.sku_id,'OUT',-v_delta,'ORDER_FULFILLMENT',v_res_id);
          end if;
          update public.inventory_skus set stock_qty=(select sum(on_hand_qty) from public.inventory_facility_stock where sku_id=v_row.sku_id) where id=v_row.sku_id;
          v_changed:=v_changed||jsonb_build_array(jsonb_build_object('sku_code',v_row.sku_code,'previous_stock',v_stock.on_hand_qty-v_stock.reserved_qty,'current_stock',v_stock.on_hand_qty-v_delta-v_stock.reserved_qty+v_row.quantity));
        end loop;
        update public.inventory_stock_reservations set
          status=case when p_action='fulfill' or v_status='COMPLETE' then 'FULFILLED' else 'RELEASED' end,
          fulfilled_at=case when p_action='fulfill' or v_status='COMPLETE' then coalesce((p_body->>'dispatched_at')::timestamptz,v_now) else null end,
          released_at=case when p_action='fulfill' or v_status='COMPLETE' then null else v_now end,
          release_reason=coalesce(p_body->>'reason',v_status,p_action) where id=v_res_id;
      end if;
      if p_action in ('cancel','status') then
        update public.scott_orders set status=v_status,updated_at=v_now,
          cancelled_at=case when v_status='CANCELLED' then v_now else cancelled_at end,
          cancel_reason=case when v_status='CANCELLED' then coalesce(p_body->>'reason','CUSTOMER_CANCELLED') else cancel_reason end,
          dispatched_at=case when v_status='COMPLETE' then coalesce((p_body->>'dispatched_at')::timestamptz,v_now) else dispatched_at end where id=v_order_id;
        if v_status='COMPLETE' then update public.scott_order_items set dispatched_quantity=quantity where order_id=v_order_id; end if;
        v_result:=jsonb_build_object('dashboard_order_id',v_order_id,'order_code',v_order_code,'status',v_status,'updated_at',v_now,'cancelled_at',case when v_status='CANCELLED' then v_now end);
      else
        select jsonb_build_object('reservation_id',id,'status',status,'released_at',released_at,'fulfilled_at',fulfilled_at)
          into v_result from public.inventory_stock_reservations where id=v_res_id;
        if p_action='fulfill' then
          v_result:=v_result||jsonb_build_object('stock_deducted',(select jsonb_agg(jsonb_build_object(
            'sku_code',i.sku_code,'deducted',i.quantity,'remaining',f.on_hand_qty-f.reserved_qty) order by i.sku_code)
            from public.inventory_stock_reservation_items i join public.inventory_facility_stock f
              on f.sku_id=i.sku_id and f.facility_code=v_facility where i.reservation_id=v_res_id));
        end if;
      end if;
    end if;
    if v_before_map<>'{}'::jsonb then
      select coalesce(jsonb_agg(jsonb_build_object('sku_code',b.key,'previous_stock',b.value,
        'current_stock',f.on_hand_qty-f.reserved_qty) order by b.key),'[]') into v_changed
      from jsonb_each(v_before_map)b join public.inventory_skus s on s.sku_code=b.key
        join public.inventory_facility_stock f on f.sku_id=s.id and f.facility_code=v_facility;
    end if;
    if jsonb_array_length(v_changed)>0 then
      v_trigger:=case when p_action='adjust' then 'ADJUST' when p_action in ('fulfill','status') and (p_action='fulfill' or v_status='COMPLETE') then 'FULFILLMENT'
        when p_action in ('release','cancel','status') then 'RELEASE' else 'RESERVATION' end;
      perform public.enqueue_dashboard_webhook('stock.level_changed',jsonb_build_object('event','stock.level_changed',
        'event_id','evt_'||replace(gen_random_uuid()::text,'-',''),'occurred_at',v_now,'facility_code',v_facility,'trigger',v_trigger,'changed_skus',v_changed));
      select jsonb_agg(jsonb_build_object('sku_code',s.sku_code,'available',f.on_hand_qty-f.reserved_qty,'threshold',s.reorder_point))
        into v_low from jsonb_array_elements(v_changed)c join public.inventory_skus s on s.sku_code=c->>'sku_code'
        join public.inventory_facility_stock f on f.sku_id=s.id and f.facility_code=v_facility
        where s.reorder_point>0 and f.on_hand_qty-f.reserved_qty<s.reorder_point;
      if v_low is not null then perform public.enqueue_dashboard_webhook('stock.low_threshold',jsonb_build_object(
        'event','stock.low_threshold','event_id','evt_'||replace(gen_random_uuid()::text,'-',''),
        'occurred_at',v_now,'facility_code',v_facility,'low_stock_items',v_low)); end if;
    end if;
    v_response:=coalesce(v_response,jsonb_build_object('status',case when p_action in ('create','reserve') then 201 else 200 end,'body',v_result));
  exception
    when no_data_found then v_response:=jsonb_build_object('status',404,'body',jsonb_build_object('error','NOT_FOUND'));
    when check_violation or serialization_failure then v_response:=jsonb_build_object('status',409,'body',jsonb_build_object('error',sqlerrm));
    when invalid_parameter_value or invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
      v_response:=jsonb_build_object('status',400,'body',jsonb_build_object('error','INVALID_REQUEST'));
  end;
  insert into private.dashboard_mutation_results_v1(request_id,request,response) values(p_request_id,v_request,v_response);
  return v_response;
end;
$$;
revoke all on function public.dashboard_mutate_v1(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.dashboard_mutate_v1(text,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
