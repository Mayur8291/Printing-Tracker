BEGIN;
-- Staging-only, trusted-registration acceptance of three exact PDF roots and
-- five recipient emails. Generic queues and ownership fences remain unchanged.
CREATE TABLE sa_domain.weekly_mail_rehearsals(
 id uuid PRIMARY KEY, fixture_run_id uuid NOT NULL, controlled_inbox text NOT NULL, generation bigint NOT NULL, owner_user_id bigint NOT NULL,
 tailor_id bigint NOT NULL, recipient_ids bigint[] NOT NULL,
 manual_documents uuid[] NOT NULL, week_start date NOT NULL,
 recipients jsonb NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 CHECK(cardinality(recipient_ids)=4),CHECK(cardinality(manual_documents)=2),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '15 minutes')
);
CREATE TABLE sa_domain.weekly_mail_documents(
 document_id uuid PRIMARY KEY, capability_id uuid NOT NULL,
 job_id uuid NOT NULL UNIQUE REFERENCES sa_domain.outbox(id),
 kind text NOT NULL CHECK(kind IN('catalogue','delivery_challan','tailor_weekly')),
 document_xmin text NOT NULL,document_sha256 text NOT NULL,
 request_sha256 text NOT NULL,phase text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sa_domain.weekly_mail_sends(
 job_id uuid PRIMARY KEY REFERENCES sa_domain.outbox(id),capability_id uuid NOT NULL,
 document_id uuid NOT NULL,recipient_id bigint NOT NULL,recipient_auth_id uuid NOT NULL,
 email text NOT NULL,lease_token uuid NOT NULL,state text NOT NULL CHECK(state IN('started','accepted','unknown')),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz
);
CREATE TABLE sa_domain.weekly_mail_job_receipts(
 job_id uuid PRIMARY KEY REFERENCES sa_domain.outbox(id),document_id uuid NOT NULL,capability_id uuid NOT NULL,
 job_xmin text NOT NULL,job_sha256 text NOT NULL,binding_sha256 text NOT NULL,
 delivery_xmin text,delivery_sha256 text,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sa_domain.weekly_mail_settings_receipts(
 capability_id uuid PRIMARY KEY,schedule_xmin text NOT NULL,schedule_sha256 text NOT NULL,
 settings_xmin text NOT NULL,settings_sha256 text NOT NULL,run_id uuid,run_xmin text,run_sha256 text,
 entry_document_id uuid,entry_xmin text,entry_sha256 text,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE sa_domain.weekly_mail_context(
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,capability_id uuid NOT NULL,
 PRIMARY KEY(backend_pid,transaction_id)
);
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['weekly_mail_rehearsals','weekly_mail_documents','weekly_mail_sends','weekly_mail_context','weekly_mail_job_receipts','weekly_mail_settings_receipts'] LOOP
  EXECUTE format('ALTER TABLE sa_domain.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE sa_domain.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON sa_domain.%I FROM PUBLIC,anon,authenticated,sa_app,service_role',t);
  EXECUTE format('GRANT SELECT ON sa_domain.%I TO sa_worker',t);
  EXECUTE format('CREATE POLICY weekly_mail_worker_read ON sa_domain.%I FOR SELECT TO sa_worker USING(true)',t);
 END LOOP;
END $f$;
GRANT INSERT,UPDATE ON sa_domain.weekly_mail_documents,sa_domain.weekly_mail_sends,sa_domain.weekly_mail_job_receipts,sa_domain.weekly_mail_settings_receipts TO sa_worker;
CREATE POLICY weekly_mail_job_receipts_write ON sa_domain.weekly_mail_job_receipts TO sa_worker USING(true) WITH CHECK(true);
CREATE POLICY weekly_mail_settings_receipts_write ON sa_domain.weekly_mail_settings_receipts TO sa_worker USING(true) WITH CHECK(true);
CREATE POLICY weekly_mail_documents_write ON sa_domain.weekly_mail_documents TO sa_worker USING(true) WITH CHECK(true);
CREATE POLICY weekly_mail_sends_write ON sa_domain.weekly_mail_sends TO sa_worker USING(true) WITH CHECK(true);
GRANT INSERT,DELETE ON sa_domain.weekly_mail_context TO sa_worker;
CREATE POLICY weekly_mail_context_write ON sa_domain.weekly_mail_context TO sa_worker USING(true) WITH CHECK(true);
GRANT SELECT ON sa_domain.weekly_mail_context,sa_domain.weekly_mail_rehearsals TO sa_guard;
CREATE POLICY weekly_mail_context_guard ON sa_domain.weekly_mail_context FOR SELECT TO sa_guard USING(true);
CREATE POLICY weekly_mail_cap_guard ON sa_domain.weekly_mail_rehearsals FOR SELECT TO sa_guard USING(true);
GRANT CREATE ON SCHEMA sa_domain TO sa_worker,sa_guard;

-- Only trusted direct SQL registers capabilities. Capture current, server-owned
-- identity/email bindings here; neither a request nor job payload supplies To.
CREATE FUNCTION sa_domain.weekly_mail_register() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE s sa_sync.environment_state;r sa_domain.runtime_state;d sa_domain.documents;j sa_domain.outbox;
 v uuid;roles_ integer[];emails_ text[];local_ text;domain_ text;alias_ text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Mail rehearsal is immutable' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('weekly-mail-rehearsal',784144));
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 SELECT * INTO s FROM sa_sync.environment_state;SELECT * INTO r FROM sa_domain.runtime_state;
 NEW.created_at:=clock_timestamp();NEW.week_start:=sa_domain.weekly_tailor_latest_week(NEW.created_at);
 IF NEW.fixture_run_id IS NULL OR NEW.controlled_inbox IS NULL OR NEW.controlled_inbox<>lower(btrim(NEW.controlled_inbox))
 OR NEW.controlled_inbox!~'^[a-z0-9][a-z0-9._-]*@[a-z0-9]([a-z0-9.-]*[a-z0-9])?[.][a-z]{2,63}$'
 OR length(NEW.controlled_inbox)>254 THEN RAISE EXCEPTION 'Explicit controlled base inbox required' USING ERRCODE='22023';END IF;
 local_:=split_part(NEW.controlled_inbox,'@',1);domain_:=split_part(NEW.controlled_inbox,'@',2);
 alias_:=local_||'+squad-'||left(replace(NEW.fixture_run_id::text,'-',''),12)||'-0@'||domain_;
 IF local_ LIKE '%..%' OR domain_ LIKE '%..%' OR right(local_,1)='.' OR domain_='mailinator.com'
 OR length(split_part(alias_,'@',1))>64 OR length(alias_)>254 THEN
 RAISE EXCEPTION 'Controlled inbox alias is invalid' USING ERRCODE='22023';END IF;
 IF s.environment IS DISTINCT FROM 'staging' OR s.cutover IS DISTINCT FROM false OR s.active_job IS NOT NULL
  OR r.allow_test_writes IS DISTINCT FROM true OR NEW.generation IS DISTINCT FROM r.generation
  OR NEW.expires_at<=NEW.created_at OR NEW.expires_at>NEW.created_at+interval '15 minutes'
  OR r.test_write_expires_at IS NULL OR NEW.expires_at>r.test_write_expires_at
  OR EXISTS(SELECT 1 FROM sa_domain.weekly_mail_rehearsals WHERE expires_at>NEW.created_at) THEN
  RAISE EXCEPTION 'Mail rehearsal unavailable' USING ERRCODE='55000';END IF;
 IF cardinality(NEW.recipient_ids) IS DISTINCT FROM 4 OR cardinality(NEW.manual_documents) IS DISTINCT FROM 2
  OR (SELECT count(DISTINCT x) FROM unnest(NEW.recipient_ids)x)<>4
  OR (SELECT count(DISTINCT x) FROM unnest(NEW.manual_documents)x)<>2 THEN
  RAISE EXCEPTION 'Four actors and two manual documents required' USING ERRCODE='22023';END IF;
 SELECT jsonb_agg(jsonb_build_object('user_id',u.id,'auth_id',a.id,'role_id',u.role,'email',a.email) ORDER BY u.id),
  array_agg(u.role ORDER BY u.role),array_agg(a.email)
 INTO NEW.recipients,roles_,emails_
 FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id
 JOIN auth.users a ON a.id=m.auth_user_id
 WHERE u.id=ANY(NEW.recipient_ids) AND a.id=ANY(r.test_actor_ids) AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE
 AND u.approved IS DISTINCT FROM false AND m.enrollment_state='ready' AND a.role='sa_app'
 AND (a.banned_until IS NULL OR a.banned_until<now())
 AND a.email=local_||'+squad-'||left(replace(NEW.fixture_run_id::text,'-',''),12)||'-'||u.role::text||'@'||domain_
 AND a.email=u.email AND a.email=m.canonical_email
 AND u.name='SQB '||left(replace(NEW.fixture_run_id::text,'-',''),12)||' role'||u.role::text;
 IF roles_ IS DISTINCT FROM ARRAY[0,2,3,4] OR cardinality(emails_)<>4 OR (SELECT count(DISTINCT e) FROM unnest(emails_)e)<>4
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.recipients)x WHERE (x->>'user_id')::bigint=NEW.owner_user_id AND x->>'role_id'='0') THEN
  RAISE EXCEPTION 'Exact current controlled recipients required' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id=NEW.tailor_id AND role=5 AND deleted_at IS NULL AND disabled IS NOT TRUE)
  OR EXISTS(SELECT 1 FROM sa_domain.weekly_tailor_runs WHERE generation=NEW.generation AND week_start=NEW.week_start)
  OR NOT EXISTS(SELECT 1 FROM sa_domain.weekly_tailor_schedule WHERE singleton AND enabled AND generation=NEW.generation
    AND owner_user_id=NEW.owner_user_id AND next_week=NEW.week_start)
  OR (SELECT array_agg(x ORDER BY x) FROM sa_domain.business_mail_settings m CROSS JOIN unnest(m.recipient_ids)x WHERE m.kind='tailor_weekly')
    IS DISTINCT FROM (SELECT array_agg((x->>'user_id')::bigint ORDER BY (x->>'user_id')::bigint) FROM jsonb_array_elements(NEW.recipients)x WHERE x->>'role_id' IN('0','2','4')) THEN
  RAISE EXCEPTION 'Exact weekly scheduler configuration required' USING ERRCODE='42501';END IF;
 FOREACH v IN ARRAY NEW.manual_documents LOOP
  SELECT * INTO d FROM sa_domain.documents WHERE id=v FOR UPDATE;SELECT * INTO j FROM sa_domain.outbox WHERE id=d.job_id FOR UPDATE;
  IF d.id IS NULL OR d.kind NOT IN('catalogue','delivery_challan') OR d.request->>'delivery' IS DISTINCT FROM 'email'
   OR d.state<>'queued' OR d.snapshot IS NOT NULL OR d.generation<>NEW.generation OR (d.actor_id=ANY(r.test_actor_ids)) IS NOT TRUE
   OR d.delivery_state<>'pending' OR j.status<>'pending' OR j.attempts<>0 OR j.lease_token IS NOT NULL
   OR j.actor_id<>d.actor_id OR j.event_type<>'document.requested' OR j.payload IS DISTINCT FROM jsonb_build_object('document_id',d.id)
   OR NOT EXISTS(SELECT 1 FROM sa_domain.audit a WHERE a.actor_id=d.actor_id AND a.command_key=j.command_key
      AND a.generation=NEW.generation AND a.operation='document.requested' AND a.kind='document' AND a.entity_id=d.sequence_id
      AND a.changes=jsonb_build_object('document_id',d.id)) THEN
   RAISE EXCEPTION 'Only untouched audited email documents may be registered' USING ERRCODE='42501';END IF;
  IF d.kind='catalogue' AND d.legacy_user_id<>NEW.owner_user_id THEN RAISE EXCEPTION 'Catalogue requester binding differs' USING ERRCODE='42501';END IF;
  IF d.kind='delivery_challan' AND NOT EXISTS(SELECT 1 FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id
    CROSS JOIN jsonb_array_elements(NEW.recipients)x WHERE i.id=(d.request->>'item_id')::bigint AND o.customer_id=(x->>'user_id')::bigint AND x->>'role_id'='3') THEN
   RAISE EXCEPTION 'Challan customer binding differs' USING ERRCODE='42501';END IF;
 END LOOP;
 IF (SELECT count(DISTINCT kind) FROM sa_domain.documents WHERE id=ANY(NEW.manual_documents))<>2 THEN RAISE EXCEPTION 'One catalogue and one challan required' USING ERRCODE='22023';END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION sa_domain.weekly_mail_register() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER weekly_mail_registration BEFORE INSERT OR UPDATE ON sa_domain.weekly_mail_rehearsals FOR EACH ROW EXECUTE FUNCTION sa_domain.weekly_mail_register();

