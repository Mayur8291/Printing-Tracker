-- Squad One domain boundary. Existing business records remain in the snapshot.
-- Deliberately no public-schema DDL/DML and no business-data side-effect triggers.
BEGIN;
CREATE SCHEMA IF NOT EXISTS sa_domain;
REVOKE ALL ON SCHEMA sa_domain FROM PUBLIC,anon,authenticated,sa_app;
DO $do$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='sa_guard') THEN CREATE ROLE sa_guard NOLOGIN NOINHERIT NOBYPASSRLS; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='sa_executor') THEN CREATE ROLE sa_executor NOLOGIN NOINHERIT NOBYPASSRLS; END IF;
END $do$;
GRANT sa_guard,sa_executor TO postgres;
-- PostgreSQL requires the receiving owner to have CREATE during ownership transfer.
-- Remove it again before committing; execution roles cannot install arbitrary code.
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
GRANT USAGE ON SCHEMA sa_domain,sa_snapshot_20261019,sa_identity,auth,sa_sync TO sa_guard;
GRANT USAGE ON SCHEMA sa_domain,sa_snapshot_20261019,sa_sync,auth TO sa_executor;
GRANT USAGE ON SCHEMA sa_domain,canto_api TO sa_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA sa_domain REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA canto_api REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TYPE sa_domain.actor AS (auth_id uuid,user_id bigint,role_id integer,factory_id bigint,features jsonb);
GRANT SELECT(id,role,email,banned_until) ON auth.users TO sa_guard;
GRANT SELECT(id,user_id,not_after) ON auth.sessions TO sa_guard;
GRANT SELECT(auth_user_id,legacy_user_id,enrollment_state) ON sa_identity.sa_auth_identities TO sa_guard;
CREATE POLICY squad_guard_identity ON sa_identity.sa_auth_identities FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,role,email,disabled,deleted_at,approved,factory_id,features,created_by_id,factory_manager_id,parent_tailor_id)
 ON sa_snapshot_20261019.sa_users TO sa_guard;
CREATE POLICY squad_guard_users ON sa_snapshot_20261019.sa_users FOR SELECT TO sa_guard USING(true);
GRANT SELECT ON sa_snapshot_20261019.sa_user_dealers TO sa_guard;
CREATE POLICY squad_guard_links ON sa_snapshot_20261019.sa_user_dealers FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,customer_id,customer_sc_id,customer_dealer_id,assigned_to_id,assigned_worker_id,order_item_type)
 ON sa_snapshot_20261019.sa_orders TO sa_guard;
CREATE POLICY squad_guard_orders ON sa_snapshot_20261019.sa_orders FOR SELECT TO sa_guard USING(true);
GRANT SELECT(id,order_id,cutting_master_id) ON sa_snapshot_20261019.sa_items TO sa_guard;
CREATE POLICY squad_guard_items ON sa_snapshot_20261019.sa_items FOR SELECT TO sa_guard USING(true);

-- Only this narrow lookup role can read identity eligibility. It cannot write,
-- log in, or read password hashes. No client is a member of either private role.
CREATE FUNCTION sa_domain.actor() RETURNS sa_domain.actor
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor;
BEGIN
 IF auth.jwt()->>'role' IS DISTINCT FROM 'sa_app' THEN
  RAISE EXCEPTION 'App session required' USING ERRCODE='28000'; END IF;
 SELECT u.id,s.id,s.role,s.factory_id,coalesce(s.features,'[]') INTO a
 FROM auth.users u
 JOIN sa_identity.sa_auth_identities m ON m.auth_user_id=u.id AND m.enrollment_state='ready'
 JOIN sa_snapshot_20261019.sa_users s ON s.id=m.legacy_user_id
 WHERE u.id=auth.uid() AND u.role='sa_app' AND (u.banned_until IS NULL OR u.banned_until<now())
  AND s.deleted_at IS NULL AND s.disabled IS NOT TRUE AND NOT(s.role=3 AND s.approved IS FALSE)
  AND s.role IN (0,1,2,3,4,7,8,9,10,11,12) AND lower(btrim(s.email))=lower(btrim(u.email))
  AND EXISTS(SELECT FROM auth.sessions x WHERE x.id=(auth.jwt()->>'session_id')::uuid
    AND x.user_id=u.id AND (x.not_after IS NULL OR x.not_after>now()));
 IF a.user_id IS NULL THEN RAISE EXCEPTION 'App session is no longer eligible' USING ERRCODE='28000'; END IF;
 RETURN a;
