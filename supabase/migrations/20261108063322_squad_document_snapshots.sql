BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor,sa_guard,sa_worker;
-- Immutable render inputs and job state are operational records, not a second
-- customer/product/order database. Imported catalogue history stays canonical.
CREATE TABLE sa_domain.documents(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 actor_id uuid NOT NULL,legacy_user_id bigint NOT NULL,role_id integer NOT NULL,generation bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN('catalogue','delivery_challan','tailor_weekly')),
 request jsonb NOT NULL,authority_scope jsonb NOT NULL DEFAULT '{}', snapshot jsonb, snapshot_hash text,job_id uuid REFERENCES sa_domain.outbox,
 delivery_state text NOT NULL DEFAULT 'not_requested' CHECK(delivery_state IN('not_requested','pending','sent','failed')),state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','rendering','ready','failed','expired')),
 parts_cleanup_queued_at timestamptz,output_cleanup_queued_at timestamptz,part_size integer NOT NULL DEFAULT 100 CHECK(part_size IN(10,100)),parts jsonb NOT NULL DEFAULT '[]',next_part integer NOT NULL DEFAULT 0,object_path text,bytes bigint,sha256 text,page_count integer,error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),captured_at timestamptz,completed_at timestamptz,expires_at timestamptz,
 CHECK(octet_length(request::text)<=65536),CHECK(snapshot IS NULL OR octet_length(snapshot::text)<=8388608)
);
CREATE INDEX squad_documents_owner_page ON sa_domain.documents(actor_id,generation,sequence_id DESC);
CREATE INDEX squad_documents_retention ON sa_domain.documents(expires_at) WHERE state='ready';
ALTER TABLE sa_domain.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.documents FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sa_domain.documents TO sa_executor;
GRANT SELECT,UPDATE ON sa_domain.documents TO sa_worker;
GRANT USAGE ON SEQUENCE sa_domain.documents_sequence_id_seq TO sa_executor;
CREATE POLICY document_owner ON sa_domain.documents TO sa_executor USING(actor_id=(SELECT sa_domain.request_uid()) AND generation=(SELECT generation FROM sa_domain.runtime_state)) WITH CHECK(actor_id=(SELECT sa_domain.request_uid()) AND generation=(SELECT generation FROM sa_domain.runtime_state));
CREATE POLICY document_worker ON sa_domain.documents TO sa_worker USING(true) WITH CHECK(true);

CREATE FUNCTION sa_domain.document_ids(p_value jsonb) RETURNS bigint[]
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE ids_ bigint[];
BEGIN
 IF jsonb_typeof(p_value) IS DISTINCT FROM 'array' OR jsonb_array_length(p_value)>2000 THEN RAISE EXCEPTION 'Expected at most 2000 selection IDs' USING ERRCODE='22023';END IF;
 SELECT coalesce(array_agg(DISTINCT sa_domain.input_id(x)),'{}') INTO ids_ FROM jsonb_array_elements(p_value) x;RETURN ids_;
END $f$;