CREATE FUNCTION sa_domain.weekly_mail_job_record(p_cap uuid,p_document uuid,p_job uuid,p_new boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE j sa_domain.outbox;m sa_domain.business_mail_deliveries;old_ sa_domain.weekly_mail_job_receipts;binding_ text;jx text;mx text;
BEGIN
 SELECT j0.* INTO j FROM sa_domain.outbox j0 WHERE id=p_job;
 SELECT * INTO m FROM sa_domain.business_mail_deliveries WHERE job_id=p_job;
 SELECT xmin::text INTO jx FROM sa_domain.outbox WHERE id=p_job;
 SELECT xmin::text INTO mx FROM sa_domain.business_mail_deliveries WHERE job_id=p_job;
 SELECT * INTO old_ FROM sa_domain.weekly_mail_job_receipts WHERE job_id=p_job;
 binding_:=encode(sha256(convert_to(jsonb_build_object('parent',j.parent_id,'actor',j.actor_id,'generation',j.generation,
  'event',j.event_type,'kind',j.aggregate_kind,'entity',j.aggregate_id,'key',j.command_key,'payload',j.payload)::text,'UTF8')),'hex');
 IF old_.job_id IS NOT NULL AND(old_.capability_id<>p_cap OR old_.document_id<>p_document OR old_.binding_sha256<>binding_) THEN
  RAISE EXCEPTION 'Rehearsal job binding changed' USING ERRCODE='42501';END IF;
 IF old_.job_id IS NULL AND NOT p_new AND pg_xact_status(jx::xid8)<>'in progress' THEN
  RAISE EXCEPTION 'Rehearsal descendant is not newly created' USING ERRCODE='42501';END IF;
 INSERT INTO sa_domain.weekly_mail_job_receipts(job_id,document_id,capability_id,job_xmin,job_sha256,binding_sha256,delivery_xmin,delivery_sha256)
 VALUES(j.id,p_document,p_cap,jx,encode(sha256(convert_to(to_jsonb(j)::text,'UTF8')),'hex'),binding_,mx,
  CASE WHEN m.job_id IS NOT NULL THEN encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex') END)
 ON CONFLICT(job_id) DO UPDATE SET job_xmin=excluded.job_xmin,job_sha256=excluded.job_sha256,
 delivery_xmin=excluded.delivery_xmin,delivery_sha256=excluded.delivery_sha256,recorded_at=clock_timestamp();
END $f$;
ALTER FUNCTION sa_domain.weekly_mail_job_record(uuid,uuid,uuid,boolean) OWNER TO sa_worker;
CREATE FUNCTION sa_domain.weekly_mail_settings_record(p_cap uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 INSERT INTO sa_domain.weekly_mail_settings_receipts(capability_id,schedule_xmin,schedule_sha256,settings_xmin,settings_sha256,
 run_id,run_xmin,run_sha256,entry_document_id,entry_xmin,entry_sha256)
 SELECT p_cap,s.xmin::text,encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex'),m.xmin::text,
 encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex'),run.id,run.xmin::text,
 CASE WHEN run.id IS NOT NULL THEN encode(sha256(convert_to(to_jsonb(run)::text,'UTF8')),'hex') END,
 entry.document_id,entry.xmin::text,CASE WHEN entry.document_id IS NOT NULL THEN encode(sha256(convert_to(to_jsonb(entry)::text,'UTF8')),'hex') END
 FROM sa_domain.weekly_tailor_schedule s CROSS JOIN sa_domain.business_mail_settings m
 JOIN sa_domain.weekly_mail_rehearsals cap ON cap.id=p_cap
 LEFT JOIN sa_domain.weekly_tailor_runs run ON run.generation=cap.generation AND run.week_start=cap.week_start
 LEFT JOIN sa_domain.weekly_tailor_entries entry ON entry.run_id=run.id AND entry.tailor_id=cap.tailor_id
 WHERE m.kind='tailor_weekly'
 ON CONFLICT(capability_id) DO UPDATE SET schedule_xmin=excluded.schedule_xmin,schedule_sha256=excluded.schedule_sha256,
 settings_xmin=excluded.settings_xmin,settings_sha256=excluded.settings_sha256,run_id=excluded.run_id,
 run_xmin=excluded.run_xmin,run_sha256=excluded.run_sha256,entry_document_id=excluded.entry_document_id,
 entry_xmin=excluded.entry_xmin,entry_sha256=excluded.entry_sha256,recorded_at=clock_timestamp();
END $f$;
ALTER FUNCTION sa_domain.weekly_mail_settings_record(uuid) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.weekly_mail_bind(p_cap uuid,p_document uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 INSERT INTO sa_domain.weekly_mail_documents(document_id,capability_id,job_id,kind,document_xmin,document_sha256,request_sha256,phase)
 SELECT d.id,p_cap,d.job_id,d.kind,d.xmin::text,encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex'),
 encode(sha256(convert_to(jsonb_build_object('request',d.request,'actor_id',d.actor_id,'generation',d.generation,'kind',d.kind)::text,'UTF8')),'hex'),'registered'
 FROM sa_domain.documents d WHERE d.id=p_document ON CONFLICT(document_id) DO NOTHING;
 IF FOUND THEN PERFORM sa_domain.weekly_mail_job_record(p_cap,p_document,(SELECT job_id FROM sa_domain.documents WHERE id=p_document),true);END IF;
END $f$;
ALTER FUNCTION sa_domain.weekly_mail_bind(uuid,uuid) OWNER TO sa_worker;
CREATE FUNCTION sa_domain.weekly_mail_seed() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE v uuid;BEGIN FOREACH v IN ARRAY NEW.manual_documents LOOP PERFORM sa_domain.weekly_mail_bind(NEW.id,v);END LOOP;PERFORM sa_domain.weekly_mail_settings_record(NEW.id);RETURN NEW;END $f$;
REVOKE ALL ON FUNCTION sa_domain.weekly_mail_seed() FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE TRIGGER weekly_mail_initial_proof AFTER INSERT ON sa_domain.weekly_mail_rehearsals FOR EACH ROW EXECUTE FUNCTION sa_domain.weekly_mail_seed();

-- A non-login, non-bypass owner may lock these rows, but cannot change them.
-- Column UPDATE grants are required by PostgreSQL FOR SHARE/FOR UPDATE; false
-- WITH CHECK policies deny actual writes even if another function is added.
DO $f$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sa_mail_lock') THEN
 CREATE ROLE sa_mail_lock NOLOGIN NOINHERIT NOBYPASSRLS;
END IF;END $f$;
GRANT sa_mail_lock TO postgres;
GRANT USAGE,CREATE ON SCHEMA sa_domain TO sa_mail_lock;
GRANT SELECT ON sa_domain.weekly_mail_rehearsals,sa_domain.weekly_tailor_schedule,
 sa_domain.business_mail_settings,sa_domain.weekly_tailor_runs,sa_domain.weekly_tailor_entries TO sa_mail_lock;
GRANT UPDATE(id) ON sa_domain.weekly_mail_rehearsals,sa_domain.weekly_tailor_runs TO sa_mail_lock;
GRANT UPDATE(singleton) ON sa_domain.weekly_tailor_schedule TO sa_mail_lock;
GRANT UPDATE(kind) ON sa_domain.business_mail_settings TO sa_mail_lock;
GRANT UPDATE(document_id) ON sa_domain.weekly_tailor_entries TO sa_mail_lock;
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['weekly_mail_rehearsals','weekly_tailor_schedule','business_mail_settings','weekly_tailor_runs','weekly_tailor_entries'] LOOP
  EXECUTE format('CREATE POLICY weekly_mail_lock_read ON sa_domain.%I FOR SELECT TO sa_mail_lock USING(true)',t);
  EXECUTE format('CREATE POLICY weekly_mail_lock_only ON sa_domain.%I FOR UPDATE TO sa_mail_lock USING(true) WITH CHECK(false)',t);
 END LOOP;
END $f$;
CREATE FUNCTION sa_domain.weekly_mail_lock(p_cap uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 PERFORM 1 FROM sa_domain.weekly_mail_rehearsals WHERE id=p_cap FOR SHARE;
 PERFORM 1 FROM sa_domain.weekly_tailor_schedule FOR UPDATE;
 PERFORM 1 FROM sa_domain.business_mail_settings WHERE kind='tailor_weekly' FOR SHARE;
 PERFORM 1 FROM sa_domain.weekly_tailor_runs r JOIN sa_domain.weekly_mail_rehearsals c
 ON r.generation=c.generation AND r.week_start=c.week_start WHERE c.id=p_cap ORDER BY r.id FOR UPDATE OF r;
 PERFORM 1 FROM sa_domain.weekly_tailor_entries e JOIN sa_domain.weekly_tailor_runs r ON r.id=e.run_id
 JOIN sa_domain.weekly_mail_rehearsals c ON r.generation=c.generation AND r.week_start=c.week_start
 WHERE c.id=p_cap ORDER BY e.document_id FOR UPDATE OF e;
END $f$;
ALTER FUNCTION sa_domain.weekly_mail_lock(uuid) OWNER TO sa_mail_lock;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_mail_lock;
REVOKE ALL ON FUNCTION sa_domain.weekly_mail_lock(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.weekly_mail_lock(uuid) TO sa_worker;
CREATE FUNCTION sa_domain.weekly_mail_scope(p_cap uuid) RETURNS sa_domain.weekly_mail_rehearsals
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE c sa_domain.weekly_mail_rehearsals;s sa_sync.environment_state;r sa_domain.runtime_state;
BEGIN
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RAISE EXCEPTION 'Refresh in progress' USING ERRCODE='55000';END IF;
 PERFORM sa_domain.weekly_mail_lock(p_cap);
 SELECT * INTO c FROM sa_domain.weekly_mail_rehearsals WHERE id=p_cap;
 SELECT * INTO s FROM sa_sync.environment_state;SELECT * INTO r FROM sa_domain.runtime_state;
 IF c.id IS NULL OR s.environment IS DISTINCT FROM 'staging' OR s.cutover IS DISTINCT FROM false OR s.active_job IS NOT NULL
 OR r.allow_test_writes IS DISTINCT FROM true OR c.generation<>r.generation OR c.expires_at<=clock_timestamp()
 OR r.test_write_expires_at IS NULL OR c.expires_at>r.test_write_expires_at
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.recipients)x WHERE ((x->>'auth_id')::uuid=ANY(r.test_actor_ids)) IS NOT TRUE)
 OR NOT EXISTS(SELECT 1 FROM sa_domain.weekly_tailor_schedule WHERE enabled AND generation=c.generation AND owner_user_id=c.owner_user_id
   AND owner_auth_id=(SELECT (x->>'auth_id')::uuid FROM jsonb_array_elements(c.recipients)x WHERE x->>'role_id'='0')
   AND next_week IN(c.week_start,c.week_start+7))
 OR (SELECT array_agg(x ORDER BY x) FROM sa_domain.business_mail_settings m CROSS JOIN unnest(m.recipient_ids)x WHERE m.kind='tailor_weekly')
   IS DISTINCT FROM (SELECT array_agg((x->>'user_id')::bigint ORDER BY (x->>'user_id')::bigint) FROM jsonb_array_elements(c.recipients)x WHERE x->>'role_id' IN('0','2','4')) THEN
 RAISE EXCEPTION 'Mail rehearsal scope unavailable' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT 1 FROM sa_domain.weekly_mail_settings_receipts proof CROSS JOIN sa_domain.weekly_tailor_schedule sched
 CROSS JOIN sa_domain.business_mail_settings m WHERE proof.capability_id=c.id AND m.kind='tailor_weekly'
 AND proof.schedule_xmin=sched.xmin::text AND proof.schedule_sha256=encode(sha256(convert_to(to_jsonb(sched)::text,'UTF8')),'hex')
 AND proof.settings_xmin=m.xmin::text AND proof.settings_sha256=encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex')) THEN
 RAISE EXCEPTION 'Rehearsal settings changed outside owned worker' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM sa_domain.weekly_mail_settings_receipts proof
 LEFT JOIN sa_domain.weekly_tailor_runs run ON run.id=proof.run_id
 LEFT JOIN sa_domain.weekly_tailor_entries entry ON entry.document_id=proof.entry_document_id
 WHERE proof.capability_id=c.id AND proof.run_id IS NOT NULL AND(
 proof.run_xmin IS DISTINCT FROM run.xmin::text OR proof.run_sha256 IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(run)::text,'UTF8')),'hex')
 OR proof.entry_xmin IS DISTINCT FROM entry.xmin::text OR proof.entry_sha256 IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(entry)::text,'UTF8')),'hex'))) THEN
 RAISE EXCEPTION 'Rehearsal schedule run changed' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM sa_domain.weekly_mail_settings_receipts proof
 JOIN sa_domain.weekly_tailor_runs run ON run.generation=c.generation AND run.week_start=c.week_start
 WHERE proof.capability_id=c.id AND proof.run_id IS NULL) THEN
 RAISE EXCEPTION 'Unowned rehearsal schedule run appeared' USING ERRCODE='42501';END IF;
 RETURN c;