END $f$;
ALTER FUNCTION sa_domain.actor() OWNER TO sa_guard;

CREATE FUNCTION sa_domain.feature(p_features jsonb,p_key text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_features)='array' THEN p_features ELSE '[]' END) f
  WHERE f->>'key'=split_part(p_key,'.',1) AND f->>'checked'='true'
   AND (p_key=split_part(p_key,'.',1) OR EXISTS(
    SELECT FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f->'children')='array' THEN f->'children' ELSE '[]' END) child
    WHERE child->>'key'=p_key AND child->>'checked'='true')))
$f$;

CREATE FUNCTION sa_domain.require_roles(p_roles integer[]) RETURNS sa_domain.actor
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();
BEGIN
 IF NOT a.role_id=ANY(p_roles) THEN RAISE EXCEPTION 'Action is not permitted' USING ERRCODE='42501'; END IF;
 RETURN a;
END $f$;

CREATE FUNCTION sa_domain.can_person(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users target CROSS JOIN sa_domain.actor() a
 WHERE target.id=p_id AND (a.role_id=0 OR target.id=a.user_id
  OR (a.role_id=1 AND target.role IN(3,10) AND target.created_by_id=a.user_id)
  OR (a.role_id=10 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_user_dealers d WHERE d.user_id=target.id AND d.dealer_id=a.user_id))
  OR (a.role_id=2 AND target.role IN(1,2,4,5,6,7,8,9,11))
  OR (a.role_id IN(4,7,8,9) AND target.factory_id=a.factory_id AND target.role IN(4,5,6,7,8,9))))
$f$;
ALTER FUNCTION sa_domain.can_person(bigint) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.can_order(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders o CROSS JOIN sa_domain.actor() a
 WHERE o.id=p_id AND (a.role_id=0 OR (a.role_id=1 AND o.customer_sc_id=a.user_id)
 OR (a.role_id=2 AND o.order_item_type IN(0,2))
 OR (a.role_id IN(3,10) AND o.customer_id=a.user_id)
 OR (a.role_id=10 AND o.customer_dealer_id=a.user_id)
 OR (a.role_id=11 AND o.assigned_worker_id=a.user_id)
 OR (a.role_id IN(4,7,8) AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_users manager
    WHERE manager.id=o.assigned_to_id AND manager.factory_id=a.factory_id))
 OR (a.role_id=9 AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_items item WHERE item.order_id=o.id AND item.cutting_master_id=a.user_id))))
$f$;
ALTER FUNCTION sa_domain.can_order(bigint) OWNER TO sa_guard;

CREATE FUNCTION sa_domain.can_item(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_items item WHERE item.id=p_id AND sa_domain.can_order(item.order_id)
  AND ((SELECT (sa_domain.actor()).role_id)<>9 OR item.cutting_master_id=(SELECT (sa_domain.actor()).user_id)))
$f$;
ALTER FUNCTION sa_domain.can_item(bigint) OWNER TO sa_guard;

-- Operational state, never a copy of business data. A refresh generation makes
-- entity versions from before a source publication unusable after that publication.
CREATE TABLE sa_domain.runtime_state(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),generation bigint NOT NULL DEFAULT 0,
 allow_test_writes boolean NOT NULL DEFAULT false,api_version integer NOT NULL DEFAULT 1
);
INSERT INTO sa_domain.runtime_state(singleton) VALUES(true);
CREATE TABLE sa_domain.entity_versions(
 kind text NOT NULL,entity_id bigint NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 PRIMARY KEY(kind,entity_id)
);
CREATE TABLE sa_domain.commands(
 actor_id uuid NOT NULL,key uuid NOT NULL,operation text NOT NULL,payload_hash bytea NOT NULL,
 generation bigint NOT NULL,result jsonb,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,key)
);
CREATE TABLE sa_domain.audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid NOT NULL,legacy_user_id bigint NOT NULL,
 operation text NOT NULL,kind text NOT NULL,entity_id bigint,command_key uuid NOT NULL,
 changes jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX squad_audit_entity ON sa_domain.audit(kind,entity_id,id DESC);
