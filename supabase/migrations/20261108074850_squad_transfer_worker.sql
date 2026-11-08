BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_worker,sa_media_writer;
GRANT USAGE ON SCHEMA sa_admin,sa_snapshot_20261019 TO sa_worker;
GRANT EXECUTE ON FUNCTION sa_admin.master_request(text,text,jsonb) TO sa_worker;
GRANT SELECT ON sa_admin.master_contracts TO sa_worker;
CREATE POLICY transfer_contract_worker ON sa_admin.master_contracts FOR SELECT TO sa_worker USING(true);
CREATE INDEX squad_transfer_unique_keys ON sa_domain.transfer_rows USING gin((normalized->'unique_keys'));
CREATE TABLE sa_domain.transfer_replacements(
 transfer_id uuid NOT NULL REFERENCES sa_domain.transfers ON DELETE CASCADE,
 price_id bigint NOT NULL,expected_version text NOT NULL,applied boolean NOT NULL DEFAULT false,
 PRIMARY KEY(transfer_id,price_id)
);
ALTER TABLE sa_domain.transfer_replacements ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.transfer_replacements FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON sa_domain.transfer_replacements TO sa_worker;
CREATE POLICY transfer_replacement_worker ON sa_domain.transfer_replacements TO sa_worker USING(true) WITH CHECK(true);
-- Validation follows the exact existing Masters contract, before any INSERT,
-- UPDATE, audit event or sequence allocation. Type/relationship checks also run
-- on ordinary writes so CSV and form edits cannot diverge.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_admin.master_request(text,text,jsonb)'::regprocedure);
 d:=replace(d,'row_ jsonb; record_id bigint;', 'dry_run_ boolean:=p_action IN(''validate_create'',''validate_update''); relation_ jsonb; typed_ jsonb; row_ jsonb; record_id bigint;');
 d:=replace(d,'BEGIN' || chr(10)||'  IF NOT sa_admin.is_admin()', 'BEGIN' || chr(10)||'  IF dry_run_ THEN p_action:=replace(p_action,''validate_'','''');END IF;'||chr(10)||'  IF NOT sa_admin.is_admin()');
 d:=replace(d,$s$  IF p_action='list' THEN$s$,$s$  IF p_action='match' THEN
    field:=p_data->>'field';
    IF NOT(spec->'fields'?field) OR NOT(spec->'columns'?field) OR nullif(p_data->>'value','') IS NULL THEN RAISE EXCEPTION 'Invalid match field' USING ERRCODE='22023';END IF;
    EXECUTE format('SELECT count(*),min(id) FROM sa_snapshot_20261019.%I WHERE lower(btrim(%I::text))=lower(btrim($1))','sa_'||p_resource,field) INTO total_,record_id USING p_data->>'value';
    IF total_>1 THEN RAISE EXCEPTION 'MATCH_AMBIGUOUS' USING ERRCODE='22023';END IF;
    RETURN CASE WHEN record_id IS NOT NULL THEN sa_admin.read_record(p_resource,record_id) ELSE '{}'::jsonb END;
  END IF;
  IF p_action='list' THEN$s$);
 d:=replace(d,'  -- Snapshot columns retain their original names/types.', $s$
  EXECUTE format('SELECT to_jsonb(jsonb_populate_record(NULL::sa_snapshot_20261019.%I,$1))','sa_'||p_resource) INTO typed_ USING payload;
  FOR field,value IN SELECT * FROM jsonb_each(payload) LOOP
   IF spec->'columns' ? field AND (spec->'columns'->field->>'nullable')='false' AND typed_->field='null'::jsonb THEN RAISE EXCEPTION 'Field % cannot be null',field USING ERRCODE='23502';END IF;
  END LOOP;
  IF jsonb_typeof(coalesce(p_data->'relations','{}'))<>'object' THEN RAISE EXCEPTION 'Invalid relations' USING ERRCODE='22023';END IF;
  FOR target,ids IN SELECT * FROM jsonb_each(coalesce(p_data->'relations','{}')) LOOP
   relation_:=spec->'relations'->target;
   IF relation_ IS NULL OR jsonb_typeof(ids)<>'array' OR jsonb_array_length(ids)>1000 THEN RAISE EXCEPTION 'Invalid relation' USING ERRCODE='22023';END IF;
   FOR item IN SELECT jsonb_array_elements_text(ids) LOOP
    IF item IS NULL OR item!~'^[0-9]+$' OR NOT pg_input_is_valid(item,'bigint') THEN RAISE EXCEPTION 'Invalid relation ID' USING ERRCODE='22023';END IF;
    EXECUTE format('SELECT EXISTS(SELECT FROM sa_snapshot_20261019.%I WHERE id=$1)','sa_'||target) INTO exists_ USING item::bigint;
    IF NOT exists_ THEN RAISE EXCEPTION 'Related record unavailable' USING ERRCODE='23503';END IF;
   END LOOP;
  END LOOP;
  IF dry_run_ THEN RETURN jsonb_build_object('valid',true,'id',record_id,'updated_at',before_->>'updated_at');END IF;
  -- Snapshot columns retain their original names/types.$s$);
 IF position('IF dry_run_ THEN RETURN' in d)=0 OR position('IF dry_run_ THEN p_action' in d)=0 THEN RAISE EXCEPTION 'Masters validation patch did not match';END IF;
 EXECUTE d;
END $f$;

-- Worker catalog grants are confined to registry-backed masters. No user data
-- or Auth table privilege is added to support platform administrator delegation.
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['rmp_skus','rmp_prices','rmp_price_types','rmp_sku_prices','cities','zones'] LOOP
  EXECUTE format('GRANT SELECT ON sa_snapshot_20261019.%I TO sa_worker','sa_'||t);
  EXECUTE format('CREATE POLICY transfer_worker_catalog ON sa_snapshot_20261019.%I FOR SELECT TO sa_worker USING(true)','sa_'||t);
 END LOOP;
END $f$;
GRANT SELECT(id,role,deleted_at,zone_id,rmp_price_type_id) ON sa_snapshot_20261019.sa_users TO sa_worker;
CREATE POLICY transfer_worker_people_read ON sa_snapshot_20261019.sa_users FOR SELECT TO sa_worker USING(sa_domain.worker_actor_id() IS NOT NULL);
GRANT INSERT,UPDATE ON sa_snapshot_20261019.sa_cities,sa_snapshot_20261019.sa_zones TO sa_worker;
GRANT UPDATE(zone_id,rmp_price_type_id,updated_at) ON sa_snapshot_20261019.sa_users TO sa_worker;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_cities_id_seq,sa_snapshot_20261019.sa_zones_id_seq TO sa_worker;
GRANT EXECUTE ON FUNCTION sa_domain.address_rule_values(bigint) TO sa_worker;
CREATE POLICY transfer_worker_city_write ON sa_snapshot_20261019.sa_cities TO sa_worker USING(sa_domain.worker_actor_id() IS NOT NULL) WITH CHECK(sa_domain.worker_actor_id() IS NOT NULL);
CREATE POLICY transfer_worker_zone_write ON sa_snapshot_20261019.sa_zones TO sa_worker USING(sa_domain.worker_actor_id() IS NOT NULL) WITH CHECK(sa_domain.worker_actor_id() IS NOT NULL);
CREATE POLICY transfer_worker_people_write ON sa_snapshot_20261019.sa_users FOR UPDATE TO sa_worker USING(sa_domain.worker_actor_id() IS NOT NULL) WITH CHECK(sa_domain.worker_actor_id() IS NOT NULL);
GRANT UPDATE(edit_revision,updated_at) ON sa_sync.environment_state TO sa_worker;
CREATE POLICY transfer_worker_revision ON sa_sync.environment_state FOR UPDATE TO sa_worker USING(singleton) WITH CHECK(singleton);

CREATE FUNCTION sa_domain.transfer_normalize(t sa_domain.transfers,p_values jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE v jsonb:='{}';relations_ jsonb:='{}';field_ text;source_ text;value_ jsonb;spec_ jsonb;match_ text;key_ text;id_ bigint;version_ text;n bigint;sku_ bigint;type_ bigint;data_ jsonb;candidate_ jsonb;keys_ jsonb:='[]';
BEGIN
 IF t.kind='masters' THEN SELECT spec INTO spec_ FROM sa_admin.master_contracts WHERE resource=t.resource;END IF;
 IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'ROW_INVALID' USING ERRCODE='22023';END IF;
 FOR source_,value_ IN SELECT * FROM jsonb_each(p_values) LOOP
  field_:=coalesce(t.options->'mapping'->>source_,source_);
  IF t.kind='masters' THEN
   SELECT coalesce((SELECT f FROM(SELECT jsonb_array_elements_text(spec_->'fields') f UNION SELECT jsonb_object_keys(coalesce(spec_->'relations','{}'))) x WHERE lower(f)=lower(field_) LIMIT 1),field_) INTO field_;
  END IF;
  IF v?field_ THEN RAISE EXCEPTION 'DUPLICATE_MAPPING' USING ERRCODE='22023';END IF;
  v:=v||jsonb_build_object(field_,value_);
 END LOOP;
 IF t.kind='zones' THEN
  PERFORM sa_domain.check_fields(v,ARRAY['zone','city']);
  IF nullif(btrim(v->>'zone'),'') IS NULL OR nullif(btrim(v->>'city'),'') IS NULL OR length(v->>'zone')>200 OR length(v->>'city')>200 THEN RAISE EXCEPTION 'ZONE_CITY_REQUIRED' USING ERRCODE='22023';END IF;
  SELECT count(*),min(id) INTO n,id_ FROM sa_snapshot_20261019.sa_cities WHERE lower(btrim(name))=lower(btrim(v->>'city'));
  IF n>1 OR(SELECT count(*) FROM sa_snapshot_20261019.sa_zones WHERE lower(btrim(name))=lower(btrim(v->>'zone')))>1 THEN RAISE EXCEPTION 'AMBIGUOUS_NAME' USING ERRCODE='22023';END IF;
  SELECT updated_at::text INTO version_ FROM sa_snapshot_20261019.sa_cities WHERE id=id_;
  RETURN jsonb_build_object('values',jsonb_build_object('zone',btrim(v->>'zone'),'city',btrim(v->>'city')),'id',id_,'version',version_,'match_key','city:'||lower(btrim(v->>'city')));
 END IF;
 IF t.kind='prices' THEN
  PERFORM sa_domain.check_fields(v,ARRAY['name','rmp_sku','price_type','price','mrp']);
  IF nullif(btrim(v->>'name'),'') IS NULL OR nullif(btrim(v->>'rmp_sku'),'') IS NULL OR nullif(btrim(v->>'price_type'),'') IS NULL THEN RAISE EXCEPTION 'PRICE_NAMES_REQUIRED' USING ERRCODE='22023';END IF;
  PERFORM sa_domain.input_number(to_jsonb(v->>'price'),0,1000000000);
  IF coalesce(btrim(v->>'mrp'),'')='' THEN v:=v||'{"mrp":"0"}'::jsonb;END IF;
  PERFORM sa_domain.input_number(to_jsonb(v->>'mrp'),0,1000000000);
  SELECT count(*),min(id) INTO n,sku_ FROM sa_snapshot_20261019.sa_rmp_skus WHERE name=btrim(v->>'rmp_sku') AND is_deleted IS NOT TRUE;
  IF n<>1 THEN RAISE EXCEPTION 'SKU_MISSING_OR_AMBIGUOUS' USING ERRCODE='22023';END IF;
  SELECT count(*),min(id) INTO n,type_ FROM sa_snapshot_20261019.sa_rmp_price_types WHERE name=btrim(v->>'price_type') AND is_deleted IS NOT TRUE;
  IF n<>1 THEN RAISE EXCEPTION 'PRICE_TYPE_MISSING_OR_AMBIGUOUS' USING ERRCODE='22023';END IF;
  SELECT count(*),min(id) INTO n,id_ FROM sa_snapshot_20261019.sa_rmp_prices WHERE name=btrim(v->>'name');
  IF n>1 THEN RAISE EXCEPTION 'PRICE_NAME_AMBIGUOUS' USING ERRCODE='22023';END IF;
  SELECT updated_at::text INTO version_ FROM sa_snapshot_20261019.sa_rmp_prices WHERE id=id_;
  key_:='name:'||lower(btrim(v->>'name'));
  v:=jsonb_build_object('name',btrim(v->>'name'),'rmp_sku_id',sku_,'rmp_price_type_id',type_,'price',(v->>'price')::numeric,'mrp',(v->>'mrp')::numeric,'is_deleted',false);
 ELSE
  SELECT spec INTO spec_ FROM sa_admin.master_contracts WHERE resource=t.resource;
  match_:=coalesce(t.options->>'match_field','id');
  IF match_<>'id' AND NOT(spec_->'fields'?match_) THEN RAISE EXCEPTION 'MATCH_FIELD_NOT_WRITABLE' USING ERRCODE='22023';END IF;
  IF match_='id' AND nullif(v->>'id','') IS NOT NULL THEN
   IF NOT pg_input_is_valid(v->>'id','bigint') OR(v->>'id')::bigint<=0 THEN RAISE EXCEPTION 'INVALID_ID' USING ERRCODE='22023';END IF;
   id_:=(v->>'id')::bigint;key_:='id:'||id_::text;
   candidate_:=sa_admin.master_request(t.resource,'get',jsonb_build_object('id',id_));
  ELSIF match_<>'id' THEN
   IF nullif(btrim(v->>match_),'') IS NULL THEN RAISE EXCEPTION 'MATCH_VALUE_REQUIRED' USING ERRCODE='22023';END IF;
   -- Registry fields only; values remain parameters. Case-insensitive matching
   -- mirrors registry uniqueness and refuses ambiguous legacy duplicates.
   candidate_:=sa_admin.master_request(t.resource,'match',jsonb_build_object('field',match_,'value',v->>match_));id_:=(candidate_->>'id')::bigint;
   key_:=match_||':'||lower(btrim(v->>match_));
  END IF;
  version_:=candidate_->>'updated_at';v:=v-'id';
  FOR field_,value_ IN SELECT * FROM jsonb_each(v) LOOP
   IF spec_->'relations'?field_ THEN
    BEGIN relations_:=relations_||jsonb_build_object(field_,CASE WHEN jsonb_typeof(value_)='string' THEN(value_#>>'{}')::jsonb ELSE value_ END);
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'RELATION_REQUIRES_JSON_ID_ARRAY' USING ERRCODE='22023';END;
    v:=v-field_;
   END IF;
  END LOOP;
 END IF;
 IF t.kind='prices' THEN keys_:=jsonb_build_array('name:'||lower(v->>'name'));
 ELSE
  FOR field_,value_ IN SELECT * FROM jsonb_each(coalesce(spec_->'unique','{}')) LOOP
   IF coalesce(v,candidate_)->>field_ IS NOT NULL THEN keys_:=keys_||jsonb_build_array(field_||':'||CASE WHEN value_='true'::jsonb THEN lower(coalesce(v->>field_,candidate_->>field_)) ELSE coalesce(v->>field_,candidate_->>field_) END);END IF;
  END LOOP;
 END IF;
 IF id_ IS NOT NULL THEN keys_:=keys_||jsonb_build_array('id:'||id_::text);END IF;
 data_:=jsonb_build_object('id',id_,'expectedUpdatedAt',version_,'values',v,'relations',relations_);
 PERFORM sa_admin.master_request(CASE WHEN t.kind='prices' THEN 'rmp_prices' ELSE t.resource END,CASE WHEN id_ IS NULL THEN 'validate_create' ELSE 'validate_update' END,data_);
 RETURN jsonb_build_object('payload',data_,'id',id_,'version',version_,'match_key',key_,'unique_keys',keys_);
END $f$;
ALTER FUNCTION sa_domain.transfer_normalize(sa_domain.transfers,jsonb) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.transfer_normalize(sa_domain.transfers,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;

CREATE FUNCTION sa_domain.transfer_capture_export(p_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE t sa_domain.transfers;spec_ jsonb;page_ integer:=1;data_ jsonb;r jsonb;row_ bigint:=0;bytes_ bigint:=0;columns_ jsonb;
BEGIN
 SELECT * INTO t FROM sa_domain.transfers WHERE id=p_id;
 IF t.state='exporting' THEN RETURN;END IF;
 IF NOT pg_try_advisory_xact_lock(20261107,1) THEN RAISE EXCEPTION 'Concurrent master edit' USING ERRCODE='55000';END IF;
 SELECT spec INTO spec_ FROM sa_admin.master_contracts WHERE resource=t.resource;
 columns_:=coalesce(t.options->'columns',jsonb_build_array('id')||(spec_->'fields')||coalesce((SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(coalesce(spec_->'relations','{}')) k),'[]'::jsonb));
 LOOP
  data_:=sa_admin.master_request(t.resource,'list',jsonb_build_object('page',page_,'items',1000,'includeInactive',coalesce((t.options->>'include_inactive')::boolean,false),'search',coalesce(t.options->>'search',''),'filters',coalesce(t.options->'filters','{}')));
  IF(data_->>'totalCount')::bigint>20000 THEN RAISE EXCEPTION 'EXPORT_ROW_LIMIT' USING ERRCODE='54000';END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(data_->'data') LOOP
   SELECT coalesce(jsonb_object_agg(key,CASE WHEN spec_->'relations'?key THEN coalesce((SELECT jsonb_agg(value->'id') FROM jsonb_array_elements(coalesce(r->key,'[]'))),'[]'::jsonb) ELSE r->key END),'{}') INTO r FROM jsonb_array_elements_text(columns_) key;
   row_:=row_+1;bytes_:=bytes_+octet_length(r::text);
   IF bytes_>8388608 THEN RAISE EXCEPTION 'EXPORT_BYTE_LIMIT' USING ERRCODE='54000';END IF;
   INSERT INTO sa_domain.transfer_rows(transfer_id,row_number,raw,normalized,state) VALUES(t.id,row_,r,r,'valid');
  END LOOP;
  EXIT WHEN page_*1000>=(data_->>'totalCount')::bigint;page_:=page_+1;
 END LOOP;
 UPDATE sa_domain.transfers SET state='exporting',headers=columns_,total_rows=row_,valid_rows=row_,result=jsonb_build_object('snapshot_bytes',bytes_),revision=revision+1 WHERE id=t.id;
END $f$;
ALTER FUNCTION sa_domain.transfer_capture_export(uuid) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.transfer_capture_export(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;

CREATE FUNCTION sa_domain.squad_transfer_work(p_id uuid,p_lease_token uuid,p_action text,p_input jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;t sa_domain.transfers;u sa_domain.transfer_uploads;g bigint;r jsonb;v jsonb;n jsonb;row_ sa_domain.transfer_rows;code_ text;message_ text;state_ text:='pending';eof_ boolean;next_ bigint;start_ bigint;count_ integer:=0;part_ integer;path_ text;zone_ bigint;city_ bigint;person_ bigint;rules_ jsonb;last_ bigint;revision_ bigint;finish_ boolean:=false;headers_ jsonb;phase_ text;
BEGIN
 PERFORM sa_domain.assert_service_worker();
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Object input required' USING ERRCODE='22023';END IF;
 FOR message_ IN SELECT jsonb_object_keys(p_input) LOOP
  IF message_=ANY(ARRAY['bytes','byte_offset','next_byte_offset','part_number']) AND(p_input->>message_ IS NULL OR p_input->>message_!~'^[0-9]+$') THEN RAISE EXCEPTION 'Integer metadata required' USING ERRCODE='22023';END IF;
 END LOOP;
 g:=sa_domain.worker_write_fence();SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL OR j.event_type NOT IN('transfer.validate','transfer.apply','transfer.export') THEN RAISE EXCEPTION 'Transfer lease unavailable' USING ERRCODE='40001';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('state','done','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN
  IF j.status='pending' AND j.result->>'action'=p_action AND j.result->>'input_hash'=md5(p_input::text) THEN RETURN j.result||jsonb_build_object('state','pending','replayed',true);END IF;
  RAISE EXCEPTION 'Transfer lease expired' USING ERRCODE='40001';
 END IF;
 SELECT * INTO t FROM sa_domain.transfers WHERE id=(j.payload->>'transfer_id')::uuid AND job_id=j.id FOR UPDATE;
 IF t.id IS NULL OR t.state IN('cancelled','expired','failed') OR t.expires_at<=now() THEN RAISE EXCEPTION 'Transfer unavailable' USING ERRCODE='55000';END IF;
 INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
 BEGIN
  IF NOT sa_domain.transfer_current(t) THEN RAISE EXCEPTION 'Transfer authority changed' USING ERRCODE='42501';END IF;
  IF p_action='input' THEN
   UPDATE sa_domain.outbox SET lease_until=statement_timestamp()+interval '180 seconds' WHERE id=j.id;
   IF j.event_type='transfer.validate' THEN
    SELECT * INTO u FROM sa_domain.transfer_uploads WHERE id=t.upload_id;
    r:=jsonb_build_object('kind','validate','bucket','squad-transfers','path','inputs/'||u.id::text||'/file.csv','bytes',u.bytes,'byte_offset',t.byte_offset,'row_offset',t.row_offset,'headers',t.headers,'sha256',u.sha256);
   ELSIF j.event_type='transfer.apply' THEN r:=jsonb_build_object('kind','apply');
   ELSE
    PERFORM sa_domain.transfer_capture_export(t.id);SELECT * INTO t FROM sa_domain.transfers WHERE id=t.id;
    SELECT count(*) INTO part_ FROM sa_domain.transfer_parts WHERE transfer_id=t.id;
    path_:='g'||t.generation::text||'/'||t.id::text||'/';
    IF t.row_offset>=t.total_rows AND part_>0 THEN
     SELECT coalesce(jsonb_agg(jsonb_build_object('path',path,'bytes',bytes,'sha256',sha256) ORDER BY part_number),'[]') INTO v FROM sa_domain.transfer_parts WHERE transfer_id=t.id;
     r:=jsonb_build_object('kind','export','phase','merge','parts',v,'bucket','squad-transfers','path',path_||'export.csv');
    ELSE
     SELECT coalesce(jsonb_agg(normalized ORDER BY row_number),'[]') INTO v FROM(SELECT normalized,row_number FROM sa_domain.transfer_rows WHERE transfer_id=t.id AND row_number>t.row_offset ORDER BY row_number LIMIT 100) x;
     r:=jsonb_build_object('kind','export','phase','part','columns',t.headers,'rows',v,'part_number',part_,'bucket','squad-transfers','path',path_||'part-'||lpad(part_::text,4,'0')||'.csv');
    END IF;
   END IF;
   DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
   RETURN r||jsonb_build_object('state','ready','transfer_id',t.id,'generation',t.generation::text);
  ELSIF p_action='validate' AND j.event_type='transfer.validate' THEN
   PERFORM sa_domain.check_fields(p_input,ARRAY['byte_offset','next_byte_offset','headers','rows','eof']);
   start_:=sa_domain.input_number(p_input->'byte_offset',0,10485760);next_:=sa_domain.input_number(p_input->'next_byte_offset',1,10485760);
   SELECT * INTO u FROM sa_domain.transfer_uploads WHERE id=t.upload_id;
   IF start_<>t.byte_offset OR next_<=start_ OR next_>u.bytes OR next_-start_>262144 OR jsonb_typeof(p_input->'rows')<>'array' OR jsonb_array_length(p_input->'rows')>100 OR jsonb_typeof(p_input->'eof')<>'boolean' THEN RAISE EXCEPTION 'Invalid transfer chunk' USING ERRCODE='22023';END IF;
   eof_:=(p_input->>'eof')::boolean;IF eof_<>(next_=u.bytes) THEN RAISE EXCEPTION 'Invalid EOF' USING ERRCODE='22023';END IF;
   headers_:=p_input->'headers';
   IF jsonb_typeof(headers_)<>'array' OR jsonb_array_length(headers_) NOT BETWEEN 1 AND 100 OR EXISTS(SELECT FROM jsonb_array_elements(headers_) h WHERE jsonb_typeof(h)<>'string' OR h#>>'{}'!~'^[a-z][a-z0-9_]{0,99}$') OR(SELECT count(DISTINCT x) FROM jsonb_array_elements_text(headers_) x)<>jsonb_array_length(headers_) OR(t.headers IS NOT NULL AND t.headers<>headers_) THEN RAISE EXCEPTION 'Invalid CSV headers' USING ERRCODE='22023';END IF;
   FOR r IN SELECT value FROM jsonb_array_elements(p_input->'rows') LOOP
    count_:=count_+1;IF(r->>'row')::bigint<>t.row_offset+count_ OR t.row_offset+count_>20000 THEN RAISE EXCEPTION 'Transfer row order or limit' USING ERRCODE='54000';END IF;
    code_:=NULL;n:=NULL;message_:=NULL;
    BEGIN
     IF r->>'error' IS NOT NULL THEN RAISE EXCEPTION 'COLUMN_COUNT' USING ERRCODE='22023';END IF;
     IF octet_length((r->'values')::text)>131072 THEN RAISE EXCEPTION 'ROW_LIMIT' USING ERRCODE='54000';END IF;
     n:=sa_domain.transfer_normalize(t,r->'values');
    EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS code_=RETURNED_SQLSTATE,message_=MESSAGE_TEXT;END;
    INSERT INTO sa_domain.transfer_rows(transfer_id,row_number,raw,normalized,match_key,target_id,expected_version,state,errors)
    VALUES(t.id,t.row_offset+count_,coalesce(r->'values','{}'),n,n->>'match_key',(n->>'id')::bigint,n->>'version',CASE WHEN code_ IS NULL THEN 'valid' ELSE 'invalid' END,CASE WHEN code_ IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(jsonb_build_object('code',code_,'message',left(message_,160))) END);
    IF EXISTS(SELECT FROM sa_domain.transfer_rows WHERE transfer_id=t.id AND row_number<>t.row_offset+count_ AND (match_key=n->>'match_key' OR normalized->'unique_keys' ?| ARRAY(SELECT jsonb_array_elements_text(coalesce(n->'unique_keys','[]'))))) THEN
     UPDATE sa_domain.transfer_rows SET state='invalid',errors='[{"code":"DUPLICATE_ROW"}]' WHERE transfer_id=t.id AND(row_number=t.row_offset+count_ OR match_key=n->>'match_key' OR normalized->'unique_keys' ?| ARRAY(SELECT jsonb_array_elements_text(coalesce(n->'unique_keys','[]'))));
    END IF;
   END LOOP;
   UPDATE sa_domain.transfers SET byte_offset=next_,row_offset=row_offset+count_,headers=headers_,total_rows=row_offset+count_,
    valid_rows=(SELECT count(*) FROM sa_domain.transfer_rows WHERE transfer_id=t.id AND state='valid'),invalid_rows=(SELECT count(*) FROM sa_domain.transfer_rows WHERE transfer_id=t.id AND state='invalid'),
    state=CASE WHEN eof_ THEN CASE WHEN EXISTS(SELECT FROM sa_domain.transfer_rows WHERE transfer_id=t.id AND state='invalid') OR row_offset+count_=0 THEN 'invalid' ELSE 'validated' END ELSE 'validating' END,
    result=CASE WHEN eof_ THEN jsonb_build_object('validation_revision',(SELECT edit_revision FROM sa_sync.environment_state)) ELSE result END,revision=revision+1 WHERE id=t.id;
   IF eof_ AND t.kind='prices' AND coalesce((t.options->>'replace_all')::boolean,false) AND NOT EXISTS(SELECT FROM sa_domain.transfer_rows WHERE transfer_id=t.id AND state='invalid') THEN
    INSERT INTO sa_domain.transfer_replacements(transfer_id,price_id,expected_version)
    SELECT t.id,p.id,p.updated_at::text FROM sa_snapshot_20261019.sa_rmp_prices p WHERE p.is_deleted IS NOT TRUE
    AND p.rmp_sku_id IN(SELECT DISTINCT(normalized->'payload'->'values'->>'rmp_sku_id')::bigint FROM sa_domain.transfer_rows WHERE transfer_id=t.id)
    AND NOT EXISTS(SELECT FROM sa_domain.transfer_rows r WHERE r.transfer_id=t.id AND r.target_id=p.id);
    IF(SELECT count(*) FROM sa_domain.transfer_replacements WHERE transfer_id=t.id)>20000 THEN RAISE EXCEPTION 'Replacement limit' USING ERRCODE='54000';END IF;
    UPDATE sa_domain.transfers SET result=result||jsonb_build_object('replacement_scope','validated_snapshot','replacement_candidates',(SELECT count(*) FROM sa_domain.transfer_replacements WHERE transfer_id=t.id)) WHERE id=t.id;
   END IF;
   code_:=NULL;IF eof_ THEN state_:='done';END IF;
  ELSIF p_action='apply' AND j.event_type='transfer.apply' THEN
   PERFORM sa_domain.check_fields(p_input,ARRAY[]::text[]);
   IF t.state<>'applying' THEN RAISE EXCEPTION 'Transfer not applying' USING ERRCODE='55000';END IF;
   IF NOT pg_try_advisory_xact_lock(20261107,1) THEN RAISE EXCEPTION 'Concurrent write' USING ERRCODE='55000';END IF;
   SELECT edit_revision INTO revision_ FROM sa_sync.environment_state;
   -- Each imported row and each captured replacement has its own optimistic
   -- version. Unrelated business writes cannot invalidate a long import.
   phase_:='rows';
   FOR row_ IN SELECT * FROM sa_domain.transfer_rows WHERE transfer_id=t.id AND state='valid' ORDER BY row_number LIMIT 50 FOR UPDATE LOOP
    n:=row_.normalized;
    IF t.kind='zones' THEN
     SELECT id INTO zone_ FROM sa_snapshot_20261019.sa_zones WHERE lower(btrim(name))=lower(n->'values'->>'zone') ORDER BY id LIMIT 1;
     IF zone_ IS NULL THEN INSERT INTO sa_snapshot_20261019.sa_zones(name,created_at,updated_at) VALUES(n->'values'->>'zone',now(),now()) RETURNING id INTO zone_;END IF;
     IF row_.target_id IS NULL THEN INSERT INTO sa_snapshot_20261019.sa_cities(name,zone_id,created_at,updated_at) VALUES(n->'values'->>'city',zone_,now(),now()) RETURNING id INTO city_;
     ELSE UPDATE sa_snapshot_20261019.sa_cities SET zone_id=zone_,updated_at=now() WHERE id=row_.target_id AND updated_at::text IS NOT DISTINCT FROM row_.expected_version RETURNING id INTO city_;IF city_ IS NULL THEN RAISE EXCEPTION 'City changed' USING ERRCODE='40001';END IF;END IF;
     v:=jsonb_build_object('id',city_);
     UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1,updated_at=now() WHERE singleton;
    ELSE
     v:=sa_admin.master_request(CASE WHEN t.kind='prices' THEN 'rmp_prices' ELSE t.resource END,CASE WHEN row_.target_id IS NULL THEN 'create' ELSE 'update' END,n->'payload');
    END IF;
    UPDATE sa_domain.transfer_rows SET state='applied',result_id=v->>'id' WHERE transfer_id=t.id AND row_number=row_.row_number;
   END LOOP;
   finish_:=NOT EXISTS(SELECT FROM sa_domain.transfer_rows WHERE transfer_id=t.id AND state='valid');
   row_.row_number:=NULL;phase_:='replacement';
   IF finish_ AND t.kind='prices' AND coalesce((t.options->>'replace_all')::boolean,false) AND NOT coalesce((t.result->>'replacement_done')::boolean,false) THEN
    -- Archive exactly the affected-SKU candidates seen during validation.
    -- Concurrent newly created prices are preserved; changed candidates fail
    -- their own version check instead of overwriting another administrator.
    FOR v IN SELECT jsonb_build_object('id',price_id,'expectedUpdatedAt',expected_version) FROM sa_domain.transfer_replacements WHERE transfer_id=t.id AND NOT applied ORDER BY price_id LIMIT 50 FOR UPDATE LOOP
      PERFORM sa_admin.master_request('rmp_prices','delete',v);count_:=count_+1;
      UPDATE sa_domain.transfer_replacements SET applied=true WHERE transfer_id=t.id AND price_id=(v->>'id')::bigint;
    END LOOP;
    IF count_=50 THEN finish_:=false;ELSE UPDATE sa_domain.transfers SET result=result||'{"replacement_done":true}' WHERE id=t.id;END IF;
   END IF;
   phase_:='zone_rules';
   IF finish_ AND t.kind='zones' THEN
    last_:=coalesce((t.result->>'last_user_id')::bigint,0);count_:=0;
    FOR person_ IN SELECT id FROM sa_snapshot_20261019.sa_users WHERE id>last_ AND deleted_at IS NULL AND CASE WHEN coalesce(t.result->>'rules_phase','people')='people' THEN role<>3 ELSE role=3 END ORDER BY id LIMIT 50 LOOP
     rules_:=sa_domain.address_rule_values(person_);
     UPDATE sa_snapshot_20261019.sa_users SET zone_id=(rules_->>'zone_id')::bigint,rmp_price_type_id=(rules_->>'price_type_id')::bigint,updated_at=now() WHERE id=person_ AND(zone_id IS DISTINCT FROM(rules_->>'zone_id')::bigint OR rmp_price_type_id IS DISTINCT FROM(rules_->>'price_type_id')::bigint);
     last_:=person_;count_:=count_+1;
    END LOOP;
    IF count_>0 THEN UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1,updated_at=now() WHERE singleton;END IF;
    UPDATE sa_domain.transfers SET result=result||jsonb_build_object('last_user_id',last_,'zone_rules','future_orders_only') WHERE id=t.id;
    finish_:=count_<50;
    IF finish_ AND coalesce(t.result->>'rules_phase','people')='people' THEN
     UPDATE sa_domain.transfers SET result=result||'{"rules_phase":"customers","last_user_id":0}' WHERE id=t.id;finish_:=false;
    END IF;
   END IF;
   UPDATE sa_domain.transfers SET applied_rows=(SELECT count(*) FROM sa_domain.transfer_rows WHERE transfer_id=t.id AND state='applied'),result=result||jsonb_build_object('apply_revision',(SELECT edit_revision FROM sa_sync.environment_state)),revision=revision+1,state=CASE WHEN finish_ THEN 'completed' ELSE state END,completed_at=CASE WHEN finish_ THEN now() END WHERE id=t.id;
   IF finish_ THEN state_:='done';END IF;
  ELSIF p_action='checkpoint' AND j.event_type='transfer.export' THEN
   PERFORM sa_domain.check_fields(p_input,ARRAY['part_number','path','bytes','sha256']);SELECT count(*) INTO part_ FROM sa_domain.transfer_parts WHERE transfer_id=t.id;
   path_:='g'||t.generation::text||'/'||t.id::text||'/part-'||lpad(part_::text,4,'0')||'.csv';
   IF(p_input->>'part_number')::int IS DISTINCT FROM part_ OR p_input->>'path' IS DISTINCT FROM path_ OR p_input->>'sha256' IS NULL OR p_input->>'sha256'!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid export part' USING ERRCODE='22023';END IF;
   next_:=sa_domain.input_number(p_input->'bytes',0,10485760);
   IF next_+(SELECT coalesce(sum(bytes),0) FROM sa_domain.transfer_parts WHERE transfer_id=t.id)>10485760 THEN RAISE EXCEPTION 'Export limit' USING ERRCODE='54000';END IF;
   INSERT INTO sa_domain.transfer_parts VALUES(t.id,part_,path_,next_,p_input->>'sha256');
   UPDATE sa_domain.transfers SET row_offset=least(total_rows,row_offset+100),revision=revision+1 WHERE id=t.id;
  ELSIF p_action='complete' AND j.event_type='transfer.export' THEN
   PERFORM sa_domain.check_fields(p_input,ARRAY['bytes','sha256']);next_:=sa_domain.input_number(p_input->'bytes',1,10485760);
   IF t.row_offset<t.total_rows OR NOT EXISTS(SELECT FROM sa_domain.transfer_parts WHERE transfer_id=t.id) OR next_<>(SELECT sum(bytes) FROM sa_domain.transfer_parts WHERE transfer_id=t.id) OR p_input->>'sha256' IS NULL OR p_input->>'sha256'!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid export completion' USING ERRCODE='22023';END IF;
   UPDATE sa_domain.transfers SET state='completed',completed_at=now(),revision=revision+1,result=result||jsonb_build_object('bucket','squad-transfers','path','g'||t.generation::text||'/'||t.id::text||'/export.csv','bytes',next_,'sha256',p_input->>'sha256') WHERE id=t.id;state_:='done';
  ELSIF p_action='fail' THEN
   PERFORM sa_domain.check_fields(p_input,ARRAY['code']);code_:=p_input->>'code';
   IF code_ IS NULL OR code_ NOT IN('CSV_INVALID','STORAGE_UNAVAILABLE','TRANSFER_LIMIT','EXPORT_FAILED') THEN RAISE EXCEPTION 'Unknown failure code' USING ERRCODE='22023';END IF;
   IF code_<>'STORAGE_UNAVAILABLE' OR j.attempts>=5 THEN state_:='dead';ELSE state_:='pending';END IF;
   UPDATE sa_domain.transfers SET state=CASE WHEN state_='dead' THEN 'failed' ELSE state END,error_code=code_,revision=revision+1 WHERE id=t.id;
  ELSE RAISE EXCEPTION 'Unknown transfer action' USING ERRCODE='22023';END IF;
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS code_=RETURNED_SQLSTATE;
  IF code_ NOT IN('42501','28000','P0002','40001') AND p_action NOT IN('apply','input') THEN RAISE;END IF;
  IF code_ IN('40P01','55P03','57014','53300','55000') THEN RAISE;END IF;
  IF code_='PT409' THEN code_:='40001';END IF;
  state_:='dead';
  IF p_action='apply' AND row_.row_number IS NOT NULL THEN UPDATE sa_domain.transfer_rows SET state='failed',errors=jsonb_build_array(jsonb_build_object('code',code_)) WHERE transfer_id=t.id AND row_number=row_.row_number;END IF;
  UPDATE sa_domain.transfers SET state='failed',error_code=code_,revision=revision+1,result=result||CASE WHEN phase_ IS NOT NULL THEN jsonb_build_object('failure_phase',phase_) ELSE '{}'::jsonb END WHERE id=t.id;
 END;
 DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 UPDATE sa_domain.job_attempts SET state=CASE WHEN state_='dead' THEN 'failed' ELSE 'done' END,finished_at=now(),error_code=code_ WHERE lease_token=j.lease_token;
 r:=jsonb_build_object('state',state_,'action',p_action,'input_hash',md5(p_input::text),'transfer_id',t.id,'error_code',code_);
 UPDATE sa_domain.outbox SET status=state_,attempts=CASE WHEN code_ IS NULL THEN 0 ELSE attempts END,lease_until=NULL,available_at=now()+CASE WHEN code_='STORAGE_UNAVAILABLE' THEN interval '60 seconds' ELSE interval '0 seconds' END,completed_at=CASE WHEN state_<>'pending' THEN now() END,last_error_code=code_,result=r,revision=revision+1 WHERE id=j.id;
 RETURN r-'input_hash'-'action';
END $f$;
ALTER FUNCTION sa_domain.squad_transfer_work(uuid,uuid,text,jsonb) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_transfer_work(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_transfer_work(uuid,uuid,text,jsonb) TO service_role;
CREATE FUNCTION canto_api.squad_transfer_work(p_id uuid,p_lease_token uuid,p_action text,p_input jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_transfer_work(p_id,p_lease_token,p_action,p_input) $f$;
REVOKE ALL ON FUNCTION canto_api.squad_transfer_work(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.squad_transfer_work(uuid,uuid,text,jsonb) TO service_role;
CREATE FUNCTION sa_domain.account_transfer_grant(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE t sa_domain.transfers;
BEGIN SELECT * INTO t FROM sa_domain.transfers WHERE id=p_id;
 IF t.id IS NULL OR NOT sa_domain.transfer_current(t) THEN RAISE EXCEPTION 'Transfer unavailable' USING ERRCODE='P0002';END IF;
 IF t.direction<>'export' OR t.state<>'completed' OR t.expires_at<=now() THEN RAISE EXCEPTION 'Export unavailable' USING ERRCODE='55000';END IF;
 RETURN jsonb_build_object('id',t.id,'generation',t.generation::text)||t.result-ARRAY['snapshot_bytes','validation_revision','apply_revision'];END $f$;
ALTER FUNCTION sa_domain.account_transfer_grant(uuid) OWNER TO sa_media_writer;
REVOKE ALL ON FUNCTION sa_domain.account_transfer_grant(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.account_transfer_grant(uuid) TO authenticated,sa_app;
CREATE FUNCTION canto_api.account_transfer_grant(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.account_transfer_grant(p_id) $f$;
REVOKE ALL ON FUNCTION canto_api.account_transfer_grant(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.account_transfer_grant(uuid) TO authenticated,sa_app;
DO $f$ DECLARE d text;s text;BEGIN
 SELECT pg_get_functiondef('sa_domain.job_handler(text,jsonb)'::regprocedure) INTO d;d:=replace(d,'SELECT CASE WHEN', $s$SELECT CASE WHEN p_event IN('transfer.validate','transfer.apply','transfer.export') THEN 'transfer' WHEN$s$);EXECUTE d;
 FOREACH s IN ARRAY ARRAY['sa_domain.squad_job_claim(integer)','sa_domain.job_projection(sa_domain.outbox)'] LOOP
  SELECT pg_get_functiondef(s::regprocedure) INTO d;d:=replace(d,'''document_render''','''document_render'',''transfer''');EXECUTE d;
 END LOOP;
 SELECT pg_get_functiondef('sa_domain.squad_job_claim(integer)'::regprocedure) INTO d;
 -- At most one storage/render transfer per invocation; otherwise three 35 s
 -- storage deadlines could outlive the queue pump's HTTP execution window.
 d:=replace(d,$s$AND(event_type<>'document.requested' OR id=(SELECT x.id FROM sa_domain.outbox x WHERE x.generation=g AND x.attempts<5 AND x.status='pending' AND x.available_at<=now() AND x.event_type='document.requested' ORDER BY x.available_at,x.sequence_id LIMIT 1))$s$,
 $s$AND(event_type NOT IN('document.requested','transfer.validate','transfer.apply','transfer.export') OR id=(SELECT x.id FROM sa_domain.outbox x WHERE x.generation=g AND x.attempts<5 AND x.status='pending' AND x.available_at<=now() AND x.event_type IN('document.requested','transfer.validate','transfer.apply','transfer.export') ORDER BY x.available_at,x.sequence_id LIMIT 1))$s$);
 d:=replace(d,$s$ RETURN jsonb_build_object('jobs',result_,'paused',false);$s$,$s$
 UPDATE sa_domain.transfers t SET state='failed',error_code=j.last_error_code,revision=t.revision+1
 FROM sa_domain.outbox j WHERE t.job_id=j.id AND j.status='dead' AND t.state IN('queued','validating','applying','exporting');
 RETURN jsonb_build_object('jobs',result_,'paused',false);$s$);EXECUTE d;
 SELECT pg_get_functiondef('sa_domain.v1_job_retry(uuid,text,text,uuid)'::regprocedure) INTO d;
 d:=replace(d,$s$ UPDATE sa_domain.outbox SET status='pending',attempts=0$s$,$s$
 IF j.event_type IN('transfer.validate','transfer.apply','transfer.export') THEN
  DECLARE transfer_ sa_domain.transfers;BEGIN
   SELECT * INTO transfer_ FROM sa_domain.transfers WHERE job_id=j.id FOR UPDATE;
   IF transfer_.id IS NULL OR NOT sa_domain.transfer_current(transfer_) OR transfer_.expires_at<=now()+interval '5 minutes' OR transfer_.state IN('completed','cancelled','expired') THEN RAISE EXCEPTION 'Transfer requires a fresh request' USING ERRCODE='55000';END IF;
   UPDATE sa_domain.transfers SET state=CASE j.event_type WHEN 'transfer.validate' THEN 'validating' WHEN 'transfer.apply' THEN 'applying' ELSE CASE WHEN headers IS NULL THEN 'queued' ELSE 'exporting' END END,error_code=NULL,completed_at=NULL,revision=revision+1 WHERE id=transfer_.id;
  END;
 END IF;
 UPDATE sa_domain.outbox SET status='pending',attempts=0$s$);EXECUTE d;
END $f$;
CREATE INDEX squad_transfer_pending ON sa_domain.outbox(available_at,sequence_id) WHERE status IN('pending','leased') AND event_type IN('transfer.validate','transfer.apply','transfer.export');
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_worker,sa_media_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
