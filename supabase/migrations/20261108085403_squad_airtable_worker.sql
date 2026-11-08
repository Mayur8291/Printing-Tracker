BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_worker,sa_media_writer;
CREATE FUNCTION sa_domain.airtable_capture_page(p_transfer uuid,p_input jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE t sa_domain.airtable_tables;run_ sa_domain.airtable_runs;spec jsonb;r jsonb;field_ text;v jsonb;id_ bigint;digest_ text;old_ sa_domain.airtable_pages;bytes_ bigint;count_ integer;category_ text;derived_ integer:=0;added_ integer;
BEGIN
 PERFORM sa_domain.check_fields(p_input,ARRAY['resource','offset','next_offset','records','eof']);
 IF jsonb_typeof(p_input->'records') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'records')>100 OR jsonb_typeof(p_input->'eof') IS DISTINCT FROM 'boolean'
 OR (p_input->>'offset' IS NOT NULL AND length(p_input->>'offset') NOT BETWEEN 1 AND 2048) OR(p_input->>'next_offset' IS NOT NULL AND length(p_input->>'next_offset') NOT BETWEEN 1 AND 2048)
 OR(p_input->>'eof')::boolean IS DISTINCT FROM(p_input->>'next_offset' IS NULL) THEN RAISE EXCEPTION 'AIRTABLE_INVALID_OFFSET' USING ERRCODE='22023';END IF;
 SELECT * INTO t FROM sa_domain.airtable_tables WHERE transfer_id=p_transfer AND resource=p_input->>'resource' FOR UPDATE;
 IF t.resource IS NULL THEN RAISE EXCEPTION 'AIRTABLE_INVALID_RESOURCE' USING ERRCODE='22023';END IF;
 digest_:=encode(sha256(convert_to(p_input::text,'UTF8')),'hex');
 SELECT * INTO old_ FROM sa_domain.airtable_pages WHERE transfer_id=p_transfer AND resource=t.resource AND offset_token=coalesce(p_input->>'offset','');
 IF old_.digest IS NOT NULL THEN IF old_.digest<>digest_ THEN RAISE EXCEPTION 'AIRTABLE_CAPTURE_CONFLICT' USING ERRCODE='40001';END IF;RETURN;END IF;
 IF t.complete OR t.offset_token IS DISTINCT FROM p_input->>'offset' OR EXISTS(SELECT FROM sa_domain.airtable_pages WHERE transfer_id=p_transfer AND resource=t.resource AND offset_token=p_input->>'next_offset') OR p_input->>'next_offset'=p_input->>'offset' THEN RAISE EXCEPTION 'AIRTABLE_INVALID_OFFSET' USING ERRCODE='22023';END IF;
 SELECT * INTO run_ FROM sa_domain.airtable_runs WHERE transfer_id=p_transfer FOR UPDATE;IF run_.phase<>'capture' THEN RAISE EXCEPTION 'AIRTABLE_INVALID_PHASE' USING ERRCODE='55000';END IF;
 bytes_:=octet_length((p_input->'records')::text);count_:=jsonb_array_length(p_input->'records');
 IF run_.capture_rows+count_>200000 OR t.row_count+count_>150000 OR run_.capture_bytes+bytes_>268435456 THEN RAISE EXCEPTION 'AIRTABLE_RESPONSE_LIMIT' USING ERRCODE='54000';END IF;
 SELECT contract INTO spec FROM sa_domain.airtable_resources WHERE resource=t.resource;
 FOR r IN SELECT value FROM jsonb_array_elements(p_input->'records') LOOP
  PERFORM sa_domain.check_fields(r,ARRAY['airtable_id','attributes','references','relations','media']);
  IF r->>'airtable_id' IS NULL OR r->>'airtable_id'!~'^rec[A-Za-z0-9]{14}$' OR jsonb_typeof(r->'attributes') IS DISTINCT FROM 'object' OR jsonb_typeof(r->'references') IS DISTINCT FROM 'object' OR jsonb_typeof(r->'relations') IS DISTINCT FROM 'object' OR jsonb_typeof(r->'media') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'AIRTABLE_INVALID_RECORD' USING ERRCODE='22023';END IF;
  IF(SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(r->'attributes')key) IS DISTINCT FROM(SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(spec->'fields')key)
  OR(SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(r->'references')key) IS DISTINCT FROM(SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(coalesce(spec->'references','{}'))key)
  OR(SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(r->'relations')key) IS DISTINCT FROM(SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(coalesce(spec->'relations','{}'))key)
  OR(SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(r->'media')key) IS DISTINCT FROM(SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(coalesce(spec->'media','{}'))key) THEN RAISE EXCEPTION 'AIRTABLE_INVALID_RECORD' USING ERRCODE='22023';END IF;
  FOR field_,v IN SELECT * FROM jsonb_each(r->'attributes') LOOP
   IF jsonb_typeof(v) NOT IN('null','string','number','boolean') OR octet_length(v::text)>65536 THEN RAISE EXCEPTION 'AIRTABLE_INVALID_RECORD' USING ERRCODE='22023';END IF;
  END LOOP;
  FOR field_,v IN SELECT * FROM jsonb_each(r->'references') LOOP
   PERFORM sa_domain.check_fields(v,ARRAY['resource','airtable_id']);
   IF v->>'resource' IS DISTINCT FROM spec->'references'->field_->>'resource' OR(v->>'airtable_id' IS NOT NULL AND v->>'airtable_id'!~'^rec[A-Za-z0-9]{14}$') THEN RAISE EXCEPTION 'AIRTABLE_INVALID_REFERENCE' USING ERRCODE='22023';END IF;
  END LOOP;
  FOR field_,v IN SELECT * FROM jsonb_each(r->'relations') LOOP
   IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>1000 OR EXISTS(SELECT FROM jsonb_array_elements(v)x WHERE jsonb_typeof(x)<>'string' OR CASE WHEN field_='categories' THEN length(btrim(x#>>'{}')) NOT BETWEEN 1 AND 255 ELSE (x#>>'{}')!~'^rec[A-Za-z0-9]{14}$' END) OR(SELECT count(DISTINCT x) FROM jsonb_array_elements(v)x)<>jsonb_array_length(v) THEN RAISE EXCEPTION 'AIRTABLE_INVALID_REFERENCE' USING ERRCODE='22023';END IF;
  END LOOP;
  INSERT INTO sa_domain.airtable_rows(transfer_id,resource,airtable_id,attributes,references_,relations,media) VALUES(p_transfer,t.resource,r->>'airtable_id',r->'attributes',r->'references',r->'relations',r->'media') RETURNING id INTO id_;
  FOR field_,v IN SELECT * FROM jsonb_each(r->'media') LOOP
   IF v='null'::jsonb THEN CONTINUE;END IF;
   PERFORM sa_domain.check_fields(v,ARRAY['id','url','filename','bytes','mime','variant']);
   IF jsonb_typeof(v)<>'object' OR v->>'id' IS NULL OR v->>'id'!~'^att[A-Za-z0-9]{14}$' OR v->>'variant' IS DISTINCT FROM spec->'media'->field_->>'variant'
   OR v->>'url' IS NULL OR v->>'url'!~'^https://([A-Za-z0-9-]+\.)*airtableusercontent\.com/' OR length(v->>'url')>8192 OR length(v->>'filename')>1024 OR length(v->>'mime') NOT BETWEEN 1 AND 100 OR v->>'bytes' IS NULL OR v->>'bytes'!~'^[0-9]+$' OR(v->>'bytes')::numeric NOT BETWEEN 1 AND 1073741824 THEN RAISE EXCEPTION 'AIRTABLE_INVALID_MEDIA' USING ERRCODE='22023';END IF;
   INSERT INTO sa_domain.airtable_assets(row_id,field,attachment) VALUES(id_,field_,v);
  END LOOP;
  IF t.resource='base_products' THEN
   FOR category_ IN SELECT DISTINCT btrim(value) FROM jsonb_array_elements_text(r->'relations'->'categories') LOOP
    INSERT INTO sa_domain.airtable_rows(transfer_id,resource,airtable_id,attributes,references_,relations,media) VALUES(p_transfer,'categories','cat:'||encode(sha256(convert_to(lower(category_),'UTF8')),'hex'),jsonb_build_object('name',category_),'{}','{}','{}') ON CONFLICT(transfer_id,resource,airtable_id) DO NOTHING;GET DIAGNOSTICS added_=ROW_COUNT;derived_:=derived_+added_;
   END LOOP;
  END IF;
 END LOOP;
 IF run_.capture_rows+count_+derived_>200000 THEN RAISE EXCEPTION 'AIRTABLE_RESPONSE_LIMIT' USING ERRCODE='54000';END IF;
 INSERT INTO sa_domain.airtable_pages VALUES(p_transfer,t.resource,coalesce(p_input->>'offset',''),digest_,p_input->>'next_offset',(p_input->>'eof')::boolean);
 UPDATE sa_domain.airtable_tables SET offset_token=p_input->>'next_offset',complete=(p_input->>'eof')::boolean,row_count=row_count+count_ WHERE transfer_id=p_transfer AND resource=t.resource;
 UPDATE sa_domain.airtable_runs SET capture_rows=capture_rows+count_+derived_,capture_bytes=capture_bytes+bytes_ WHERE transfer_id=p_transfer;
 UPDATE sa_domain.transfers SET total_rows=total_rows+count_,revision=revision+1 WHERE id=p_transfer;
 IF NOT EXISTS(SELECT FROM sa_domain.airtable_tables WHERE transfer_id=p_transfer AND NOT complete) THEN
  UPDATE sa_domain.airtable_runs SET phase='media',captured_at=now() WHERE transfer_id=p_transfer;
  UPDATE sa_domain.transfers SET total_rows=(SELECT count(*) FROM sa_domain.airtable_rows WHERE transfer_id=p_transfer) WHERE id=p_transfer;
 END IF;
END $f$;
ALTER FUNCTION sa_domain.airtable_capture_page(uuid,jsonb) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.airtable_match_row(p_row bigint) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE r sa_domain.airtable_rows;spec jsonb;candidate jsonb;v jsonb;field_ text;target_ text;id_ bigint;n bigint;refs jsonb:='{}';started_ timestamptz;
BEGIN
 SELECT * INTO r FROM sa_domain.airtable_rows WHERE id=p_row;SELECT c.spec INTO spec FROM sa_admin.master_contracts c WHERE c.resource=r.resource;
 SELECT created_at INTO started_ FROM sa_domain.transfers WHERE id=r.transfer_id;
 IF r.resource='categories' THEN
  SELECT count(*),min(id) INTO n,id_ FROM sa_snapshot_20261019.sa_categories WHERE lower(name)=lower(r.attributes->>'name');
 ELSIF r.resource='base_product_asset_infos' THEN
  FOR field_,v IN SELECT * FROM jsonb_each(r.references_) LOOP
   SELECT coalesce(target_id,-id) INTO id_ FROM sa_domain.airtable_rows WHERE transfer_id=r.transfer_id AND resource=v->>'resource' AND airtable_id=v->>'airtable_id';
   IF id_ IS NULL THEN RAISE EXCEPTION 'AIRTABLE_REFERENCE_MISSING' USING ERRCODE='23503';END IF;refs:=refs||jsonb_build_object(field_,id_);
  END LOOP;
  SELECT count(*),min(id) INTO n,id_ FROM sa_snapshot_20261019.sa_base_product_asset_infos WHERE base_product_id=(refs->>'base_product_id')::bigint AND asset_info_id=(refs->>'asset_info_id')::bigint AND add_on_id=(refs->>'add_on_id')::bigint AND part_id=(refs->>'part_id')::bigint;
 ELSE
  EXECUTE format('SELECT count(*),min(id) FROM sa_snapshot_20261019.%I WHERE airtable_id=$1','sa_'||r.resource) INTO n,id_ USING r.airtable_id;
  IF n=0 AND r.resource IN('base_products','parts','add_ons') THEN
   field_:=CASE WHEN r.resource='add_ons' THEN 'add_on' ELSE 'name' END;
   EXECUTE format('SELECT count(*),min(s.id) FROM sa_snapshot_20261019.%I s WHERE source=0 AND lower(s.%I)=lower($1) AND(airtable_id IS NULL OR NOT EXISTS(SELECT FROM sa_domain.airtable_rows c WHERE c.transfer_id=$2 AND c.resource=$3 AND c.airtable_id=s.airtable_id))','sa_'||r.resource,field_) INTO n,id_ USING r.attributes->>field_,r.transfer_id,r.resource;
  END IF;
 END IF;
 IF n>1 THEN RAISE EXCEPTION 'AIRTABLE_IDENTITY_AMBIGUOUS' USING ERRCODE='23505';END IF;
 IF id_ IS NOT NULL THEN
  EXECUTE format('SELECT to_jsonb(s) FROM sa_snapshot_20261019.%I s WHERE id=$1','sa_'||r.resource) INTO candidate USING id_;
  IF r.resource<>'categories' AND(candidate->>'source')::integer IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'AIRTABLE_SOURCE_CONFLICT' USING ERRCODE='42501';END IF;
  IF r.resource='colors' AND candidate->>'created_by_id' IS NOT NULL THEN RAISE EXCEPTION 'AIRTABLE_SOURCE_CONFLICT' USING ERRCODE='42501';END IF;
  IF(candidate->>'updated_at')::timestamptz>started_ THEN RAISE EXCEPTION 'AIRTABLE_RECORD_CHANGED' USING ERRCODE='40001';END IF;
 END IF;
 UPDATE sa_domain.airtable_rows SET target_id=id_,expected_version=candidate->>'updated_at',state='matched' WHERE id=r.id;
END $f$;
ALTER FUNCTION sa_domain.airtable_match_row(bigint) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.airtable_values(p_row bigint,p_virtual boolean) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE r sa_domain.airtable_rows;v jsonb;out_ jsonb;field_ text;id_ bigint;count_ bigint;a sa_domain.airtable_assets;size_ numeric;
BEGIN
 SELECT * INTO r FROM sa_domain.airtable_rows WHERE id=p_row;out_:=r.attributes;
 IF r.resource<>'categories' THEN out_:=out_||'{"is_deleted":false}'::jsonb;END IF;
 FOR field_,v IN SELECT * FROM jsonb_each(r.references_) LOOP
  id_:=NULL;
  IF v->>'airtable_id' IS NOT NULL THEN
   SELECT CASE WHEN p_virtual THEN coalesce(target_id,-id) ELSE target_id END INTO id_ FROM sa_domain.airtable_rows WHERE transfer_id=r.transfer_id AND resource=v->>'resource' AND airtable_id=v->>'airtable_id' AND state NOT IN('invalid','failed');
   IF id_ IS NULL THEN RAISE EXCEPTION 'AIRTABLE_REFERENCE_MISSING' USING ERRCODE='23503';END IF;
  END IF;
  out_:=out_||jsonb_build_object(field_,id_);
 END LOOP;
 IF r.resource='rmp_price_types' THEN
  IF out_->>'price_for' IS NULL OR out_->>'price_for' NOT IN('customer','dealer','zone') THEN out_:=out_||'{"price_for":"customer"}'::jsonb;END IF;
  id_:=NULL;
  IF out_->>'price_for'='zone' THEN SELECT count(*),min(id) INTO count_,id_ FROM sa_snapshot_20261019.sa_zones WHERE name=out_->>'name';IF count_>1 THEN RAISE EXCEPTION 'AIRTABLE_ZONE_AMBIGUOUS' USING ERRCODE='23505';END IF;END IF;
  out_:=out_||jsonb_build_object('zone_id',id_);
 ELSIF r.resource='promotions' THEN
  SELECT * INTO a FROM sa_domain.airtable_assets WHERE row_id=r.id AND field='thumbnail' AND state='ready';
  size_:=(a.manifest->>'bytes')::numeric;
  out_:=out_||jsonb_build_object('file_size',CASE WHEN size_ IS NULL THEN 'N/A' WHEN size_<1024 THEN size_::bigint::text||' Bytes' WHEN size_<1048576 THEN round(size_/1024,2)::text||' KB' ELSE round(size_/1048576,2)::text||' MB' END);
 END IF;
 RETURN out_;
END $f$;
ALTER FUNCTION sa_domain.airtable_values(bigint,boolean) OWNER TO sa_worker;
CREATE FUNCTION sa_domain.airtable_call_master(p_transfer uuid,p_row bigint,p_resource text,p_action text,p_payload jsonb,p_dry boolean,p_airtable_id text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE w sa_domain.worker_context;r jsonb;
BEGIN
 SELECT * INTO w FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 INSERT INTO sa_domain.airtable_master_context VALUES(pg_backend_pid(),txid_current(),w.job_id,w.lease_token,p_transfer,p_row,p_resource,p_action,p_dry,sha256(convert_to(p_payload::text,'UTF8')),p_airtable_id);
 r:=sa_admin.master_request(p_resource,CASE WHEN p_dry THEN 'validate_' ELSE '' END||p_action,p_payload);
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.airtable_call_master(uuid,bigint,text,text,jsonb,boolean,text) OWNER TO sa_worker;
CREATE FUNCTION sa_domain.airtable_clear_context() RETURNS void LANGUAGE sql SET search_path=pg_catalog AS $f$ DELETE FROM sa_domain.airtable_master_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() $f$;
ALTER FUNCTION sa_domain.airtable_clear_context() OWNER TO sa_worker;

CREATE FUNCTION sa_domain.airtable_validate_batch(p_transfer uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE r sa_domain.airtable_rows;run_ sa_domain.airtable_runs;spec jsonb;data_ jsonb;payload_ jsonb;v jsonb;keys_ jsonb;field_ text;target_ text;item_ text;id_ bigint;code_ text;n integer:=0;tab_ sa_domain.airtable_tables;max_ bigint;rows_ integer;
BEGIN
 SELECT * INTO run_ FROM sa_domain.airtable_runs WHERE transfer_id=p_transfer;
 IF run_.phase='match' THEN
  FOR r IN SELECT x.* FROM sa_domain.airtable_rows x LEFT JOIN sa_domain.airtable_resources s USING(resource) WHERE x.transfer_id=p_transfer AND x.state='captured' ORDER BY coalesce(s.priority,0),x.id LIMIT 100 LOOP
   BEGIN PERFORM sa_domain.airtable_match_row(r.id);
   EXCEPTION WHEN unique_violation OR check_violation OR foreign_key_violation OR insufficient_privilege OR serialization_failure THEN
    GET STACKED DIAGNOSTICS code_=RETURNED_SQLSTATE;
    UPDATE sa_domain.airtable_rows SET state='invalid',errors=jsonb_build_array(jsonb_build_object('code',code_)) WHERE id=r.id;
   END;
  END LOOP;
  IF NOT EXISTS(SELECT FROM sa_domain.airtable_rows WHERE transfer_id=p_transfer AND state='captured') THEN UPDATE sa_domain.airtable_runs SET phase='validate' WHERE transfer_id=p_transfer;END IF;
  RETURN false;
 END IF;
 IF EXISTS(SELECT FROM sa_domain.airtable_rows WHERE transfer_id=p_transfer AND state='matched') THEN
  FOR r IN SELECT x.* FROM sa_domain.airtable_rows x LEFT JOIN sa_domain.airtable_resources s USING(resource) WHERE x.transfer_id=p_transfer AND x.state='matched' ORDER BY coalesce(s.priority,0),x.id LIMIT 100 LOOP
   BEGIN
    SELECT c.spec INTO spec FROM sa_admin.master_contracts c WHERE resource=r.resource;data_:=sa_domain.airtable_values(r.id,true);
    keys_:='[]';
    FOR field_,v IN SELECT * FROM jsonb_each(CASE WHEN r.resource='categories' THEN '{"name":true}'::jsonb ELSE spec->'unique' END) LOOP
     IF data_->>field_ IS NOT NULL THEN keys_:=keys_||jsonb_build_array(r.resource||':'||field_||':'||CASE WHEN v='true'::jsonb THEN lower(data_->>field_) ELSE data_->>field_ END);END IF;
    END LOOP;
    UPDATE sa_domain.airtable_rows SET unique_keys=keys_ WHERE id=r.id;
    IF EXISTS(SELECT FROM sa_domain.airtable_rows x WHERE x.transfer_id=p_transfer AND x.id<>r.id AND x.unique_keys?|ARRAY(SELECT jsonb_array_elements_text(keys_))) THEN
     UPDATE sa_domain.airtable_rows SET state='invalid',errors='[{"code":"DUPLICATE_VALUE"}]' WHERE transfer_id=p_transfer AND unique_keys?|ARRAY(SELECT jsonb_array_elements_text(keys_));CONTINUE;
    END IF;
    FOR target_,v IN SELECT * FROM jsonb_each(r.relations) LOOP
     FOR item_ IN SELECT jsonb_array_elements_text(v) LOOP
      SELECT id INTO id_ FROM sa_domain.airtable_rows WHERE transfer_id=p_transfer AND resource=target_ AND airtable_id=CASE WHEN target_='categories' THEN 'cat:'||encode(sha256(convert_to(lower(btrim(item_)),'UTF8')),'hex') ELSE item_ END AND state NOT IN('invalid','failed');
      IF id_ IS NULL THEN RAISE EXCEPTION 'AIRTABLE_REFERENCE_MISSING' USING ERRCODE='23503';END IF;
     END LOOP;
    END LOOP;
    payload_:=jsonb_build_object('values',data_);
    IF r.target_id IS NOT NULL THEN payload_:=payload_||jsonb_build_object('id',r.target_id,'expectedUpdatedAt',r.expected_version);END IF;
    PERFORM sa_domain.airtable_call_master(p_transfer,r.id,r.resource,CASE WHEN r.target_id IS NULL THEN 'create' ELSE 'update' END,payload_,true,r.airtable_id);
    PERFORM sa_domain.airtable_clear_context();UPDATE sa_domain.airtable_rows SET state='valid',values_=data_ WHERE id=r.id;
    IF r.resource='rmp_sizes' THEN
     IF EXISTS(SELECT FROM sa_snapshot_20261019.sa_sizes WHERE lower(name)=lower(data_->>'name') AND updated_at>(SELECT created_at FROM sa_domain.transfers WHERE id=p_transfer)) THEN RAISE EXCEPTION 'Canonical size changed' USING ERRCODE='40001';END IF;
     UPDATE sa_domain.airtable_rows SET side_effects=jsonb_build_object('sizes',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'version',updated_at::text)),'[]') FROM sa_snapshot_20261019.sa_sizes WHERE lower(name)=lower(data_->>'name'))) WHERE id=r.id;
    END IF;
   EXCEPTION WHEN data_exception OR integrity_constraint_violation OR insufficient_privilege OR serialization_failure OR SQLSTATE 'PT409' OR no_data_found THEN
    GET STACKED DIAGNOSTICS code_=RETURNED_SQLSTATE;
    PERFORM sa_domain.airtable_clear_context();UPDATE sa_domain.airtable_rows SET state='invalid',errors=jsonb_build_array(jsonb_build_object('code',code_)) WHERE id=r.id;
   END;
  END LOOP;
  RETURN false;
 END IF;
 -- Capture only pre-existing source-0 retirement candidates. Newly created or
 -- concurrently edited records are never inferred to be missing and discarded.
 SELECT x.* INTO tab_ FROM sa_domain.airtable_tables x JOIN sa_domain.airtable_resources s USING(resource) WHERE x.transfer_id=p_transfer AND NOT x.candidates_complete ORDER BY s.priority LIMIT 1;
 IF tab_.resource IS NOT NULL THEN
  EXECUTE format('WITH page AS MATERIALIZED(SELECT id,updated_at FROM sa_snapshot_20261019.%I WHERE id>$1 ORDER BY id LIMIT 500), candidates AS(SELECT p.* FROM page p JOIN sa_snapshot_20261019.%I s USING(id) WHERE s.source=0 AND s.is_deleted IS NOT TRUE %s AND s.updated_at<=(SELECT created_at FROM sa_domain.transfers WHERE id=$2) AND NOT EXISTS(SELECT FROM sa_domain.airtable_rows r WHERE r.transfer_id=$2 AND r.resource=$3 AND r.target_id=s.id)), inserted AS(INSERT INTO sa_domain.airtable_retirements(transfer_id,resource,record_id,expected_version) SELECT $2,$3,id,updated_at::text FROM candidates ON CONFLICT DO NOTHING RETURNING record_id) SELECT count(*),max(id) FROM page','sa_'||tab_.resource,'sa_'||tab_.resource,CASE WHEN tab_.resource='colors' THEN 'AND s.created_by_id IS NULL' ELSE '' END) INTO rows_,max_ USING tab_.candidate_cursor,p_transfer,tab_.resource;
  UPDATE sa_domain.airtable_tables SET candidate_cursor=coalesce(max_,candidate_cursor),candidates_complete=rows_<500 WHERE transfer_id=p_transfer AND resource=tab_.resource;
  RETURN false;
 END IF;
 RETURN true;
END $f$;
ALTER FUNCTION sa_domain.airtable_validate_batch(uuid) OWNER TO sa_worker;
CREATE FUNCTION sa_domain.airtable_apply_batch(p_transfer uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE phase_ text;r sa_domain.airtable_rows;ret_ sa_domain.airtable_retirements;data_ jsonb;relations_ jsonb;payload_ jsonb;result_ jsonb;target_ text;ids_ jsonb;item_ text;id_ bigint;version_ text;code_ text;classes_ bigint[];
BEGIN
 SELECT phase INTO phase_ FROM sa_domain.airtable_runs WHERE transfer_id=p_transfer;
 IF phase_='apply_scalar' THEN
  FOR r IN SELECT x.* FROM sa_domain.airtable_rows x LEFT JOIN sa_domain.airtable_resources s USING(resource) WHERE x.transfer_id=p_transfer AND x.state='valid' ORDER BY coalesce(s.priority,0),x.id LIMIT 100 LOOP
   BEGIN
    -- Existing derived categories are reused without renaming shared records.
    IF r.resource='categories' AND r.target_id IS NOT NULL THEN UPDATE sa_domain.airtable_rows SET state='scalar' WHERE id=r.id;CONTINUE;END IF;
    data_:=sa_domain.airtable_values(r.id,false);payload_:=jsonb_build_object('values',data_);
    IF r.target_id IS NOT NULL THEN payload_:=payload_||jsonb_build_object('id',r.target_id,'expectedUpdatedAt',r.expected_version);END IF;
    result_:=sa_domain.airtable_call_master(p_transfer,r.id,r.resource,CASE WHEN r.target_id IS NULL THEN 'create' ELSE 'update' END,payload_,false,r.airtable_id);id_:=(result_->>'id')::bigint;
    UPDATE sa_domain.airtable_rows SET target_id=id_,values_=data_ WHERE id=r.id;
    PERFORM sa_domain.airtable_media_apply(r.id,id_);
    IF r.resource='rmp_sizes' THEN PERFORM sa_domain.airtable_size_position(r.id);END IF;
    EXECUTE format('SELECT updated_at::text FROM sa_snapshot_20261019.%I WHERE id=$1','sa_'||r.resource) INTO version_ USING id_;
    UPDATE sa_domain.airtable_rows SET state='scalar',expected_version=version_ WHERE id=r.id;
    PERFORM sa_domain.airtable_clear_context();
   EXCEPTION WHEN data_exception OR integrity_constraint_violation OR insufficient_privilege OR serialization_failure OR SQLSTATE 'PT409' OR no_data_found OR object_not_in_prerequisite_state THEN
    GET STACKED DIAGNOSTICS code_=RETURNED_SQLSTATE;PERFORM sa_domain.airtable_clear_context();
    UPDATE sa_domain.airtable_rows SET state='failed',errors=jsonb_build_array(jsonb_build_object('code',code_)) WHERE id=r.id;
    UPDATE sa_domain.transfers SET state='failed',error_code='AIRTABLE_APPLY_CONFLICT',completed_at=now(),revision=revision+1 WHERE id=p_transfer;RETURN false;
   END;
  END LOOP;
  IF NOT EXISTS(SELECT FROM sa_domain.airtable_rows WHERE transfer_id=p_transfer AND state='valid') THEN UPDATE sa_domain.airtable_runs SET phase='apply_relations' WHERE transfer_id=p_transfer;END IF;
 ELSIF phase_='apply_relations' THEN
  FOR r IN SELECT * FROM sa_domain.airtable_rows WHERE transfer_id=p_transfer AND state='scalar' ORDER BY id LIMIT 100 LOOP
   BEGIN
    relations_:='{}';
    FOR target_,ids_ IN SELECT * FROM jsonb_each(r.relations) LOOP
     SELECT coalesce(jsonb_agg(x.target_id ORDER BY x.target_id),'[]') INTO result_ FROM jsonb_array_elements_text(ids_)v JOIN sa_domain.airtable_rows x ON x.transfer_id=p_transfer AND x.resource=target_ AND x.airtable_id=CASE WHEN target_='categories' THEN 'cat:'||encode(sha256(convert_to(lower(btrim(v)),'UTF8')),'hex') ELSE v END AND x.target_id IS NOT NULL AND x.state IN('scalar','applied');
     IF jsonb_array_length(result_)<>jsonb_array_length(ids_) THEN RAISE EXCEPTION 'AIRTABLE_REFERENCE_MISSING' USING ERRCODE='23503';END IF;
     relations_:=relations_||jsonb_build_object(target_,result_);
    END LOOP;
    IF relations_<>'{}'::jsonb THEN
     payload_:=jsonb_build_object('id',r.target_id,'expectedUpdatedAt',r.expected_version,'relations',relations_);
     PERFORM sa_domain.airtable_call_master(p_transfer,r.id,r.resource,'relations',payload_,false,r.airtable_id);PERFORM sa_domain.airtable_clear_context();
    END IF;
    UPDATE sa_domain.airtable_rows SET state='applied' WHERE id=r.id;
   EXCEPTION WHEN data_exception OR integrity_constraint_violation OR insufficient_privilege OR serialization_failure OR SQLSTATE 'PT409' OR no_data_found THEN
    GET STACKED DIAGNOSTICS code_=RETURNED_SQLSTATE;PERFORM sa_domain.airtable_clear_context();
    UPDATE sa_domain.airtable_rows SET state='failed',errors=jsonb_build_array(jsonb_build_object('code',code_)) WHERE id=r.id;
    UPDATE sa_domain.transfers SET state='failed',error_code='AIRTABLE_APPLY_CONFLICT',completed_at=now(),revision=revision+1 WHERE id=p_transfer;RETURN false;
   END;
  END LOOP;
  IF NOT EXISTS(SELECT FROM sa_domain.airtable_rows WHERE transfer_id=p_transfer AND state='scalar') THEN UPDATE sa_domain.airtable_runs SET phase='retire' WHERE transfer_id=p_transfer;END IF;
 ELSIF phase_='retire' THEN
  FOR ret_ IN SELECT * FROM sa_domain.airtable_retirements WHERE transfer_id=p_transfer AND NOT applied ORDER BY resource,record_id LIMIT 100 LOOP
   BEGIN
    payload_:=jsonb_build_object('id',ret_.record_id,'expectedUpdatedAt',ret_.expected_version);
    PERFORM sa_domain.airtable_call_master(p_transfer,NULL,ret_.resource,'delete',payload_,false,NULL);PERFORM sa_domain.airtable_clear_context();
    UPDATE sa_domain.airtable_retirements SET applied=true WHERE transfer_id=p_transfer AND resource=ret_.resource AND record_id=ret_.record_id;
   EXCEPTION WHEN data_exception OR integrity_constraint_violation OR insufficient_privilege OR serialization_failure OR SQLSTATE 'PT409' OR no_data_found THEN
    GET STACKED DIAGNOSTICS code_=RETURNED_SQLSTATE;PERFORM sa_domain.airtable_clear_context();
    UPDATE sa_domain.transfers SET state='failed',error_code='AIRTABLE_RETIREMENT_CONFLICT',result=result||jsonb_build_object('retirement_error',jsonb_build_object('resource',ret_.resource,'record_id',ret_.record_id::text,'code',code_)),completed_at=now(),revision=revision+1 WHERE id=p_transfer;RETURN false;
   END;
  END LOOP;
  IF NOT EXISTS(SELECT FROM sa_domain.airtable_retirements WHERE transfer_id=p_transfer AND NOT applied) THEN UPDATE sa_domain.airtable_runs SET phase='statistics' WHERE transfer_id=p_transfer;END IF;
 ELSIF phase_='statistics' THEN
  SELECT array_agg(class_id) INTO classes_ FROM(SELECT class_id FROM sa_domain.airtable_statistics WHERE transfer_id=p_transfer AND NOT applied ORDER BY class_id LIMIT 10)x;
  IF classes_ IS NOT NULL THEN PERFORM sa_admin.refresh_min_stats(classes_);UPDATE sa_domain.airtable_statistics SET applied=true WHERE transfer_id=p_transfer AND class_id=ANY(classes_);END IF;
  IF NOT EXISTS(SELECT FROM sa_domain.airtable_statistics WHERE transfer_id=p_transfer AND NOT applied) THEN UPDATE sa_domain.airtable_runs SET phase='done' WHERE transfer_id=p_transfer;RETURN true;END IF;
 ELSE RAISE EXCEPTION 'AIRTABLE_INVALID_PHASE' USING ERRCODE='55000';
 END IF;
 UPDATE sa_domain.transfers SET applied_rows=(SELECT count(*) FROM sa_domain.airtable_rows WHERE transfer_id=p_transfer AND state IN('scalar','applied')),revision=revision+1 WHERE id=p_transfer;
 RETURN false;
END $f$;
ALTER FUNCTION sa_domain.airtable_apply_batch(uuid) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.airtable_input(p_transfer uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE run_ sa_domain.airtable_runs;r jsonb;BEGIN
 SELECT * INTO run_ FROM sa_domain.airtable_runs WHERE transfer_id=p_transfer;
 IF run_.phase='capture' THEN
  SELECT jsonb_build_object('phase','capture','resource',t.resource,'offset',t.offset_token) INTO r FROM sa_domain.airtable_tables t JOIN sa_domain.airtable_resources s USING(resource) WHERE transfer_id=p_transfer AND NOT complete ORDER BY s.priority LIMIT 1;
 ELSIF run_.phase='media' THEN
  SELECT jsonb_build_object('phase','media','bucket','canto-media','assets',jsonb_agg(jsonb_build_object('asset_id',a.id,'resource',r.resource,'airtable_id',r.airtable_id,'field',a.field,'attachment',a.attachment) ORDER BY a.id)) INTO r
  FROM(SELECT a.* FROM sa_domain.airtable_assets a JOIN sa_domain.airtable_rows r ON r.id=a.row_id WHERE r.transfer_id=p_transfer AND a.state='pending' ORDER BY a.id LIMIT 2)a JOIN sa_domain.airtable_rows r ON r.id=a.row_id;
  IF r->'assets'='null'::jsonb THEN
   UPDATE sa_domain.airtable_rows x SET state='invalid',errors='[{"code":"AIRTABLE_MEDIA_FAILED"}]' WHERE transfer_id=p_transfer AND EXISTS(SELECT FROM sa_domain.airtable_assets a WHERE a.row_id=x.id AND a.state='failed');
   UPDATE sa_domain.airtable_runs SET phase='match' WHERE transfer_id=p_transfer;r:='{"phase":"validate"}';
  END IF;
 ELSIF run_.phase IN('match','validate') THEN r:='{"phase":"validate"}';
 ELSIF run_.phase IN('apply_scalar','apply_relations','retire','statistics') THEN r:=jsonb_build_object('phase','apply','step',run_.phase);
 ELSE RETURN jsonb_build_object('state','done');END IF;
 RETURN r||jsonb_build_object('state','ready','transfer_id',p_transfer,'generation',(SELECT generation::text FROM sa_domain.transfers WHERE id=p_transfer));
END $f$;
ALTER FUNCTION sa_domain.airtable_input(uuid) OWNER TO sa_worker;

-- Failed/cancelled partial imports still recompute the derived minima for
-- committed price changes. This system continuation cannot apply captured CRUD.
CREATE FUNCTION sa_domain.airtable_queue_statistics(p_transfer uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE t sa_domain.transfers;BEGIN
 SELECT * INTO t FROM sa_domain.transfers WHERE id=p_transfer AND kind='airtable' AND generation=(SELECT generation FROM sa_domain.runtime_state);
 IF t.id IS NULL OR t.state NOT IN('failed','cancelled','expired') OR NOT EXISTS(SELECT FROM sa_domain.airtable_statistics WHERE transfer_id=t.id AND NOT applied) THEN RETURN;END IF;
 INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
 VALUES(t.actor_id,'airtable.statistics','import',t.sequence_id,t.id,t.generation,jsonb_build_object('transfer_id',t.id)) ON CONFLICT DO NOTHING;
 IF FOUND THEN UPDATE sa_domain.transfers SET result=result||'{"derived_statistics":"pending"}',revision=revision+1 WHERE id=t.id;END IF;
END $f$;
ALTER FUNCTION sa_domain.airtable_queue_statistics(uuid) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.airtable_queue_statistics(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.airtable_queue_statistics(uuid) TO sa_media_writer;

CREATE FUNCTION sa_domain.squad_airtable_work(p_id uuid,p_lease_token uuid,p_action text,p_input jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;t sa_domain.transfers;run_ sa_domain.airtable_runs;g bigint;r jsonb;v jsonb;a sa_domain.airtable_assets;manifest_ jsonb;done_ boolean:=false;state_ text:='ready';code_ text;delay_ integer:=0;classes_ bigint[];
BEGIN
 PERFORM sa_domain.assert_service_worker();
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Object input required' USING ERRCODE='22023';END IF;
 g:=sa_domain.worker_write_fence();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.event_type NOT IN('airtable.validate','airtable.apply','airtable.statistics') THEN RAISE EXCEPTION 'Airtable lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status IN('done','dead') THEN RETURN jsonb_build_object('id',j.id,'state',j.status,'error_code',j.last_error_code,'replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN
  IF j.status='pending' AND j.result->>'action'=p_action AND j.result->>'input_hash'=md5(p_input::text) THEN RETURN j.result||jsonb_build_object('state','pending','replayed',true);END IF;
  RAISE EXCEPTION 'Airtable lease expired' USING ERRCODE='40001';
 END IF;
 IF p_action IN('validate','apply') AND NOT pg_try_advisory_xact_lock(20261107,1) THEN
  r:=jsonb_build_object('id',j.id,'state','pending','error_code','AIRTABLE_BUSY','action',p_action,'input_hash',md5(p_input::text));
  UPDATE sa_domain.job_attempts SET state='done',finished_at=now() WHERE lease_token=j.lease_token;
  UPDATE sa_domain.outbox SET status='pending',attempts=0,lease_until=NULL,available_at=now()+interval '2 seconds',result=r,last_error_code='AIRTABLE_BUSY',revision=revision+1 WHERE id=j.id;RETURN r;
 END IF;
 SELECT * INTO t FROM sa_domain.transfers WHERE id=(j.payload->>'transfer_id')::uuid AND(job_id=j.id OR j.event_type='airtable.statistics') AND actor_id=j.actor_id AND generation=j.generation FOR UPDATE;
 IF j.event_type='airtable.statistics' THEN
  IF t.id IS NULL OR t.kind<>'airtable' OR t.state NOT IN('failed','cancelled','expired') THEN RAISE EXCEPTION 'Statistics repair unavailable' USING ERRCODE='55000';END IF;
  PERFORM sa_domain.check_fields(p_input,ARRAY[]::text[]);
  IF p_action='input' THEN UPDATE sa_domain.outbox SET lease_until=statement_timestamp()+interval '180 seconds' WHERE id=j.id;RETURN jsonb_build_object('id',j.id,'state','ready','phase','apply','step','statistics_repair','transfer_id',t.id,'generation',t.generation::text);
  ELSIF p_action='apply' THEN
   SELECT array_agg(class_id) INTO classes_ FROM(SELECT class_id FROM sa_domain.airtable_statistics WHERE transfer_id=t.id AND NOT applied ORDER BY class_id LIMIT 10)x;
   IF classes_ IS NOT NULL THEN PERFORM sa_admin.refresh_min_stats(classes_);UPDATE sa_domain.airtable_statistics SET applied=true WHERE transfer_id=t.id AND class_id=ANY(classes_);END IF;
   IF EXISTS(SELECT FROM sa_domain.airtable_statistics WHERE transfer_id=t.id AND NOT applied) THEN RETURN jsonb_build_object('id',j.id,'state','ready','phase','apply','step','statistics_repair');END IF;
   UPDATE sa_domain.transfers SET result=result||'{"derived_statistics":"repaired"}',revision=revision+1 WHERE id=t.id;state_:='done';
  ELSIF p_action='yield' THEN state_:='pending';ELSE RAISE EXCEPTION 'Statistics repair action unavailable' USING ERRCODE='22023';END IF;
  UPDATE sa_domain.job_attempts SET state='done',finished_at=now() WHERE lease_token=j.lease_token;
  UPDATE sa_domain.outbox SET status=state_,lease_until=NULL,attempts=0,available_at=now(),completed_at=CASE WHEN state_='done' THEN now() END,revision=revision+1 WHERE id=j.id;
  RETURN jsonb_build_object('id',j.id,'state',state_);
 END IF;
 IF t.id IS NULL OR t.kind<>'airtable' OR t.state IN('cancelled','expired','failed') OR t.expires_at<=now() THEN RAISE EXCEPTION 'Airtable import unavailable' USING ERRCODE='55000';END IF;
 INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
 BEGIN
  IF NOT sa_domain.transfer_current(t) THEN RAISE EXCEPTION 'Transfer authority changed' USING ERRCODE='42501';END IF;
  PERFORM sa_domain.airtable_ensure_enabled();
  IF t.state='queued' THEN UPDATE sa_domain.transfers SET state='validating',revision=revision+1 WHERE id=t.id;END IF;
  SELECT * INTO run_ FROM sa_domain.airtable_runs WHERE transfer_id=t.id;
  IF j.event_type='airtable.apply' AND run_.phase='validate' THEN UPDATE sa_domain.airtable_runs SET phase='apply_scalar' WHERE transfer_id=t.id;run_.phase:='apply_scalar';END IF;
  IF p_action='input' THEN
   PERFORM sa_domain.check_fields(p_input,ARRAY[]::text[]);
   UPDATE sa_domain.outbox SET lease_until=statement_timestamp()+interval '180 seconds' WHERE id=j.id;r:=sa_domain.airtable_input(t.id);
  ELSIF p_action='capture' AND j.event_type='airtable.validate' THEN
   PERFORM sa_domain.airtable_capture_page(t.id,p_input);r:=sa_domain.airtable_input(t.id);
  ELSIF p_action='media' AND j.event_type='airtable.validate' AND run_.phase IN('media','match') THEN
   PERFORM sa_domain.check_fields(p_input,ARRAY['assets']);
   IF jsonb_typeof(p_input->'assets') IS DISTINCT FROM 'array' OR jsonb_array_length(p_input->'assets') NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'AIRTABLE_INVALID_MEDIA' USING ERRCODE='22023';END IF;
   FOR v IN SELECT value FROM jsonb_array_elements(p_input->'assets') LOOP
    PERFORM sa_domain.check_fields(v,ARRAY['asset_id','attachment_id','status','manifest','error_code']);
    IF pg_input_is_valid(v->>'asset_id','uuid') IS NOT TRUE THEN RAISE EXCEPTION 'AIRTABLE_INVALID_MEDIA' USING ERRCODE='22023';END IF;
    SELECT a1.* INTO a FROM sa_domain.airtable_assets a1 JOIN sa_domain.airtable_rows x ON x.id=a1.row_id WHERE a1.id=(v->>'asset_id')::uuid AND x.transfer_id=t.id FOR UPDATE OF a1;
    IF a.id IS NULL OR a.attachment->>'id' IS DISTINCT FROM v->>'attachment_id' OR v->>'status' IS NULL OR v->>'status' NOT IN('ready','failed') THEN RAISE EXCEPTION 'AIRTABLE_INVALID_MEDIA' USING ERRCODE='22023';END IF;
    IF a.state<>'pending' THEN
     IF a.state IS DISTINCT FROM v->>'status' OR a.manifest IS DISTINCT FROM v->'manifest' OR a.error_code IS DISTINCT FROM v->>'error_code' THEN RAISE EXCEPTION 'AIRTABLE_MEDIA_CHANGED' USING ERRCODE='40001';END IF;CONTINUE;
    END IF;
    IF v->>'status'='ready' THEN
     IF v->>'error_code' IS NOT NULL THEN RAISE EXCEPTION 'AIRTABLE_INVALID_MEDIA' USING ERRCODE='22023';END IF;
     manifest_:=v->'manifest';PERFORM sa_domain.check_fields(manifest_,ARRAY['bucket','path','sha256','bytes','mime']);
     IF jsonb_typeof(manifest_) IS DISTINCT FROM 'object' OR manifest_->>'bytes' IS NULL OR manifest_->>'bytes'!~'^[0-9]+$' OR nullif(manifest_->>'mime','') IS NULL OR length(manifest_->>'mime')>100 THEN RAISE EXCEPTION 'AIRTABLE_INVALID_MEDIA' USING ERRCODE='22023';END IF;
     PERFORM sa_domain.airtable_media_register(a.id,manifest_);
    ELSIF v->'manifest' IS NOT NULL OR v->>'error_code' IS NULL OR v->>'error_code' NOT IN('AIRTABLE_INVALID_MEDIA','AIRTABLE_MEDIA_CHANGED','AIRTABLE_MEDIA_LIMIT','AIRTABLE_RESPONSE_LIMIT','AIRTABLE_REJECTED') THEN RAISE EXCEPTION 'AIRTABLE_INVALID_MEDIA' USING ERRCODE='22023';END IF;
    UPDATE sa_domain.airtable_assets SET state=v->>'status',manifest=v->'manifest',error_code=v->>'error_code' WHERE id=a.id;
   END LOOP;
   UPDATE sa_domain.transfers SET revision=revision+1 WHERE id=t.id;r:=sa_domain.airtable_input(t.id);
  ELSIF p_action='validate' AND j.event_type='airtable.validate' AND run_.phase IN('match','validate') THEN
   PERFORM sa_domain.check_fields(p_input,ARRAY[]::text[]);done_:=sa_domain.airtable_validate_batch(t.id);
   IF done_ THEN
    UPDATE sa_domain.transfers SET valid_rows=(SELECT count(*) FROM sa_domain.airtable_rows WHERE transfer_id=t.id AND state='valid'),invalid_rows=(SELECT count(*) FROM sa_domain.airtable_rows WHERE transfer_id=t.id AND state='invalid'),revision=revision+1,
     state=CASE WHEN EXISTS(SELECT FROM sa_domain.airtable_rows WHERE transfer_id=t.id AND state='invalid') THEN 'invalid' ELSE 'validated' END,
     result=jsonb_build_object('resources',22,'derived_resources',1,'retirements',(SELECT count(*) FROM sa_domain.airtable_retirements WHERE transfer_id=t.id),'captured_at',run_.captured_at,'source_consistency','paginated_unversioned','capture_counts',(SELECT jsonb_object_agg(resource,row_count) FROM sa_domain.airtable_tables WHERE transfer_id=t.id),'retirement_counts',(SELECT coalesce(jsonb_object_agg(resource,n),'{}') FROM(SELECT resource,count(*)n FROM sa_domain.airtable_retirements WHERE transfer_id=t.id GROUP BY resource)x)) WHERE id=t.id;state_:='done';
   ELSE UPDATE sa_domain.transfers SET revision=revision+1 WHERE id=t.id;r:=sa_domain.airtable_input(t.id);END IF;
  ELSIF p_action='apply' AND j.event_type='airtable.apply' THEN
   PERFORM sa_domain.check_fields(p_input,ARRAY[]::text[]);done_:=sa_domain.airtable_apply_batch(t.id);
   IF done_ THEN UPDATE sa_domain.transfers SET state='completed',completed_at=now(),applied_rows=total_rows,revision=revision+1,result=result||jsonb_build_object('retired',(SELECT count(*) FROM sa_domain.airtable_retirements WHERE transfer_id=t.id AND applied)) WHERE id=t.id;state_:='done';
   ELSIF(SELECT state FROM sa_domain.transfers WHERE id=t.id)='failed' THEN state_:='dead';SELECT error_code INTO code_ FROM sa_domain.transfers WHERE id=t.id;
   ELSE r:=sa_domain.airtable_input(t.id);END IF;
  ELSIF p_action='yield' THEN PERFORM sa_domain.check_fields(p_input,ARRAY[]::text[]);state_:='pending';
  ELSIF p_action IN('retry','fail') THEN
   PERFORM sa_domain.check_fields(p_input,CASE WHEN p_action='retry' THEN ARRAY['code','retry_after_seconds'] ELSE ARRAY['code'] END);code_:=p_input->>'code';
   IF p_action='retry' THEN
    IF code_ IS NULL OR code_ NOT IN('AIRTABLE_RATE_LIMIT','AIRTABLE_AUTH_UNAVAILABLE','AIRTABLE_UNAVAILABLE','AIRTABLE_STORAGE_UNAVAILABLE','STORAGE_UNAVAILABLE','AIRTABLE_NOT_CONFIGURED') THEN RAISE EXCEPTION 'Invalid retry code' USING ERRCODE='22023';END IF;
    IF p_input->>'retry_after_seconds' IS NULL OR p_input->>'retry_after_seconds'!~'^[0-9]+$' THEN RAISE EXCEPTION 'Integer retry delay required' USING ERRCODE='22023';END IF;delay_:=sa_domain.input_number(p_input->'retry_after_seconds',1,3600);state_:=CASE WHEN j.attempts<5 THEN 'pending' ELSE 'dead' END;
   ELSE
    IF code_ IS NULL OR code_ NOT IN('AIRTABLE_REJECTED','AIRTABLE_RESPONSE_INVALID','AIRTABLE_INVALID_RECORD','AIRTABLE_INVALID_REFERENCE','AIRTABLE_INVALID_OFFSET','AIRTABLE_INVALID_RESOURCE','AIRTABLE_INVALID_MEDIA','AIRTABLE_MEDIA_CHANGED','AIRTABLE_MEDIA_LIMIT','AIRTABLE_RESPONSE_LIMIT','AIRTABLE_INVALID_PHASE') THEN RAISE EXCEPTION 'Invalid failure code' USING ERRCODE='22023';END IF;state_:='dead';
   END IF;
  ELSE RAISE EXCEPTION 'AIRTABLE_INVALID_PHASE' USING ERRCODE='22023';END IF;
 EXCEPTION WHEN insufficient_privilege OR invalid_authorization_specification OR object_not_in_prerequisite_state THEN
  code_:='AIRTABLE_AUTHORITY_CHANGED';state_:='dead';
 END;
 PERFORM sa_domain.airtable_clear_context();DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 UPDATE sa_domain.transfers SET result=result||jsonb_build_object('phase',(SELECT phase FROM sa_domain.airtable_runs WHERE transfer_id=t.id),'partial',state='failed' AND EXISTS(SELECT FROM sa_domain.airtable_rows WHERE transfer_id=t.id AND state IN('scalar','applied'))) WHERE id=t.id;
 IF state_='ready' THEN RETURN coalesce(r,'{}')||jsonb_build_object('id',j.id,'state','ready');END IF;
 IF state_='dead' THEN UPDATE sa_domain.transfers SET state='failed',error_code=code_,completed_at=now(),revision=revision+1 WHERE id=t.id;PERFORM sa_domain.airtable_queue_statistics(t.id);END IF;
 r:=jsonb_build_object('id',j.id,'state',state_,'transfer_id',t.id,'action',p_action,'input_hash',md5(p_input::text),'error_code',code_);
 UPDATE sa_domain.job_attempts SET state=CASE WHEN state_='dead' THEN 'failed' ELSE 'done' END,finished_at=now(),error_code=code_ WHERE lease_token=j.lease_token;
 UPDATE sa_domain.outbox SET status=state_,attempts=CASE WHEN code_ IS NULL THEN 0 ELSE attempts END,lease_until=NULL,available_at=now()+make_interval(secs=>delay_),completed_at=CASE WHEN state_<>'pending' THEN now() END,last_error_code=code_,result=r,revision=revision+1 WHERE id=j.id;
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.squad_airtable_work(uuid,uuid,text,jsonb) OWNER TO sa_worker;
CREATE FUNCTION canto_api.squad_airtable_work(p_id uuid,p_lease_token uuid,p_action text,p_input jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_airtable_work(p_id,p_lease_token,p_action,p_input) $f$;
DO $f$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['airtable_capture_page','airtable_match_row','airtable_values','airtable_call_master','airtable_clear_context','airtable_validate_batch','airtable_apply_batch','airtable_input','squad_airtable_work']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',f.sig);
 END LOOP;
END $f$;
REVOKE ALL ON FUNCTION canto_api.squad_airtable_work(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_airtable_work(uuid,uuid,text,jsonb),canto_api.squad_airtable_work(uuid,uuid,text,jsonb) TO service_role;
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.job_handler(text,jsonb)'::regprocedure);d:=replace(d,'SELECT CASE WHEN',$s$SELECT CASE WHEN p_event IN('airtable.validate','airtable.apply','airtable.statistics') THEN 'airtable' WHEN$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.squad_job_claim(integer)'::regprocedure);
 d:=replace(d,'''warehouse'',''webhook''','''warehouse'',''webhook'',''airtable''');
 IF position('''airtable''' IN d)=0 THEN d:=replace(d,'''warehouse''','''warehouse'',''airtable''');END IF;
 d:=replace(d,'''transfer.export'')','''transfer.export'',''airtable.validate'',''airtable.apply'',''airtable.statistics'')');
 d:=replace(d,$s$ RETURN jsonb_build_object('jobs',result_,'paused',false);$s$,$s$ PERFORM sa_domain.airtable_queue_statistics(t.id) FROM sa_domain.transfers t WHERE t.kind='airtable' AND t.generation=g AND t.state IN('failed','cancelled','expired') AND EXISTS(SELECT FROM sa_domain.airtable_statistics s WHERE s.transfer_id=t.id AND NOT applied) LIMIT 25;
 RETURN jsonb_build_object('jobs',result_,'paused',false);$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.job_projection(sa_domain.outbox)'::regprocedure);d:=replace(d,'''warehouse''','''warehouse'',''airtable''');EXECUTE d;
 d:=pg_get_functiondef('sa_domain.v1_job_retry(uuid,text,text,uuid)'::regprocedure);
 d:=replace(d,'''transfer.validate'',''transfer.apply'',''transfer.export'')','''transfer.validate'',''transfer.apply'',''transfer.export'',''airtable.validate'',''airtable.apply'')');
 d:=replace(d,$s$CASE j.event_type WHEN 'transfer.validate' THEN 'validating'$s$,$s$CASE j.event_type WHEN 'airtable.validate' THEN 'validating' WHEN 'airtable.apply' THEN 'applying' WHEN 'transfer.validate' THEN 'validating'$s$);
 d:=replace(d,'IF transfer_.id IS NULL OR NOT sa_domain.transfer_current(transfer_)',$s$IF (transfer_.kind='airtable' AND transfer_.error_code IN('AIRTABLE_APPLY_CONFLICT','AIRTABLE_RETIREMENT_CONFLICT')) OR transfer_.id IS NULL OR NOT sa_domain.transfer_current(transfer_)$s$);EXECUTE d;
END $f$;
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.squad_transfer_cleanup(uuid[],integer)'::regprocedure);
 d:=replace(d,' WITH chosen AS(SELECT id FROM sa_domain.transfer_cleanup',$s$
 WITH due AS(SELECT r.id FROM sa_domain.airtable_rows r JOIN sa_domain.transfers t ON t.id=r.transfer_id WHERE t.state='expired' AND(r.attributes<>'{}' OR r.media<>'{}' OR r.values_ IS NOT NULL) ORDER BY t.expires_at,r.id LIMIT 1000 FOR UPDATE OF r SKIP LOCKED),
 scrubbed AS(UPDATE sa_domain.airtable_rows r SET attributes='{}',references_='{}',relations='{}',media='{}',values_=NULL,side_effects='{}' FROM due WHERE r.id=due.id RETURNING r.id)
 UPDATE sa_domain.airtable_assets a SET attachment=attachment-ARRAY['url','filename'] WHERE row_id IN(SELECT id FROM scrubbed);
 WITH chosen AS(SELECT id FROM sa_domain.transfer_cleanup$s$);EXECUTE d;
END $f$;
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.v1_import_request(text,jsonb,uuid)'::regprocedure);
 d:=replace(d,$s$ RETURN sa_domain.transfer_command_finish('import.cancel',p_idempotency_key,t.id,NULL);$s$,$s$ PERFORM sa_domain.airtable_queue_statistics(t.id);
 RETURN sa_domain.transfer_command_finish('import.cancel',p_idempotency_key,t.id,NULL);$s$);EXECUTE d;
END $f$;
CREATE INDEX squad_airtable_jobs ON sa_domain.outbox(available_at,sequence_id) WHERE status IN('pending','leased') AND event_type IN('airtable.validate','airtable.apply','airtable.statistics');
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_worker,sa_media_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