END $f$;
ALTER FUNCTION sa_domain.weekly_mail_scope(uuid) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.weekly_mail_job_document(p_job uuid) RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT d.document_id FROM sa_domain.weekly_mail_documents d JOIN sa_domain.outbox root ON root.id=d.job_id
 JOIN sa_domain.outbox j ON j.id=p_job LEFT JOIN sa_domain.outbox parent ON parent.id=j.parent_id
 LEFT JOIN sa_domain.business_mail_deliveries m ON m.job_id=j.id
 WHERE (j.id=root.id AND j.event_type='document.requested')
 OR (j.parent_id=root.id AND j.event_type='document.mail' AND j.actor_id=root.actor_id AND j.payload=root.payload)
 OR (parent.parent_id=root.id AND parent.event_type='document.mail' AND parent.payload=root.payload AND parent.actor_id=root.actor_id
  AND j.event_type='business.mail_delivery' AND m.source_job=parent.id AND m.document_id=d.document_id AND m.recipient_auth_id=j.actor_id)
$f$;
ALTER FUNCTION sa_domain.weekly_mail_job_document(uuid) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.weekly_mail_job_scope(p_job uuid,p_lease uuid DEFAULT NULL) RETURNS sa_domain.weekly_mail_rehearsals
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE d sa_domain.documents;b sa_domain.weekly_mail_documents;j sa_domain.outbox;c sa_domain.weekly_mail_rehearsals;m sa_domain.business_mail_deliveries;
BEGIN
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_job FOR UPDATE;
 SELECT * INTO b FROM sa_domain.weekly_mail_documents WHERE document_id=sa_domain.weekly_mail_job_document(p_job);
 c:=sa_domain.weekly_mail_scope(b.capability_id);
 SELECT * INTO d FROM sa_domain.documents WHERE id=b.document_id FOR UPDATE;
 IF d.id IS NULL OR j.id IS NULL OR d.generation<>c.generation OR j.generation<>c.generation OR d.request->>'delivery' IS DISTINCT FROM 'email'
  OR b.document_xmin IS DISTINCT FROM (SELECT xmin::text FROM sa_domain.documents WHERE id=d.id)
  OR b.document_sha256 IS DISTINCT FROM encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex')
  OR b.request_sha256 IS DISTINCT FROM encode(sha256(convert_to(jsonb_build_object('request',d.request,'actor_id',d.actor_id,'generation',d.generation,'kind',d.kind)::text,'UTF8')),'hex')
  OR (d.actor_id=ANY((SELECT test_actor_ids FROM sa_domain.runtime_state)::uuid[])) IS NOT TRUE THEN
  RAISE EXCEPTION 'Mail rehearsal document changed' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM sa_domain.weekly_mail_job_receipts proof JOIN sa_domain.outbox x ON x.id=proof.job_id
 LEFT JOIN sa_domain.business_mail_deliveries m0 ON m0.job_id=x.id WHERE x.id=p_job AND proof.capability_id=c.id AND proof.document_id=d.id
 AND proof.job_xmin=x.xmin::text AND proof.job_sha256=encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex')
 AND proof.delivery_xmin IS NOT DISTINCT FROM m0.xmin::text
 AND proof.delivery_sha256 IS NOT DISTINCT FROM CASE WHEN m0.job_id IS NOT NULL THEN encode(sha256(convert_to(to_jsonb(m0)::text,'UTF8')),'hex') END) THEN
 RAISE EXCEPTION 'Rehearsal job changed outside owned worker' USING ERRCODE='42501';END IF;
 IF p_lease IS NOT NULL AND (j.lease_token IS DISTINCT FROM p_lease OR(j.status='leased' AND j.lease_until<=clock_timestamp())) THEN
  RAISE EXCEPTION 'Mail rehearsal lease unavailable' USING ERRCODE='PT409';END IF;
 IF j.event_type='business.mail_delivery' THEN
  SELECT * INTO m FROM sa_domain.business_mail_deliveries WHERE job_id=j.id;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.recipients)x WHERE (x->>'user_id')::bigint=m.recipient_id AND (x->>'auth_id')::uuid=m.recipient_auth_id
   AND (x->>'role_id')::integer=m.recipient_role AND(m.bound_email IS NULL OR m.bound_email=x->>'email')
   AND CASE d.kind WHEN 'tailor_weekly' THEN m.recipient_role IN(0,2,4) WHEN 'catalogue' THEN m.recipient_id=c.owner_user_id ELSE m.recipient_role=3 END) THEN
   RAISE EXCEPTION 'Mail rehearsal recipient changed' USING ERRCODE='42501';END IF;
 END IF;
 RETURN c;
