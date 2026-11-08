BEGIN;
-- This immutable scalar uses only built-in numeric comparisons and casts.
-- Its SET clause prevented SQL inlining once per monetary field per fact.
ALTER FUNCTION sa_domain.report_money(numeric) RESET search_path;
-- Dashboard admins remain platform principals: no synthetic legacy user or JWT.
-- Only the allowlisted dispatcher can establish this transaction-local context.
DO $f$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='sa_dashboard') THEN
  CREATE ROLE sa_dashboard NOLOGIN NOINHERIT NOBYPASSRLS;
 END IF;
END $f$;
GRANT sa_dashboard TO postgres;
GRANT USAGE ON SCHEMA sa_domain,sa_admin,canto_api TO sa_dashboard;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor,sa_worker;
GRANT CREATE ON SCHEMA canto_api TO sa_dashboard;
CREATE TABLE sa_domain.dashboard_context(
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,actor_id uuid NOT NULL,
 PRIMARY KEY(backend_pid,transaction_id)
);
ALTER TABLE sa_domain.dashboard_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.dashboard_context FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON sa_domain.dashboard_context TO sa_dashboard;
GRANT SELECT ON sa_domain.dashboard_context TO sa_guard;
CREATE POLICY dashboard_context_dispatch ON sa_domain.dashboard_context TO sa_dashboard USING(true) WITH CHECK(true);
CREATE POLICY dashboard_context_guard ON sa_domain.dashboard_context FOR SELECT TO sa_guard USING(true);
CREATE TABLE sa_domain.dashboard_effects(
 job_id uuid PRIMARY KEY REFERENCES sa_domain.outbox,actor_id uuid NOT NULL,generation bigint NOT NULL,
 customer_id bigint NOT NULL
);
ALTER TABLE sa_domain.dashboard_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.dashboard_effects FORCE ROW LEVEL SECURITY;
GRANT SELECT ON sa_domain.dashboard_effects TO sa_guard;
GRANT SELECT,INSERT ON sa_domain.dashboard_effects TO sa_executor;
CREATE POLICY dashboard_effect_guard ON sa_domain.dashboard_effects FOR SELECT TO sa_guard USING(true);
CREATE POLICY dashboard_effect_executor ON sa_domain.dashboard_effects TO sa_executor
 USING(actor_id=(SELECT sa_domain.request_uid())) WITH CHECK(actor_id=(SELECT sa_domain.request_uid()));

CREATE FUNCTION sa_domain.dashboard_actor_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT sa_domain.request_uid() WHERE sa_admin.is_admin() AND (
  EXISTS(SELECT FROM sa_domain.dashboard_context c WHERE c.backend_pid=pg_backend_pid()
   AND c.transaction_id=txid_current() AND c.actor_id=sa_domain.request_uid())
  OR EXISTS(SELECT FROM sa_domain.worker_context c JOIN sa_domain.dashboard_effects e ON e.job_id=c.job_id
   WHERE c.backend_pid=pg_backend_pid() AND c.transaction_id=txid_current()
   AND e.actor_id=sa_domain.worker_actor_id() AND e.generation=c.generation))
$f$;
ALTER FUNCTION sa_domain.dashboard_actor_id() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.dashboard_actor_id() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.dashboard_actor_id() TO sa_executor,sa_dashboard;
DO $f$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('sa_domain.actor()'::regprocedure);
 IF position('SELECT * INTO context_ FROM sa_domain.auth_context();' IN d)=0 THEN RAISE EXCEPTION 'Unexpected actor contract';END IF;
 d:=replace(d,'SELECT * INTO context_ FROM sa_domain.auth_context();',
 $s$IF sa_domain.dashboard_actor_id() IS NOT NULL THEN
   RETURN ROW(sa_domain.dashboard_actor_id(),NULL,0,NULL,'[]'::jsonb)::sa_domain.actor;
  END IF;
  SELECT * INTO context_ FROM sa_domain.auth_context();$s$);
 EXECUTE d;
END $f$;

GRANT SELECT(created_at,gst_no,customer_registered_by,rmp_price_type_id,is_direct_deal,zone_id,onboarded,
 customer_company_name,customer_first_name,customer_last_name,phone,updated_at,approved_at,onboarded_at)
 ON sa_snapshot_20261019.sa_users TO sa_guard;
GRANT SELECT ON sa_snapshot_20261019.sa_addresses,sa_snapshot_20261019.sa_zones,
 sa_snapshot_20261019.sa_rmp_price_types TO sa_guard;
CREATE POLICY dashboard_address_guard ON sa_snapshot_20261019.sa_addresses FOR SELECT TO sa_guard USING(true);
CREATE POLICY dashboard_zone_guard ON sa_snapshot_20261019.sa_zones FOR SELECT TO sa_guard USING(true);
CREATE POLICY dashboard_price_type_guard ON sa_snapshot_20261019.sa_rmp_price_types FOR SELECT TO sa_guard USING(true);
GRANT SELECT ON sa_domain.entity_versions TO sa_guard;
CREATE POLICY dashboard_version_guard ON sa_domain.entity_versions FOR SELECT TO sa_guard USING(true);
GRANT EXECUTE ON FUNCTION sa_domain.version(text,bigint) TO sa_guard;