CREATE FUNCTION sa_domain.document_spec(p_kind text,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();k text;v jsonb;today_ date:=(now() AT TIME ZONE 'Asia/Kolkata')::date;week_ date;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('catalogue','delivery_challan','tailor_weekly') THEN RAISE EXCEPTION 'Unknown document kind' USING ERRCODE='22023';END IF;
 IF octet_length(p_request::text)>65536 THEN RAISE EXCEPTION 'Document request too large' USING ERRCODE='22023';END IF;
 IF p_kind='catalogue' THEN
  PERFORM sa_domain.catalog_actor('documents');
  PERFORM sa_domain.check_fields(p_request,ARRAY['selection','markup','company_name','company_desc','display_stock','bank_details','full_name','account_no','ifsc','display_address','building_name','area','remarks','terms','terms_reference','delivery']);
  PERFORM sa_domain.check_fields(coalesce(p_request->'selection','{}'),ARRAY['category_ids','brand_ids','class_ids','exclude_category_ids','exclude_brand_ids','exclude_class_ids','parent_category']);
  FOR k,v IN SELECT * FROM jsonb_each(coalesce(p_request->'selection','{}')) LOOP
   IF k='parent_category' THEN
    IF jsonb_typeof(v)<>'string' OR length(v#>>'{}') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid parent category' USING ERRCODE='22023';END IF;
   ELSE PERFORM sa_domain.document_ids(v);END IF;
  END LOOP;
  PERFORM sa_domain.check_fields(coalesce(p_request->'markup','{"kind":"percentage","value":"0"}'),ARRAY['kind','value']);
  IF coalesce(p_request->'markup'->>'kind','percentage') NOT IN('percentage','fixed') THEN RAISE EXCEPTION 'Invalid markup kind' USING ERRCODE='22023';END IF;
  PERFORM sa_domain.input_number(coalesce(p_request->'markup'->'value','"0"'),0,CASE WHEN p_request->'markup'->>'kind'='fixed' THEN 10000000 ELSE 10000 END);
  FOR k,v IN SELECT * FROM jsonb_each(p_request) WHERE key=ANY(ARRAY['company_name','company_desc','full_name','account_no','ifsc','building_name','area','remarks','terms']) LOOP
   IF jsonb_typeof(v)<>'string' OR length(v#>>'{}')>(CASE WHEN k='terms' THEN 8000 ELSE 1000 END) OR (v#>>'{}')~'[\x01-\x08\x0B\x0C\x0E-\x1F]' THEN RAISE EXCEPTION 'Invalid document text' USING ERRCODE='22023';END IF;
  END LOOP;
  FOR k,v IN SELECT * FROM jsonb_each(p_request) WHERE key=ANY(ARRAY['display_stock','bank_details','display_address']) LOOP
   IF jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'Document flag must be boolean' USING ERRCODE='22023';END IF;
  END LOOP;
  IF p_request?'terms_reference' THEN PERFORM sa_domain.account_media_resolve(jsonb_build_array(p_request->'terms_reference'));END IF;
 ELSIF p_kind='delivery_challan' THEN
  PERFORM sa_domain.require_roles(ARRAY[4,7,10]);
  PERFORM sa_domain.check_fields(p_request,ARRAY['item_id','dispatch_id','delivery']);
  IF NOT sa_domain.can_item(sa_domain.input_id(p_request->'item_id')) OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE id=sa_domain.input_id(p_request->'dispatch_id') AND item_id=sa_domain.input_id(p_request->'item_id')) THEN RAISE EXCEPTION 'Dispatch unavailable' USING ERRCODE='P0002';END IF;
 ELSE
  PERFORM sa_domain.require_roles(ARRAY[0,2,4]);
  PERFORM sa_domain.check_fields(p_request,ARRAY['tailor_id','week_start','include_team','delivery']);
  IF p_request?'include_team' AND jsonb_typeof(p_request->'include_team')<>'boolean' THEN RAISE EXCEPTION 'Team flag must be boolean' USING ERRCODE='22023';END IF;
  IF p_request?'week_start' AND (jsonb_typeof(p_request->'week_start')<>'string' OR NOT pg_input_is_valid(p_request->>'week_start','date')) THEN RAISE EXCEPTION 'Invalid week' USING ERRCODE='22023';END IF;
  week_:=coalesce((p_request->>'week_start')::date,today_-((extract(dow FROM today_)::int+1)%7)-7);
  -- Reuse the existing authorization, period and formula, with a bounded probe.
  PERFORM sa_domain.v1_tailor_earnings(sa_domain.input_id(p_request->'tailor_id'),week_,coalesce((p_request->>'include_team')::boolean,false),NULL,1);
  p_request:=p_request||jsonb_build_object('week_start',week_);
 END IF;
 IF p_request?'delivery' AND (jsonb_typeof(p_request->'delivery')<>'string' OR p_request->>'delivery' NOT IN('download','email')) THEN RAISE EXCEPTION 'Unknown document delivery' USING ERRCODE='22023';END IF;
 RETURN p_request;
END $f$;

CREATE FUNCTION sa_domain.document_current(d sa_domain.documents) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();brands_ bigint[];items_ bigint[];
BEGIN
 IF d.actor_id<>a.auth_id OR d.role_id<>a.role_id OR d.generation<>(SELECT generation FROM sa_domain.runtime_state) THEN RETURN false;END IF;
 IF d.kind='catalogue' THEN
  IF NOT(sa_domain.effective_capabilities(a.role_id,a.features)->>'documents')::boolean THEN RETURN false;END IF;
  SELECT coalesce(array_agg(x),'{}') INTO brands_ FROM sa_domain.catalog_brand_ids() x;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(d.authority_scope->'brands','[]')) r WHERE r::bigint<>ALL(brands_)) THEN RETURN false;END IF;
 ELSIF d.kind='delivery_challan' THEN
  IF a.role_id NOT IN(4,7,10) OR NOT sa_domain.can_item((d.request->>'item_id')::bigint) THEN RETURN false;END IF;
 ELSE
  IF a.role_id NOT IN(0,2,4) OR NOT sa_domain.can_person((d.request->>'tailor_id')::bigint) THEN RETURN false;END IF;
  IF a.role_id=4 AND sa_domain.effective_factory((d.request->>'tailor_id')::bigint) IS DISTINCT FROM a.factory_id THEN RETURN false;END IF;
  SELECT coalesce(array_agg(x),'{}') INTO items_ FROM sa_domain.scope_item_ids() x;
  IF EXISTS(SELECT FROM jsonb_array_elements_text(coalesce(d.authority_scope->'items','[]')) r WHERE r::bigint<>ALL(items_)) THEN RETURN false;END IF;
 END IF;
 IF d.request?'terms_reference' THEN
  IF NOT sa_domain.media_allowed(d.request->'terms_reference'->>'resource',(d.request->'terms_reference'->>'record_id')::bigint) THEN RETURN false;END IF;
 END IF;
 RETURN true;
