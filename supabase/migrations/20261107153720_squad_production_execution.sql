BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor;
GRANT UPDATE(cutting_done,assigned_to_tailor_quantity,completed_by_tailor_quantity,completed_by_tailor_quantity_status,dispatched_quantity,updated_at)
 ON sa_snapshot_20261019.sa_quantities TO sa_executor;
CREATE POLICY squad_quantities_update ON sa_snapshot_20261019.sa_quantities FOR UPDATE TO sa_executor
 USING(item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items)) WITH CHECK(item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items));
GRANT UPDATE(cutting_done,cutting_status,sample_cutting_done,sample_cutting_status,assigned_to_tailor_quantity,completed_by_tailor_quantity,
 completed_by_tailor_quantity_status,tailor_job_status,dispatched_quantity,dispatched_status,job_sheet_assigned,job_sheet_due_on,job_sheet_completion_by,updated_at)
 ON sa_snapshot_20261019.sa_items TO sa_executor;
GRANT UPDATE(last_dispatched_at) ON sa_snapshot_20261019.sa_orders TO sa_executor;
-- Scope history through its item. No client receives direct table privileges.
DO $do$ DECLARE t text;predicate_ text; BEGIN
 FOREACH t IN ARRAY ARRAY['mark_cuttings','job_sheet_assign_dates','item_tailors','job_sheet_tailor_mark_dates','job_sheet_dispatched_dates','job_sheet_assign_quantities'] LOOP
  predicate_:='item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items)';
  EXECUTE format('GRANT SELECT,INSERT ON sa_snapshot_20261019.sa_%I TO sa_executor',t);
  EXECUTE format('GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_%I TO sa_executor',t||'_id_seq');
  EXECUTE format('CREATE POLICY squad_work_read ON sa_snapshot_20261019.sa_%I FOR SELECT TO sa_executor USING(%s)',t,predicate_);
  EXECUTE format('CREATE POLICY squad_work_insert ON sa_snapshot_20261019.sa_%I FOR INSERT TO sa_executor WITH CHECK(%s)',t,predicate_);
 END LOOP;
 FOR t,predicate_ IN SELECT * FROM (VALUES
 ('mark_cutting_quantities','mark_cutting_id IN(SELECT id FROM sa_snapshot_20261019.sa_mark_cuttings) AND quantity_id IN(SELECT id FROM sa_snapshot_20261019.sa_quantities)'),
 ('item_tailor_quantities','item_tailor_id IN(SELECT id FROM sa_snapshot_20261019.sa_item_tailors) AND quantity_id IN(SELECT id FROM sa_snapshot_20261019.sa_quantities)'),
 ('job_sheet_assign_tailors','job_sheet_assign_date_id IN(SELECT id FROM sa_snapshot_20261019.sa_job_sheet_assign_dates) AND item_tailor_id IN(SELECT id FROM sa_snapshot_20261019.sa_item_tailors)'),
 ('job_sheet_mark_tailors','job_sheet_tailor_mark_date_id IN(SELECT id FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates) AND item_tailor_id IN(SELECT id FROM sa_snapshot_20261019.sa_item_tailors)'),
 ('mark_tailor_quantities','job_sheet_mark_tailor_id IN(SELECT id FROM sa_snapshot_20261019.sa_job_sheet_mark_tailors) AND item_tailor_quantity_id IN(SELECT id FROM sa_snapshot_20261019.sa_item_tailor_quantities)'),
 ('dispatched_quantities','job_sheet_dispatched_date_id IN(SELECT id FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates) AND quantity_id IN(SELECT id FROM sa_snapshot_20261019.sa_quantities)')) x(t,p) LOOP
  EXECUTE format('GRANT SELECT,INSERT ON sa_snapshot_20261019.sa_%I TO sa_executor',t);
  EXECUTE format('GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_%I TO sa_executor',t||'_id_seq');
  EXECUTE format('CREATE POLICY squad_work_read ON sa_snapshot_20261019.sa_%I FOR SELECT TO sa_executor USING(%s)',t,predicate_);
  EXECUTE format('CREATE POLICY squad_work_insert ON sa_snapshot_20261019.sa_%I FOR INSERT TO sa_executor WITH CHECK(%s)',t,predicate_);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['item_tailors','item_tailor_quantities','job_sheet_assign_quantities'] LOOP
  EXECUTE format('CREATE POLICY squad_work_update ON sa_snapshot_20261019.sa_%I FOR UPDATE TO sa_executor USING(%s) WITH CHECK(%s)',t,
   CASE WHEN t='item_tailor_quantities' THEN 'item_tailor_id IN(SELECT id FROM sa_snapshot_20261019.sa_item_tailors)' ELSE 'item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items)' END,
   CASE WHEN t='item_tailor_quantities' THEN 'item_tailor_id IN(SELECT id FROM sa_snapshot_20261019.sa_item_tailors)' ELSE 'item_id IN(SELECT id FROM sa_snapshot_20261019.sa_items)' END);
 END LOOP;
END $do$;
GRANT UPDATE(assigned_quantity,completed_quantity,completed_quantity_status,quantity_completed_at,updated_at) ON sa_snapshot_20261019.sa_item_tailors TO sa_executor;
GRANT UPDATE(assigned_quantity,completed_quantity,completed_quantity_status,updated_at) ON sa_snapshot_20261019.sa_item_tailor_quantities TO sa_executor;
GRANT UPDATE(completed_quantity,completed_quantity_status,updated_at) ON sa_snapshot_20261019.sa_job_sheet_assign_quantities TO sa_executor;
CREATE INDEX squad_assign_fifo ON sa_snapshot_20261019.sa_job_sheet_assign_quantities(item_tailor_id,quantity_id,job_sheet_assign_date_id,id);
CREATE INDEX squad_tailor_item_quantity ON sa_snapshot_20261019.sa_item_tailor_quantities(item_tailor_id,quantity_id);
CREATE INDEX squad_item_tailor ON sa_snapshot_20261019.sa_item_tailors(item_id,tailor_id);