END $f$;
ALTER FUNCTION sa_domain.weekly_mail_job_scope(uuid,uuid) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.weekly_mail_record(p_job uuid,p_phase text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE b_ sa_domain.weekly_mail_documents;child_ uuid;BEGIN
 UPDATE sa_domain.weekly_mail_documents b SET document_xmin=d.xmin::text,
 document_sha256=encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex'),phase=p_phase,recorded_at=clock_timestamp()
 FROM sa_domain.documents d WHERE b.document_id=d.id AND d.id=sa_domain.weekly_mail_job_document(p_job);
 SELECT * INTO b_ FROM sa_domain.weekly_mail_documents WHERE document_id=sa_domain.weekly_mail_job_document(p_job);
 IF b_.document_id IS NOT NULL THEN
  PERFORM sa_domain.weekly_mail_job_record(b_.capability_id,b_.document_id,p_job);
  FOR child_ IN SELECT id FROM sa_domain.outbox WHERE parent_id=p_job AND event_type IN('document.mail','business.mail_delivery') LOOP
   IF sa_domain.weekly_mail_job_document(child_) IS DISTINCT FROM b_.document_id THEN RAISE EXCEPTION 'Unbound mail child' USING ERRCODE='42501';END IF;
   PERFORM sa_domain.weekly_mail_job_record(b_.capability_id,b_.document_id,child_);
  END LOOP;
 END IF;
END $f$;
ALTER FUNCTION sa_domain.weekly_mail_record(uuid,text) OWNER TO sa_worker;

-- Private backend/transaction context cannot be forged through JWTs or GUCs.
CREATE FUNCTION sa_domain.weekly_mail_context_id() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT capability_id FROM sa_domain.weekly_mail_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current()
$f$;
ALTER FUNCTION sa_domain.weekly_mail_context_id() OWNER TO sa_guard;
GRANT EXECUTE ON FUNCTION sa_domain.weekly_mail_context_id() TO sa_worker,sa_guard;
CREATE FUNCTION sa_domain.weekly_mail_schedule_fence() RETURNS bigint LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE c sa_domain.weekly_mail_rehearsals;BEGIN
 IF sa_domain.weekly_mail_context_id() IS NULL THEN RETURN sa_domain.worker_write_fence();END IF;
 c:=sa_domain.weekly_mail_scope(sa_domain.weekly_mail_context_id());RETURN c.generation;
END $f$;
ALTER FUNCTION sa_domain.weekly_mail_schedule_fence() OWNER TO sa_worker;
DO $f$ DECLARE d text;needle_ text;sig text;BEGIN
 FOREACH sig IN ARRAY ARRAY['sa_domain.weekly_tailor_ceiling()','sa_domain.weekly_tailor_page(bigint,bigint,integer)'] LOOP
  d:=pg_get_functiondef(sig::regprocedure);needle_:='WHERE role=5 AND deleted_at IS NULL';
  IF position(needle_ IN d)=0 THEN RAISE EXCEPTION 'Weekly selector contract changed';END IF;
  EXECUTE replace(d,needle_,needle_||' AND (sa_domain.weekly_mail_context_id() IS NULL OR id=(SELECT tailor_id FROM sa_domain.weekly_mail_rehearsals WHERE id=sa_domain.weekly_mail_context_id()))');
 END LOOP;
 d:=pg_get_functiondef('sa_domain.squad_weekly_tailor_heartbeat(integer)'::regprocedure);
 needle_:='IF NOT(SELECT cutover AND active_job IS NULL FROM sa_sync.environment_state WHERE singleton) THEN';
 IF position(needle_ IN d)=0 THEN RAISE EXCEPTION 'Weekly heartbeat contract changed';END IF;
 d:=replace(d,needle_,'IF sa_domain.weekly_mail_context_id() IS NULL AND NOT(SELECT cutover AND active_job IS NULL FROM sa_sync.environment_state WHERE singleton) THEN');
 d:=replace(d,'g:=sa_domain.worker_write_fence();','g:=sa_domain.weekly_mail_schedule_fence();');
 needle_:='ON CONFLICT(generation,week_start) DO NOTHING;';
 IF position(needle_ IN d)=0 THEN RAISE EXCEPTION 'Weekly insert contract changed';END IF;
 EXECUTE replace(d,needle_,needle_||' IF NOT FOUND AND sa_domain.weekly_mail_context_id() IS NOT NULL THEN RAISE EXCEPTION ''Rehearsal cannot adopt an existing schedule run'' USING ERRCODE=''42501'';END IF;');
END $f$;

CREATE FUNCTION sa_domain.weekly_mail_worker_fence(p_job uuid,p_lease uuid) RETURNS bigint LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE c sa_domain.weekly_mail_rehearsals;BEGIN
 IF sa_domain.weekly_mail_job_document(p_job) IS NULL THEN RETURN sa_domain.worker_write_fence();END IF;
 c:=sa_domain.weekly_mail_job_scope(p_job,p_lease);RETURN c.generation;
END $f$;
ALTER FUNCTION sa_domain.weekly_mail_worker_fence(uuid,uuid) OWNER TO sa_worker;
ALTER FUNCTION sa_domain.document_worker_fence(uuid,uuid) RENAME TO document_worker_fence_download;
CREATE FUNCTION sa_domain.document_worker_fence(p_id uuid,p_lease_token uuid) RETURNS bigint LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 IF sa_domain.weekly_mail_job_document(p_id) IS NOT NULL THEN RETURN sa_domain.weekly_mail_worker_fence(p_id,p_lease_token);END IF;
 RETURN sa_domain.document_worker_fence_download(p_id,p_lease_token);
END $f$;
ALTER FUNCTION sa_domain.document_worker_fence(uuid,uuid) OWNER TO sa_worker;
-- The shared document renderer still performs its ordinary current actor/scope checks.
DO $f$ DECLARE d text;sig text;needle_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.document_prepare_standard(uuid,uuid)'::regprocedure);
 needle_:='(SELECT expires_at FROM sa_domain.document_rehearsals WHERE job_id=p_id)';
 IF position(needle_ IN d)=0 THEN RAISE EXCEPTION 'Document deadline contract changed';END IF;
 EXECUTE replace(d,needle_,'coalesce('||needle_||',(SELECT c.expires_at FROM sa_domain.weekly_mail_rehearsals c JOIN sa_domain.weekly_mail_documents b ON b.capability_id=c.id WHERE b.job_id=p_id))');
 FOREACH sig IN ARRAY ARRAY['sa_domain.squad_document_prepare(uuid,uuid)','sa_domain.squad_document_finish(uuid,uuid,jsonb)'] LOOP
  d:=pg_get_functiondef(sig::regprocedure);needle_:='RETURN result_;';
  IF position(needle_ IN d)=0 THEN RAISE EXCEPTION 'Document receipt wrapper changed';END IF;
  IF sig='sa_domain.squad_document_prepare(uuid,uuid)' THEN
   d:=replace(d,needle_,$s$IF EXISTS(SELECT 1 FROM sa_domain.weekly_mail_documents WHERE job_id=p_id AND kind='tailor_weekly')
    AND result_->>'state'='prepared' AND(coalesce(jsonb_array_length(result_->'snapshot'->'rows'),0)=0
      OR result_->'snapshot'->'summary'->>'needs_reconciliation' IS DISTINCT FROM 'false') THEN
    RAISE EXCEPTION 'Nonempty verified weekly work required' USING ERRCODE='55000';END IF; RETURN result_;$s$);
  END IF;
  EXECUTE replace(d,needle_,'PERFORM sa_domain.weekly_mail_record(p_id,''document_worker''); '||needle_);
 END LOOP;
 FOREACH sig IN ARRAY ARRAY['sa_domain.squad_business_mail_prepare(uuid,uuid)','sa_domain.squad_business_mail_finish(uuid,uuid,text)'] LOOP
  d:=pg_get_functiondef(sig::regprocedure);needle_:='g:=sa_domain.worker_write_fence();';
  IF position(needle_ IN d)=0 THEN RAISE EXCEPTION 'Mail worker fence changed';END IF;
  d:=replace(d,needle_,'g:=sa_domain.weekly_mail_worker_fence(p_id,p_lease_token);');
  d:=replace(d,'RETURN r;','PERFORM sa_domain.weekly_mail_record(p_id,''mail_worker''); RETURN r;');
  IF sig='sa_domain.squad_business_mail_finish(uuid,uuid,text)' THEN
   d:=replace(d,'r:=sa_domain.business_mail_settle(j,p_code);',$s$
   IF sa_domain.weekly_mail_job_document(p_id) IS NOT NULL AND p_code='SENT' AND NOT EXISTS(
    SELECT 1 FROM sa_domain.weekly_mail_sends WHERE job_id=p_id AND lease_token=p_lease_token AND state='started') THEN
    RAISE EXCEPTION 'Mail send receipt required' USING ERRCODE='42501';END IF;
   UPDATE sa_domain.weekly_mail_sends SET state=CASE WHEN p_code='SENT' THEN 'accepted' ELSE 'unknown' END,
    finished_at=clock_timestamp() WHERE job_id=p_id AND lease_token=p_lease_token AND state='started';
   r:=sa_domain.business_mail_settle(j,p_code);$s$);
  END IF;
  EXECUTE d;
 END LOOP;
END $f$;

CREATE FUNCTION sa_domain.squad_weekly_mail_rehearsal_tick(p_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE c sa_domain.weekly_mail_rehearsals;r jsonb;j sa_domain.outbox;d uuid;token_ uuid;handler_ text;
BEGIN
 PERFORM sa_domain.assert_service_worker();c:=sa_domain.weekly_mail_scope(p_id);
 -- One in-flight phase per capability, including concurrent Cron deliveries.
 IF NOT pg_try_advisory_xact_lock(hashtextextended(p_id::text,121935)) THEN RETURN jsonb_build_object('jobs','[]'::jsonb,'state','busy');END IF;
 INSERT INTO sa_domain.weekly_mail_context VALUES(pg_backend_pid(),txid_current(),p_id);
 r:=sa_domain.squad_weekly_tailor_heartbeat(1);
 PERFORM sa_domain.weekly_mail_settings_record(c.id);
 DELETE FROM sa_domain.weekly_mail_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 FOR d IN SELECT e.document_id FROM sa_domain.weekly_tailor_entries e JOIN sa_domain.weekly_tailor_runs run ON run.id=e.run_id
  WHERE run.generation=c.generation AND run.week_start=c.week_start AND e.tailor_id=c.tailor_id LOOP
  PERFORM sa_domain.weekly_mail_bind(c.id,d);
 END LOOP;
 IF EXISTS(SELECT 1 FROM sa_domain.weekly_mail_documents b JOIN sa_domain.outbox x
  ON x.id=b.job_id OR x.parent_id=b.job_id OR x.parent_id IN(SELECT y.id FROM sa_domain.outbox y WHERE y.parent_id=b.job_id AND y.event_type='document.mail')
  WHERE b.capability_id=c.id AND sa_domain.weekly_mail_job_document(x.id)=b.document_id AND x.status='leased' AND x.lease_until>clock_timestamp()) THEN
  RETURN jsonb_build_object('jobs','[]'::jsonb,'state','busy','schedule',r);END IF;
 -- Bounded three document roots + three fanouts + five deliveries. Never inspect
 -- or lease any unrelated queue entries, even if their actor happens to match.
 SELECT x.* INTO j FROM sa_domain.weekly_mail_documents b JOIN sa_domain.outbox x
 ON x.id=b.job_id OR x.parent_id=b.job_id OR x.parent_id IN(SELECT y.id FROM sa_domain.outbox y WHERE y.parent_id=b.job_id AND y.event_type='document.mail')
 WHERE b.capability_id=c.id AND sa_domain.weekly_mail_job_document(x.id)=b.document_id
 AND x.status IN('pending','leased') AND x.available_at<=clock_timestamp()
 AND NOT EXISTS(SELECT 1 FROM sa_domain.weekly_mail_sends send WHERE send.job_id=x.id)
 ORDER BY CASE x.event_type WHEN 'document.requested' THEN 0 WHEN 'document.mail' THEN 1 ELSE 2 END,x.created_at,x.id
 LIMIT 1 FOR UPDATE OF x SKIP LOCKED;
 IF j.id IS NULL THEN RETURN jsonb_build_object('jobs','[]'::jsonb,'state','idle','schedule',r);END IF;
 c:=sa_domain.weekly_mail_job_scope(j.id);
 IF j.attempts>=5 THEN RAISE EXCEPTION 'Rehearsal attempts exhausted' USING ERRCODE='54000';END IF;
 UPDATE sa_domain.job_attempts SET state='expired',finished_at=now(),error_code='LEASE_EXPIRED' WHERE job_id=j.id AND state='leased';
 token_:=gen_random_uuid();handler_:=CASE j.event_type WHEN 'document.requested' THEN 'document_render' WHEN 'document.mail' THEN 'document_mail' ELSE 'business_mail' END;
 UPDATE sa_domain.outbox SET status='leased',lease_token=token_,lease_until=least(clock_timestamp()+interval '180 seconds',c.expires_at),
 attempts=attempts+1,revision=revision+1 WHERE id=j.id RETURNING * INTO j;
 INSERT INTO sa_domain.job_attempts(job_id,lease_token,attempt,state) VALUES(j.id,token_,j.attempts,'leased');
 PERFORM sa_domain.weekly_mail_job_record(c.id,sa_domain.weekly_mail_job_document(j.id),j.id);
 RETURN jsonb_build_object('state','claimed','schedule',r,'jobs',jsonb_build_array(jsonb_build_object('id',j.id,'lease_token',token_,
 'handler',handler_,'attempt',j.attempts,'lease_until',j.lease_until)));
END $f$;
ALTER FUNCTION sa_domain.squad_weekly_mail_rehearsal_tick(uuid) OWNER TO sa_worker;

CREATE FUNCTION sa_domain.squad_weekly_mail_rehearsal_send_begin(p_id uuid,p_job_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE c sa_domain.weekly_mail_rehearsals;m sa_domain.business_mail_deliveries;j sa_domain.outbox;r jsonb;
BEGIN
 PERFORM sa_domain.assert_service_worker();c:=sa_domain.weekly_mail_job_scope(p_job_id,p_lease_token);
 IF c.id IS DISTINCT FROM p_id THEN RAISE EXCEPTION 'Mail capability differs' USING ERRCODE='42501';END IF;
 SELECT * INTO j FROM sa_domain.outbox WHERE id=p_job_id FOR UPDATE;
 SELECT * INTO m FROM sa_domain.business_mail_deliveries WHERE job_id=p_job_id FOR UPDATE;
 IF j.status<>'leased' OR j.event_type<>'business.mail_delivery' OR m.state<>'prepared' OR m.bound_email IS NULL
 OR EXISTS(SELECT 1 FROM sa_domain.weekly_mail_sends WHERE job_id=p_job_id)
 OR(SELECT count(*) FROM sa_domain.weekly_mail_sends WHERE capability_id=c.id)>=5 THEN
 RAISE EXCEPTION 'Mail send already attempted or unavailable' USING ERRCODE='PT409';END IF;
 INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),j.id,j.actor_id,j.generation,j.lease_token);
 r:=sa_domain.business_mail_content(m);
 DELETE FROM sa_domain.worker_context WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 IF r->>'email' IS DISTINCT FROM m.bound_email OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.recipients)x WHERE x->>'email'=r->>'email' AND(x->>'auth_id')::uuid=m.recipient_auth_id) THEN
 RAISE EXCEPTION 'Mail recipient binding changed' USING ERRCODE='42501';END IF;
 INSERT INTO sa_domain.weekly_mail_sends(job_id,capability_id,document_id,recipient_id,recipient_auth_id,email,lease_token,state)
 VALUES(j.id,c.id,m.document_id,m.recipient_id,m.recipient_auth_id,m.bound_email,j.lease_token,'started');
 RETURN jsonb_build_object('message_id',j.id,'allowed_recipient',m.bound_email,'document_id',m.document_id,'capability_id',c.id,'role_id',m.recipient_role,'kind',m.kind,'attachment_path',(SELECT object_path FROM sa_domain.documents WHERE id=m.document_id));
