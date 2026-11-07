BEGIN;
-- The exclusive relationship fence already excludes concurrent business writes.
-- Validate all identities/versions and bump the selected versions in sets rather
-- than calling a live actor/lock helper once for every customer.
CREATE OR REPLACE FUNCTION sa_domain.reassign_customers(p_customers jsonb,p_coordinator_id bigint) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);x jsonb;ids_ bigint[]:='{}';orders_ bigint[];people_ jsonb;id_ bigint;generation_ bigint;
BEGIN
 IF p_customers IS NULL OR jsonb_typeof(p_customers)<>'array' OR jsonb_array_length(p_customers) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Choose 1..100 customers' USING ERRCODE='22023';END IF;
 PERFORM sa_domain.person_structure_fence();PERFORM sa_domain.work_person(p_coordinator_id,ARRAY[1]);
 FOR x IN SELECT * FROM jsonb_array_elements(p_customers) LOOP
  PERFORM sa_domain.check_fields(x,ARRAY['id','version']);id_:=sa_domain.input_id(x->'id');
  IF id_=ANY(ids_) OR x->>'version' IS NULL THEN RAISE EXCEPTION 'Distinct customers and exact versions are required' USING ERRCODE='22023';END IF;ids_:=array_append(ids_,id_);
 END LOOP;
 IF(SELECT count(*) FROM sa_snapshot_20261019.sa_users WHERE id=ANY(ids_) AND role IN(3,10) AND deleted_at IS NULL)<>cardinality(ids_) THEN RAISE EXCEPTION 'Customer unavailable' USING ERRCODE='P0002';END IF;
 SELECT generation INTO generation_ FROM sa_domain.runtime_state;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_customers) expected_row LEFT JOIN sa_domain.entity_versions v ON v.kind='person' AND v.entity_id=(expected_row->>'id')::bigint WHERE expected_row->>'version' IS DISTINCT FROM generation_::text||':'||coalesce(v.revision,0)::text) THEN RAISE EXCEPTION 'Customer changed; reload and retry' USING ERRCODE='40001';END IF;
 SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO orders_ FROM(SELECT id FROM sa_snapshot_20261019.sa_orders WHERE customer_id=ANY(ids_) AND status=0 AND uc_status IS DISTINCT FROM 'CANCELLED' AND is_deleted IS NOT TRUE AND deleted_at IS NULL AND customer_sc_id IS DISTINCT FROM p_coordinator_id ORDER BY id LIMIT 1001) s;
 IF cardinality(orders_)>1000 THEN RAISE EXCEPTION 'More than 1000 pending orders; split the customer selection or use the reconciliation job' USING ERRCODE='54000';END IF;
 INSERT INTO sa_domain.entity_versions(kind,entity_id,revision) SELECT 'person',unnest(ids_),1 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=sa_domain.entity_versions.revision+1;
 SELECT jsonb_agg(jsonb_build_object('id',u.id::text,'version',generation_::text||':'||v.revision::text,'previous_coordinator_id',u.created_by_id::text,'coordinator_id',p_coordinator_id::text) ORDER BY u.id) INTO people_
 FROM sa_snapshot_20261019.sa_users u JOIN sa_domain.entity_versions v ON v.kind='person' AND v.entity_id=u.id WHERE u.id=ANY(ids_);
 INSERT INTO sa_domain.entity_versions(kind,entity_id,revision) SELECT 'order',unnest(orders_),1 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=sa_domain.entity_versions.revision+1;
 UPDATE sa_snapshot_20261019.sa_orders SET customer_sc_id=p_coordinator_id,updated_at=now() AT TIME ZONE 'UTC' WHERE id=ANY(orders_);
 UPDATE sa_snapshot_20261019.sa_users SET created_by_id=p_coordinator_id,updated_at=now() AT TIME ZONE 'UTC' WHERE id=ANY(ids_);
 RETURN jsonb_build_object('people',people_,'updated_pending_orders',cardinality(orders_),'completed_history_preserved',true);
END $f$;
COMMIT;