CREATE TABLE sa_domain.outbox(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,event_type text NOT NULL,
 aggregate_kind text NOT NULL,aggregate_id bigint NOT NULL,command_key uuid NOT NULL,
 generation bigint NOT NULL,payload jsonb NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','leased','done','dead')),
 attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,
 lease_token uuid,last_error_code text,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(actor_id,command_key,event_type,aggregate_kind,aggregate_id)
);
CREATE INDEX squad_outbox_ready ON sa_domain.outbox(available_at,id) WHERE status IN('pending','leased');
DO $do$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['runtime_state','entity_versions','commands','audit','outbox'] LOOP
  EXECUTE format('ALTER TABLE sa_domain.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE sa_domain.%I FORCE ROW LEVEL SECURITY',t);
 END LOOP;
END $do$;
GRANT SELECT ON sa_domain.runtime_state TO sa_executor;
CREATE POLICY executor_runtime ON sa_domain.runtime_state FOR SELECT TO sa_executor USING(true);
GRANT SELECT,INSERT,UPDATE ON sa_domain.entity_versions,sa_domain.commands TO sa_executor;
CREATE POLICY executor_versions ON sa_domain.entity_versions TO sa_executor USING(true) WITH CHECK(true);
CREATE POLICY executor_commands ON sa_domain.commands TO sa_executor USING(actor_id=(SELECT auth.uid())) WITH CHECK(actor_id=(SELECT auth.uid()));
GRANT INSERT ON sa_domain.audit,sa_domain.outbox TO sa_executor;
GRANT USAGE ON SEQUENCE sa_domain.audit_id_seq TO sa_executor;
CREATE POLICY executor_audit ON sa_domain.audit FOR INSERT TO sa_executor WITH CHECK(actor_id=(SELECT auth.uid()));
CREATE POLICY executor_events ON sa_domain.outbox FOR INSERT TO sa_executor WITH CHECK(actor_id=(SELECT auth.uid()));
GRANT SELECT,UPDATE(edit_revision,updated_at) ON sa_sync.environment_state TO sa_executor;
CREATE POLICY squad_executor_environment ON sa_sync.environment_state TO sa_executor USING(singleton) WITH CHECK(singleton);

CREATE FUNCTION sa_domain.version(p_kind text,p_id bigint) RETURNS text
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT s.generation::text||':'||coalesce(v.revision,0)::text FROM sa_domain.runtime_state s
 LEFT JOIN sa_domain.entity_versions v ON v.kind=p_kind AND v.entity_id=p_id WHERE s.singleton
$f$;
CREATE FUNCTION sa_domain.bump_version(p_kind text,p_id bigint,p_expected text) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 IF p_expected IS NULL THEN RAISE EXCEPTION 'expected_version required' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_kind||':'||p_id,784139));
 IF sa_domain.version(p_kind,p_id) IS DISTINCT FROM p_expected THEN
  RAISE EXCEPTION 'Record changed; reload and retry' USING ERRCODE='40001'; END IF;
 INSERT INTO sa_domain.entity_versions(kind,entity_id,revision) VALUES(p_kind,p_id,1)
 ON CONFLICT(kind,entity_id) DO UPDATE SET revision=sa_domain.entity_versions.revision+1;
 RETURN sa_domain.version(p_kind,p_id);
END $f$;