END $f$;
ALTER FUNCTION sa_domain.squad_weekly_mail_rehearsal_send_begin(uuid,uuid,uuid) OWNER TO sa_worker;

DO $f$ DECLARE f record;args_ text;BEGIN
 FOR f IN SELECT p.oid,p.proname,p.proargnames FROM pg_proc p WHERE p.pronamespace='sa_domain'::regnamespace
 AND(p.proname LIKE 'weekly_mail_%' OR p.proname IN('squad_weekly_mail_rehearsal_tick','squad_weekly_mail_rehearsal_send_begin','document_worker_fence')) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',f.oid::regprocedure);
  IF f.proname IN('squad_weekly_mail_rehearsal_tick','squad_weekly_mail_rehearsal_send_begin') THEN
   SELECT string_agg(quote_ident(x),',') INTO args_ FROM unnest(f.proargnames)x;
   EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS %L',
    f.proname,pg_get_function_arguments(f.oid),'SELECT sa_domain.'||f.proname||'('||args_||')');
   EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated,sa_app,service_role',f.proname,pg_get_function_identity_arguments(f.oid));
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.oid::regprocedure);
   EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s) TO service_role',f.proname,pg_get_function_identity_arguments(f.oid));
  END IF;
 END LOOP;
END $f$;
GRANT EXECUTE ON FUNCTION sa_domain.weekly_mail_context_id() TO sa_worker,sa_guard;
GRANT EXECUTE ON FUNCTION sa_domain.weekly_mail_lock(uuid) TO sa_worker;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_worker,sa_guard;
COMMIT;