GRANT EXECUTE ON FUNCTION sa_domain.job_handler(text,jsonb) TO sa_guard;
CREATE INDEX dashboard_customer_jobs ON sa_domain.outbox(aggregate_id,generation,event_type,sequence_id DESC) WHERE aggregate_kind='person';
CREATE FUNCTION sa_domain.dashboard_customer_effects(p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('account_sync',(SELECT jsonb_build_object('state',j.status,'error_code',j.last_error_code) FROM sa_domain.outbox j
  WHERE j.aggregate_kind='person' AND j.aggregate_id=p_id AND j.generation=(SELECT generation FROM sa_domain.runtime_state)
  AND sa_domain.job_handler(j.event_type,j.payload)='account_reconciliation' ORDER BY j.sequence_id DESC LIMIT 1),
 'warehouse_sync',(SELECT jsonb_build_object('state',j.status,'error_code',j.last_error_code) FROM sa_domain.outbox j
  WHERE j.aggregate_kind='person' AND j.aggregate_id=p_id AND j.generation=(SELECT generation FROM sa_domain.runtime_state)
  AND j.event_type='warehouse.customer' ORDER BY j.sequence_id DESC LIMIT 1))
 WHERE sa_domain.dashboard_actor_id() IS NOT NULL
$f$;
ALTER FUNCTION sa_domain.dashboard_customer_effects(bigint) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.dashboard_customer(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r jsonb;BEGIN
 IF sa_domain.dashboard_actor_id() IS NULL THEN RAISE EXCEPTION 'Dashboard administrator required' USING ERRCODE='42501';END IF;
 SELECT jsonb_build_object('id',u.id::text,'version',sa_domain.version('person',u.id),
  'customer_code',CASE s.environment WHEN 'production' THEN 'P-' ELSE 'S-' END||u.id,
  'company_name',coalesce(nullif(u.customer_company_name,''),u.name),'contact_person',coalesce(nullif(concat_ws(' ',u.customer_first_name,u.customer_last_name),''),u.name),
  'email',u.email,'phone',u.phone,'gst',u.gst_no,'customer_type',CASE WHEN pt.name ILIKE '%distributor%' THEN 'distributor' ELSE 'retail' END,
  'is_owner_distributor',false,'direct',coalesce(u.is_direct_deal,false),'price_type_id',u.rmp_price_type_id::text,
  'rmp_price_type_name',pt.name,'zone_id',u.zone_id::text,'zone_name',z.name,'zone',jsonb_build_object('id',u.zone_id::text,'name',z.name),
  'status',CASE WHEN u.disabled THEN 'inactive' ELSE 'active' END,'approved',CASE WHEN u.approved THEN 'Yes' ELSE 'No' END,
  'onboarded',CASE WHEN u.onboarded THEN 'Yes' ELSE 'No' END,'created_at',u.created_at,'updated_at',u.updated_at,
  'registered_by',CASE u.customer_registered_by WHEN 0 THEN 'Self' WHEN 1 THEN 'Sales Coordinator' WHEN 2 THEN 'Dealer' WHEN 3 THEN 'Admin' END,
  'last_order_date',(SELECT max(coalesce(created_on,created_at)) AT TIME ZONE 'UTC' FROM sa_snapshot_20261019.sa_orders WHERE customer_id=u.id AND deleted_at IS NULL AND is_deleted IS NOT TRUE),
  'dealer_name',(SELECT d.name FROM sa_snapshot_20261019.sa_user_dealers ud JOIN sa_snapshot_20261019.sa_users d ON d.id=ud.dealer_id WHERE ud.user_id=u.id AND u.is_direct_deal IS NOT TRUE ORDER BY d.id LIMIT 1),
  'sc_name',sc.name,'sc_email',sc.email,'coordinator_id',u.created_by_id::text,
  'addresses',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id::text,'version',sa_domain.version('address',a.id),
   'label','Primary','type','office','address',a.address,'city',jsonb_build_object('name',a.city),'state',jsonb_build_object('name',a.state),
   'postal_code',a.zip_code,'is_primary',a.is_primary) ORDER BY a.is_primary DESC,a.id)
   FROM sa_snapshot_20261019.sa_addresses a WHERE a.user_id=u.id AND a.deleted_at IS NULL),'[]'),
  'distributor_ids',CASE WHEN u.is_direct_deal THEN '[]'::jsonb ELSE coalesce((SELECT jsonb_agg(d.dealer_id::text ORDER BY d.dealer_id)
   FROM sa_snapshot_20261019.sa_user_dealers d WHERE d.user_id=u.id),'[]') END)
 INTO r FROM sa_snapshot_20261019.sa_users u CROSS JOIN sa_sync.environment_state s
 LEFT JOIN sa_snapshot_20261019.sa_zones z ON z.id=u.zone_id
 LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types pt ON pt.id=u.rmp_price_type_id
 LEFT JOIN sa_snapshot_20261019.sa_users sc ON sc.id=u.created_by_id
 WHERE u.id=p_id AND u.role=3 AND u.deleted_at IS NULL;
 IF r IS NULL THEN RAISE EXCEPTION 'Customer unavailable' USING ERRCODE='P0002';END IF;
 RETURN r||sa_domain.dashboard_customer_effects(p_id)||jsonb_build_object('address_line',r#>>'{addresses,0,address}','postal_code',r#>>'{addresses,0,postal_code}','city_name',r#>>'{addresses,0,city,name}','state_name',r#>>'{addresses,0,state,name}');
END $f$;
ALTER FUNCTION sa_domain.dashboard_customer(bigint) OWNER TO sa_guard;

CREATE INDEX dashboard_dealer_customer ON sa_snapshot_20261019.sa_user_dealers(user_id,dealer_id);

CREATE FUNCTION sa_domain.dashboard_customers(p_id bigint DEFAULT NULL) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF sa_domain.dashboard_actor_id() IS NULL THEN RAISE EXCEPTION 'Dashboard administrator required' USING ERRCODE='42501';END IF;
 RETURN QUERY WITH last_orders AS MATERIALIZED(SELECT customer_id,max(coalesce(created_on,created_at)) AT TIME ZONE 'UTC' at_ FROM sa_snapshot_20261019.sa_orders WHERE deleted_at IS NULL AND is_deleted IS NOT TRUE AND(p_id IS NULL OR customer_id=p_id) GROUP BY customer_id),
 dealers AS MATERIALIZED(SELECT DISTINCT ON(ud.user_id) ud.user_id,d.name FROM sa_snapshot_20261019.sa_user_dealers ud JOIN sa_snapshot_20261019.sa_users d ON d.id=ud.dealer_id WHERE p_id IS NULL OR ud.user_id=p_id ORDER BY ud.user_id,d.id),
 addresses AS MATERIALIZED(SELECT a.user_id,jsonb_agg(jsonb_build_object('id',a.id::text,'version',g.generation::text||':'||coalesce(av.revision,0)::text,
 'label','Primary','type','office','address',a.address,'city',jsonb_build_object('name',a.city),'state',jsonb_build_object('name',a.state),'postal_code',a.zip_code,'is_primary',a.is_primary) ORDER BY a.is_primary DESC,a.id) value
 FROM sa_snapshot_20261019.sa_addresses a CROSS JOIN sa_domain.runtime_state g LEFT JOIN sa_domain.entity_versions av ON av.kind='address' AND av.entity_id=a.id WHERE a.deleted_at IS NULL AND(p_id IS NULL OR a.user_id=p_id) GROUP BY a.user_id),
 distributors AS MATERIALIZED(SELECT user_id,jsonb_agg(dealer_id::text ORDER BY dealer_id) value FROM sa_snapshot_20261019.sa_user_dealers WHERE p_id IS NULL OR user_id=p_id GROUP BY user_id),
 projected(r) AS MATERIALIZED ( SELECT jsonb_build_object('id',u.id::text,'version',g.generation::text||':'||coalesce(ev.revision,0)::text,
  'customer_code',CASE s.environment WHEN 'production' THEN 'P-' ELSE 'S-' END||u.id,
  'company_name',coalesce(nullif(u.customer_company_name,''),u.name),'contact_person',coalesce(nullif(concat_ws(' ',u.customer_first_name,u.customer_last_name),''),u.name),
  'email',u.email,'phone',u.phone,'gst',u.gst_no,'customer_type',CASE WHEN pt.name ILIKE '%distributor%' THEN 'distributor' ELSE 'retail' END,
  'is_owner_distributor',false,'direct',coalesce(u.is_direct_deal,false),'price_type_id',u.rmp_price_type_id::text,
  'rmp_price_type_name',pt.name,'zone_id',u.zone_id::text,'zone_name',z.name,'zone',jsonb_build_object('id',u.zone_id::text,'name',z.name),
  'status',CASE WHEN u.disabled THEN 'inactive' ELSE 'active' END,'approved',CASE WHEN u.approved THEN 'Yes' ELSE 'No' END,
  'onboarded',CASE WHEN u.onboarded THEN 'Yes' ELSE 'No' END,'created_at',u.created_at,'updated_at',u.updated_at,
  'registered_by',CASE u.customer_registered_by WHEN 0 THEN 'Self' WHEN 1 THEN 'Sales Coordinator' WHEN 2 THEN 'Dealer' WHEN 3 THEN 'Admin' END,
  'last_order_date',lo.at_,
  'dealer_name',CASE WHEN u.is_direct_deal IS NOT TRUE THEN dl.name END,
  'sc_name',sc.name,'sc_email',sc.email,'coordinator_id',u.created_by_id::text,
  'addresses',coalesce(ad.value,'[]'),'distributor_ids',CASE WHEN u.is_direct_deal THEN '[]'::jsonb ELSE coalesce(di.value,'[]') END)
 FROM sa_snapshot_20261019.sa_users u CROSS JOIN sa_sync.environment_state s CROSS JOIN sa_domain.runtime_state g LEFT JOIN sa_domain.entity_versions ev ON ev.kind='person' AND ev.entity_id=u.id
 LEFT JOIN sa_snapshot_20261019.sa_zones z ON z.id=u.zone_id
 LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types pt ON pt.id=u.rmp_price_type_id
 LEFT JOIN sa_snapshot_20261019.sa_users sc ON sc.id=u.created_by_id
 LEFT JOIN last_orders lo ON lo.customer_id=u.id LEFT JOIN dealers dl ON dl.user_id=u.id LEFT JOIN addresses ad ON ad.user_id=u.id LEFT JOIN distributors di ON di.user_id=u.id
 WHERE(p_id IS NULL OR u.id=p_id) AND u.role=3 AND u.deleted_at IS NULL)
, jobs AS MATERIALIZED(SELECT DISTINCT ON(aggregate_id,sa_domain.job_handler(event_type,payload)) aggregate_id,sa_domain.job_handler(event_type,payload) handler,status,last_error_code
  FROM sa_domain.outbox WHERE aggregate_kind='person' AND generation=(SELECT generation FROM sa_domain.runtime_state)
  AND(p_id IS NULL OR aggregate_id=p_id) AND(sa_domain.job_handler(event_type,payload)='account_reconciliation' OR event_type='warehouse.customer')
  ORDER BY aggregate_id,sa_domain.job_handler(event_type,payload),sequence_id DESC),
 effects AS(SELECT aggregate_id,jsonb_build_object('account_sync',max(jsonb_build_object('state',status,'error_code',last_error_code)::text) FILTER(WHERE handler='account_reconciliation')::jsonb,
  'warehouse_sync',max(jsonb_build_object('state',status,'error_code',last_error_code)::text) FILTER(WHERE handler='warehouse')::jsonb) value FROM jobs GROUP BY aggregate_id)
 SELECT r||coalesce(e.value,'{"account_sync":null,"warehouse_sync":null}'::jsonb)||jsonb_build_object('address_line',r#>>'{addresses,0,address}','postal_code',r#>>'{addresses,0,postal_code}',
 'city_name',r#>>'{addresses,0,city,name}','state_name',r#>>'{addresses,0,state,name}') FROM projected LEFT JOIN effects e ON e.aggregate_id=(r->>'id')::bigint;
END $f$;
ALTER FUNCTION sa_domain.dashboard_customers(bigint) OWNER TO sa_guard;

-- Compose the actual domain commands in one transaction, preserving all their
-- relationship, historical-address, account and provider guards.
CREATE FUNCTION sa_domain.dashboard_customer_save(p_id bigint,p_values jsonb,p_version text,p_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r jsonb;cached_ jsonb;fields_ jsonb;old_ jsonb;address_ jsonb;old_address jsonb;links_ jsonb;
 id_ bigint:=p_id;role_ integer;version_ text;key_ uuid;n integer:=0;ids_ bigint[]:='{}';job_ record;BEGIN
 IF sa_domain.dashboard_actor_id() IS NULL THEN RAISE EXCEPTION 'Dashboard administrator required' USING ERRCODE='42501';END IF;
 PERFORM sa_domain.check_fields(p_values,ARRAY['company_name','contact_person','email','phone','gst','customer_code','customer_type','status','price_type_id','addresses','approved','onboarded','coordinator_id','distributor_ids','direct']);
 cached_:=sa_domain.begin_command('dashboard.customer_saved',p_key,jsonb_build_object('id',p_id,'values',p_values,'version',p_version));
 IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 IF p_id IS NOT NULL THEN
  old_:=sa_domain.dashboard_customer(p_id);
  IF p_version IS DISTINCT FROM old_->>'version' THEN RAISE EXCEPTION 'Customer changed; reload and retry' USING ERRCODE='PT409';END IF;
  IF p_values?'customer_code' AND p_values->>'customer_code' IS DISTINCT FROM old_->>'customer_code' THEN RAISE EXCEPTION 'Customer code cannot be changed' USING ERRCODE='22023';END IF;
 END IF;
 IF p_values?'customer_type' AND p_values->>'customer_type' NOT IN('retail','distributor') THEN RAISE EXCEPTION 'Invalid customer type' USING ERRCODE='22023';END IF;
 role_:=3; -- Dashboard customers are customers, including distributor price types.
 fields_:=jsonb_strip_nulls(jsonb_build_object('name',coalesce(p_values->>'contact_person',p_values->>'company_name',old_->>'contact_person'),
  'company_name',coalesce(p_values->>'company_name',old_->>'company_name'),'phone',coalesce(p_values->>'phone',old_->>'phone'),
  'email',coalesce(p_values->>'email',old_->>'email')));
 IF p_values?'contact_person' THEN fields_:=fields_||jsonb_build_object('first_name',p_values->>'contact_person','last_name','');END IF;
 IF p_values?'gst' THEN fields_:=fields_||jsonb_build_object('gst_no',p_values->'gst');END IF;
 r:=sa_domain.v1_person_save(p_id,role_,fields_,p_version,md5(p_key::text||':profile')::uuid);
 id_:=(r->>'id')::bigint;
 IF p_values?'addresses' THEN
  IF jsonb_typeof(p_values->'addresses')<>'array' OR jsonb_array_length(p_values->'addresses')>50 THEN RAISE EXCEPTION 'Invalid addresses' USING ERRCODE='22023';END IF;
  IF (SELECT count(*)<>count(DISTINCT value->>'id') FROM jsonb_array_elements(p_values->'addresses') WHERE nullif(value->>'id','') IS NOT NULL)
   OR (SELECT count(*) FROM jsonb_array_elements(p_values->'addresses') WHERE (value->>'is_primary')::boolean)>1 THEN
   RAISE EXCEPTION 'Duplicate addresses or multiple primary addresses' USING ERRCODE='22023';END IF;
  FOR address_ IN SELECT value FROM jsonb_array_elements(p_values->'addresses') LOOP
   n:=n+1;key_:=md5(p_key::text||':address:'||n)::uuid;
   IF nullif(address_->>'id','') IS NOT NULL THEN
    SELECT value INTO old_address FROM jsonb_array_elements(old_->'addresses') WHERE value->>'id'=address_->>'id';
    IF old_address IS NULL THEN RAISE EXCEPTION 'Address does not belong to customer' USING ERRCODE='42501';END IF;
    ids_:=array_append(ids_,(address_->>'id')::bigint);
   ELSE old_address:=NULL; END IF;
   fields_:=jsonb_build_object('address',address_->>'address','city',coalesce(address_#>>'{city,name}',address_->>'city_name'),
    'state',coalesce(address_#>>'{state,name}',address_->>'state_name'),'zip_code',address_->>'postal_code','is_primary',coalesce((address_->>'is_primary')::boolean,false));
   IF old_address IS NULL OR fields_ IS DISTINCT FROM jsonb_build_object('address',old_address->>'address','city',old_address#>>'{city,name}',
     'state',old_address#>>'{state,name}','zip_code',old_address->>'postal_code','is_primary',(old_address->>'is_primary')::boolean) THEN
    r:=sa_domain.v1_address_save(nullif(address_->>'id','')::bigint,id_,fields_,CASE WHEN old_address IS NOT NULL THEN sa_domain.version('address',(address_->>'id')::bigint) END,key_);
   END IF;
  END LOOP;
  FOR old_address IN SELECT value FROM jsonb_array_elements(coalesce(old_->'addresses','[]')) LOOP
   IF NOT (old_address->>'id')::bigint=ANY(ids_) THEN
    PERFORM sa_domain.v1_address_archive((old_address->>'id')::bigint,id_,sa_domain.version('address',(old_address->>'id')::bigint),md5(p_key::text||':remove:'||(old_address->>'id'))::uuid);
   END IF;
  END LOOP;
 END IF;
 IF p_values ?| ARRAY['approved','onboarded'] THEN
  SELECT coalesce(jsonb_object_agg(key,value),'{}') INTO fields_ FROM jsonb_each(p_values) WHERE key IN('approved','onboarded');
  PERFORM sa_domain.v1_customer_review(id_,fields_,'Dashboard customer save',sa_domain.version('person',id_),md5(p_key::text||':review')::uuid);
 END IF;
 IF p_values ?| ARRAY['coordinator_id','distributor_ids','direct'] THEN
  links_:=sa_domain.dashboard_customer(id_);
  PERFORM sa_domain.v1_customer_links_save(id_,nullif(CASE WHEN p_values?'coordinator_id' THEN p_values->>'coordinator_id' ELSE links_->>'coordinator_id' END,'')::bigint,
   ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(coalesce(p_values->'distributor_ids',links_->'distributor_ids'))),
   coalesce((p_values->>'direct')::boolean,(links_->>'direct')::boolean),
   'Dashboard customer save',sa_domain.version('person',id_),md5(p_key::text||':links')::uuid);
 END IF;
 IF p_values?'price_type_id' THEN
  PERFORM sa_domain.v1_customer_commercial_rules_save(id_,jsonb_build_object('price_type_id',nullif(p_values->>'price_type_id','')),
   'Dashboard customer save',sa_domain.version('person',id_),md5(p_key::text||':pricing')::uuid);
 END IF;
 IF p_values?'status' THEN
  IF p_values->>'status' NOT IN('active','inactive') THEN RAISE EXCEPTION 'Invalid customer status' USING ERRCODE='22023';END IF;
  IF p_values->>'status' IS DISTINCT FROM coalesce(old_->>'status','active') THEN
   PERFORM sa_domain.account_user_status(id_,CASE p_values->>'status' WHEN 'active' THEN 'enable' ELSE 'disable' END,
    'Dashboard customer save',sa_domain.version('person',id_),md5(p_key::text||':status')::uuid);
  END IF;
 END IF;
 IF p_values?'customer_type' AND p_values->>'customer_type' IS DISTINCT FROM sa_domain.dashboard_customer(id_)->>'customer_type' THEN
  RAISE EXCEPTION 'Customer type is determined by its price type; select a matching price type' USING ERRCODE='22023';
 END IF;
 r:=sa_domain.finish_command('dashboard.customer_saved',p_key,'person',id_,sa_domain.dashboard_customer(id_),jsonb_build_object('principal','platform'));
 INSERT INTO sa_domain.dashboard_effects(job_id,actor_id,generation,customer_id)
 SELECT j.id,j.actor_id,j.generation,id_ FROM sa_domain.outbox j WHERE j.actor_id=sa_domain.request_uid()
 AND j.created_at=transaction_timestamp() AND(j.aggregate_kind='person' AND j.aggregate_id=id_ OR j.aggregate_kind='address' AND j.aggregate_id IN(SELECT id FROM sa_snapshot_20261019.sa_addresses WHERE user_id=id_))
 ON CONFLICT DO NOTHING;
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.dashboard_customer_save(bigint,jsonb,text,uuid) OWNER TO sa_executor;

-- Reserve the parent command before looking up an archived customer, so a lost
-- response can be retried with the original version and key.
CREATE FUNCTION sa_domain.dashboard_customer_archive(p_id bigint,p_version text,p_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cached_ jsonb;r jsonb;BEGIN
 IF sa_domain.dashboard_actor_id() IS NULL THEN RAISE EXCEPTION 'Dashboard administrator required' USING ERRCODE='42501';END IF;
 cached_:=sa_domain.begin_command('dashboard.customer_archived',p_key,jsonb_build_object('id',p_id,'version',p_version));
 IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 PERFORM sa_domain.dashboard_customer(p_id);
 r:=sa_domain.account_user_status(p_id,'archive','Dashboard customer archive',p_version,md5(p_key::text||':archive')::uuid);
 INSERT INTO sa_domain.dashboard_effects(job_id,actor_id,generation,customer_id)
 SELECT id,actor_id,generation,p_id FROM sa_domain.outbox WHERE actor_id=sa_domain.request_uid()
 AND command_key=md5(p_key::text||':archive')::uuid AND event_type='account.status_changed'
 ON CONFLICT DO NOTHING;
 RETURN sa_domain.finish_command('dashboard.customer_archived',p_key,'person',p_id,r,jsonb_build_object('principal','platform'));
END $f$;
ALTER FUNCTION sa_domain.dashboard_customer_archive(bigint,text,uuid) OWNER TO sa_executor;

-- Composite events describe already-committed local work. Their child domain
-- events own account/provider work and retain their independent leased status.
CREATE FUNCTION sa_domain.dashboard_event_applied() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN NEW.status:='done';NEW.completed_at:=now();NEW.result:='{"state":"applied"}'::jsonb;RETURN NEW;END $f$;
ALTER FUNCTION sa_domain.dashboard_event_applied() OWNER TO sa_executor;
CREATE TRIGGER dashboard_event_applied BEFORE INSERT ON sa_domain.outbox FOR EACH ROW
 WHEN(NEW.event_type IN('dashboard.customer_saved','dashboard.customer_archived')) EXECUTE FUNCTION sa_domain.dashboard_event_applied();

CREATE FUNCTION sa_domain.dashboard_customer_options() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF sa_domain.dashboard_actor_id() IS NULL THEN RAISE EXCEPTION 'Dashboard administrator required' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('zones',(SELECT coalesce(jsonb_agg(jsonb_build_object('value',z.id::text,'label',z.name) ORDER BY z.name,z.id),'[]')
 FROM sa_snapshot_20261019.sa_zones z WHERE EXISTS(SELECT FROM sa_snapshot_20261019.sa_users u WHERE u.zone_id=z.id AND u.role=3 AND u.deleted_at IS NULL)));
END $f$;
ALTER FUNCTION sa_domain.dashboard_customer_options() OWNER TO sa_guard;

-- Reuse the shared sales facts; presentation adds the dashboard's established
-- labels, never source password fields or whole-row user JSON.
GRANT SELECT ON sa_snapshot_20261019.sa_items,sa_snapshot_20261019.sa_orders,
 sa_snapshot_20261019.sa_products,sa_snapshot_20261019.sa_base_products,sa_snapshot_20261019.sa_fabrics,
 sa_snapshot_20261019.sa_product_parts,sa_snapshot_20261019.sa_product_part_add_ons,sa_snapshot_20261019.sa_add_ons,
 sa_snapshot_20261019.sa_quantities,sa_snapshot_20261019.sa_sizes,sa_snapshot_20261019.sa_factories,
 sa_snapshot_20261019.sa_job_sheet_dispatched_dates,sa_snapshot_20261019.sa_rmp_brands,sa_snapshot_20261019.sa_rmp_classes,
 sa_snapshot_20261019.sa_rmp_colors,sa_snapshot_20261019.sa_rmp_categories,sa_snapshot_20261019.sa_rmp_skus,
 sa_snapshot_20261019.sa_rmp_sizes,sa_snapshot_20261019.sa_profit_margins,
 sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates,sa_snapshot_20261019.sa_job_sheet_mark_tailors,
 sa_snapshot_20261019.sa_mark_tailor_quantities,sa_snapshot_20261019.sa_item_tailor_quantities,
 sa_snapshot_20261019.sa_item_tailors TO sa_guard;
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['sa_products','sa_base_products','sa_fabrics','sa_product_parts','sa_product_part_add_ons','sa_add_ons','sa_quantities','sa_sizes','sa_factories','sa_job_sheet_dispatched_dates','sa_rmp_brands','sa_rmp_classes','sa_rmp_colors','sa_rmp_categories','sa_rmp_skus','sa_rmp_sizes','sa_profit_margins','sa_job_sheet_tailor_mark_dates','sa_job_sheet_mark_tailors','sa_mark_tailor_quantities','sa_item_tailor_quantities','sa_item_tailors'] LOOP
  EXECUTE format('CREATE POLICY dashboard_report_guard ON sa_snapshot_20261019.%I FOR SELECT TO sa_guard USING(true)',t);
 END LOOP;
END $f$;

-- RMP's 19-column projection uses one set-based SKU match, avoiding one lookup
-- per quantity for full-history filters and exports.
CREATE INDEX dashboard_quantity_mapping ON sa_snapshot_20261019.sa_quantities(item_id,size_id) WHERE quantity>0;

CREATE FUNCTION sa_domain.dashboard_rmp_rows(p_filters jsonb) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET plan_cache_mode=force_custom_plan SET work_mem='32MB' AS $f$
BEGIN
 RETURN QUERY WITH facts AS MATERIALIZED(SELECT item_id,order_id,ordered_at,customer_id,customer_name,coordinator_name,quantity,subtotal,branding,tax,brand_id,class_id
  FROM sa_domain.sales_rows(coalesce((p_filters->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata','-infinity'::timestamptz),
   coalesce((p_filters->>'before')::date::timestamp AT TIME ZONE 'Asia/Kolkata','infinity'::timestamptz),coalesce(p_filters->'domain','{}'))
  WHERE item_kind=1 AND(NOT p_filters?'id' OR item_id=(p_filters->>'id')::bigint)
   AND(NOT p_filters?'ids' OR item_id=ANY(ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(p_filters->'ids'))))),
 sku_map AS MATERIALIZED(SELECT k.rmp_brand_id brand_id,k.rmp_class_id class_id,rs.name size_name,
  string_agg(DISTINCT k.id::text,', ' ORDER BY k.id::text) ids,string_agg(DISTINCT k.name,', ' ORDER BY k.name) names,count(*) candidates
  FROM sa_snapshot_20261019.sa_rmp_skus k JOIN sa_snapshot_20261019.sa_rmp_sizes rs ON rs.id=k.rmp_size_id GROUP BY k.rmp_brand_id,k.rmp_class_id,rs.name),
 skus AS(SELECT f.item_id,string_agg(DISTINCT m.ids,', ' ORDER BY m.ids) ids,string_agg(DISTINCT m.names,', ' ORDER BY m.names) names,
  bool_or(m.candidates>1) ambiguous,bool_or(m.ids IS NULL) unmapped FROM facts f
  LEFT JOIN sa_snapshot_20261019.sa_quantities q ON q.item_id=f.item_id AND q.quantity>0
  LEFT JOIN sa_snapshot_20261019.sa_sizes z ON z.id=q.size_id
  LEFT JOIN sku_map m ON m.brand_id=f.brand_id AND m.class_id=f.class_id AND m.size_name=z.name GROUP BY f.item_id),
 dispatch AS(SELECT item_id,max(dispatched_at) at_ FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE item_id IN(SELECT item_id FROM facts) GROUP BY item_id)
 SELECT jsonb_build_object('id',f.item_id::text,'order_id','OD-'||prefix_||f.order_id,'order_number','OD-'||prefix_||f.order_id,
  'customer_id',f.customer_id::text,'customer_code',prefix_||f.customer_id,'customer_name',f.customer_name,'customer_type',pt.name,
  'order_date',f.ordered_at AT TIME ZONE 'UTC','quantity',f.quantity,'total_quantity',f.quantity,
  'price',CASE WHEN f.quantity>0 THEN sa_domain.report_money(f.subtotal/f.quantity) END,
  'total_amount',CASE WHEN sa_domain.report_money(f.subtotal) IS NOT NULL AND sa_domain.report_money(f.branding) IS NOT NULL AND f.tax IS NOT NULL THEN(f.subtotal+f.branding+f.tax)::text END,
  'order_status',CASE WHEN o.uc_status='CANCELLED' THEN 'CANCELLED' WHEN o.status=1 THEN 'COMPLETED' ELSE 'PENDING' END,
  'sales_coordinator',f.coordinator_name,'rmp_sku_id',CASE WHEN NOT(k.ambiguous OR k.unmapped) THEN k.ids END,'rmp_sku_name',CASE WHEN NOT(k.ambiguous OR k.unmapped) THEN k.names END,'sku_ambiguous',coalesce(k.ambiguous,false),'sku_unmapped',coalesce(k.unmapped,true),
  'dispatch_date',CASE WHEN i.dispatched_status=1 THEN d.at_ AT TIME ZONE 'UTC' END,'delivery_required_on',o.due_on AT TIME ZONE 'UTC',
  'expected_delivery_date',o.due_on AT TIME ZONE 'UTC','actual_delivery_date',CASE WHEN i.dispatched_status=1 THEN d.at_ AT TIME ZONE 'UTC' END,
  'created_at',i.created_at AT TIME ZONE 'UTC','updated_at',i.updated_at AT TIME ZONE 'UTC','basis','stored_item_gross_exact_decimal')
 FROM facts f JOIN sa_snapshot_20261019.sa_items i ON i.id=f.item_id JOIN sa_snapshot_20261019.sa_orders o ON o.id=f.order_id
 JOIN sa_snapshot_20261019.sa_users u ON u.id=f.customer_id LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types pt ON pt.id=u.rmp_price_type_id
 LEFT JOIN skus k ON k.item_id=f.item_id LEFT JOIN dispatch d ON d.item_id=f.item_id
 CROSS JOIN(SELECT CASE environment WHEN 'production' THEN 'P-' ELSE 'S-' END prefix_ FROM sa_sync.environment_state) env;
END $f$;
ALTER FUNCTION sa_domain.dashboard_rmp_rows(jsonb) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.dashboard_item_rows(p_kind text,p_filters jsonb) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET plan_cache_mode=force_custom_plan AS $f$
DECLARE chosen_ jsonb;
BEGIN
 IF p_kind='rmp_order_reports' THEN RETURN QUERY SELECT * FROM sa_domain.dashboard_rmp_rows(p_filters);RETURN;END IF;
 IF p_kind='tailor_reports' AND NOT p_filters?'ids' THEN
  SELECT coalesce(jsonb_agg(item_id::text),'[]') INTO chosen_ FROM sa_domain.sales_rows(
   coalesce((p_filters->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata','-infinity'::timestamptz),
   coalesce((p_filters->>'before')::date::timestamp AT TIME ZONE 'Asia/Kolkata','infinity'::timestamptz),coalesce(p_filters->'domain','{}')) f
  WHERE EXISTS(SELECT FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d WHERE d.item_id=f.item_id)
   AND(NOT p_filters?'id' OR f.item_id=(p_filters->>'id')::bigint);
  p_filters:=p_filters||jsonb_build_object('ids',chosen_);
 END IF;
 RETURN QUERY WITH facts AS MATERIALIZED(SELECT * FROM sa_domain.sales_rows(
   coalesce((p_filters->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata','-infinity'::timestamptz),
   coalesce((p_filters->>'before')::date::timestamp AT TIME ZONE 'Asia/Kolkata','infinity'::timestamptz),
   coalesce(p_filters->'domain','{}'))
  WHERE item_id IS NOT NULL AND (p_kind='order_reports' AND item_kind=0 OR p_kind='rmp_order_reports' AND item_kind=1 OR p_kind='tailor_reports')
   AND (NOT p_filters?'id' OR item_id=(p_filters->>'id')::bigint)
   AND (NOT p_filters?'ids' OR item_id=ANY(ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(p_filters->'ids'))))
   AND (p_kind<>'tailor_reports' OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates WHERE item_id=sales_rows.item_id))),
 quantities AS(SELECT q.item_id,sum(q.quantity) total,string_agg(upper(s.name)||'-'||q.quantity,', ' ORDER BY q.id) sizes
  FROM sa_snapshot_20261019.sa_quantities q LEFT JOIN sa_snapshot_20261019.sa_sizes s ON s.id=q.size_id WHERE q.item_id IN(SELECT item_id FROM facts) GROUP BY q.item_id),
 addons AS(SELECT pp.product_id,sum(a.add_on_price) price,sum(a.add_on_of) of_,sum(a.add_on_sn) sn_
  FROM sa_snapshot_20261019.sa_product_parts pp JOIN sa_snapshot_20261019.sa_product_part_add_ons pa ON pa.product_part_id=pp.id
  JOIN sa_snapshot_20261019.sa_add_ons a ON a.id=pa.add_on_id WHERE pp.product_id IN(SELECT i.product_id FROM facts f JOIN sa_snapshot_20261019.sa_items i ON i.id=f.item_id) GROUP BY pp.product_id),
 dispatch AS(SELECT item_id,max(dispatched_at) at_ FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE item_id IN(SELECT item_id FROM facts) GROUP BY item_id),
 tailor_first AS(SELECT DISTINCT ON(d.item_id) d.item_id,t.name,d.marked_at,m.updated_at
  FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d LEFT JOIN sa_snapshot_20261019.sa_job_sheet_mark_tailors m ON m.job_sheet_tailor_mark_date_id=d.id
  LEFT JOIN sa_snapshot_20261019.sa_item_tailors it ON it.id=m.item_tailor_id LEFT JOIN sa_snapshot_20261019.sa_users t ON t.id=it.tailor_id WHERE d.item_id IN(SELECT item_id FROM facts) ORDER BY d.item_id,d.id,m.id),
 tailor_sizes AS(SELECT d.item_id,s.name,sum(mq.completed_quantity) quantity FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d
  JOIN sa_snapshot_20261019.sa_job_sheet_mark_tailors m ON m.job_sheet_tailor_mark_date_id=d.id
  JOIN sa_snapshot_20261019.sa_mark_tailor_quantities mq ON mq.job_sheet_mark_tailor_id=m.id
  JOIN sa_snapshot_20261019.sa_item_tailor_quantities iq ON iq.id=mq.item_tailor_quantity_id
  JOIN sa_snapshot_20261019.sa_quantities q ON q.id=iq.quantity_id JOIN sa_snapshot_20261019.sa_sizes s ON s.id=q.size_id WHERE d.item_id IN(SELECT item_id FROM facts) GROUP BY d.item_id,s.name),
 tailor_total AS(SELECT item_id,sum(quantity) quantity,string_agg(upper(name)||'-'||quantity,', ' ORDER BY name) sizes FROM tailor_sizes GROUP BY item_id)
 SELECT jsonb_build_object('id',i.id::text,'order_id','OD-'||prefix_||o.id,'order_number',CASE WHEN p_kind='tailor_reports' THEN 'JS-'||prefix_||i.id ELSE 'OD-'||prefix_||o.id END,'jobsheet_number','JS-'||prefix_||i.id,
  'customer_id',f.customer_id::text,'customer_code',prefix_||f.customer_id,'customer_name',f.customer_name,'customer_type',pt.name,
  'order_date',f.ordered_at AT TIME ZONE 'UTC','created_at',i.created_at AT TIME ZONE 'UTC','updated_at',i.updated_at AT TIME ZONE 'UTC',
  'expected_delivery_date',o.due_on AT TIME ZONE 'UTC','delivery_required_on',o.due_on AT TIME ZONE 'UTC',
  'actual_delivery_date',CASE WHEN i.dispatched_status=1 THEN disp.at_ AT TIME ZONE 'UTC' END,'dispatch_date',CASE WHEN i.dispatched_status=1 THEN disp.at_ AT TIME ZONE 'UTC' END,
  'order_status',CASE WHEN o.uc_status='CANCELLED' THEN 'CANCELLED' WHEN o.status=1 THEN 'COMPLETED' ELSE 'PENDING' END,
  'status',CASE WHEN o.uc_status='CANCELLED' THEN 'CANCELLED' WHEN o.status=1 THEN 'COMPLETED' ELSE 'PENDING' END,
  'product',pr.name,'product_name',f.brand_name,'description',pr.comment,'factory',factory.name,'kam',creator.name,'created_by',creator.name,
  'sales_coordinator',f.coordinator_name,'total_quantity',CASE WHEN p_kind='tailor_reports' THEN coalesce(tt.quantity,0) WHEN i.item_type=0 THEN coalesce(q.total,0) ELSE i.total_quantity END,
  'quantity',i.total_quantity,'size_breakup',CASE WHEN p_kind='tailor_reports' THEN tt.sizes ELSE q.sizes END,
  'base_of',sa_domain.report_money(bp.base_of),'base_sn',sa_domain.report_money(bp.base_sn),'add_on_of',sa_domain.report_money(coalesce(ad.of_,0)),
  'add_on_sn',sa_domain.report_money(coalesce(ad.sn_,0)),'add_on_cost',sa_domain.report_money(coalesce(ad.price,0))
  )||jsonb_build_object('fabric_rate',sa_domain.report_money(fab.price),'fabric_consumption',sa_domain.report_money(i.weight_per_piece),'trims_cost',sa_domain.report_money(bp.tims_cost),
  'overhead',sa_domain.report_money(bp.over_header_percentage),'branding_cost',sa_domain.report_money(i.branding_amount),
  'subtotal',sa_domain.report_money(i.total_amount),'gst_amount',sa_domain.report_money(f.tax),'per_piece_amount',CASE WHEN i.total_quantity>0 THEN sa_domain.report_money(i.total_amount/i.total_quantity) END,
  'total_amount',CASE WHEN p_kind='tailor_reports' THEN CASE WHEN bp.base_of IS NOT NULL AND bp.base_sn IS NOT NULL THEN sa_domain.report_money(coalesce(tt.quantity,0)*(bp.base_of+bp.base_sn+coalesce(ad.of_,0)+coalesce(ad.sn_,0))) END ELSE CASE WHEN sa_domain.report_money(i.total_amount) IS NOT NULL AND sa_domain.report_money(i.branding_amount) IS NOT NULL AND sa_domain.report_money(f.tax) IS NOT NULL THEN (i.total_amount+i.branding_amount+f.tax)::text END END,
  'total_value',CASE WHEN sa_domain.report_money(i.total_amount) IS NOT NULL AND sa_domain.report_money(i.branding_amount) IS NOT NULL AND sa_domain.report_money(f.tax) IS NOT NULL THEN (i.total_amount+i.branding_amount+f.tax)::text END,'item_type',CASE i.item_type WHEN 0 THEN 'custom' ELSE 'RMP' END,
  'rmp_brand',f.brand_name,'rmp_class',f.class_name,'rmp_category',cat.name,'class_name',f.class_name,
  'rmp_sku_id',CASE WHEN NOT sk.ambiguous THEN sk.ids END,'price',CASE WHEN i.total_quantity>0 THEN sa_domain.report_money(i.total_amount/i.total_quantity) END,'rmp_sku_name',CASE WHEN NOT sk.ambiguous THEN sk.names END,'sku',CASE WHEN NOT sk.ambiguous THEN sk.names END,'sku_ambiguous',sk.ambiguous,
  'tailor_name',tf.name,'picking_date_time',tf.marked_at AT TIME ZONE 'UTC','updated_on',tf.updated_at AT TIME ZONE 'UTC','week_number',extract(week FROM tf.marked_at)
  )||jsonb_build_object('of_rate',sa_domain.report_money(bp.base_of+coalesce(ad.of_,0)),'sn_rate',sa_domain.report_money(bp.base_sn+coalesce(ad.sn_,0)),
  'of_amount',sa_domain.report_money(coalesce(tt.quantity,0)*(bp.base_of+coalesce(ad.of_,0))),
  'sn_amount',sa_domain.report_money(coalesce(tt.quantity,0)*(bp.base_sn+coalesce(ad.sn_,0))),
  'payment_status',NULL,'basis','stored_money_current_master_costs',
  'quantity_needs_reconciliation',q.total IS DISTINCT FROM i.total_quantity)
 ||jsonb_build_object('total_of',NULL,'total_sn',NULL,'total_stitching_cost',NULL,'total_add_on_cost',NULL,'fabric_used_kgs',NULL,
  'fabric_cost',NULL,'trims_cost_pc',sa_domain.report_money(bp.tims_cost),'total_trims_cost',NULL,'total_material_cost',NULL,'total_cost',NULL,'cogs',NULL,
  'margin_percentage',CASE WHEN mg.candidates=1 THEN sa_domain.report_money(mg.margin) END,
  'sales_value_ex_taxes',sa_domain.report_money(i.total_amount),'sp',sa_domain.report_money(i.per_piece_amount),
  'total_sales_including_branding',CASE WHEN sa_domain.report_money(i.total_amount) IS NOT NULL AND sa_domain.report_money(i.branding_amount) IS NOT NULL THEN (i.total_amount+i.branding_amount)::text END,'gst_percent',CASE WHEN i.total_amount+i.branding_amount>0 THEN(f.tax*100/(i.total_amount+i.branding_amount))::text END,
  'total_sales_including_gst',CASE WHEN sa_domain.report_money(i.total_amount) IS NOT NULL AND sa_domain.report_money(i.branding_amount) IS NOT NULL AND sa_domain.report_money(f.tax) IS NOT NULL THEN (i.total_amount+i.branding_amount+f.tax)::text END,
  'rating',CASE WHEN feedback.rating BETWEEN 1 AND 5 THEN feedback.rating::text END,'customer_positive_review',feedback.positive_comments,'customer_negative_review',feedback.negative_comments)
 FROM facts f JOIN sa_snapshot_20261019.sa_items i ON i.id=f.item_id JOIN sa_snapshot_20261019.sa_orders o ON o.id=f.order_id
 CROSS JOIN(SELECT CASE environment WHEN 'production' THEN 'P-' ELSE 'S-' END prefix_ FROM sa_sync.environment_state) env
 LEFT JOIN sa_snapshot_20261019.sa_users u ON u.id=f.customer_id LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types pt ON pt.id=u.rmp_price_type_id
 LEFT JOIN sa_snapshot_20261019.sa_users creator ON creator.id=o.created_by_id LEFT JOIN sa_snapshot_20261019.sa_users fm ON fm.id=o.assigned_to_id
 LEFT JOIN sa_snapshot_20261019.sa_factories factory ON factory.id=fm.factory_id LEFT JOIN sa_snapshot_20261019.sa_products pr ON pr.id=i.product_id
 LEFT JOIN sa_snapshot_20261019.sa_base_products bp ON bp.id=pr.base_product_id LEFT JOIN sa_snapshot_20261019.sa_fabrics fab ON fab.id=pr.fabric_id
 LEFT JOIN sa_snapshot_20261019.sa_rmp_categories cat ON cat.id=i.rmp_category_id LEFT JOIN addons ad ON ad.product_id=pr.id
 LEFT JOIN quantities q ON q.item_id=i.id LEFT JOIN dispatch disp ON disp.item_id=i.id
 LEFT JOIN tailor_first tf ON tf.item_id=i.id LEFT JOIN tailor_total tt ON tt.item_id=i.id
 LEFT JOIN LATERAL(SELECT min(margin_percentage) margin,count(*) candidates FROM sa_snapshot_20261019.sa_profit_margins WHERE i.total_quantity BETWEEN min_range AND max_range AND NOT is_deleted) mg ON true
 LEFT JOIN LATERAL(SELECT rating,positive_comments,negative_comments FROM sa_snapshot_20261019.sa_ratings q
  WHERE q.rating_on_type='Order' AND q.rating_on_id=o.id AND q.from_role='Customer'
  AND NOT EXISTS(SELECT FROM sa_domain.rating_moderation m WHERE m.rating_id=q.id AND m.generation=(SELECT generation FROM sa_domain.runtime_state)) ORDER BY q.id DESC LIMIT 1) feedback ON true
 LEFT JOIN LATERAL(SELECT string_agg(name,', ' ORDER BY name) names,string_agg(id::text,', ' ORDER BY id) ids,bool_or(candidates>1) ambiguous FROM(
  SELECT DISTINCT ON(q.size_id) k.id,k.name,count(*) OVER(PARTITION BY q.size_id) candidates FROM sa_snapshot_20261019.sa_quantities q
  JOIN sa_snapshot_20261019.sa_sizes s ON s.id=q.size_id JOIN sa_snapshot_20261019.sa_rmp_sizes rs ON rs.name=s.name
  JOIN sa_snapshot_20261019.sa_rmp_skus k ON k.rmp_size_id=rs.id AND k.rmp_brand_id=i.rmp_brand_id AND k.rmp_class_id=i.rmp_class_id
  WHERE q.item_id=i.id AND q.quantity>0 AND i.item_type=1 ORDER BY q.size_id,rs.is_deleted,k.is_deleted,rs.id,k.id) chosen) sk ON true
 WHERE p_kind<>'tailor_reports' OR tf.item_id IS NOT NULL;
END $f$;
ALTER FUNCTION sa_domain.dashboard_item_rows(text,jsonb) OWNER TO sa_guard;

-- Complete the shared aggregate's closed-value split used by dashboard exports.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.sales_aggregate(text,jsonb,jsonb,bigint,integer)'::regprocedure);
 d:=replace(d,'sum(quantity) FILTER(WHERE customer_role=10 AND closed) dealer_closed_quantity,',
 'sum(quantity) FILTER(WHERE customer_role=10 AND closed) dealer_closed_quantity,sum(subtotal) FILTER(WHERE customer_role=10 AND closed) dealer_closed_subtotal,');
 d:=replace(d,'sum(quantity) FILTER(WHERE customer_role<>10 AND closed) customer_closed_quantity,',
 'sum(quantity) FILTER(WHERE customer_role<>10 AND closed) customer_closed_quantity,sum(subtotal) FILTER(WHERE customer_role<>10 AND closed) customer_closed_subtotal,');
 d:=replace(d,$s$'dealer_fill_rate',CASE$s$,$s$'dealer_closed_subtotal',CASE WHEN NOT p.invalid THEN coalesce(p.dealer_closed_subtotal,0)::text END,'dealer_fill_rate',CASE$s$);
 d:=replace(d,$s$'customer_fill_rate',CASE$s$,$s$'customer_closed_subtotal',CASE WHEN NOT p.invalid THEN coalesce(p.customer_closed_subtotal,0)::text END,'customer_fill_rate',CASE$s$);
 EXECUTE d;
END $f$;

CREATE FUNCTION sa_domain.dashboard_breakdown_row(v jsonb,p_filters jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $f$ SELECT jsonb_build_object('id',v->'id','needs_reconciliation',v->'needs_reconciliation','label',v->'name','coordinator_name',v->'name','item_qty',v->'quantity',
   'ordered_qty',v->'quantity','order_value',v->'subtotal','closed_ordered_qty',v->'closed_quantity','closed_ordered_value',v->'closed_subtotal',
   'distributor_closed_qty',v->'dealer_closed_quantity','distributor_closed_value',v->'dealer_closed_subtotal','other_customer_closed_qty',v->'customer_closed_quantity','other_customer_closed_value',v->'customer_closed_subtotal',
   'distributor_qty',v->'dealer_quantity','distributor_value',v->'dealer_subtotal','other_customer_qty',v->'customer_quantity','other_customer_value',v->'customer_subtotal',
   'fill_rate_total',v->'fill_rate','distributor_fill_rate',v->'dealer_fill_rate','other_fill_rate',v->'customer_fill_rate',
   'drr',round((v->>'quantity')::numeric / ((p_filters->>'before')::date-(p_filters->>'from')::date),4)) $f$;
ALTER FUNCTION sa_domain.dashboard_breakdown_row(jsonb,jsonb) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.dashboard_rows(p_report text,p_tab text,p_filters jsonb) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET plan_cache_mode=force_custom_plan AS $f$
DECLARE period_ jsonb;from_ timestamptz;before_ timestamptz;a_ jsonb;b_ jsonb;availability_ jsonb;
BEGIN
 IF sa_domain.dashboard_actor_id() IS NULL THEN RAISE EXCEPTION 'Dashboard administrator required' USING ERRCODE='42501';END IF;
 IF p_report IN('order_reports','rmp_order_reports','tailor_reports') THEN
  RETURN QUERY SELECT * FROM sa_domain.dashboard_item_rows(p_report,p_filters);RETURN;
 END IF;
 IF p_report='customers' THEN
  RETURN QUERY SELECT v FROM sa_domain.dashboard_customers() v WHERE NOT p_filters?'zone_id' OR v->>'zone_id'=p_filters->>'zone_id';RETURN;
 END IF;
 IF p_report='unique_customers' THEN
  IF (p_filters->>'before')::date <= (p_filters->>'from')::date OR (p_filters->>'before')::date-(p_filters->>'from')::date>3660 THEN RAISE EXCEPTION 'Invalid KPI period' USING ERRCODE='22023';END IF;
  RETURN QUERY SELECT jsonb_build_object('id','1','total_unique_customers',count(DISTINCT customer_id),
   'custom_order_customers',count(DISTINCT customer_id) FILTER(WHERE order_kind=1),'rmp_order_customers',count(DISTINCT customer_id) FILTER(WHERE order_kind=0))
   FROM sa_domain.sales_rows((p_filters->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata',(p_filters->>'before')::date::timestamp AT TIME ZONE 'Asia/Kolkata','{}')
   WHERE provider_status IS DISTINCT FROM 'CANCELLED';RETURN;
 END IF;
 period_:=sa_domain.report_period((p_filters->>'from')::date,(p_filters->>'before')::date);
 from_:=(period_->>'start_utc')::timestamptz;before_:=(period_->>'end_exclusive_utc')::timestamptz;
 IF p_report='rmp_sales' AND p_tab IN('brand','class','coordinator') THEN
  a_:=sa_domain.sales_aggregate(CASE p_tab WHEN 'brand' THEN 'brands' WHEN 'class' THEN 'classes' ELSE 'coordinators' END,period_,coalesce(p_filters->'domain','{}'),9223372036854775807,100000);
  IF (a_->>'has_more')::boolean THEN RAISE EXCEPTION 'Report exceeds supported group count' USING ERRCODE='54000';END IF;
  RETURN QUERY SELECT sa_domain.dashboard_breakdown_row(v,p_filters) FROM jsonb_array_elements(a_->'data') v;RETURN;
 ELSIF p_report IN('order_tracking','rmp_sales') THEN
  RETURN QUERY WITH facts AS MATERIALIZED(SELECT * FROM sa_domain.sales_rows(from_,before_,coalesce(p_filters->'domain','{}'))
   WHERE(p_report<>'rmp_sales' OR order_kind=0 AND item_kind=1)
   AND(NOT p_filters?'ids' OR order_id=ANY(ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(p_filters->'ids'))))
   AND (coalesce(jsonb_array_length(p_filters->'customer_ids'),0)=0 OR customer_id::text IN(SELECT jsonb_array_elements_text(p_filters->'customer_ids')))),
  grouped AS(SELECT order_id,min(customer_id) customer_id,min(customer_name) customer_name,min(ordered_at) ordered_at,
    string_agg(DISTINCT class_id::text,', ' ORDER BY class_id::text) classes,string_agg(DISTINCT class_name,', ' ORDER BY class_name) names,
    sum(quantity) quantity,sum(subtotal) subtotal,sum(quantity) FILTER(WHERE closed) closed_quantity,
    bool_or(quantity IS NULL OR quantity<0 OR subtotal IS NULL OR sa_domain.report_money(subtotal) IS NULL) invalid
    FROM facts GROUP BY order_id)
  SELECT jsonb_build_object('id',o.id::text,'order_id',o.id::text,'order_number','OD-'||CASE s.environment WHEN 'production' THEN 'P-' ELSE 'S-' END||o.id,
   'customer_id',g.customer_id::text,'customer_code',CASE s.environment WHEN 'production' THEN 'P-' ELSE 'S-' END||g.customer_id,'customer_name',g.customer_name,'customer_type',pt.name,'order_date',g.ordered_at AT TIME ZONE 'UTC',
   'class_id',g.classes,'class_name',g.names,'qty',CASE WHEN NOT g.invalid THEN g.quantity END,'total_qty',CASE WHEN NOT g.invalid THEN g.quantity END,
   'price',CASE WHEN NOT g.invalid THEN (g.subtotal/nullif(g.quantity,0))::text END,'value',CASE WHEN NOT g.invalid THEN g.subtotal::text END,
   'total_amount',CASE WHEN NOT g.invalid THEN g.subtotal::text END,'closed_qty',CASE WHEN NOT g.invalid THEN coalesce(g.closed_quantity,0) END,
   'status',CASE WHEN o.uc_status='CANCELLED' THEN 'failed' WHEN o.status=1 THEN 'completed' WHEN o.due_on<now() AT TIME ZONE 'UTC' THEN 'overdue' ELSE 'pending' END,
   'sla_date',o.due_on AT TIME ZONE 'UTC','is_overdue',o.status=0 AND o.due_on<now() AT TIME ZONE 'UTC' AND o.uc_status IS DISTINCT FROM 'CANCELLED',
   'is_failed',o.uc_status='CANCELLED','is_oos',coalesce(o.uc_status IN('OUT_OF_STOCK','OOS'),false),'uniware_reason',NULL,
   'needs_reconciliation',g.invalid,'basis','one_row_per_order_stored_item_subtotal')
  FROM grouped g JOIN sa_snapshot_20261019.sa_orders o ON o.id=g.order_id CROSS JOIN sa_sync.environment_state s
  LEFT JOIN sa_snapshot_20261019.sa_users u ON u.id=g.customer_id LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types pt ON pt.id=u.rmp_price_type_id
  WHERE NOT coalesce((p_filters->>'oos')::boolean,false) OR o.uc_status IN('OUT_OF_STOCK','OOS');RETURN;
 ELSIF p_report='customer_performance' THEN
  b_:=sa_domain.report_period((p_filters->>'from_b')::date,(p_filters->>'before_b')::date);
  RETURN QUERY WITH a AS(SELECT customer_id,sum(quantity) qty,sum(subtotal) val,
    bool_or(quantity IS NULL OR quantity<0 OR sa_domain.report_money(subtotal) IS NULL) invalid
    FROM sa_domain.sales_rows(from_,before_,coalesce(p_filters->'domain','{}')) WHERE NOT p_filters?'ids' OR customer_id=ANY(ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(p_filters->'ids'))) GROUP BY customer_id),
   b AS(SELECT customer_id,sum(quantity) qty,sum(subtotal) val,
    bool_or(quantity IS NULL OR quantity<0 OR sa_domain.report_money(subtotal) IS NULL) invalid
    FROM sa_domain.sales_rows((b_->>'start_utc')::timestamptz,(b_->>'end_exclusive_utc')::timestamptz,coalesce(p_filters->'domain','{}')) WHERE NOT p_filters?'ids' OR customer_id=ANY(ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(p_filters->'ids'))) GROUP BY customer_id),
   last_ AS(SELECT customer_id,max(coalesce(created_on,created_at)) at_ FROM sa_snapshot_20261019.sa_orders WHERE deleted_at IS NULL AND is_deleted IS NOT TRUE AND(NOT p_filters?'ids' OR customer_id=ANY(ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(p_filters->'ids')))) GROUP BY customer_id)
  SELECT jsonb_build_object('id',u.id::text,'customer_id',u.id::text,'customer_name',coalesce(nullif(u.customer_company_name,''),u.name),
   'customer_type',pt.name,'zone',z.name,'last_purchased_date',l.at_ AT TIME ZONE 'UTC',
   'qtyA',CASE WHEN NOT coalesce(a.invalid,false) THEN coalesce(a.qty,0) END,'valueA',CASE WHEN NOT coalesce(a.invalid,false) THEN coalesce(a.val,0)::text END,
   'qtyB',CASE WHEN NOT coalesce(b.invalid,false) THEN coalesce(b.qty,0) END,'valueB',CASE WHEN NOT coalesce(b.invalid,false) THEN coalesce(b.val,0)::text END,
   'qtyChange',CASE WHEN NOT(coalesce(a.invalid,false) OR coalesce(b.invalid,false)) THEN coalesce(b.qty,0)-coalesce(a.qty,0) END,
   'valueChange',CASE WHEN NOT(coalesce(a.invalid,false) OR coalesce(b.invalid,false)) THEN(coalesce(b.val,0)-coalesce(a.val,0))::text END,
   'qtyChangePct',CASE WHEN NOT(coalesce(a.invalid,false) OR coalesce(b.invalid,false)) THEN round(100.0*(coalesce(b.qty,0)-a.qty)/nullif(a.qty,0),2) END,
   'valueChangePct',CASE WHEN NOT(coalesce(a.invalid,false) OR coalesce(b.invalid,false)) THEN round(100.0*(coalesce(b.val,0)-a.val)/nullif(a.val,0),2) END,
   'needs_reconciliation',coalesce(a.invalid,false) OR coalesce(b.invalid,false))
  FROM sa_snapshot_20261019.sa_users u LEFT JOIN a ON a.customer_id=u.id LEFT JOIN b ON b.customer_id=u.id LEFT JOIN last_ l ON l.customer_id=u.id
  LEFT JOIN sa_snapshot_20261019.sa_zones z ON z.id=u.zone_id LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types pt ON pt.id=u.rmp_price_type_id
  WHERE u.role=3 AND u.deleted_at IS NULL AND(NOT p_filters?'ids' OR u.id=ANY(ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(p_filters->'ids')))) AND CASE coalesce(p_filters->>'history','all') WHEN 'has_orders' THEN l.at_ IS NOT NULL WHEN 'no_orders_yet' THEN l.at_ IS NULL ELSE true END;RETURN;
 ELSIF p_report='total_inventory' THEN
  before_:=least(before_,((now() AT TIME ZONE 'Asia/Kolkata')::date+1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  availability_:=sa_domain.warehouse_availability(ARRAY(SELECT id FROM sa_snapshot_20261019.sa_rmp_skus WHERE NOT is_deleted));
  RETURN QUERY WITH source AS MATERIALIZED(SELECT f.item_id,i.rmp_brand_id brand,i.rmp_class_id class,q.id quantity_id,q.quantity,sz.name size_name
   FROM sa_domain.sales_rows(before_-interval '90 days',before_,'{"status":"completed"}') f
   JOIN sa_snapshot_20261019.sa_items i ON i.id=f.item_id LEFT JOIN sa_snapshot_20261019.sa_quantities q ON q.item_id=i.id
   LEFT JOIN sa_snapshot_20261019.sa_sizes sz ON sz.id=q.size_id WHERE f.item_kind=1),
  matches AS MATERIALIZED(SELECT x.*,k.id sku_id,count(k.id) OVER(PARTITION BY x.item_id,x.quantity_id) candidates
   FROM source x LEFT JOIN sa_snapshot_20261019.sa_rmp_sizes rs ON rs.name=x.size_name
   LEFT JOIN sa_snapshot_20261019.sa_rmp_skus k ON k.rmp_size_id=rs.id AND k.rmp_brand_id=x.brand AND k.rmp_class_id=x.class),
  unresolved AS(SELECT DISTINCT brand,class FROM matches WHERE candidates=0 OR quantity IS NULL OR quantity<0),
  demand AS(SELECT sku_id id,sum(quantity) qty,bool_or(candidates<>1) ambiguous FROM matches WHERE sku_id IS NOT NULL GROUP BY sku_id),
  rows AS(SELECT k.id,k.name,availability_->k.id::text a,CASE WHEN NOT coalesce(d.ambiguous,false) AND NOT EXISTS(SELECT FROM unresolved x WHERE x.brand IS NOT DISTINCT FROM k.rmp_brand_id AND x.class IS NOT DISTINCT FROM k.rmp_class_id) THEN coalesce(d.qty,0)/90.0 END drr FROM sa_snapshot_20261019.sa_rmp_skus k LEFT JOIN demand d ON d.id=k.id WHERE NOT k.is_deleted),
  ready AS(SELECT *,CASE WHEN a->>'status'='ready' THEN (a->>'one_day')::numeric+(a->>'three_day')::numeric END inventory FROM rows)
  SELECT jsonb_build_object('id',id::text,'sku',name,'inventory',inventory,'drr',drr,'daysOfCover',CASE WHEN drr>0 THEN inventory/drr END,
   'status',CASE WHEN inventory IS NULL THEN 'unknown' WHEN inventory=0 THEN 'out of stock' ELSE 'in stock' END,
   'demandMetricsReady',drr IS NOT NULL,'availability',a,'basis','live_cache_5_minutes_demand_completed_90_days') FROM ready;RETURN;
 END IF;
 RAISE EXCEPTION 'Unknown dashboard report' USING ERRCODE='22023';
END $f$;
ALTER FUNCTION sa_domain.dashboard_rows(text,text,jsonb) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.dashboard_number(p_value text) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $f$
 SELECT CASE WHEN p_value ~ '^-?[0-9]+([.][0-9]+)?$' THEN p_value::numeric END
$f$;
CREATE FUNCTION sa_domain.dashboard_match(p_row jsonb,p_group jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE c jsonb;v text;wanted text;ok boolean;any_ boolean:=false;logic_ text:=coalesce(p_group->>'logic','and');op text;n numeric;
BEGIN
 IF p_group IS NULL OR p_group='null' OR coalesce(jsonb_array_length(p_group->'conditions'),0)=0 THEN RETURN true;END IF;
 IF logic_ NOT IN('and','or') OR jsonb_array_length(p_group->'conditions')>50 THEN RAISE EXCEPTION 'Invalid filter group' USING ERRCODE='22023';END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_group->'conditions') LOOP
  IF NOT p_row ? (c->>'field') THEN RAISE EXCEPTION 'Unknown filter field: %',c->>'field' USING ERRCODE='22023';END IF;
  v:=p_row->>(c->>'field');wanted:=c->>'value';op:=c->>'operator';n:=sa_domain.dashboard_number(v);
  ok:=CASE op
   WHEN 'is_empty' THEN coalesce(v,'')=''
   WHEN 'is_not_empty' THEN coalesce(v,'')<>''
   WHEN 'is_true' THEN v='true' WHEN 'is_false' THEN v='false'
   WHEN 'contains' THEN strpos(lower(coalesce(v,'')),lower(wanted))>0
   WHEN 'not_contains' THEN strpos(lower(coalesce(v,'')),lower(wanted))=0
   WHEN 'starts_with' THEN starts_with(lower(v),lower(wanted))
   WHEN 'ends_with' THEN right(lower(v),length(wanted))=lower(wanted)
   WHEN 'equals' THEN CASE WHEN jsonb_typeof(c->'value')='number' OR c->>'field'=ANY(ARRAY['quantity','total_quantity','total_qty','total_amount','value','price','inventory','drr','item_qty','order_value','qtyA','qtyB','valueA','valueB','qtyChange','valueChange','qtyChangePct','valueChangePct']) THEN n=sa_domain.dashboard_number(wanted) ELSE lower(v)=lower(wanted) END
   WHEN 'not_equals' THEN CASE WHEN jsonb_typeof(c->'value')='number' OR c->>'field'=ANY(ARRAY['quantity','total_quantity','total_qty','total_amount','value','price','inventory','drr','item_qty','order_value','qtyA','qtyB','valueA','valueB','qtyChange','valueChange','qtyChangePct','valueChangePct']) THEN n<>sa_domain.dashboard_number(wanted) ELSE lower(v)<>lower(wanted) END
   WHEN 'gt' THEN n>sa_domain.dashboard_number(wanted) WHEN 'gte' THEN n>=sa_domain.dashboard_number(wanted)
   WHEN 'lt' THEN n<sa_domain.dashboard_number(wanted) WHEN 'lte' THEN n<=sa_domain.dashboard_number(wanted)
   WHEN 'between' THEN n BETWEEN sa_domain.dashboard_number(c#>>'{value,0}') AND sa_domain.dashboard_number(c#>>'{value,1}')
   WHEN 'is_any_of' THEN jsonb_array_length(c->'value')=0 OR EXISTS(SELECT FROM jsonb_array_elements_text(c->'value') x WHERE lower(x)=lower(v))
   WHEN 'is_none_of' THEN NOT EXISTS(SELECT FROM jsonb_array_elements_text(c->'value') x WHERE lower(x)=lower(v))
   WHEN 'date_on' THEN (v::timestamptz AT TIME ZONE 'Asia/Kolkata')::date=wanted::date
   WHEN 'date_before' THEN (v::timestamptz AT TIME ZONE 'Asia/Kolkata')::date<=wanted::date
   WHEN 'date_after' THEN (v::timestamptz AT TIME ZONE 'Asia/Kolkata')::date>=wanted::date
   WHEN 'date_between' THEN (v::timestamptz AT TIME ZONE 'Asia/Kolkata')::date BETWEEN(c#>>'{value,0}')::date AND(c#>>'{value,1}')::date
   ELSE NULL END;
  IF op NOT IN('is_empty','is_not_empty','is_true','is_false','contains','not_contains','starts_with','ends_with','equals','not_equals','gt','gte','lt','lte','between','is_any_of','is_none_of','date_on','date_before','date_after','date_between') THEN RAISE EXCEPTION 'Unknown filter operator' USING ERRCODE='22023';END IF;
  IF logic_='and' AND NOT coalesce(ok,false) THEN RETURN false;END IF;
  any_:=any_ OR coalesce(ok,false);
 END LOOP;
 RETURN logic_='and' OR any_;
END $f$;

-- Only exact RMP item counts/totals are cached. Rows, authorization and workflow
-- states are always live. The key uses the same publication/edit revision as paging.
CREATE TABLE sa_domain.dashboard_summaries(
 revision text NOT NULL,filter_key text NOT NULL,total_count bigint NOT NULL,summary jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(revision,filter_key)
);
ALTER TABLE sa_domain.dashboard_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.dashboard_summaries FORCE ROW LEVEL SECURITY;
GRANT SELECT ON sa_domain.dashboard_summaries TO sa_guard;
GRANT SELECT,INSERT,DELETE ON sa_domain.dashboard_summaries TO sa_dashboard;
CREATE POLICY dashboard_summary_read ON sa_domain.dashboard_summaries FOR SELECT TO sa_guard USING(true);
CREATE POLICY dashboard_summary_dispatch ON sa_domain.dashboard_summaries TO sa_dashboard USING(true) WITH CHECK(true);

-- Cover full-history item summaries without reading wide operational rows.
CREATE INDEX dashboard_item_summary ON sa_snapshot_20261019.sa_items(item_type,id DESC)
 INCLUDE(order_id,total_quantity,total_amount,branding_amount,cgst_amount,sgst_amount,igst_amount,uc_order_status,dispatched_status);
CREATE INDEX dashboard_live_orders ON sa_snapshot_20261019.sa_orders(id)
 INCLUDE(customer_id,created_on,created_at) WHERE is_deleted IS NOT TRUE AND deleted_at IS NULL;

CREATE FUNCTION sa_domain.dashboard_fast_result(p_report text,p_tab text,p_filters jsonb,p_page integer,p_limit integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET plan_cache_mode=force_custom_plan SET work_mem='32MB' AS $f$
DECLARE result_ jsonb;ids_ jsonb;summary_ jsonb;total_ bigint;data_ jsonb;start_ timestamptz;end_ timestamptz;
BEGIN
 IF p_report='customers' THEN
  SELECT count(*) INTO total_ FROM sa_snapshot_20261019.sa_users WHERE role=3 AND deleted_at IS NULL AND(NOT p_filters?'zone_id' OR zone_id=(p_filters->>'zone_id')::bigint);
  SELECT coalesce(jsonb_agg(sa_domain.dashboard_customer(id) ORDER BY id DESC),'[]') INTO data_ FROM(
   SELECT id FROM sa_snapshot_20261019.sa_users WHERE role=3 AND deleted_at IS NULL AND(NOT p_filters?'zone_id' OR zone_id=(p_filters->>'zone_id')::bigint) ORDER BY id DESC LIMIT p_limit OFFSET(p_page-1)*p_limit) page;
  summary_:=jsonb_build_object('count',total_,'sums','{}');
 ELSIF p_report='rmp_sales' AND p_tab IN('brand','class','coordinator') THEN
  result_:=sa_domain.sales_aggregate(CASE p_tab WHEN 'brand' THEN 'brands' WHEN 'class' THEN 'classes' ELSE 'coordinators' END,
   sa_domain.report_period((p_filters->>'from')::date,(p_filters->>'before')::date),coalesce(p_filters->'domain','{}'),9223372036854775807,least(p_page*p_limit,100000));
  total_:=(result_#>>'{summary,groups}')::bigint;
  SELECT coalesce(jsonb_agg(sa_domain.dashboard_breakdown_row(v,p_filters) ORDER BY ord),'[]') INTO data_
   FROM jsonb_array_elements(result_->'data') WITH ORDINALITY x(v,ord) WHERE ord>(p_page-1)*p_limit;
  summary_:=jsonb_build_object('count',total_,'sums',jsonb_build_object('item_qty',result_#>>'{summary,quantity}','ordered_qty',result_#>>'{summary,quantity}',
   'order_value',result_#>>'{summary,subtotal}','closed_ordered_qty',result_#>>'{summary,closed_quantity}'));
 ELSIF p_report IN('order_reports','rmp_order_reports') THEN
  start_:=coalesce((p_filters->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata','-infinity'::timestamptz);
  end_:=coalesce((p_filters->>'before')::date::timestamp AT TIME ZONE 'Asia/Kolkata','infinity'::timestamptz);
  IF p_report='rmp_order_reports' AND coalesce(p_filters#>>'{domain,status}','all')<>'overdue' THEN
   SELECT total_count,summary INTO total_,summary_ FROM sa_domain.dashboard_summaries
   WHERE revision=(SELECT generation::text||':'||edit_revision::text FROM sa_domain.runtime_state CROSS JOIN sa_sync.environment_state)
   AND filter_key=md5(p_filters::text) AND created_at>now()-interval '5 minutes';
  END IF;
  IF summary_ IS NULL THEN
  WITH stats AS(SELECT count(*) n,sum(quantity) qty,
   sum(CASE WHEN p_report='order_reports' THEN coalesce((SELECT sum(q.quantity) FROM sa_snapshot_20261019.sa_quantities q WHERE q.item_id=sales_rows.item_id),0) ELSE quantity END) total_qty,sum(subtotal+branding+tax) gross,
   bool_or(quantity IS NULL OR quantity<0 OR subtotal IS NULL OR subtotal<0 OR subtotal>='Infinity'::numeric OR branding IS NULL OR branding<0 OR branding>='Infinity'::numeric OR tax IS NULL) invalid
   FROM sa_domain.sales_rows(start_,end_,coalesce(p_filters->'domain','{}'))
   WHERE item_kind=CASE p_report WHEN 'order_reports' THEN 0 ELSE 1 END AND(NOT p_filters?'id' OR item_id=(p_filters->>'id')::bigint))
  SELECT n,jsonb_build_object('count',n,'sums',jsonb_build_object('quantity',coalesce(qty,0)::text,'total_quantity',coalesce(total_qty,0)::text,
   'total_amount',CASE WHEN NOT coalesce(invalid,false) THEN coalesce(gross,0)::text END)) INTO total_,summary_ FROM stats;
  END IF;
  SELECT coalesce(jsonb_agg(item_id::text ORDER BY item_id DESC),'[]') INTO ids_ FROM(
   SELECT item_id FROM sa_domain.sales_rows(start_,end_,coalesce(p_filters->'domain','{}'))
   WHERE item_kind=CASE p_report WHEN 'order_reports' THEN 0 ELSE 1 END AND(NOT p_filters?'id' OR item_id=(p_filters->>'id')::bigint)
   ORDER BY item_id DESC LIMIT p_limit OFFSET(p_page-1)*p_limit) page;
  SELECT coalesce(jsonb_agg(v ORDER BY(v->>'id')::bigint DESC),'[]') INTO data_ FROM sa_domain.dashboard_item_rows(p_report,p_filters||jsonb_build_object('ids',ids_)) v;
 ELSIF p_report='tailor_reports' THEN
  WITH facts AS MATERIALIZED(SELECT f.item_id,f.quantity FROM sa_domain.sales_rows(
   coalesce((p_filters->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata','-infinity'::timestamptz),
   coalesce((p_filters->>'before')::date::timestamp AT TIME ZONE 'Asia/Kolkata','infinity'::timestamptz),coalesce(p_filters->'domain','{}')) f
   WHERE EXISTS(SELECT FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d WHERE d.item_id=f.item_id)
   AND(NOT p_filters?'id' OR f.item_id=(p_filters->>'id')::bigint)),
  page AS(SELECT item_id FROM facts ORDER BY item_id DESC LIMIT p_limit OFFSET(p_page-1)*p_limit),
  completed AS(SELECT d.item_id,sum(mq.completed_quantity) qty FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates d
   JOIN sa_snapshot_20261019.sa_job_sheet_mark_tailors m ON m.job_sheet_tailor_mark_date_id=d.id
   JOIN sa_snapshot_20261019.sa_mark_tailor_quantities mq ON mq.job_sheet_mark_tailor_id=m.id
   JOIN sa_snapshot_20261019.sa_item_tailor_quantities iq ON iq.id=mq.item_tailor_quantity_id
   JOIN sa_snapshot_20261019.sa_quantities q ON q.id=iq.quantity_id JOIN sa_snapshot_20261019.sa_sizes z ON z.id=q.size_id
   WHERE d.item_id IN(SELECT item_id FROM facts) GROUP BY d.item_id),
  addons AS(SELECT pp.product_id,sum(a.add_on_of) of_,sum(a.add_on_sn) sn_ FROM sa_snapshot_20261019.sa_product_parts pp
   JOIN sa_snapshot_20261019.sa_product_part_add_ons pa ON pa.product_part_id=pp.id JOIN sa_snapshot_20261019.sa_add_ons a ON a.id=pa.add_on_id GROUP BY pp.product_id),
  values_ AS(SELECT f.quantity,coalesce(c.qty,0) completed,coalesce(c.qty,0)*(bp.base_of+bp.base_sn+coalesce(a.of_,0)+coalesce(a.sn_,0)) amount
   FROM facts f JOIN sa_snapshot_20261019.sa_items i ON i.id=f.item_id LEFT JOIN sa_snapshot_20261019.sa_products p ON p.id=i.product_id
   LEFT JOIN sa_snapshot_20261019.sa_base_products bp ON bp.id=p.base_product_id LEFT JOIN addons a ON a.product_id=p.id LEFT JOIN completed c ON c.item_id=i.id)
  SELECT count(*),(SELECT coalesce(jsonb_agg(item_id::text ORDER BY item_id DESC),'[]') FROM page),jsonb_build_object('count',count(*),'sums',jsonb_build_object(
   'quantity',coalesce(sum(quantity),0)::text,'total_quantity',coalesce(sum(completed),0)::text,
   'total_amount',CASE WHEN NOT coalesce(bool_or(sa_domain.report_money(amount) IS NULL),false) THEN coalesce(sum(amount),0)::text END)) INTO total_,ids_,summary_ FROM values_;
  SELECT coalesce(jsonb_agg(v ORDER BY(v->>'id')::bigint DESC),'[]') INTO data_ FROM sa_domain.dashboard_item_rows(p_report,p_filters||jsonb_build_object('ids',ids_)) v;
 ELSIF p_report='customer_performance' THEN
  PERFORM sa_domain.report_period((p_filters->>'from')::date,(p_filters->>'before')::date);
  PERFORM sa_domain.report_period((p_filters->>'from_b')::date,(p_filters->>'before_b')::date);
  WITH a AS(SELECT customer_id,sum(quantity) qty,sum(subtotal) val,bool_or(quantity IS NULL OR quantity<0 OR subtotal IS NULL OR subtotal<0 OR subtotal>='Infinity'::numeric) invalid
   FROM sa_domain.sales_rows((p_filters->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata',(p_filters->>'before')::date::timestamp AT TIME ZONE 'Asia/Kolkata',coalesce(p_filters->'domain','{}')) GROUP BY customer_id),
  b AS(SELECT customer_id,sum(quantity) qty,sum(subtotal) val,bool_or(quantity IS NULL OR quantity<0 OR subtotal IS NULL OR subtotal<0 OR subtotal>='Infinity'::numeric) invalid
   FROM sa_domain.sales_rows((p_filters->>'from_b')::date::timestamp AT TIME ZONE 'Asia/Kolkata',(p_filters->>'before_b')::date::timestamp AT TIME ZONE 'Asia/Kolkata',coalesce(p_filters->'domain','{}')) GROUP BY customer_id),
  rows AS MATERIALIZED(SELECT u.id,coalesce(a.qty,0) qa,coalesce(a.val,0) va,coalesce(b.qty,0) qb,coalesce(b.val,0) vb,coalesce(a.invalid,false) ia,coalesce(b.invalid,false) ib
   FROM sa_snapshot_20261019.sa_users u LEFT JOIN a ON a.customer_id=u.id LEFT JOIN b ON b.customer_id=u.id WHERE u.role=3 AND u.deleted_at IS NULL
   AND CASE coalesce(p_filters->>'history','all') WHEN 'has_orders' THEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE customer_id=u.id AND deleted_at IS NULL AND is_deleted IS NOT TRUE)
   WHEN 'no_orders_yet' THEN NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE customer_id=u.id AND deleted_at IS NULL AND is_deleted IS NOT TRUE) ELSE true END),
  page AS(SELECT * FROM rows ORDER BY id DESC LIMIT p_limit OFFSET(p_page-1)*p_limit),
  projected AS(SELECT jsonb_build_object('id',r.id::text,'customer_id',r.id::text,'customer_name',coalesce(nullif(u.customer_company_name,''),u.name),
   'customer_type',pt.name,'zone',z.name,'last_purchased_date',l.at_ AT TIME ZONE 'UTC',
   'qtyA',CASE WHEN NOT ia THEN qa END,'valueA',CASE WHEN NOT ia THEN va::text END,
   'qtyB',CASE WHEN NOT ib THEN qb END,'valueB',CASE WHEN NOT ib THEN vb::text END,
   'qtyChange',CASE WHEN NOT(ia OR ib) THEN qb-qa END,'valueChange',CASE WHEN NOT(ia OR ib) THEN(vb-va)::text END,
   'qtyChangePct',CASE WHEN NOT(ia OR ib) THEN round(100.0*(qb-qa)/nullif(qa,0),2) END,
   'valueChangePct',CASE WHEN NOT(ia OR ib) THEN round(100.0*(vb-va)/nullif(va,0),2) END,
   'needs_reconciliation',ia OR ib) v,r.id FROM page r JOIN sa_snapshot_20261019.sa_users u ON u.id=r.id
   LEFT JOIN sa_snapshot_20261019.sa_zones z ON z.id=u.zone_id LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types pt ON pt.id=u.rmp_price_type_id
   LEFT JOIN LATERAL(SELECT max(coalesce(created_on,created_at)) at_ FROM sa_snapshot_20261019.sa_orders
    WHERE customer_id=r.id AND deleted_at IS NULL AND is_deleted IS NOT TRUE) l ON true)
  SELECT count(*),(SELECT coalesce(jsonb_agg(v ORDER BY id DESC),'[]') FROM projected),jsonb_build_object('count',count(*),'sums',jsonb_build_object(
   'qtyA',CASE WHEN NOT coalesce(bool_or(ia),false) THEN coalesce(sum(qa),0)::text END,'valueA',CASE WHEN NOT coalesce(bool_or(ia),false) THEN coalesce(sum(va),0)::text END,
   'qtyB',CASE WHEN NOT coalesce(bool_or(ib),false) THEN coalesce(sum(qb),0)::text END,'valueB',CASE WHEN NOT coalesce(bool_or(ib),false) THEN coalesce(sum(vb),0)::text END))
   INTO total_,data_,summary_ FROM rows;
 ELSIF p_report IN('order_reports','rmp_order_reports','order_tracking') OR p_report='rmp_sales' AND p_tab IN('','overview') THEN
  start_:=coalesce((p_filters->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata','-infinity'::timestamptz);
  end_:=coalesce((p_filters->>'before')::date::timestamp AT TIME ZONE 'Asia/Kolkata','infinity'::timestamptz);
  WITH facts AS NOT MATERIALIZED(SELECT item_id,order_id,quantity,subtotal,branding,tax,closed FROM sa_domain.sales_rows(start_,end_,coalesce(p_filters->'domain','{}')) f
   WHERE CASE p_report WHEN 'order_reports' THEN item_kind=0 WHEN 'rmp_order_reports' THEN item_kind=1 WHEN 'rmp_sales' THEN order_kind=0 AND item_kind=1 ELSE true END
   AND(NOT p_filters?'id' OR item_id=(p_filters->>'id')::bigint)
   AND(coalesce(jsonb_array_length(p_filters->'customer_ids'),0)=0 OR customer_id::text IN(SELECT jsonb_array_elements_text(p_filters->'customer_ids')))
   AND(NOT coalesce((p_filters->>'oos')::boolean,false) OR provider_status IN('OOS','OUT_OF_STOCK'))),
  keys_ AS(SELECT item_id id FROM facts WHERE p_report IN('order_reports','rmp_order_reports') UNION ALL SELECT DISTINCT order_id FROM facts WHERE p_report IN('order_tracking','rmp_sales')),
  page AS(SELECT id FROM keys_ ORDER BY id DESC LIMIT p_limit OFFSET(p_page-1)*p_limit),
  stats AS(SELECT count(*) n,sum(quantity) qty,sum(quantity) FILTER(WHERE closed) closed_qty,
   sum(subtotal) subtotal,sum(subtotal+branding+tax) gross,
   bool_or(quantity IS NULL OR quantity<0 OR subtotal IS NULL OR subtotal<0 OR subtotal>='Infinity'::numeric) invalid,
   bool_or(branding IS NULL OR branding<0 OR branding>='Infinity'::numeric OR tax IS NULL OR tax<0 OR tax>='Infinity'::numeric) invalid_tax FROM facts)
  SELECT CASE WHEN p_report IN('order_tracking','rmp_sales') THEN (SELECT count(*) FROM keys_) ELSE n END,(SELECT coalesce(jsonb_agg(id::text ORDER BY id DESC),'[]') FROM page),
   jsonb_build_object('count',CASE WHEN p_report IN('order_tracking','rmp_sales') THEN (SELECT count(*) FROM keys_) ELSE n END,'sums',jsonb_build_object(
    'quantity',CASE WHEN NOT coalesce(invalid,false) THEN coalesce(qty,0)::text END,
    'total_quantity',CASE WHEN NOT coalesce(invalid,false) THEN coalesce(qty,0)::text END,
    'total_qty',CASE WHEN NOT coalesce(invalid,false) THEN coalesce(qty,0)::text END,
    'closed_qty',CASE WHEN NOT coalesce(invalid,false) THEN coalesce(closed_qty,0)::text END,
    'total_amount',CASE WHEN NOT coalesce(invalid,false) THEN CASE WHEN p_report IN('order_tracking','rmp_sales') THEN coalesce(subtotal,0)::text WHEN NOT coalesce(invalid_tax,false) THEN coalesce(gross,0)::text END END))
   INTO total_,ids_,summary_ FROM stats;
  SELECT coalesce(jsonb_agg(v ORDER BY(v->>'id')::bigint DESC),'[]') INTO data_ FROM sa_domain.dashboard_rows(p_report,p_tab,p_filters||jsonb_build_object('ids',ids_)) v;
 ELSE RETURN NULL;END IF;
 RETURN jsonb_build_object('data',data_,'totalCount',total_,'totalPages',greatest(1,ceil(total_::numeric/p_limit)),'page',p_page,'pageSize',p_limit,'totalCountIsExact',true,'summary',summary_,'options','{}');
END $f$;
ALTER FUNCTION sa_domain.dashboard_fast_result(text,text,jsonb,integer,integer) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.dashboard_rmp_query(p_filters jsonb,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog SET plan_cache_mode=force_custom_plan SET work_mem='32MB' AS $f$
DECLARE r jsonb;need_skus_ boolean;sort_ text:=coalesce(p_query#>>'{sort,key}','id');direction_ text:=coalesce(p_query#>>'{sort,direction}','desc');
 numeric_ boolean:=coalesce((p_query#>>'{sort,numeric}')::boolean,sort_='id');n int:=coalesce((p_query->>'items')::int,20);page_ int:=coalesce((p_query->>'page')::int,1);
BEGIN
 need_skus_:=sort_ IN('rmp_sku_id','rmp_sku_name','sku_ambiguous','sku_unmapped')
  OR EXISTS(SELECT FROM jsonb_array_elements(coalesce(p_query#>'{filters,conditions}','[]')||coalesce(p_query#>'{quick,conditions}','[]')) c WHERE c->>'field' IN('rmp_sku_id','rmp_sku_name','sku_ambiguous','sku_unmapped'))
  OR jsonb_array_length(coalesce(p_query->'option_fields','[]'))>0
  OR coalesce(p_query->>'search','')<>'' AND(strpos(p_query->>'search',',')>0 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_skus WHERE strpos(lower(name),lower(p_query->>'search'))>0 OR strpos(id::text,p_query->>'search')>0));
 WITH facts AS MATERIALIZED(SELECT item_id,order_id,ordered_at,customer_id,customer_name,coordinator_name,quantity,subtotal,branding,tax,brand_id,class_id
  FROM sa_domain.sales_rows(coalesce((p_filters->>'from')::date::timestamp AT TIME ZONE 'Asia/Kolkata','-infinity'::timestamptz),
   coalesce((p_filters->>'before')::date::timestamp AT TIME ZONE 'Asia/Kolkata','infinity'::timestamptz),coalesce(p_filters->'domain','{}'))
  WHERE item_kind=1 AND(NOT p_filters?'id' OR item_id=(p_filters->>'id')::bigint)
   AND(NOT p_filters?'ids' OR item_id=ANY(ARRAY(SELECT value::bigint FROM jsonb_array_elements_text(p_filters->'ids'))))),
 sku_map AS MATERIALIZED(SELECT k.rmp_brand_id brand_id,k.rmp_class_id class_id,rs.name size_name,
  string_agg(DISTINCT k.id::text,', ' ORDER BY k.id::text) ids,string_agg(DISTINCT k.name,', ' ORDER BY k.name) names,count(*) candidates
  FROM sa_snapshot_20261019.sa_rmp_skus k JOIN sa_snapshot_20261019.sa_rmp_sizes rs ON rs.id=k.rmp_size_id GROUP BY k.rmp_brand_id,k.rmp_class_id,rs.name),
 skus AS(SELECT f.item_id,string_agg(DISTINCT m.ids,', ' ORDER BY m.ids) ids,string_agg(DISTINCT m.names,', ' ORDER BY m.names) names,
  bool_or(m.candidates>1) ambiguous,bool_or(m.ids IS NULL) unmapped FROM facts f
  LEFT JOIN sa_snapshot_20261019.sa_quantities q ON q.item_id=f.item_id AND q.quantity>0
  LEFT JOIN sa_snapshot_20261019.sa_sizes z ON z.id=q.size_id
  LEFT JOIN sku_map m ON m.brand_id=f.brand_id AND m.class_id=f.class_id AND m.size_name=z.name WHERE need_skus_ GROUP BY f.item_id),
 dispatch AS(SELECT item_id,max(dispatched_at) at_ FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE item_id IN(SELECT item_id FROM facts) GROUP BY item_id)
, flat AS MATERIALIZED(SELECT CAST(f.item_id AS text) AS "id",'OD-' || prefix_ || f.order_id AS "order_id",'OD-' || prefix_ || f.order_id AS "order_number",CAST(f.customer_id AS text) AS "customer_id",prefix_ || f.customer_id AS "customer_code",f.customer_name AS "customer_name",pt.name AS "customer_type",pg_catalog.timezone('UTC', f.ordered_at) AS "order_date",f.quantity AS "quantity",f.quantity AS "total_quantity",
 CASE
 WHEN f.quantity > 0 THEN sa_domain.report_money(f.subtotal / f.quantity) END AS "price",
 CASE
 WHEN sa_domain.report_money(f.subtotal) IS NOT NULL AND sa_domain.report_money(f.branding) IS NOT NULL AND f.tax IS NOT NULL THEN CAST(f.subtotal + f.branding + f.tax AS text) END AS "total_amount",
 CASE
 WHEN o.uc_status = 'CANCELLED' THEN 'CANCELLED'
 WHEN o.status = 1 THEN 'COMPLETED' ELSE 'PENDING' END AS "order_status",f.coordinator_name AS "sales_coordinator",
 CASE
 WHEN NOT(k.ambiguous OR k.unmapped) THEN k.ids END AS "rmp_sku_id",
 CASE
 WHEN NOT(k.ambiguous OR k.unmapped) THEN k.names END AS "rmp_sku_name",COALESCE(k.ambiguous, FALSE) AS "sku_ambiguous",COALESCE(k.unmapped, TRUE) AS "sku_unmapped",
 CASE
 WHEN i.dispatched_status = 1 THEN pg_catalog.timezone('UTC', d.at_) END AS "dispatch_date",pg_catalog.timezone('UTC', o.due_on) AS "delivery_required_on",pg_catalog.timezone('UTC', o.due_on) AS "expected_delivery_date",
 CASE
 WHEN i.dispatched_status = 1 THEN pg_catalog.timezone('UTC', d.at_) END AS "actual_delivery_date",pg_catalog.timezone('UTC', i.created_at) AS "created_at",pg_catalog.timezone('UTC', i.updated_at) AS "updated_at",'stored_item_gross_exact_decimal' AS "basis"
 FROM facts f JOIN sa_snapshot_20261019.sa_items i ON i.id=f.item_id JOIN sa_snapshot_20261019.sa_orders o ON o.id=f.order_id
 JOIN sa_snapshot_20261019.sa_users u ON u.id=f.customer_id LEFT JOIN sa_snapshot_20261019.sa_rmp_price_types pt ON pt.id=u.rmp_price_type_id
 LEFT JOIN skus k ON k.item_id=f.item_id LEFT JOIN dispatch d ON d.item_id=f.item_id
 CROSS JOIN(SELECT CASE environment
 WHEN 'production' THEN 'P-' ELSE 'S-' END prefix_ FROM sa_sync.environment_state) env),
 filtered AS MATERIALIZED(SELECT * FROM flat WHERE
 (coalesce(jsonb_array_length(p_query#>'{filters,conditions}'),0)=0 OR sa_domain.dashboard_match(to_jsonb(flat),p_query->'filters'))
 AND(coalesce(jsonb_array_length(p_query#>'{quick,conditions}'),0)=0 OR sa_domain.dashboard_match(to_jsonb(flat),p_query->'quick'))
 AND(coalesce(p_query->>'search','')='' OR strpos(lower(concat_ws(chr(10),"id","order_id","order_number","customer_id","customer_code","customer_name","customer_type","order_date","quantity","total_quantity","price","total_amount","order_status","sales_coordinator","rmp_sku_id","rmp_sku_name","sku_ambiguous","sku_unmapped","dispatch_date","delivery_required_on","expected_delivery_date","actual_delivery_date","created_at","updated_at","basis")),lower(p_query->>'search'))>0)),
 page AS(SELECT * FROM filtered ORDER BY
 CASE
 WHEN direction_='asc' AND numeric_ THEN sa_domain.dashboard_number(CASE sort_ 
 WHEN 'id' THEN "id"::text
 WHEN 'order_id' THEN "order_id"::text
 WHEN 'order_number' THEN "order_number"::text
 WHEN 'customer_id' THEN "customer_id"::text
 WHEN 'customer_code' THEN "customer_code"::text
 WHEN 'customer_name' THEN "customer_name"::text
 WHEN 'customer_type' THEN "customer_type"::text
 WHEN 'order_date' THEN "order_date"::text
 WHEN 'quantity' THEN "quantity"::text
 WHEN 'total_quantity' THEN "total_quantity"::text
 WHEN 'price' THEN "price"::text
 WHEN 'total_amount' THEN "total_amount"::text
 WHEN 'order_status' THEN "order_status"::text
 WHEN 'sales_coordinator' THEN "sales_coordinator"::text
 WHEN 'rmp_sku_id' THEN "rmp_sku_id"::text
 WHEN 'rmp_sku_name' THEN "rmp_sku_name"::text
 WHEN 'sku_ambiguous' THEN "sku_ambiguous"::text
 WHEN 'sku_unmapped' THEN "sku_unmapped"::text
 WHEN 'dispatch_date' THEN "dispatch_date"::text
 WHEN 'delivery_required_on' THEN "delivery_required_on"::text
 WHEN 'expected_delivery_date' THEN "expected_delivery_date"::text
 WHEN 'actual_delivery_date' THEN "actual_delivery_date"::text
 WHEN 'created_at' THEN "created_at"::text
 WHEN 'updated_at' THEN "updated_at"::text
 WHEN 'basis' THEN "basis"::text END) END ASC NULLS LAST,
 CASE
 WHEN direction_='desc' AND numeric_ THEN sa_domain.dashboard_number(CASE sort_ 
 WHEN 'id' THEN "id"::text
 WHEN 'order_id' THEN "order_id"::text
 WHEN 'order_number' THEN "order_number"::text
 WHEN 'customer_id' THEN "customer_id"::text
 WHEN 'customer_code' THEN "customer_code"::text
 WHEN 'customer_name' THEN "customer_name"::text
 WHEN 'customer_type' THEN "customer_type"::text
 WHEN 'order_date' THEN "order_date"::text
 WHEN 'quantity' THEN "quantity"::text
 WHEN 'total_quantity' THEN "total_quantity"::text
 WHEN 'price' THEN "price"::text
 WHEN 'total_amount' THEN "total_amount"::text
 WHEN 'order_status' THEN "order_status"::text
 WHEN 'sales_coordinator' THEN "sales_coordinator"::text
 WHEN 'rmp_sku_id' THEN "rmp_sku_id"::text
 WHEN 'rmp_sku_name' THEN "rmp_sku_name"::text
 WHEN 'sku_ambiguous' THEN "sku_ambiguous"::text
 WHEN 'sku_unmapped' THEN "sku_unmapped"::text
 WHEN 'dispatch_date' THEN "dispatch_date"::text
 WHEN 'delivery_required_on' THEN "delivery_required_on"::text
 WHEN 'expected_delivery_date' THEN "expected_delivery_date"::text
 WHEN 'actual_delivery_date' THEN "actual_delivery_date"::text
 WHEN 'created_at' THEN "created_at"::text
 WHEN 'updated_at' THEN "updated_at"::text
 WHEN 'basis' THEN "basis"::text END) END DESC NULLS LAST,
 CASE
 WHEN direction_='asc' AND NOT numeric_ THEN lower(CASE sort_ 
 WHEN 'id' THEN "id"::text
 WHEN 'order_id' THEN "order_id"::text
 WHEN 'order_number' THEN "order_number"::text
 WHEN 'customer_id' THEN "customer_id"::text
 WHEN 'customer_code' THEN "customer_code"::text
 WHEN 'customer_name' THEN "customer_name"::text
 WHEN 'customer_type' THEN "customer_type"::text
 WHEN 'order_date' THEN "order_date"::text
 WHEN 'quantity' THEN "quantity"::text
 WHEN 'total_quantity' THEN "total_quantity"::text
 WHEN 'price' THEN "price"::text
 WHEN 'total_amount' THEN "total_amount"::text
 WHEN 'order_status' THEN "order_status"::text
 WHEN 'sales_coordinator' THEN "sales_coordinator"::text
 WHEN 'rmp_sku_id' THEN "rmp_sku_id"::text
 WHEN 'rmp_sku_name' THEN "rmp_sku_name"::text
 WHEN 'sku_ambiguous' THEN "sku_ambiguous"::text
 WHEN 'sku_unmapped' THEN "sku_unmapped"::text
 WHEN 'dispatch_date' THEN "dispatch_date"::text
 WHEN 'delivery_required_on' THEN "delivery_required_on"::text
 WHEN 'expected_delivery_date' THEN "expected_delivery_date"::text
 WHEN 'actual_delivery_date' THEN "actual_delivery_date"::text
 WHEN 'created_at' THEN "created_at"::text
 WHEN 'updated_at' THEN "updated_at"::text
 WHEN 'basis' THEN "basis"::text END) END ASC NULLS LAST,
 CASE
 WHEN direction_='desc' AND NOT numeric_ THEN lower(CASE sort_ 
 WHEN 'id' THEN "id"::text
 WHEN 'order_id' THEN "order_id"::text
 WHEN 'order_number' THEN "order_number"::text
 WHEN 'customer_id' THEN "customer_id"::text
 WHEN 'customer_code' THEN "customer_code"::text
 WHEN 'customer_name' THEN "customer_name"::text
 WHEN 'customer_type' THEN "customer_type"::text
 WHEN 'order_date' THEN "order_date"::text
 WHEN 'quantity' THEN "quantity"::text
 WHEN 'total_quantity' THEN "total_quantity"::text
 WHEN 'price' THEN "price"::text
 WHEN 'total_amount' THEN "total_amount"::text
 WHEN 'order_status' THEN "order_status"::text
 WHEN 'sales_coordinator' THEN "sales_coordinator"::text
 WHEN 'rmp_sku_id' THEN "rmp_sku_id"::text
 WHEN 'rmp_sku_name' THEN "rmp_sku_name"::text
 WHEN 'sku_ambiguous' THEN "sku_ambiguous"::text
 WHEN 'sku_unmapped' THEN "sku_unmapped"::text
 WHEN 'dispatch_date' THEN "dispatch_date"::text
 WHEN 'delivery_required_on' THEN "delivery_required_on"::text
 WHEN 'expected_delivery_date' THEN "expected_delivery_date"::text
 WHEN 'actual_delivery_date' THEN "actual_delivery_date"::text
 WHEN 'created_at' THEN "created_at"::text
 WHEN 'updated_at' THEN "updated_at"::text
 WHEN 'basis' THEN "basis"::text END) END DESC NULLS LAST,id::bigint DESC LIMIT n OFFSET(page_-1)*n),
 stats AS(SELECT count(*) count_,sum(quantity) qty,sum(total_amount::numeric) amount,bool_or(total_amount IS NULL OR quantity IS NULL OR quantity<0) invalid,bool_or(quantity IS NULL OR quantity<0) invalid_qty FROM filtered),
 options AS(SELECT k,jsonb_agg(v ORDER BY v) values_ FROM(SELECT DISTINCT k,
 CASE k 
 WHEN 'id' THEN "id"::text
 WHEN 'order_id' THEN "order_id"::text
 WHEN 'order_number' THEN "order_number"::text
 WHEN 'customer_id' THEN "customer_id"::text
 WHEN 'customer_code' THEN "customer_code"::text
 WHEN 'customer_name' THEN "customer_name"::text
 WHEN 'customer_type' THEN "customer_type"::text
 WHEN 'order_date' THEN "order_date"::text
 WHEN 'quantity' THEN "quantity"::text
 WHEN 'total_quantity' THEN "total_quantity"::text
 WHEN 'price' THEN "price"::text
 WHEN 'total_amount' THEN "total_amount"::text
 WHEN 'order_status' THEN "order_status"::text
 WHEN 'sales_coordinator' THEN "sales_coordinator"::text
 WHEN 'rmp_sku_id' THEN "rmp_sku_id"::text
 WHEN 'rmp_sku_name' THEN "rmp_sku_name"::text
 WHEN 'sku_ambiguous' THEN "sku_ambiguous"::text
 WHEN 'sku_unmapped' THEN "sku_unmapped"::text
 WHEN 'dispatch_date' THEN "dispatch_date"::text
 WHEN 'delivery_required_on' THEN "delivery_required_on"::text
 WHEN 'expected_delivery_date' THEN "expected_delivery_date"::text
 WHEN 'actual_delivery_date' THEN "actual_delivery_date"::text
 WHEN 'created_at' THEN "created_at"::text
 WHEN 'updated_at' THEN "updated_at"::text
 WHEN 'basis' THEN "basis"::text END v FROM flat CROSS JOIN jsonb_array_elements_text(coalesce(p_query->'option_fields','[]')) k) x WHERE v IS NOT NULL AND v<>'' GROUP BY k)
 SELECT jsonb_build_object('data',coalesce((SELECT jsonb_agg(v ORDER BY p.position) FROM sa_domain.dashboard_rmp_rows(p_filters||jsonb_build_object('ids',(SELECT coalesce(jsonb_agg(id),'[]') FROM page))) v JOIN(SELECT id,row_number() OVER() position FROM page) p ON p.id=v->>'id'),'[]'),
 'totalCount',count_,'totalPages',greatest(1,ceil(count_::numeric/n)),'page',page_,'pageSize',n,'totalCountIsExact',true,
 'summary',jsonb_build_object('count',count_,'sums',jsonb_build_object('quantity',
 CASE
 WHEN NOT coalesce(invalid_qty,false) THEN coalesce(qty,0)::text END,'total_quantity',
 CASE
 WHEN NOT coalesce(invalid_qty,false) THEN coalesce(qty,0)::text END,'total_amount',
 CASE
 WHEN NOT coalesce(invalid,false) THEN coalesce(amount,0)::text END)),
 'options',coalesce((SELECT jsonb_object_agg(k,values_) FROM options),'{}')) INTO r FROM stats;
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.dashboard_rmp_query(jsonb,jsonb) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.dashboard_query(p_report text,p_tab text,p_filters jsonb,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET plan_cache_mode=force_custom_plan AS $f$
DECLARE r jsonb;revision_ text;n int:=coalesce((p_query->>'items')::int,20);page_ int:=coalesce((p_query->>'page')::int,1);
 sort_ text:=coalesce(nullif(p_query#>>'{sort,key}',''),'id');direction_ text:=coalesce(p_query#>>'{sort,direction}','desc');
 numeric_ boolean:=coalesce((p_query#>>'{sort,numeric}')::boolean,sort_='id');sums_ jsonb;counts_ jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_query,ARRAY['page','items','search','filters','quick','sort','option_fields','revision']);
 PERFORM sa_domain.check_fields(p_filters,ARRAY['from','before','from_b','before_b','domain','id','ids','history','oos','customer_ids','zone_id']);
 IF p_filters?'domain' THEN
  PERFORM sa_domain.check_fields(p_filters->'domain',ARRAY['status','customer_id','customer_role','zone_id','coordinator_id','brand_id','class_id','order_id','item_id']);
  IF p_filters#>>'{domain,status}' NOT IN('all','pending','overdue','failed','completed') THEN RAISE EXCEPTION 'Invalid report status' USING ERRCODE='22023';END IF;
 END IF;
 IF sa_domain.dashboard_actor_id() IS NULL THEN RAISE EXCEPTION 'Dashboard administrator required' USING ERRCODE='42501';END IF;
 IF n NOT BETWEEN 1 AND 500 OR page_ NOT BETWEEN 1 AND 100000 OR direction_ NOT IN('asc','desc') OR length(coalesce(p_query->>'search',''))>200 THEN RAISE EXCEPTION 'Invalid dashboard query' USING ERRCODE='22023';END IF;
 SELECT generation::text||':'||edit_revision::text INTO revision_ FROM sa_domain.runtime_state CROSS JOIN sa_sync.environment_state;
 IF p_query?'revision' AND p_query->>'revision' IS DISTINCT FROM revision_ THEN RAISE EXCEPTION 'Data changed during paging; refresh and retry' USING ERRCODE='PT409';END IF;
 IF coalesce(jsonb_array_length(p_query#>'{filters,conditions}'),0)=0 AND coalesce(jsonb_array_length(p_query#>'{quick,conditions}'),0)=0
 AND coalesce(p_query->>'search','')='' AND coalesce(p_query#>>'{sort,key}','id')='id' AND direction_='desc' AND coalesce(jsonb_array_length(p_query->'option_fields'),0)=0 THEN
  r:=sa_domain.dashboard_fast_result(p_report,p_tab,p_filters,page_,n);
  IF r IS NOT NULL THEN RETURN r||jsonb_build_object('revision',revision_,'metadata',
   (SELECT jsonb_build_object('environment',environment,'generation',generation,'editRevision',edit_revision,'syncedRevision',synced_revision,
    'canWrite',cutover OR(environment='staging' AND sa_domain.rehearsal_actor_allowed(sa_domain.request_uid())),'ownership',CASE WHEN cutover THEN 'supabase' ELSE 'mirror' END,'asOf',s.updated_at,'timezone','Asia/Kolkata') FROM sa_sync.environment_state s CROSS JOIN sa_domain.runtime_state));END IF;
 END IF;
 IF p_report='rmp_order_reports' THEN
  r:=sa_domain.dashboard_rmp_query(p_filters,p_query);
  RETURN r||jsonb_build_object('revision',revision_,'metadata',(SELECT jsonb_build_object('environment',environment,'generation',generation,'editRevision',edit_revision,'syncedRevision',synced_revision,
   'canWrite',cutover OR(environment='staging' AND sa_domain.rehearsal_actor_allowed(sa_domain.request_uid())),'ownership',CASE WHEN cutover THEN 'supabase' ELSE 'mirror' END,'asOf',s.updated_at,'timezone','Asia/Kolkata') FROM sa_sync.environment_state s CROSS JOIN sa_domain.runtime_state));
 END IF;
 WITH base AS MATERIALIZED(SELECT v FROM sa_domain.dashboard_rows(p_report,p_tab,p_filters) v),
 filtered AS MATERIALIZED(SELECT v FROM base WHERE(coalesce(jsonb_array_length(p_query#>'{filters,conditions}'),0)=0 OR sa_domain.dashboard_match(v,p_query->'filters'))
 AND(coalesce(jsonb_array_length(p_query#>'{quick,conditions}'),0)=0 OR sa_domain.dashboard_match(v,p_query->'quick'))
  AND (coalesce(p_query->>'search','')='' OR EXISTS(SELECT FROM jsonb_each_text(v) e WHERE strpos(lower(e.value),lower(p_query->>'search'))>0))),
 page AS(SELECT v FROM filtered ORDER BY
  CASE WHEN direction_='asc' AND numeric_ THEN sa_domain.dashboard_number(v->>sort_) END ASC NULLS LAST,
  CASE WHEN direction_='desc' AND numeric_ THEN sa_domain.dashboard_number(v->>sort_) END DESC NULLS LAST,
  CASE WHEN direction_='asc' AND NOT numeric_ THEN lower(v->>sort_) END ASC NULLS LAST,
  CASE WHEN direction_='desc' AND NOT numeric_ THEN lower(v->>sort_) END DESC NULLS LAST,(v->>'id')::bigint DESC
  LIMIT n OFFSET(page_-1)*n),
 sums AS(SELECT e.key,CASE WHEN count(*) FILTER(WHERE sa_domain.dashboard_number(e.value) IS NULL)>0 THEN NULL ELSE sum(sa_domain.dashboard_number(e.value))::text END value
  FROM filtered f CROSS JOIN LATERAL(SELECT key,f.v->>key value FROM unnest(ARRAY['total_amount','total_quantity','quantity','inventory','total_qty','closed_qty','item_qty','ordered_qty','order_value','closed_ordered_qty','qtyA','qtyB','valueA','valueB']) key WHERE f.v?key) e GROUP BY e.key),
 options AS(SELECT key,jsonb_agg(value ORDER BY value) values_ FROM(SELECT DISTINCT e.key,e.value FROM base CROSS JOIN LATERAL jsonb_each_text(v) e
  WHERE e.key IN(SELECT jsonb_array_elements_text(coalesce(p_query->'option_fields','[]'))) AND e.value IS NOT NULL AND e.value<>'') choices GROUP BY key)
 SELECT jsonb_build_object('data',coalesce((SELECT jsonb_agg(v) FROM page),'[]'),
  'page',page_,'pageSize',n,'totalCount',(SELECT count(*) FROM filtered),'totalPages',greatest(1,ceil((SELECT count(*) FROM filtered)::numeric/n)),
  'totalCountIsExact',true,'revision',revision_,'summary',jsonb_build_object('count',(SELECT count(*) FROM filtered),
   'sums',coalesce((SELECT jsonb_object_agg(key,value) FROM sums),'{}'),'outOfStockCount',(SELECT count(*) FROM filtered WHERE v->>'status'='out of stock'),
   'unknownInventoryCount',(SELECT count(*) FROM filtered WHERE p_report='total_inventory' AND v->>'inventory' IS NULL)),
  'options',coalesce((SELECT jsonb_object_agg(key,values_) FROM options),'{}'),
  'metadata',(SELECT jsonb_build_object('environment',environment,'generation',generation,'editRevision',edit_revision,'syncedRevision',synced_revision,
    'canWrite',cutover OR(environment='staging' AND sa_domain.rehearsal_actor_allowed(sa_domain.request_uid())),'ownership',CASE WHEN cutover THEN 'supabase' ELSE 'mirror' END,'asOf',s.updated_at,'timezone','Asia/Kolkata') FROM sa_sync.environment_state s CROSS JOIN sa_domain.runtime_state)) INTO r;
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.dashboard_query(text,text,jsonb,jsonb) OWNER TO sa_guard;

-- The existing SQL-only leased-job executor also runs report captures. No
-- external provider request is needed: completed rows are retained for download.
CREATE TABLE sa_domain.dashboard_exports(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sequence_id bigint GENERATED ALWAYS AS IDENTITY,
 actor_id uuid NOT NULL,export_key uuid NOT NULL,generation bigint NOT NULL,revision text NOT NULL,request jsonb NOT NULL,
 UNIQUE(actor_id,export_key),
 job_id uuid REFERENCES sa_domain.outbox,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day',
 total_rows bigint,captured_rows bigint NOT NULL DEFAULT 0,total_bytes bigint NOT NULL DEFAULT 0,completed_at timestamptz,
 CHECK(octet_length(request::text)<=32768)
);
CREATE TABLE sa_domain.dashboard_export_rows(
 export_id uuid NOT NULL REFERENCES sa_domain.dashboard_exports ON DELETE CASCADE,row_number bigint NOT NULL,row_data jsonb NOT NULL,
 PRIMARY KEY(export_id,row_number)
);
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['dashboard_exports','dashboard_export_rows'] LOOP
  EXECUTE format('ALTER TABLE sa_domain.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE sa_domain.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON sa_domain.%I TO sa_guard',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON sa_domain.%I TO sa_executor',t);
  EXECUTE format('CREATE POLICY dashboard_export_guard ON sa_domain.%I FOR SELECT TO sa_guard USING(true)',t);
 END LOOP;
END $f$;
CREATE POLICY dashboard_export_owner ON sa_domain.dashboard_exports TO sa_executor USING(actor_id=(SELECT sa_domain.request_uid())) WITH CHECK(actor_id=(SELECT sa_domain.request_uid()));
CREATE POLICY dashboard_export_row_owner ON sa_domain.dashboard_export_rows TO sa_executor
 USING(export_id IN(SELECT id FROM sa_domain.dashboard_exports)) WITH CHECK(export_id IN(SELECT id FROM sa_domain.dashboard_exports));
GRANT USAGE ON SEQUENCE sa_domain.dashboard_exports_sequence_id_seq TO sa_executor;
GRANT SELECT,INSERT,DELETE ON sa_domain.dashboard_context TO sa_executor;
GRANT SELECT ON sa_domain.worker_context TO sa_executor;
CREATE POLICY dashboard_worker_context_read ON sa_domain.worker_context FOR SELECT TO sa_executor
 USING(backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND actor_id=(SELECT sa_domain.worker_actor_id()));
CREATE POLICY dashboard_export_context ON sa_domain.dashboard_context TO sa_executor
 USING(actor_id=(SELECT sa_domain.worker_actor_id()) AND backend_pid=pg_backend_pid() AND transaction_id=txid_current())
 WITH CHECK(actor_id=(SELECT sa_domain.worker_actor_id()) AND backend_pid=pg_backend_pid() AND transaction_id=txid_current());

CREATE INDEX dashboard_export_expiry ON sa_domain.dashboard_exports(expires_at);
GRANT SELECT,DELETE,UPDATE(expires_at) ON sa_domain.dashboard_exports TO sa_worker;
CREATE POLICY dashboard_export_cleanup ON sa_domain.dashboard_exports TO sa_worker USING(expires_at<=now());
-- Reuse the existing scheduled cleanup endpoint; no new Cron or Edge authority.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.squad_document_cleanup(text[])'::regprocedure);
 IF position(' UPDATE sa_domain.document_cleanup SET deleted_at' IN d)=0 THEN RAISE EXCEPTION 'Unexpected cleanup contract';END IF;
 d:=replace(d,' UPDATE sa_domain.document_cleanup SET deleted_at',
 $s$ DELETE FROM sa_domain.dashboard_exports WHERE id IN(SELECT id FROM sa_domain.dashboard_exports WHERE expires_at<=now() ORDER BY expires_at LIMIT 2 FOR UPDATE SKIP LOCKED);
 UPDATE sa_domain.document_cleanup SET deleted_at$s$);EXECUTE d;
END $f$;

CREATE FUNCTION sa_domain.dashboard_export_request(p_request jsonb,p_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cached_ jsonb;t sa_domain.dashboard_exports;r jsonb;g bigint;rev text;BEGIN
 IF sa_domain.dashboard_actor_id() IS NULL THEN RAISE EXCEPTION 'Dashboard administrator required' USING ERRCODE='42501';END IF;
 PERFORM sa_domain.check_fields(p_request,ARRAY['report','tab','filters','query']);
 IF p_key IS NULL THEN RAISE EXCEPTION 'Export retry key required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('dashboard-export:'||sa_domain.request_uid()::text,784145));
 SELECT * INTO t FROM sa_domain.dashboard_exports WHERE actor_id=sa_domain.request_uid() AND export_key=p_key;
 IF t.id IS NOT NULL THEN
  IF t.request IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'Export retry key reused with different filters' USING ERRCODE='22023';END IF;
  IF t.expires_at<=now() OR t.generation<>(SELECT generation FROM sa_domain.runtime_state) THEN RAISE EXCEPTION 'Export expired; request a fresh export' USING ERRCODE='55000';END IF;
  RETURN jsonb_build_object('id',t.id,'state','queued','expiresAt',t.expires_at);
 END IF;
 -- Validate the same request that the list accepts before queuing work.
 r:=sa_domain.dashboard_query(p_request->>'report',coalesce(p_request->>'tab',''),coalesce(p_request->'filters','{}'),coalesce(p_request->'query','{}')||'{"page":1,"items":1}');
 IF (r->>'totalCount')::bigint>250000 THEN RAISE EXCEPTION 'Export exceeds 250,000 rows; narrow the filters' USING ERRCODE='54000';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('dashboard-export:'||sa_domain.request_uid()::text,784145));
 IF(SELECT count(*) FROM sa_domain.dashboard_exports WHERE actor_id=sa_domain.request_uid() AND created_at>now()-interval '1 hour')>=10 THEN RAISE EXCEPTION 'Export hourly limit reached' USING ERRCODE='54000';END IF;
 DELETE FROM sa_domain.dashboard_exports WHERE actor_id=sa_domain.request_uid() AND expires_at<=now();
 INSERT INTO sa_domain.dashboard_exports(actor_id,export_key,generation,revision,request,total_rows)
 SELECT sa_domain.request_uid(),p_key,generation,generation::text||':'||edit_revision::text,p_request,(r->>'totalCount')::bigint FROM sa_domain.runtime_state CROSS JOIN sa_sync.environment_state RETURNING * INTO t;
 INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
 VALUES(t.actor_id,'dashboard.export','export',t.sequence_id,p_key,t.generation,jsonb_build_object('export_id',t.id));
 UPDATE sa_domain.dashboard_exports SET job_id=(SELECT id FROM sa_domain.outbox WHERE actor_id=t.actor_id AND command_key=p_key AND event_type='dashboard.export') WHERE id=t.id;
 r:=jsonb_build_object('id',t.id,'state','queued','expiresAt',t.expires_at);
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.dashboard_export_request(jsonb,uuid) OWNER TO sa_executor;

CREATE FUNCTION sa_domain.dashboard_capture_export(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE t sa_domain.dashboard_exports;n bigint;bytes_ bigint;rev text;batch_ jsonb;BEGIN
 IF sa_domain.worker_actor_id() IS NULL OR NOT coalesce((sa_domain.ops_context()->>'platform')::boolean,false) THEN RAISE EXCEPTION 'Current delegated platform administrator required' USING ERRCODE='42501';END IF;
 SELECT * INTO t FROM sa_domain.dashboard_exports WHERE id=p_id AND actor_id=sa_domain.worker_actor_id() FOR UPDATE;
 IF t.id IS NULL OR t.expires_at<=now() THEN RAISE EXCEPTION 'Export expired' USING ERRCODE='P0002';END IF;
 IF NOT EXISTS(SELECT FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND job_id=t.job_id AND generation=t.generation) THEN RAISE EXCEPTION 'Export lease mismatch' USING ERRCODE='42501';END IF;
 IF t.completed_at IS NOT NULL THEN RETURN jsonb_build_object('export_id',t.id,'rows',t.total_rows);END IF;
 SELECT generation::text||':'||edit_revision::text INTO rev FROM sa_domain.runtime_state CROSS JOIN sa_sync.environment_state;
 IF rev<>t.revision THEN RAISE EXCEPTION 'Data changed before capture; request a fresh export' USING ERRCODE='PT409';END IF;
 INSERT INTO sa_domain.dashboard_context VALUES(pg_backend_pid(),txid_current(),t.actor_id);
 batch_:=sa_domain.dashboard_query(t.request->>'report',coalesce(t.request->>'tab',''),coalesce(t.request->'filters','{}'),
  coalesce(t.request->'query','{}')||jsonb_build_object('page',t.captured_rows/500+1,'items',500,'revision',t.revision));
 IF (batch_->>'totalCount')::bigint<>t.total_rows THEN RAISE EXCEPTION 'Export count changed' USING ERRCODE='PT409';END IF;
 INSERT INTO sa_domain.dashboard_export_rows(export_id,row_number,row_data)
 SELECT t.id,t.captured_rows+ord,v FROM jsonb_array_elements(batch_->'data') WITH ORDINALITY x(v,ord);
 n:=t.captured_rows+jsonb_array_length(batch_->'data');
 SELECT t.total_bytes+coalesce(sum(octet_length(v::text)),0) INTO bytes_ FROM jsonb_array_elements(batch_->'data') v;
 IF n>250000 OR bytes_>268435456 THEN RAISE EXCEPTION 'Export is too large; narrow the filters' USING ERRCODE='54000';END IF;
 IF n<t.total_rows AND jsonb_array_length(batch_->'data')<>500 OR n>t.total_rows THEN RAISE EXCEPTION 'Export page incomplete' USING ERRCODE='PT409';END IF;
 UPDATE sa_domain.dashboard_exports SET captured_rows=n,total_bytes=bytes_,completed_at=CASE WHEN n=t.total_rows THEN now() END WHERE id=t.id;
 DELETE FROM sa_domain.dashboard_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 RETURN jsonb_build_object('export_id',t.id,'rows',n,'revision',rev,'more',n<t.total_rows);
END $f$;
ALTER FUNCTION sa_domain.dashboard_capture_export(uuid) OWNER TO sa_executor;
GRANT EXECUTE ON FUNCTION sa_domain.dashboard_capture_export(uuid) TO sa_worker;

CREATE FUNCTION sa_domain.dashboard_export_read(p_id uuid,p_page integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE t sa_domain.dashboard_exports;r jsonb;BEGIN
 IF sa_domain.dashboard_actor_id() IS NULL THEN RAISE EXCEPTION 'Dashboard administrator required' USING ERRCODE='42501';END IF;
 SELECT * INTO t FROM sa_domain.dashboard_exports WHERE id=p_id AND actor_id=sa_domain.request_uid();
 IF t.id IS NULL THEN RAISE EXCEPTION 'Export unavailable' USING ERRCODE='P0002';END IF;
 IF t.expires_at<=now() OR t.generation<>(SELECT generation FROM sa_domain.runtime_state) THEN RAISE EXCEPTION 'Export expired; request a fresh export' USING ERRCODE='55000';END IF;
 IF p_page NOT BETWEEN 0 AND 500 THEN RAISE EXCEPTION 'Invalid export page' USING ERRCODE='22023';END IF;
 SELECT jsonb_build_object('id',t.id,'state',CASE WHEN t.completed_at IS NOT NULL THEN 'completed' ELSE j.status END,'errorCode',j.last_error_code,
  'totalCount',t.total_rows,'capturedRows',t.captured_rows,'totalPages',ceil(t.total_rows/500.0),'page',p_page,'expiresAt',t.expires_at,'revision',t.revision,
  'data',CASE WHEN p_page>0 AND t.completed_at IS NOT NULL THEN coalesce((SELECT jsonb_agg(row_data ORDER BY row_number) FROM sa_domain.dashboard_export_rows WHERE export_id=t.id AND row_number BETWEEN(p_page-1)*500+1 AND p_page*500),'[]') ELSE '[]'::jsonb END)
 INTO r FROM sa_domain.outbox j WHERE j.id=t.job_id;
 RETURN r;
END $f$;
ALTER FUNCTION sa_domain.dashboard_export_read(uuid,integer) OWNER TO sa_guard;

-- Mirror mode permits only these read-only jobs. No business worker fence is
-- relaxed, and imported/native events remain untouched while Scott owns writes.
CREATE FUNCTION sa_domain.dashboard_export_claim(p_limit integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE g bigint;r jsonb;BEGIN
 PERFORM sa_domain.assert_service_worker();
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Invalid claim size' USING ERRCODE='22023';END IF;
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) OR EXISTS(SELECT FROM sa_sync.environment_state WHERE active_job IS NOT NULL) THEN RETURN jsonb_build_object('jobs','[]'::jsonb,'paused',true);END IF;
 SELECT generation INTO g FROM sa_domain.runtime_state;
 WITH expired AS(SELECT id FROM sa_domain.outbox WHERE event_type='dashboard.export' AND generation=g AND status='leased' AND lease_until<now() ORDER BY lease_until,id FOR UPDATE SKIP LOCKED LIMIT 100),
 settled AS(UPDATE sa_domain.outbox j SET status=CASE WHEN attempts>=5 THEN 'dead' ELSE 'pending' END,last_error_code='LEASE_EXPIRED',lease_until=NULL,
  completed_at=CASE WHEN attempts>=5 THEN now() END,revision=revision+1 FROM expired e WHERE j.id=e.id RETURNING j.lease_token)
 UPDATE sa_domain.job_attempts a SET state='expired',finished_at=now(),error_code='LEASE_EXPIRED' FROM settled s WHERE a.lease_token=s.lease_token AND a.state='leased';
 WITH candidates AS(SELECT id FROM sa_domain.outbox WHERE event_type='dashboard.export' AND generation=g AND attempts<5 AND available_at<=now() AND status='pending'
  ORDER BY available_at,sequence_id FOR UPDATE SKIP LOCKED LIMIT p_limit),
 claimed AS(UPDATE sa_domain.outbox j SET status='leased',attempts=attempts+1,revision=revision+1,lease_until=now()+interval '90 seconds',lease_token=gen_random_uuid()
  FROM candidates c WHERE j.id=c.id RETURNING j.*),
 attempts_log AS(INSERT INTO sa_domain.job_attempts(lease_token,job_id,attempt) SELECT lease_token,id,attempts FROM claimed RETURNING lease_token)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'lease_token',lease_token,'handler','local_amendment','attempt',attempts,'lease_until',lease_until) ORDER BY available_at,sequence_id),'[]') INTO r FROM claimed;
 RETURN jsonb_build_object('jobs',r,'paused',jsonb_array_length(r)=0);
END $f$;
ALTER FUNCTION sa_domain.dashboard_export_claim(integer) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.dashboard_export_execute(p_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET jit=off AS $f$
DECLARE j sa_domain.outbox;r jsonb;g bigint;error_ text;retry_ boolean;state_ text;BEGIN
 PERFORM sa_domain.assert_service_worker();
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) OR EXISTS(SELECT FROM sa_sync.environment_state WHERE active_job IS NOT NULL) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 SELECT generation INTO g FROM sa_domain.runtime_state;
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_id AND event_type='dashboard.export' FOR UPDATE;
 IF j.id IS NULL OR j.generation<>g OR j.lease_token IS DISTINCT FROM p_lease_token OR p_lease_token IS NULL THEN RAISE EXCEPTION 'Export lease unavailable' USING ERRCODE='PT409';END IF;
 IF j.status='done' THEN RETURN jsonb_build_object('id',j.id,'state','done','replayed',true);END IF;
 IF j.status<>'leased' OR j.lease_until<=statement_timestamp() THEN RAISE EXCEPTION 'Export lease expired' USING ERRCODE='PT409';END IF;
 BEGIN
  INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
  r:=sa_domain.dashboard_capture_export((j.payload->>'export_id')::uuid);
  DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS error_=RETURNED_SQLSTATE;END;
 retry_:=error_ IN('40P01','55P03','55000','57014','53300') AND j.attempts<5;
 state_:=CASE WHEN error_ IS NULL THEN CASE WHEN coalesce((r->>'more')::boolean,false) THEN 'pending' ELSE 'done' END WHEN retry_ THEN 'pending' ELSE 'dead' END;
 UPDATE sa_domain.job_attempts SET state=CASE WHEN error_ IS NULL THEN 'done' ELSE 'failed' END,finished_at=now(),error_code=error_ WHERE lease_token=j.lease_token;
 UPDATE sa_domain.outbox SET status=state_,result=coalesce(r,result),completed_at=CASE WHEN state_ IN('done','dead') THEN now() END,
  attempts=CASE WHEN error_ IS NULL AND state_='pending' THEN 0 ELSE attempts END,lease_until=NULL,
  lease_token=CASE WHEN state_='done' THEN lease_token ELSE NULL END,last_error_code=error_,
  available_at=CASE WHEN retry_ THEN now()+make_interval(secs=>least(300,power(2,j.attempts)::integer*5)) ELSE now() END,revision=revision+1 WHERE id=j.id;
 RETURN jsonb_build_object('id',j.id,'state',state_,'error_code',error_);
END $f$;
ALTER FUNCTION sa_domain.dashboard_export_execute(uuid,uuid) OWNER TO sa_worker;

DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.job_handler(text,jsonb)'::regprocedure);
 d:=replace(d,'SELECT CASE WHEN',$s$SELECT CASE WHEN p_event='dashboard.export' THEN 'local_amendment' WHEN$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.squad_job_claim(integer)'::regprocedure);
 IF position($s$THEN RETURN jsonb_build_object('jobs','[]'::jsonb,'paused',true);END IF;$s$ IN d)=0 THEN RAISE EXCEPTION 'Unexpected mirror claim contract';END IF;
 d:=replace(d,$s$THEN RETURN jsonb_build_object('jobs','[]'::jsonb,'paused',true);END IF;$s$,
 $s$THEN RETURN sa_domain.dashboard_export_claim(p_limit);END IF;$s$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.squad_job_execute(uuid,uuid)'::regprocedure);
 IF position('g:=sa_domain.worker_write_fence();' IN d)=0 THEN RAISE EXCEPTION 'Unexpected SQL executor contract';END IF;
 d:=replace(d,'g:=sa_domain.worker_write_fence();',
 $s$IF EXISTS(SELECT FROM sa_domain.outbox WHERE id=p_id AND event_type='dashboard.export') THEN RETURN sa_domain.dashboard_export_execute(p_id,p_lease_token);END IF;
 g:=sa_domain.worker_write_fence();$s$);EXECUTE d;
END $f$;

CREATE FUNCTION canto_api.dashboard(p_action text,p_args jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET statement_timeout='15s' SET jit=off AS $f$
DECLARE r jsonb;id_ bigint;BEGIN
 IF NOT sa_admin.is_admin() THEN RAISE EXCEPTION 'Dashboard administrator required' USING ERRCODE='42501';END IF;
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Source refresh in progress; retry shortly' USING ERRCODE='55000';END IF;
 INSERT INTO sa_domain.dashboard_context VALUES(pg_backend_pid(),txid_current(),sa_domain.request_uid());
 CASE p_action
 WHEN 'query' THEN r:=sa_domain.dashboard_query(p_args->>'report',coalesce(p_args->>'tab',''),coalesce(p_args->'filters','{}'),coalesce(p_args->'query','{}'));
 WHEN 'customer_options' THEN r:=sa_domain.dashboard_customer_options();
 WHEN 'customer_get' THEN r:=sa_domain.dashboard_customer((p_args->>'id')::bigint);
 WHEN 'customer_save' THEN r:=sa_domain.dashboard_customer_save((p_args->>'id')::bigint,p_args->'values',p_args->>'version',(p_args->>'key')::uuid);
 WHEN 'customer_archive' THEN r:=sa_domain.dashboard_customer_archive((p_args->>'id')::bigint,p_args->>'version',(p_args->>'key')::uuid);
 WHEN 'export_request' THEN r:=sa_domain.dashboard_export_request(p_args->'request',(p_args->>'key')::uuid);
 WHEN 'export_read' THEN r:=sa_domain.dashboard_export_read((p_args->>'id')::uuid,coalesce((p_args->>'page')::integer,0));
 WHEN 'capabilities' THEN r:=jsonb_build_object('version',1,'serverQuery',true,'atomicCustomerSave',true,'maxPageSize',500,'durableExports',true);
 ELSE RAISE EXCEPTION 'Unknown dashboard action' USING ERRCODE='22023';
 END CASE;
 IF p_action='query' AND p_args->>'report'='rmp_order_reports'
  AND coalesce(p_args#>>'{filters,domain,status}','all')<>'overdue'
  AND coalesce(p_args#>>'{query,search}','')=''
  AND coalesce(jsonb_array_length(p_args#>'{query,filters,conditions}'),0)=0
  AND coalesce(jsonb_array_length(p_args#>'{query,quick,conditions}'),0)=0 THEN
  DELETE FROM sa_domain.dashboard_summaries WHERE revision<>r->>'revision' OR created_at<=now()-interval '5 minutes';
  IF (SELECT count(*) FROM sa_domain.dashboard_summaries)<200 THEN
   INSERT INTO sa_domain.dashboard_summaries(revision,filter_key,total_count,summary)
   VALUES(r->>'revision',md5(coalesce(p_args->'filters','{}')::text),(r->>'totalCount')::bigint,r->'summary') ON CONFLICT DO NOTHING;
  END IF;
 END IF;
 DELETE FROM sa_domain.dashboard_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 RETURN r;
END $f$;
ALTER FUNCTION canto_api.dashboard(text,jsonb) OWNER TO sa_dashboard;
REVOKE ALL ON FUNCTION canto_api.dashboard(text,jsonb) FROM PUBLIC,anon,service_role,sa_app;
GRANT EXECUTE ON FUNCTION canto_api.dashboard(text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION sa_admin.is_admin(),sa_domain.request_uid(),sa_domain.worker_actor_id() TO sa_dashboard;
GRANT EXECUTE ON FUNCTION sa_domain.account_user_status(bigint,text,text,text,uuid) TO sa_dashboard,sa_executor;
DO $f$ DECLARE f record;BEGIN
 FOR f IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='sa_domain'::regnamespace AND proname LIKE 'dashboard_%' AND proname NOT IN('dashboard_export_claim','dashboard_export_execute') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_guard,sa_executor,sa_dashboard',f.signature);
 END LOOP;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.dashboard_export_claim(integer),sa_domain.dashboard_export_execute(uuid,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role,sa_guard,sa_executor,sa_dashboard;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor,sa_worker;
REVOKE CREATE ON SCHEMA canto_api FROM sa_dashboard;
NOTIFY pgrst,'reload schema';
COMMIT;