CREATE FUNCTION sa_domain.begin_command(p_operation text,p_key uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor(); s sa_sync.environment_state%ROWTYPE; old sa_domain.commands%ROWTYPE;
 h bytea:=sha256(convert_to(p_payload::text,'UTF8')); allow_tests boolean; generation_ bigint;
BEGIN
 IF p_key IS NULL OR p_payload IS NULL OR octet_length(p_payload::text)>262144 THEN
  RAISE EXCEPTION 'Invalid command envelope' USING ERRCODE='22023'; END IF;
 -- Shared writes coexist; source refresh takes this same lock exclusively.
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN
  RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000'; END IF;
 SELECT * INTO s FROM sa_sync.environment_state WHERE singleton;
 SELECT allow_test_writes,generation INTO allow_tests,generation_ FROM sa_domain.runtime_state WHERE singleton;
 IF s.active_job IS NOT NULL THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000'; END IF;
 IF NOT s.cutover AND NOT(s.environment='staging' AND allow_tests) THEN
  RAISE EXCEPTION 'Environment is a read-only source mirror' USING ERRCODE='55000'; END IF;
 INSERT INTO sa_domain.commands(actor_id,key,operation,payload_hash,generation) VALUES(a.auth_id,p_key,p_operation,h,generation_)
 ON CONFLICT DO NOTHING;
 SELECT * INTO old FROM sa_domain.commands WHERE actor_id=a.auth_id AND key=p_key FOR UPDATE;
 IF old.generation<>generation_ THEN RAISE EXCEPTION 'Command predates source refresh; reload first' USING ERRCODE='40001'; END IF;
 IF old.operation<>p_operation OR old.payload_hash<>h THEN
  RAISE EXCEPTION 'Idempotency key was already used for a different command' USING ERRCODE='22023'; END IF;
 RETURN old.result;
END $f$;
CREATE FUNCTION sa_domain.finish_command(p_operation text,p_key uuid,p_kind text,p_id bigint,p_result jsonb,p_changes jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();
BEGIN
 UPDATE sa_domain.commands SET result=p_result WHERE actor_id=a.auth_id AND key=p_key AND operation=p_operation AND result IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Command was not reserved' USING ERRCODE='55000'; END IF;
 INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes)
 VALUES(a.auth_id,a.user_id,p_operation,p_kind,p_id,p_key,p_changes);
 INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation)
 SELECT a.auth_id,p_operation,p_kind,p_id,p_key,generation FROM sa_domain.runtime_state WHERE singleton;
 UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1,updated_at=now() WHERE singleton;
 RETURN p_result;
END $f$;
CREATE FUNCTION sa_domain.page_limit(p_limit integer) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'limit must be 1..100' USING ERRCODE='22023'; END IF;
 RETURN p_limit;
END $f$;
CREATE FUNCTION sa_domain.check_fields(p_fields jsonb,p_allowed text[]) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
BEGIN
 IF p_fields IS NULL OR jsonb_typeof(p_fields)<>'object' OR EXISTS(SELECT FROM jsonb_object_keys(p_fields) k WHERE NOT k=ANY(p_allowed)) THEN
  RAISE EXCEPTION 'Unknown or invalid fields' USING ERRCODE='22023'; END IF;
END $f$;

-- Explicit safe projection. Adding a column to Rails cannot expose it here.
GRANT SELECT(id,name,email,phone,role,profile_image,customer_company_name,customer_first_name,customer_last_name,
 factory_id,created_by_id,approved,onboarded,disabled,deleted_at,updated_at),UPDATE(name,phone,customer_company_name,customer_first_name,customer_last_name,updated_at)
 ON sa_snapshot_20261019.sa_users TO sa_executor;
CREATE POLICY squad_executor_people_read ON sa_snapshot_20261019.sa_users FOR SELECT TO sa_executor USING(sa_domain.can_person(id));
CREATE POLICY squad_executor_profile_write ON sa_snapshot_20261019.sa_users FOR UPDATE TO sa_executor
 USING(id=(SELECT (sa_domain.actor()).user_id)) WITH CHECK(id=(SELECT (sa_domain.actor()).user_id));