CREATE FUNCTION sa_domain.work_timestamp(p_at text) RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE t timestamptz:=CASE WHEN p_at IS NULL THEN now() ELSE sa_domain.due_timestamp(p_at) END;
BEGIN IF t>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Work cannot be recorded in the future' USING ERRCODE='22023';END IF;RETURN t;END $f$;
CREATE FUNCTION sa_domain.work_rows(p_rows jsonb,p_kind text) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE x jsonb;ids_ text[]:='{}';key_ text;id_ bigint;v integer;
BEGIN
 IF p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 100 OR pg_column_size(p_rows)>32768 THEN
  RAISE EXCEPTION 'Provide 1 to 100 work rows within 32KB' USING ERRCODE='22023';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  PERFORM sa_domain.check_fields(x,CASE WHEN p_kind='assignment' THEN ARRAY['quantity_id','tailor_id','quantity'] WHEN p_kind='inspection' THEN ARRAY['item_tailor_quantity_id','quantity'] ELSE ARRAY['quantity_id','quantity'] END);
  id_:=sa_domain.input_id(x->CASE WHEN p_kind='inspection' THEN 'item_tailor_quantity_id' ELSE 'quantity_id' END);
  key_:=id_::text;
  IF p_kind='assignment' THEN key_:=key_||':'||sa_domain.input_id(x->'tailor_id');END IF;
  IF key_=ANY(ids_) OR coalesce(x->>'quantity','')!~ '^[0-9]{1,6}$' THEN RAISE EXCEPTION 'Work rows require unique IDs and positive integer quantities' USING ERRCODE='22023';END IF;
  v:=(x->>'quantity')::int;IF v NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'Quantity outside supported bounds' USING ERRCODE='22023';END IF;
  ids_:=array_append(ids_,key_);
 END LOOP;
END $f$;
CREATE FUNCTION sa_domain.assert_factory_work(p_item sa_snapshot_20261019.sa_items) RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE o sa_snapshot_20261019.sa_orders;a sa_domain.actor:=sa_domain.actor();
BEGIN
 SELECT * INTO o FROM sa_snapshot_20261019.sa_orders WHERE id=p_item.order_id;
 IF p_item.item_type<>0 OR o.assigned_to_id IS NULL OR o.assigned_worker_id IS NOT NULL OR o.customer_dealer_id IS NOT NULL OR a.factory_id IS NULL OR o.assigned_to_id NOT IN(SELECT sa_domain.factory_manager_ids()) THEN
 RAISE EXCEPTION 'Item is not active factory work' USING ERRCODE='42501';END IF;
END $f$;
CREATE FUNCTION sa_domain.assert_work_balances(p_id bigint) RETURNS void LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
BEGIN
 IF EXISTS(
 WITH sizes AS MATERIALIZED(SELECT * FROM sa_snapshot_20261019.sa_quantities WHERE item_id=p_id),
 cuts AS(SELECT h.quantity_id,sum(h.cutting_done) n FROM sa_snapshot_20261019.sa_mark_cutting_quantities h JOIN sa_snapshot_20261019.sa_mark_cuttings d ON d.id=h.mark_cutting_id WHERE d.item_id=p_id GROUP BY h.quantity_id),
 assignments AS(SELECT quantity_id,sum(assigned_quantity) n,sum(completed_quantity) completed FROM sa_snapshot_20261019.sa_job_sheet_assign_quantities WHERE item_id=p_id GROUP BY quantity_id),
 inspected AS(SELECT q.quantity_id,sum(m.completed_quantity) n FROM sa_snapshot_20261019.sa_mark_tailor_quantities m
 JOIN sa_snapshot_20261019.sa_item_tailor_quantities q ON q.id=m.item_tailor_quantity_id JOIN sa_snapshot_20261019.sa_item_tailors it ON it.id=q.item_tailor_id WHERE it.item_id=p_id GROUP BY q.quantity_id),
 dispatched AS(SELECT h.quantity_id,sum(h.dispatched_quantity) n FROM sa_snapshot_20261019.sa_dispatched_quantities h JOIN sa_snapshot_20261019.sa_job_sheet_dispatched_dates d ON d.id=h.job_sheet_dispatched_date_id WHERE d.item_id=p_id GROUP BY h.quantity_id)
 SELECT FROM sizes q LEFT JOIN cuts c ON c.quantity_id=q.id LEFT JOIN assignments a ON a.quantity_id=q.id LEFT JOIN inspected i ON i.quantity_id=q.id LEFT JOIN dispatched d ON d.quantity_id=q.id
 WHERE q.quantity IS NULL OR q.quantity<0 OR coalesce(q.cutting_done,0)<>coalesce(c.n,0) OR coalesce(q.assigned_to_tailor_quantity,0)<>coalesce(a.n,0)
 OR coalesce(q.completed_by_tailor_quantity,0)<>coalesce(i.n,0) OR coalesce(q.completed_by_tailor_quantity,0)<>coalesce(a.completed,0)
 OR coalesce(q.dispatched_quantity,0)<>coalesce(d.n,0) OR coalesce(d.n,0)<0 OR coalesce(i.n,0)<coalesce(d.n,0) OR coalesce(a.n,0)<coalesce(i.n,0)
 OR coalesce(c.n,0)<coalesce(a.n,0) OR q.quantity<coalesce(c.n,0)) THEN
 RAISE EXCEPTION 'Recorded quantity history and balances require reconciliation before further work' USING ERRCODE='55000';END IF;