END $f$;

CREATE FUNCTION sa_domain.document_projection(d sa_domain.documents) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',d.id,'kind',d.kind,'job_id',d.job_id,'state',CASE WHEN d.expires_at<=now() THEN 'expired' ELSE d.state END,
 'created_at',d.created_at,'captured_at',d.captured_at,'completed_at',d.completed_at,'expires_at',d.expires_at,'generation',d.generation::text,
 'completed_parts',d.next_part,'total_parts',CASE WHEN d.snapshot IS NULL THEN NULL ELSE greatest(1,ceil(jsonb_array_length(d.snapshot->'rows')/d.part_size::numeric)::integer) END,'pages',d.page_count,'bytes',d.bytes::text,'error_code',d.error_code,'delivery',coalesce(d.request->>'delivery','download'),'delivery_state',d.delivery_state,'snapshot_hash',d.snapshot_hash)
$f$;

CREATE FUNCTION sa_domain.v1_document_request(p_kind text,p_request jsonb,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();cached jsonb;spec_ jsonb;d sa_domain.documents;result_ jsonb;
BEGIN
 spec_:=sa_domain.document_spec(p_kind,p_request);
 cached:=sa_domain.begin_command('document.requested',p_idempotency_key,jsonb_build_object('kind',p_kind,'request',spec_));
 IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('document-owner:'||a.auth_id,784144));
 IF (SELECT count(*) FROM sa_domain.documents WHERE actor_id=a.auth_id AND generation=(SELECT generation FROM sa_domain.runtime_state) AND created_at>now()-interval '1 hour')>=20 THEN RAISE EXCEPTION 'Document quota reached' USING ERRCODE='54000';END IF;
 INSERT INTO sa_domain.documents(actor_id,legacy_user_id,role_id,generation,kind,request,delivery_state)
 SELECT a.auth_id,a.user_id,a.role_id,generation,p_kind,spec_,CASE WHEN spec_->>'delivery'='email' THEN 'pending' ELSE 'not_requested' END FROM sa_domain.runtime_state RETURNING * INTO d;
 result_:=sa_domain.finish_command('document.requested',p_idempotency_key,'document',d.sequence_id,jsonb_build_object('id',d.id,'kind',p_kind,'state','queued','generation',d.generation::text),jsonb_build_object('document_id',d.id));
 UPDATE sa_domain.documents SET job_id=(SELECT id FROM sa_domain.outbox WHERE actor_id=a.auth_id AND command_key=p_idempotency_key AND event_type='document.requested') WHERE id=d.id;
 RETURN result_;
END $f$;