CREATE FUNCTION sa_domain.v1_me() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor(); result jsonb;
BEGIN
 SELECT jsonb_build_object('id',u.id::text,'auth_id',a.auth_id,'role',u.role,'name',u.name,'email',u.email,'phone',u.phone,
  'company_name',u.customer_company_name,'first_name',u.customer_first_name,'last_name',u.customer_last_name,
  'approved',u.approved,'onboarded',u.onboarded,'version',sa_domain.version('person',u.id),
  'capabilities',jsonb_build_object('notes',a.role_id IN(0,1,2,4) OR (a.role_id IN(11,12) AND sa_domain.feature(a.features,'1')),
   'goals',a.role_id IN(0,1,2) OR (a.role_id IN(11,12) AND sa_domain.feature(a.features,'2')),
   'catalogue',a.role_id IN(0,1,2,3,10) OR (a.role_id IN(11,12) AND sa_domain.feature(a.features,'3')),
   'configure',a.role_id IN(0,1,3,10) OR (a.role_id IN(11,12) AND sa_domain.feature(a.features,'3.3')),
   'documents',a.role_id IN(0,1,3,10) OR (a.role_id IN(11,12) AND sa_domain.feature(a.features,'3.2')),
   'promotions',a.role_id IN(0,1,3,10) OR (a.role_id IN(11,12) AND sa_domain.feature(a.features,'3.4')),
   'place_orders',a.role_id IN(1,3,10))) INTO result
 FROM sa_snapshot_20261019.sa_users u WHERE u.id=a.user_id;
 RETURN result;
END $f$;
ALTER FUNCTION sa_domain.v1_me() OWNER TO sa_executor;
CREATE FUNCTION sa_domain.v1_profile_save(p_fields jsonb,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor(); cached jsonb; v text; field text; val jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_fields,ARRAY['name','phone','company_name','first_name','last_name']);
 FOR field,val IN SELECT * FROM jsonb_each(p_fields) LOOP
  IF jsonb_typeof(val) NOT IN('string','null') OR length(val #>> '{}')>200 OR
   (field='name' AND coalesce(btrim(val #>> '{}'),'')='') THEN
   RAISE EXCEPTION 'Invalid profile field' USING ERRCODE='22023'; END IF;
 END LOOP;
 cached:=sa_domain.begin_command('profile.saved',p_idempotency_key,jsonb_build_object('fields',p_fields,'version',p_expected_version));
 IF cached IS NOT NULL THEN RETURN cached; END IF;
 v:=sa_domain.bump_version('person',a.user_id,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_users SET
 name=CASE WHEN p_fields?'name' THEN btrim(p_fields->>'name') ELSE name END,
 phone=CASE WHEN p_fields?'phone' THEN p_fields->>'phone' ELSE phone END,
 customer_company_name=CASE WHEN p_fields?'company_name' THEN p_fields->>'company_name' ELSE customer_company_name END,
 customer_first_name=CASE WHEN p_fields?'first_name' THEN p_fields->>'first_name' ELSE customer_first_name END,
 customer_last_name=CASE WHEN p_fields?'last_name' THEN p_fields->>'last_name' ELSE customer_last_name END,updated_at=now()
 WHERE id=a.user_id;
 RETURN sa_domain.finish_command('profile.saved',p_idempotency_key,'person',a.user_id,sa_domain.v1_me(),
   jsonb_build_object('fields',(SELECT jsonb_agg(key) FROM jsonb_object_keys(p_fields) key),'version',v));
END $f$;
ALTER FUNCTION sa_domain.v1_profile_save(jsonb,text,uuid) OWNER TO sa_executor;

CREATE FUNCTION canto_api.v1_me() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
 AS $f$ SELECT sa_domain.v1_me() $f$;
CREATE FUNCTION canto_api.v1_profile_save(p_fields jsonb,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
 LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_profile_save(p_fields,p_expected_version,p_idempotency_key) $f$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sa_domain FROM PUBLIC,anon,authenticated,sa_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA sa_domain TO sa_guard,sa_executor;
-- Guard must not be able to execute mutators; only executor owns entry commands.
REVOKE EXECUTE ON FUNCTION sa_domain.v1_profile_save(jsonb,text,uuid),sa_domain.begin_command(text,uuid,jsonb),
 sa_domain.finish_command(text,uuid,text,bigint,jsonb,jsonb),sa_domain.bump_version(text,bigint,text) FROM sa_guard;
GRANT EXECUTE ON FUNCTION sa_domain.v1_me(),sa_domain.v1_profile_save(jsonb,text,uuid) TO sa_app;
REVOKE ALL ON FUNCTION canto_api.v1_me(),canto_api.v1_profile_save(jsonb,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION canto_api.v1_me(),canto_api.v1_profile_save(jsonb,text,uuid) TO sa_app;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