END $f$;
CREATE FUNCTION sa_domain.recompute_item_progress(p_id bigint) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE i sa_snapshot_20261019.sa_items;r record;result_ jsonb;
BEGIN
 SELECT * INTO i FROM sa_snapshot_20261019.sa_items WHERE id=p_id;
 SELECT count(*) FILTER(WHERE quantity>0) n,coalesce(sum(quantity),0) total,coalesce(sum(cutting_done),0) cut,
 coalesce(sum(assigned_to_tailor_quantity),0) assigned,coalesce(sum(completed_by_tailor_quantity),0) sewn,coalesce(sum(dispatched_quantity),0) dispatched,
 coalesce(bool_and(cutting_done>=quantity) FILTER(WHERE quantity>0),false) cut_complete,
 coalesce(bool_and(completed_by_tailor_quantity>=quantity) FILTER(WHERE quantity>0),false) sewn_complete,
 coalesce(bool_and(dispatched_quantity>=quantity) FILTER(WHERE quantity>0),false) dispatch_complete,
 coalesce(bool_and(assigned_to_tailor_quantity>=quantity) FILTER(WHERE quantity>0),false) assigned_complete INTO r
 FROM sa_snapshot_20261019.sa_quantities WHERE item_id=p_id;
 UPDATE sa_snapshot_20261019.sa_items SET cutting_done=r.cut,cutting_status=CASE WHEN r.n>0 AND r.cut_complete THEN 1 ELSE 0 END,
 sample_cutting_done=CASE WHEN sample_order THEN r.cut ELSE sample_cutting_done END,
 sample_cutting_status=CASE WHEN sample_order THEN CASE WHEN r.n>0 AND r.cut_complete THEN 1 ELSE 0 END ELSE sample_cutting_status END,
 assigned_to_tailor_quantity=r.assigned,completed_by_tailor_quantity=r.sewn,
 completed_by_tailor_quantity_status=CASE WHEN r.n>0 AND r.sewn_complete THEN 1 ELSE 0 END,
 tailor_job_status=CASE WHEN r.n>0 AND r.sewn_complete THEN 1 ELSE 0 END,
 dispatched_quantity=r.dispatched,dispatched_status=CASE WHEN r.n>0 AND r.dispatch_complete THEN 1 ELSE 0 END,updated_at=now() WHERE id=p_id;
 result_:=sa_domain.recompute_order_progress(i.order_id);
 RETURN jsonb_build_object('required',r.total,'cut',r.cut,'assigned',r.assigned,'sewn',r.sewn,'dispatched',r.dispatched,'order_completed',result_->'completed');