CREATE FUNCTION sa_domain.v1_document_get(p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();d sa_domain.documents;c sa_snapshot_20261019.sa_catalogues;
BEGIN
 IF p_id~'^legacy:[1-9][0-9]{0,18}$' AND pg_input_is_valid(substring(p_id FROM 8),'bigint') THEN
  PERFORM sa_domain.catalog_actor('documents');
  SELECT * INTO c FROM sa_snapshot_20261019.sa_catalogues WHERE id=substring(p_id FROM 8)::bigint AND user_id=a.user_id;
  IF c.id IS NOT NULL THEN RETURN jsonb_build_object('id',p_id,'kind','catalogue','state',CASE WHEN c.is_expired THEN 'expired' WHEN c.status=1 THEN 'ready' WHEN c.status=2 THEN 'failed' ELSE 'legacy_pending' END,'created_at',c.created_at AT TIME ZONE 'UTC','generation',(SELECT generation::text FROM sa_domain.runtime_state),'media_reference',CASE WHEN c.status=1 AND NOT c.is_expired THEN jsonb_build_object('resource','catalogues','record_id',c.id::text,'field','url') END);END IF;
 ELSIF pg_input_is_valid(p_id,'uuid') THEN
  SELECT * INTO d FROM sa_domain.documents WHERE id=p_id::uuid;
  IF d.id IS NOT NULL AND sa_domain.document_current(d) THEN RETURN sa_domain.document_projection(d);END IF;
 END IF;
 RAISE EXCEPTION 'Document unavailable' USING ERRCODE='P0002';
END $f$;

CREATE FUNCTION sa_domain.v1_documents_list(p_kind text DEFAULT NULL,p_state text DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30,p_legacy boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();n integer:=sa_domain.page_limit(p_limit);ctx jsonb;after_ bigint;r jsonb;
BEGIN
 IF p_kind IS NOT NULL AND p_kind NOT IN('catalogue','delivery_challan','tailor_weekly') OR p_state IS NOT NULL AND p_state NOT IN('queued','rendering','ready','failed','expired','legacy_pending') OR p_legacy IS NULL THEN RAISE EXCEPTION 'Invalid document filter' USING ERRCODE='22023';END IF;
 ctx:=sa_domain.page_context('documents',jsonb_build_object('kind',p_kind,'state',p_state,'legacy',p_legacy));after_:=sa_domain.cursor_id(p_cursor,ctx);
 IF p_legacy THEN
  PERFORM sa_domain.catalog_actor('documents');
  IF p_kind IS NOT NULL AND p_kind<>'catalogue' THEN RAISE EXCEPTION 'Legacy history contains catalogues only' USING ERRCODE='22023';END IF;
  WITH scan AS MATERIALIZED(SELECT c.id FROM sa_snapshot_20261019.sa_catalogues c WHERE c.user_id=a.user_id AND c.id<after_ AND(p_state IS NULL OR p_state=CASE WHEN c.is_expired THEN 'expired' WHEN c.status=1 THEN 'ready' WHEN c.status=2 THEN 'failed' ELSE 'legacy_pending' END) ORDER BY c.id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
  SELECT jsonb_build_object('data',coalesce(jsonb_agg(sa_domain.v1_document_get('legacy:'||id) ORDER BY id DESC),'[]'),'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;
 ELSE
  WITH scan AS MATERIALIZED(SELECT d FROM sa_domain.documents d WHERE d.sequence_id<after_ AND(p_kind IS NULL OR d.kind=p_kind) AND(p_state IS NULL OR p_state=CASE WHEN d.expires_at<=now() THEN 'expired' ELSE d.state END) AND sa_domain.document_current(d) ORDER BY d.sequence_id DESC LIMIT n+1),page AS(SELECT d FROM scan ORDER BY(d).sequence_id DESC LIMIT n)
  SELECT jsonb_build_object('data',coalesce(jsonb_agg(sa_domain.document_projection(d) ORDER BY(d).sequence_id DESC),'[]'),'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min((d).sequence_id),ctx) END) INTO r FROM page;
 END IF;
 RETURN r||jsonb_build_object('generation',(SELECT generation::text FROM sa_domain.runtime_state),'as_of',now());
END $f$;

GRANT SELECT ON sa_snapshot_20261019.sa_catalogues TO sa_executor;
CREATE POLICY squad_document_legacy_read ON sa_snapshot_20261019.sa_catalogues FOR SELECT TO sa_executor USING(user_id=(SELECT(sa_domain.actor()).user_id));
CREATE INDEX squad_catalogues_owner_page ON sa_snapshot_20261019.sa_catalogues(user_id,id DESC);
DO $f$ DECLARE f record;args_ text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames,p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='sa_domain' AND p.proname=ANY(ARRAY['document_ids','document_spec','document_current','document_projection','v1_document_request','v1_document_get','v1_documents_list']) LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO sa_executor',f.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',f.oid::regprocedure);
  IF left(f.proname,3)='v1_' THEN
   SELECT string_agg(quote_ident(x),',') INTO args_ FROM unnest(f.proargnames) x;
   EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',f.proname,pg_get_function_arguments(f.oid),CASE WHEN f.provolatile='s' THEN 'STABLE' ELSE 'VOLATILE' END,'SELECT sa_domain.'||f.proname||'('||args_||')');
   EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s,canto_api.%I(%s) TO sa_app',f.oid::regprocedure,f.proname,pg_get_function_identity_arguments(f.oid));
  END IF;
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor,sa_guard,sa_worker;
NOTIFY pgrst,'reload schema';
COMMIT;