END $f$;
CREATE FUNCTION sa_domain.v1_cutting_record(p_id bigint,p_quantities jsonb,p_occurred_at text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[9]);i sa_snapshot_20261019.sa_items;q sa_snapshot_20261019.sa_quantities;cached jsonb;x jsonb;qty_ int;date_ bigint;v text;ov text;progress_ jsonb;t timestamptz;
BEGIN
 PERFORM sa_domain.work_rows(p_quantities,'cutting');
 cached:=sa_domain.begin_command('item.cut',p_idempotency_key,jsonb_build_object('id',p_id,'rows',p_quantities,'at',p_occurred_at,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 t:=sa_domain.work_timestamp(p_occurred_at);i:=sa_domain.lock_item(p_id);PERFORM sa_domain.assert_factory_work(i);PERFORM sa_domain.assert_work_balances(p_id);
 IF i.cutting_master_id IS DISTINCT FROM a.user_id THEN RAISE EXCEPTION 'Only the assigned cutting master may record work' USING ERRCODE='42501';END IF;
 v:=sa_domain.bump_version('item',p_id,p_expected_version);ov:=sa_domain.bump_version('order',i.order_id,sa_domain.version('order',i.order_id));
 INSERT INTO sa_snapshot_20261019.sa_mark_cuttings(item_id,cutting_date,created_at,updated_at) VALUES(p_id,t,now(),now()) RETURNING id INTO date_;
 FOR x IN SELECT value FROM jsonb_array_elements(p_quantities) ORDER BY (value->>'quantity_id')::bigint LOOP
  SELECT * INTO q FROM sa_snapshot_20261019.sa_quantities WHERE id=(x->>'quantity_id')::bigint AND item_id=p_id FOR UPDATE;qty_:=(x->>'quantity')::int;
  IF q.id IS NULL OR q.quantity IS NULL OR q.cutting_done<0 OR qty_>q.quantity-coalesce(q.cutting_done,0) THEN RAISE EXCEPTION 'Cut quantity exceeds remaining work or size is unavailable' USING ERRCODE='22023';END IF;
  INSERT INTO sa_snapshot_20261019.sa_mark_cutting_quantities(mark_cutting_id,quantity_id,qty,cutting_done,created_at,updated_at) VALUES(date_,q.id,q.quantity-coalesce(q.cutting_done,0),qty_,now(),now());
  UPDATE sa_snapshot_20261019.sa_quantities SET cutting_done=coalesce(cutting_done,0)+qty_,updated_at=now() WHERE id=q.id;
 END LOOP;
 progress_:=sa_domain.recompute_item_progress(p_id);
 RETURN sa_domain.finish_command('item.cut',p_idempotency_key,'item',p_id,jsonb_build_object('id',p_id::text,'history_id',date_::text,'version',v,'order_version',ov,'progress',progress_),jsonb_build_object('order_id',i.order_id::text,'rows',p_quantities,'at',t));
END $f$;

CREATE FUNCTION sa_domain.v1_jobsheet_assign(p_id bigint,p_allocations jsonb,p_due_at text,p_completion_by text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[4]);i sa_snapshot_20261019.sa_items;q sa_snapshot_20261019.sa_quantities;cached jsonb;x jsonb;qty_ int;tailor_ bigint;it_ bigint;itq_ bigint;date_ bigint;dt_ bigint;v text;ov text;progress_ jsonb;
 due_ timestamptz:=sa_domain.due_timestamp(p_due_at);complete_ timestamptz:=sa_domain.due_timestamp(p_completion_by);
BEGIN
 PERFORM sa_domain.work_rows(p_allocations,'assignment');
 IF complete_>due_ THEN RAISE EXCEPTION 'Completion target cannot follow the job-sheet due date' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('item.work_assigned',p_idempotency_key,jsonb_build_object('id',p_id,'rows',p_allocations,'due',due_,'complete',complete_,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 i:=sa_domain.lock_item(p_id);PERFORM sa_domain.assert_factory_work(i);PERFORM sa_domain.assert_work_balances(p_id);v:=sa_domain.bump_version('item',p_id,p_expected_version);ov:=sa_domain.bump_version('order',i.order_id,sa_domain.version('order',i.order_id));
 INSERT INTO sa_snapshot_20261019.sa_job_sheet_assign_dates(item_id,assign_at,created_at,updated_at) VALUES(p_id,now(),now(),now()) RETURNING id INTO date_;
 FOR x IN SELECT value FROM jsonb_array_elements(p_allocations) ORDER BY (value->>'quantity_id')::bigint,(value->>'tailor_id')::bigint LOOP
  tailor_:=(x->>'tailor_id')::bigint;qty_:=(x->>'quantity')::int;PERFORM sa_domain.work_person(tailor_,ARRAY[5,6],a.factory_id);
  SELECT * INTO q FROM sa_snapshot_20261019.sa_quantities WHERE id=(x->>'quantity_id')::bigint AND item_id=p_id FOR UPDATE;
  IF q.id IS NULL OR coalesce(q.cutting_done,0)>coalesce(q.quantity,0) OR coalesce(q.assigned_to_tailor_quantity,0)<0 OR qty_>coalesce(q.cutting_done,0)-coalesce(q.assigned_to_tailor_quantity,0) THEN RAISE EXCEPTION 'Assignment exceeds cut work available for this size' USING ERRCODE='22023';END IF;
  SELECT id INTO it_ FROM sa_snapshot_20261019.sa_item_tailors WHERE item_id=p_id AND tailor_id=tailor_ ORDER BY id LIMIT 1;
  IF it_ IS NULL THEN INSERT INTO sa_snapshot_20261019.sa_item_tailors(item_id,tailor_id,created_at,updated_at) VALUES(p_id,tailor_,now(),now()) RETURNING id INTO it_;END IF;
  SELECT id INTO itq_ FROM sa_snapshot_20261019.sa_item_tailor_quantities WHERE item_tailor_id=it_ AND quantity_id=q.id ORDER BY id LIMIT 1;
  IF itq_ IS NULL THEN INSERT INTO sa_snapshot_20261019.sa_item_tailor_quantities(item_tailor_id,quantity_id,created_at,updated_at) VALUES(it_,q.id,now(),now()) RETURNING id INTO itq_;END IF;
  SELECT id INTO dt_ FROM sa_snapshot_20261019.sa_job_sheet_assign_tailors WHERE job_sheet_assign_date_id=date_ AND item_tailor_id=it_;
  IF dt_ IS NULL THEN INSERT INTO sa_snapshot_20261019.sa_job_sheet_assign_tailors(job_sheet_assign_date_id,item_tailor_id,created_at,updated_at) VALUES(date_,it_,now(),now()) RETURNING id INTO dt_;END IF;
  INSERT INTO sa_snapshot_20261019.sa_job_sheet_assign_quantities(job_sheet_assign_date_id,item_tailor_id,quantity_id,job_sheet_assign_tailor_id,item_id,qty,assigned_quantity,completed_quantity,created_at,updated_at)
   VALUES(date_,it_,q.id,dt_,p_id,q.cutting_done-coalesce(q.assigned_to_tailor_quantity,0),qty_,0,now(),now());
  UPDATE sa_snapshot_20261019.sa_item_tailors SET assigned_quantity=coalesce(assigned_quantity,0)+qty_,completed_quantity_status=0,quantity_completed_at=NULL,updated_at=now() WHERE id=it_;
  UPDATE sa_snapshot_20261019.sa_item_tailor_quantities SET assigned_quantity=coalesce(assigned_quantity,0)+qty_,completed_quantity_status=0,updated_at=now() WHERE id=itq_;
  UPDATE sa_snapshot_20261019.sa_quantities SET assigned_to_tailor_quantity=coalesce(assigned_to_tailor_quantity,0)+qty_,completed_by_tailor_quantity_status=0,updated_at=now() WHERE id=q.id;
 END LOOP;
 UPDATE sa_snapshot_20261019.sa_items SET job_sheet_assigned=true,job_sheet_due_on=due_,job_sheet_completion_by=complete_ WHERE id=p_id;
 progress_:=sa_domain.recompute_item_progress(p_id);
 RETURN sa_domain.finish_command('item.work_assigned',p_idempotency_key,'item',p_id,jsonb_build_object('id',p_id::text,'history_id',date_::text,'version',v,'order_version',ov,'progress',progress_),jsonb_build_object('order_id',i.order_id::text,'rows',p_allocations,'due_at',due_,'completion_by',complete_));
END $f$;

CREATE FUNCTION sa_domain.v1_jobsheet_inspect(p_id bigint,p_quantities jsonb,p_occurred_at text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[8]);i sa_snapshot_20261019.sa_items;itq sa_snapshot_20261019.sa_item_tailor_quantities;cached jsonb;x jsonb;qty_ int;remaining_ int;used_ int;date_ bigint;mt_ bigint;v text;ov text;progress_ jsonb;t timestamptz;allocation_ record;
BEGIN
 PERFORM sa_domain.work_rows(p_quantities,'inspection');
 cached:=sa_domain.begin_command('item.inspected',p_idempotency_key,jsonb_build_object('id',p_id,'rows',p_quantities,'at',p_occurred_at,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 t:=sa_domain.work_timestamp(p_occurred_at);i:=sa_domain.lock_item(p_id);PERFORM sa_domain.assert_factory_work(i);PERFORM sa_domain.assert_work_balances(p_id);
 v:=sa_domain.bump_version('item',p_id,p_expected_version);ov:=sa_domain.bump_version('order',i.order_id,sa_domain.version('order',i.order_id));
 INSERT INTO sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates(item_id,marked_at,created_at,updated_at) VALUES(p_id,t,now(),now()) RETURNING id INTO date_;
 FOR x IN SELECT value FROM jsonb_array_elements(p_quantities) ORDER BY (value->>'item_tailor_quantity_id')::bigint LOOP
  SELECT tq.* INTO itq FROM sa_snapshot_20261019.sa_item_tailor_quantities tq JOIN sa_snapshot_20261019.sa_item_tailors it ON it.id=tq.item_tailor_id
   JOIN sa_snapshot_20261019.sa_quantities q ON q.id=tq.quantity_id WHERE tq.id=(x->>'item_tailor_quantity_id')::bigint AND it.item_id=p_id AND q.item_id=p_id FOR UPDATE OF tq;
  qty_:=(x->>'quantity')::int;
  IF itq.id IS NULL OR coalesce(itq.completed_quantity,0)<0 OR qty_>coalesce(itq.assigned_quantity,0)-coalesce(itq.completed_quantity,0) THEN RAISE EXCEPTION 'Inspection exceeds assigned remaining work' USING ERRCODE='22023';END IF;
  PERFORM 1 FROM sa_snapshot_20261019.sa_quantities WHERE id=itq.quantity_id FOR UPDATE;
  IF EXISTS(SELECT FROM sa_snapshot_20261019.sa_quantities WHERE id=itq.quantity_id AND (coalesce(completed_by_tailor_quantity,0)+qty_>least(coalesce(assigned_to_tailor_quantity,0),coalesce(cutting_done,0),coalesce(quantity,0)))) THEN
   RAISE EXCEPTION 'Size balances require reconciliation before inspection' USING ERRCODE='55000';END IF;
  SELECT id INTO mt_ FROM sa_snapshot_20261019.sa_job_sheet_mark_tailors WHERE job_sheet_tailor_mark_date_id=date_ AND item_tailor_id=itq.item_tailor_id;
  IF mt_ IS NULL THEN INSERT INTO sa_snapshot_20261019.sa_job_sheet_mark_tailors(job_sheet_tailor_mark_date_id,item_tailor_id,created_at,updated_at) VALUES(date_,itq.item_tailor_id,now(),now()) RETURNING id INTO mt_;END IF;
  INSERT INTO sa_snapshot_20261019.sa_mark_tailor_quantities(job_sheet_mark_tailor_id,item_tailor_quantity_id,qty,completed_quantity,created_at,updated_at)
   VALUES(mt_,itq.id,itq.assigned_quantity-coalesce(itq.completed_quantity,0),qty_,now(),now());
  remaining_:=qty_;
  FOR allocation_ IN SELECT * FROM sa_snapshot_20261019.sa_job_sheet_assign_quantities WHERE item_id=p_id AND item_tailor_id=itq.item_tailor_id AND quantity_id=itq.quantity_id
   AND assigned_quantity>coalesce(completed_quantity,0) ORDER BY job_sheet_assign_date_id,id FOR UPDATE LOOP
   used_:=least(remaining_,allocation_.assigned_quantity-coalesce(allocation_.completed_quantity,0));
   UPDATE sa_snapshot_20261019.sa_job_sheet_assign_quantities SET completed_quantity=coalesce(completed_quantity,0)+used_,
    completed_quantity_status=CASE WHEN coalesce(completed_quantity,0)+used_=assigned_quantity THEN 1 ELSE 0 END,updated_at=now() WHERE id=allocation_.id;
   remaining_:=remaining_-used_;EXIT WHEN remaining_=0;
  END LOOP;
  IF remaining_<>0 THEN RAISE EXCEPTION 'Assignment history requires reconciliation before inspection' USING ERRCODE='55000';END IF;
  UPDATE sa_snapshot_20261019.sa_item_tailor_quantities SET completed_quantity=coalesce(completed_quantity,0)+qty_,
   completed_quantity_status=CASE WHEN coalesce(completed_quantity,0)+qty_=assigned_quantity THEN 1 ELSE 0 END,updated_at=now() WHERE id=itq.id;
  UPDATE sa_snapshot_20261019.sa_item_tailors SET completed_quantity=coalesce(completed_quantity,0)+qty_,
   completed_quantity_status=CASE WHEN coalesce(completed_quantity,0)+qty_=assigned_quantity THEN 1 ELSE 0 END,
   quantity_completed_at=CASE WHEN coalesce(completed_quantity,0)+qty_=assigned_quantity THEN coalesce(quantity_completed_at,t) ELSE quantity_completed_at END,updated_at=now() WHERE id=itq.item_tailor_id;
  UPDATE sa_snapshot_20261019.sa_quantities SET completed_by_tailor_quantity=coalesce(completed_by_tailor_quantity,0)+qty_,
   completed_by_tailor_quantity_status=CASE WHEN coalesce(completed_by_tailor_quantity,0)+qty_=quantity THEN 1 ELSE 0 END,updated_at=now() WHERE id=itq.quantity_id;
 END LOOP;
 progress_:=sa_domain.recompute_item_progress(p_id);
 RETURN sa_domain.finish_command('item.inspected',p_idempotency_key,'item',p_id,jsonb_build_object('id',p_id::text,'history_id',date_::text,'version',v,'order_version',ov,'progress',progress_),jsonb_build_object('order_id',i.order_id::text,'rows',p_quantities,'at',t,'picked_equals_inspected',true));
END $f$;

CREATE FUNCTION sa_domain.v1_dispatch_record(p_id bigint,p_quantities jsonb,p_occurred_at text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[7]);i sa_snapshot_20261019.sa_items;q sa_snapshot_20261019.sa_quantities;cached jsonb;x jsonb;qty_ int;date_ bigint;v text;ov text;progress_ jsonb;t timestamptz;
BEGIN
 PERFORM sa_domain.work_rows(p_quantities,'dispatch');
 cached:=sa_domain.begin_command('item.dispatched',p_idempotency_key,jsonb_build_object('id',p_id,'rows',p_quantities,'at',p_occurred_at,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 t:=sa_domain.work_timestamp(p_occurred_at);i:=sa_domain.lock_item(p_id);PERFORM sa_domain.assert_factory_work(i);PERFORM sa_domain.assert_work_balances(p_id);
 v:=sa_domain.bump_version('item',p_id,p_expected_version);ov:=sa_domain.bump_version('order',i.order_id,sa_domain.version('order',i.order_id));
 INSERT INTO sa_snapshot_20261019.sa_job_sheet_dispatched_dates(item_id,dispatched_at,created_at,updated_at) VALUES(p_id,t,now(),now()) RETURNING id INTO date_;
 FOR x IN SELECT value FROM jsonb_array_elements(p_quantities) ORDER BY (value->>'quantity_id')::bigint LOOP
  SELECT * INTO q FROM sa_snapshot_20261019.sa_quantities WHERE id=(x->>'quantity_id')::bigint AND item_id=p_id FOR UPDATE;qty_:=(x->>'quantity')::int;
  IF q.id IS NULL OR coalesce(q.dispatched_quantity,0)<0 OR qty_>least(coalesce(q.completed_by_tailor_quantity,0),coalesce(q.quantity,0))-coalesce(q.dispatched_quantity,0) THEN
   RAISE EXCEPTION 'Dispatch exceeds inspected work available for this size' USING ERRCODE='22023';END IF;
  INSERT INTO sa_snapshot_20261019.sa_dispatched_quantities(job_sheet_dispatched_date_id,quantity_id,qty,dispatched_quantity,created_at,updated_at)
   VALUES(date_,q.id,q.completed_by_tailor_quantity-coalesce(q.dispatched_quantity,0),qty_,now(),now());
  UPDATE sa_snapshot_20261019.sa_quantities SET dispatched_quantity=coalesce(dispatched_quantity,0)+qty_,updated_at=now() WHERE id=q.id;
 END LOOP;
 UPDATE sa_snapshot_20261019.sa_orders SET last_dispatched_at=greatest(last_dispatched_at,t AT TIME ZONE 'UTC') WHERE id=i.order_id;
 progress_:=sa_domain.recompute_item_progress(p_id);
 RETURN sa_domain.finish_command('item.dispatched',p_idempotency_key,'item',p_id,jsonb_build_object('id',p_id::text,'history_id',date_::text,'version',v,'order_version',ov,'progress',progress_),jsonb_build_object('order_id',i.order_id::text,'rows',p_quantities,'at',t));
END $f$;

-- One bounded quantity/history projection feeds cutting and dispatch detail screens.
CREATE FUNCTION sa_domain.work_detail(p_id bigint,p_kind text,p_quantity_cursor text,p_history_cursor text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(CASE WHEN p_kind='cutting' THEN ARRAY[4,9] ELSE ARRAY[4,7] END);i sa_snapshot_20261019.sa_items;n int:=sa_domain.page_limit(p_limit);
 qc jsonb:=sa_domain.page_context('work_sizes',jsonb_build_object('item',p_id,'kind',p_kind));hc jsonb:=sa_domain.page_context('work_history',jsonb_build_object('item',p_id,'kind',p_kind));
 qa bigint:=sa_domain.cursor_id(p_quantity_cursor,qc);ha bigint:=sa_domain.cursor_id(p_history_cursor,hc);qpage jsonb;hpage jsonb;
BEGIN
 SELECT * INTO i FROM sa_snapshot_20261019.sa_items WHERE id=p_id;
 IF i.id IS NULL THEN RAISE EXCEPTION 'Item not found or unavailable' USING ERRCODE='P0002';END IF;
 WITH scan AS MATERIALIZED(SELECT q.id,q.size_id,s.name size_name,q.quantity,q.cutting_done,q.assigned_to_tailor_quantity,q.completed_by_tailor_quantity,q.dispatched_quantity
  FROM sa_snapshot_20261019.sa_quantities q LEFT JOIN sa_snapshot_20261019.sa_sizes s ON s.id=q.size_id WHERE q.item_id=p_id AND q.id<qa ORDER BY q.id DESC LIMIT n+1),
 page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'size_id',size_id::text,'size_name',size_name,'quantity',quantity,
 'cut',cutting_done,'assigned',assigned_to_tailor_quantity,'inspected',completed_by_tailor_quantity,'picked',completed_by_tailor_quantity,'dispatched',dispatched_quantity,
 'remaining',CASE WHEN p_kind='cutting' THEN quantity-coalesce(cutting_done,0) ELSE least(coalesce(quantity,0),coalesce(completed_by_tailor_quantity,0))-coalesce(dispatched_quantity,0) END) ORDER BY id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),qc) END) INTO qpage FROM page;
 WITH scan AS MATERIALIZED(
  SELECT q.id,d.id history_id,q.quantity_id,q.qty remaining_before,q.cutting_done quantity,d.cutting_date occurred_at FROM sa_snapshot_20261019.sa_mark_cutting_quantities q
  JOIN sa_snapshot_20261019.sa_mark_cuttings d ON d.id=q.mark_cutting_id WHERE p_kind='cutting' AND d.item_id=p_id AND q.id<ha
  UNION ALL
  SELECT q.id,d.id,q.quantity_id,q.qty,q.dispatched_quantity,d.dispatched_at FROM sa_snapshot_20261019.sa_dispatched_quantities q
  JOIN sa_snapshot_20261019.sa_job_sheet_dispatched_dates d ON d.id=q.job_sheet_dispatched_date_id WHERE p_kind='dispatch' AND d.item_id=p_id AND q.id<ha
  ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'history_id',history_id::text,'quantity_id',quantity_id::text,'remaining_before',remaining_before,
 'quantity',quantity,'occurred_at',occurred_at AT TIME ZONE 'UTC') ORDER BY id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),hc) END) INTO hpage FROM page;
 RETURN jsonb_build_object('id',i.id::text,'order_id',i.order_id::text,'product_id',i.product_id::text,'sample',i.sample_order,'planned_quantity',i.total_quantity,
 'version',sa_domain.version('item',i.id),'quantities',qpage,'history',hpage);
END $f$;
CREATE FUNCTION sa_domain.v1_cutting_detail(p_id bigint,p_quantity_cursor text DEFAULT NULL,p_history_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$ SELECT sa_domain.work_detail(p_id,'cutting',p_quantity_cursor,p_history_cursor,p_limit) $f$;
CREATE FUNCTION sa_domain.v1_dispatch_detail(p_id bigint,p_quantity_cursor text DEFAULT NULL,p_history_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$ SELECT sa_domain.work_detail(p_id,'dispatch',p_quantity_cursor,p_history_cursor,p_limit) $f$;
CREATE FUNCTION sa_domain.work_queue(p_kind text,p_completed boolean,p_order_id bigint,p_cursor text,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(CASE WHEN p_kind='cutting' THEN ARRAY[4,9] ELSE ARRAY[4,7] END);n int:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('work_queue',jsonb_build_object('kind',p_kind,'completed',p_completed,'order',p_order_id));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;
BEGIN
 WITH scan AS MATERIALIZED(SELECT i.id,i.order_id,i.product_id,i.cutting_master_id,i.sample_order,i.cutting_done,i.assigned_to_tailor_quantity,i.completed_by_tailor_quantity,i.dispatched_quantity,o.due_on,o.is_prime,
  EXISTS(SELECT FROM sa_domain.order_requests r WHERE r.order_id=o.id AND r.state IN('queued','running')) held
  FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id
  WHERE i.id<after_ AND i.item_type=0 AND (p_order_id IS NULL OR i.order_id=p_order_id) AND o.assigned_worker_id IS NULL AND o.assigned_to_id IS NOT NULL AND o.customer_dealer_id IS NULL
  AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL AND o.uc_status<>'CANCELLED'
  AND CASE WHEN p_completed THEN CASE WHEN p_kind='cutting' THEN i.cutting_status=1 ELSE i.dispatched_status=1 END
   ELSE o.status=0 AND CASE WHEN p_kind='cutting' THEN i.cutting_status<>1 ELSE i.completed_by_tailor_quantity>i.dispatched_quantity END END
  ORDER BY i.id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',p.id::text,'order_id',p.order_id::text,'product_id',p.product_id::text,'cutter_id',p.cutting_master_id::text,
 'sample',p.sample_order,'cut',p.cutting_done,'assigned',p.assigned_to_tailor_quantity,'inspected',p.completed_by_tailor_quantity,'dispatched',p.dispatched_quantity,
 'due_at',p.due_on AT TIME ZONE 'UTC','prime',p.is_prime,'held',p.held,'version',(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY p.id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END) INTO r FROM page p LEFT JOIN sa_domain.entity_versions v ON v.kind='item' AND v.entity_id=p.id;RETURN r;
END $f$;
CREATE FUNCTION sa_domain.v1_cutting_queue(p_completed boolean DEFAULT false,p_order_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$ SELECT sa_domain.work_queue('cutting',p_completed,p_order_id,p_cursor,p_limit) $f$;
CREATE FUNCTION sa_domain.v1_dispatch_queue(p_completed boolean DEFAULT false,p_order_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$ SELECT sa_domain.work_queue('dispatch',p_completed,p_order_id,p_cursor,p_limit) $f$;

-- Read the same size allocation ledger for FM/Inspector/Dispatch/PC. Every page is flat and bounded.
CREATE FUNCTION sa_domain.v1_jobsheets_list(p_item_id bigint DEFAULT NULL,p_tailor_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2,4,7,8]);n int:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('jobsheets',jsonb_build_object('item',p_item_id,'tailor',p_tailor_id));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;
BEGIN
 WITH scan AS MATERIALIZED(SELECT q.id,q.item_id,q.quantity_id,q.item_tailor_id,q.job_sheet_assign_date_id,q.assigned_quantity,q.completed_quantity,it.tailor_id,d.assign_at
  FROM sa_snapshot_20261019.sa_job_sheet_assign_quantities q JOIN sa_snapshot_20261019.sa_item_tailors it ON it.id=q.item_tailor_id
  JOIN sa_snapshot_20261019.sa_job_sheet_assign_dates d ON d.id=q.job_sheet_assign_date_id
  WHERE q.id<after_ AND (p_item_id IS NULL OR q.item_id=p_item_id) AND (p_tailor_id IS NULL OR it.tailor_id=p_tailor_id) ORDER BY q.id DESC LIMIT n+1),
 page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'item_id',item_id::text,'quantity_id',quantity_id::text,'item_tailor_id',item_tailor_id::text,
 'tailor_id',tailor_id::text,'assignment_id',job_sheet_assign_date_id::text,'assigned',assigned_quantity,'inspected',completed_quantity,'picked',completed_quantity,'occurred_at',assign_at AT TIME ZONE 'UTC') ORDER BY id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;RETURN r;
END $f$;
CREATE FUNCTION sa_domain.v1_tailor_work(p_item_id bigint DEFAULT NULL,p_tailor_id bigint DEFAULT NULL,p_history boolean DEFAULT false,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2,4,7,8]);n int:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('tailor_work',jsonb_build_object('item',p_item_id,'tailor',p_tailor_id,'history',p_history));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;
BEGIN
 WITH scan AS MATERIALIZED(
  SELECT q.id,it.item_id,it.tailor_id,q.id item_tailor_quantity_id,q.quantity_id,q.assigned_quantity assigned,q.completed_quantity inspected,NULL::timestamp occurred_at
  FROM sa_snapshot_20261019.sa_item_tailor_quantities q JOIN sa_snapshot_20261019.sa_item_tailors it ON it.id=q.item_tailor_id
  WHERE p_history IS FALSE AND q.id<after_ AND (p_item_id IS NULL OR it.item_id=p_item_id) AND (p_tailor_id IS NULL OR it.tailor_id=p_tailor_id)
  UNION ALL
  SELECT m.id,it.item_id,it.tailor_id,q.id,q.quantity_id,m.qty,m.completed_quantity,d.marked_at FROM sa_snapshot_20261019.sa_mark_tailor_quantities m
  JOIN sa_snapshot_20261019.sa_item_tailor_quantities q ON q.id=m.item_tailor_quantity_id JOIN sa_snapshot_20261019.sa_item_tailors it ON it.id=q.item_tailor_id
  JOIN sa_snapshot_20261019.sa_job_sheet_mark_tailors mt ON mt.id=m.job_sheet_mark_tailor_id JOIN sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d ON d.id=mt.job_sheet_tailor_mark_date_id
  WHERE p_history IS TRUE AND m.id<after_ AND (p_item_id IS NULL OR it.item_id=p_item_id) AND (p_tailor_id IS NULL OR it.tailor_id=p_tailor_id)
  ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'item_id',item_id::text,'tailor_id',tailor_id::text,'item_tailor_quantity_id',item_tailor_quantity_id::text,
 'quantity_id',quantity_id::text,CASE WHEN p_history THEN 'remaining_before' ELSE 'assigned' END,assigned,'inspected',inspected,'picked',inspected,'occurred_at',occurred_at AT TIME ZONE 'UTC') ORDER BY id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;RETURN r;
END $f$;

DO $do$ DECLARE f record;arguments_ text;body_ text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['v1_cutting_record','v1_jobsheet_assign','v1_jobsheet_inspect','v1_dispatch_record','v1_cutting_detail','v1_dispatch_detail','v1_cutting_queue','v1_dispatch_queue','v1_jobsheets_list','v1_tailor_work']) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO sa_executor',f.oid::regprocedure);
  SELECT string_agg(quote_ident(x),',') INTO arguments_ FROM unnest(f.proargnames) x;
  body_:=format('SELECT sa_domain.%I(%s)',f.proname,arguments_);
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE 'VOLATILE' END,body_);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.oid::regprocedure);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_app',f.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',f.proname,pg_get_function_identity_arguments(f.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s) TO sa_app',f.proname,pg_get_function_identity_arguments(f.oid));
 END LOOP;
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain'
 AND p.proname=ANY(ARRAY['work_timestamp','work_rows','assert_factory_work','assert_work_balances','recompute_item_progress','work_detail','work_queue']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app',f.oid::regprocedure);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_executor',f.oid::regprocedure);
 END LOOP;
END $do$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
