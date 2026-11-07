BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
-- Normal business commands share this lock. Rare role/team removal changes
-- try to take it exclusively, so no concurrent assignment can be stranded.
DO $f$ DECLARE definition_ text;BEGIN
 definition_:=pg_get_functiondef('sa_domain.begin_command(text,uuid,jsonb)'::regprocedure);
 definition_:=replace(definition_,'IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN',
 'IF NOT pg_try_advisory_xact_lock_shared(20261107,2) THEN RAISE EXCEPTION ''People relationships are changing; retry'' USING ERRCODE=''40001'';END IF;
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN');
 EXECUTE definition_;
END $f$;
CREATE FUNCTION sa_domain.person_structure_fence() RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
BEGIN
 IF NOT pg_try_advisory_xact_lock(20261107,2) THEN RAISE EXCEPTION 'Assignments are changing; retry this people operation' USING ERRCODE='40001';END IF;
END $f$;
-- These are enrollment intents, not Auth users or usable credentials. The
-- account worker must reserve the UUID mapping before creating a GoTrue user.
CREATE TABLE sa_domain.account_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),legacy_user_id bigint NOT NULL,generation bigint NOT NULL,
 reserved_auth_id uuid NOT NULL DEFAULT gen_random_uuid(),actor_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','processing','ready','failed','discarded')),
 error_code text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(legacy_user_id,generation),UNIQUE(reserved_auth_id));
ALTER TABLE sa_domain.account_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.account_requests FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON sa_domain.account_requests TO sa_executor;
CREATE POLICY squad_account_request_read ON sa_domain.account_requests FOR SELECT TO sa_executor
 USING(generation=(SELECT generation FROM sa_domain.runtime_state) AND sa_domain.can_person(legacy_user_id));
CREATE POLICY squad_account_request_insert ON sa_domain.account_requests FOR INSERT TO sa_executor
 WITH CHECK(generation=(SELECT generation FROM sa_domain.runtime_state) AND actor_id=(SELECT auth.uid()));

CREATE FUNCTION sa_domain.can_manage_person(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users u CROSS JOIN sa_domain.actor() a WHERE u.id=p_id AND
 (a.role_id=0 OR (a.role_id=1 AND u.role IN(3,10) AND u.created_by_id=a.user_id)
 OR (a.role_id=2 AND u.role IN(4,5,6,7,8,9))
 OR (a.role_id=4 AND u.role IN(5,6,7,8,9) AND
  (u.factory_manager_id=a.user_id OR (u.role=6 AND u.parent_tailor_id IN(SELECT id FROM sa_snapshot_20261019.sa_users WHERE role=5 AND factory_manager_id=a.user_id))))
 OR (a.role_id=10 AND u.role=3 AND u.id IN(SELECT sa_domain.dealer_customer_ids()))))
$f$;
ALTER FUNCTION sa_domain.can_manage_person(bigint) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.can_address(p_id bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT (a.role_id IN(0,1,2,3,4,10,11)) AND (p_id=a.user_id OR sa_domain.can_manage_person(p_id)) FROM sa_domain.actor() a
$f$;
ALTER FUNCTION sa_domain.can_address(bigint) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.email_available(p_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE lower(btrim(email))=p_email)
$f$;
ALTER FUNCTION sa_domain.email_available(text) OWNER TO sa_guard;
CREATE INDEX squad_people_canonical_email ON sa_snapshot_20261019.sa_users(lower(btrim(email)));
CREATE INDEX squad_people_manager ON sa_snapshot_20261019.sa_users(factory_manager_id,role,id) WHERE deleted_at IS NULL;
CREATE INDEX squad_people_parent_tailor ON sa_snapshot_20261019.sa_users(parent_tailor_id,id) WHERE deleted_at IS NULL;
CREATE INDEX squad_address_owner ON sa_snapshot_20261019.sa_addresses(user_id,id) WHERE deleted_at IS NULL;

GRANT SELECT(gst_no,factory_manager_id,parent_tailor_id,designation,features,customer_registered_by,zone_id,rmp_price_type_id,is_direct_deal,auto_approve_customers,stock_visibility_percentage,approved_at,onboarded_at,disabled_at)
 ON sa_snapshot_20261019.sa_users TO sa_executor;
GRANT INSERT(id,email,name,phone,role,gst_no,factory_id,factory_manager_id,parent_tailor_id,created_by_id,approved,approved_at,onboarded,onboarded_at,customer_registered_by,customer_company_name,customer_first_name,customer_last_name,designation,features,created_at,updated_at),
 UPDATE(role,gst_no,factory_id,factory_manager_id,parent_tailor_id,created_by_id,approved,approved_at,onboarded,onboarded_at,designation,features,disabled,disabled_at,deleted_at,zone_id,rmp_price_type_id,is_direct_deal,auto_approve_customers,stock_visibility_percentage,dealers_count)
 ON sa_snapshot_20261019.sa_users TO sa_executor;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_users_id_seq,sa_snapshot_20261019.sa_addresses_id_seq,sa_snapshot_20261019.sa_factories_id_seq,sa_snapshot_20261019.sa_user_dealers_id_seq TO sa_executor;
CREATE POLICY squad_people_insert ON sa_snapshot_20261019.sa_users FOR INSERT TO sa_executor WITH CHECK(
 (SELECT (sa_domain.actor()).role_id)=0
 OR ((SELECT (sa_domain.actor()).role_id)=1 AND role IN(3,10) AND created_by_id=(SELECT (sa_domain.actor()).user_id))
 OR ((SELECT (sa_domain.actor()).role_id)=10 AND role=3 AND customer_registered_by=2)
 OR ((SELECT (sa_domain.actor()).role_id)=2 AND role IN(4,5,6,7,8,9))
 OR ((SELECT (sa_domain.actor()).role_id)=4 AND role IN(5,6,7,8,9) AND factory_manager_id=(SELECT (sa_domain.actor()).user_id)));
CREATE POLICY squad_people_write ON sa_snapshot_20261019.sa_users FOR UPDATE TO sa_executor
 USING(sa_domain.can_manage_person(id)) WITH CHECK(sa_domain.can_manage_person(id));
GRANT SELECT,INSERT,UPDATE ON sa_snapshot_20261019.sa_addresses TO sa_executor;
CREATE POLICY squad_address_read ON sa_snapshot_20261019.sa_addresses FOR SELECT TO sa_executor USING(sa_domain.can_address(user_id));
CREATE POLICY squad_address_insert ON sa_snapshot_20261019.sa_addresses FOR INSERT TO sa_executor WITH CHECK(sa_domain.can_address(user_id));
CREATE POLICY squad_address_write ON sa_snapshot_20261019.sa_addresses FOR UPDATE TO sa_executor USING(sa_domain.can_address(user_id)) WITH CHECK(sa_domain.can_address(user_id));
GRANT SELECT,INSERT,UPDATE ON sa_snapshot_20261019.sa_factories TO sa_executor;
GRANT SELECT ON sa_snapshot_20261019.sa_factories TO sa_guard;
CREATE POLICY squad_factory_guard ON sa_snapshot_20261019.sa_factories FOR SELECT TO sa_guard USING(true);
CREATE POLICY squad_factory_read ON sa_snapshot_20261019.sa_factories FOR SELECT TO sa_executor
 USING((SELECT (sa_domain.actor()).role_id) IN(0,2) OR id=(SELECT (sa_domain.actor()).factory_id));
CREATE POLICY squad_factory_insert ON sa_snapshot_20261019.sa_factories FOR INSERT TO sa_executor WITH CHECK((SELECT (sa_domain.actor()).role_id) IN(0,2));
CREATE POLICY squad_factory_write ON sa_snapshot_20261019.sa_factories FOR UPDATE TO sa_executor
 USING((SELECT (sa_domain.actor()).role_id) IN(0,2) OR ((SELECT (sa_domain.actor()).role_id)=4 AND id=(SELECT (sa_domain.actor()).factory_id)))
 WITH CHECK((SELECT (sa_domain.actor()).role_id) IN(0,2) OR ((SELECT (sa_domain.actor()).role_id)=4 AND id=(SELECT (sa_domain.actor()).factory_id)));
GRANT SELECT,INSERT,DELETE ON sa_snapshot_20261019.sa_user_dealers TO sa_executor;
CREATE POLICY squad_dealer_link_read ON sa_snapshot_20261019.sa_user_dealers FOR SELECT TO sa_executor
 USING(sa_domain.can_person(user_id) OR dealer_id=(SELECT (sa_domain.actor()).user_id));
CREATE POLICY squad_dealer_link_insert ON sa_snapshot_20261019.sa_user_dealers FOR INSERT TO sa_executor
 WITH CHECK(sa_domain.can_address(user_id) OR ((SELECT (sa_domain.actor()).role_id)=10 AND dealer_id=(SELECT (sa_domain.actor()).user_id)));
CREATE POLICY squad_dealer_link_delete ON sa_snapshot_20261019.sa_user_dealers FOR DELETE TO sa_executor USING(sa_domain.can_manage_person(user_id));

GRANT SELECT(status,uc_status,is_deleted,deleted_at) ON sa_snapshot_20261019.sa_orders TO sa_guard;
CREATE FUNCTION sa_domain.person_dependencies(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE reasons jsonb:='[]';
BEGIN
 IF NOT sa_domain.can_manage_person(p_id) THEN RAISE EXCEPTION 'Person unavailable' USING ERRCODE='P0002';END IF;
 IF EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE status=0 AND uc_status IS DISTINCT FROM 'CANCELLED' AND is_deleted IS NOT TRUE AND deleted_at IS NULL
 AND (customer_id=p_id OR customer_sc_id=p_id OR customer_dealer_id=p_id OR assigned_to_id=p_id OR assigned_worker_id=p_id)) THEN reasons:=reasons||'"active_orders"'::jsonb;END IF;
 IF EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE deleted_at IS NULL AND (factory_manager_id=p_id OR parent_tailor_id=p_id OR (created_by_id=p_id AND role IN(3,10)))) THEN reasons:=reasons||'"dependent_people"'::jsonb;END IF;
 IF EXISTS(SELECT FROM sa_snapshot_20261019.sa_items i JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id WHERE i.cutting_master_id=p_id AND o.status=0 AND o.uc_status IS DISTINCT FROM 'CANCELLED' AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL) THEN reasons:=reasons||'"assigned_cutting"'::jsonb;END IF;
 IF EXISTS(SELECT FROM sa_snapshot_20261019.sa_item_tailors t JOIN sa_snapshot_20261019.sa_job_sheet_assign_quantities q ON q.item_tailor_id=t.id
 JOIN sa_snapshot_20261019.sa_items i ON i.id=t.item_id JOIN sa_snapshot_20261019.sa_orders o ON o.id=i.order_id
 WHERE t.tailor_id=p_id AND coalesce(q.completed_quantity,0)<q.assigned_quantity AND o.status=0 AND o.uc_status IS DISTINCT FROM 'CANCELLED' AND o.is_deleted IS NOT TRUE AND o.deleted_at IS NULL) THEN reasons:=reasons||'"unfinished_tailoring"'::jsonb;END IF;
 IF EXISTS(SELECT FROM sa_domain.stock_balances(p_id) WHERE needs_reconciliation OR available>0) THEN reasons:=reasons||'"dealer_stock"'::jsonb;END IF;
 RETURN reasons;
END $f$;
ALTER FUNCTION sa_domain.person_dependencies(bigint) OWNER TO sa_guard;
GRANT EXECUTE ON FUNCTION sa_domain.stock_balances(bigint,bigint[]) TO sa_guard;

CREATE FUNCTION sa_domain.validate_person_fields(p_fields jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE k text;v jsonb;f jsonb;child jsonb;
BEGIN
 PERFORM sa_domain.check_fields(p_fields,ARRAY['name','email','phone','company_name','first_name','last_name','gst_no','designation','features','factory_id','manager_id','parent_tailor_id']);
 FOR k,v IN SELECT * FROM jsonb_each(p_fields) LOOP
  IF k IN('factory_id','manager_id','parent_tailor_id') THEN IF v<>'null'::jsonb THEN PERFORM sa_domain.input_id(v);END IF;
  ELSIF k='features' THEN
   IF jsonb_typeof(v)<>'array' OR jsonb_array_length(v)>3 THEN RAISE EXCEPTION 'Invalid feature grants' USING ERRCODE='22023';END IF;
   IF (SELECT count(DISTINCT x->>'key') FROM jsonb_array_elements(v) x)<>jsonb_array_length(v) THEN RAISE EXCEPTION 'Duplicate feature grant' USING ERRCODE='22023';END IF;
   FOR f IN SELECT * FROM jsonb_array_elements(v) LOOP
    PERFORM sa_domain.check_fields(f,ARRAY['key','checked','children']);
    IF f->>'key' IS NULL OR f->>'key' NOT IN('1','2','3') OR f->>'checked' IS NULL OR f->>'checked' NOT IN('true','false') THEN RAISE EXCEPTION 'Invalid feature grant' USING ERRCODE='22023';END IF;
    IF f?'children' THEN
     IF f->>'key'<>'3' OR jsonb_typeof(f->'children')<>'array' OR jsonb_array_length(f->'children')>4 THEN RAISE EXCEPTION 'Invalid child grants' USING ERRCODE='22023';END IF;
     IF (SELECT count(DISTINCT x->>'key') FROM jsonb_array_elements(f->'children') x)<>jsonb_array_length(f->'children') THEN RAISE EXCEPTION 'Duplicate child grant' USING ERRCODE='22023';END IF;
     FOR child IN SELECT * FROM jsonb_array_elements(f->'children') LOOP
      PERFORM sa_domain.check_fields(child,ARRAY['key','checked']);
      IF child->>'key' IS NULL OR child->>'key' NOT IN('3.1','3.2','3.3','3.4') OR child->>'checked' IS NULL OR child->>'checked' NOT IN('true','false') OR (child->>'checked'='true' AND f->>'checked'<>'true') THEN RAISE EXCEPTION 'Invalid child grant or disabled parent' USING ERRCODE='22023';END IF;
     END LOOP;
    END IF;
   END LOOP;
  ELSIF jsonb_typeof(v) NOT IN('string','null') OR length(v#>>'{}')>254 OR (k IN('name','email') AND coalesce(btrim(v#>>'{}'),'')='') THEN RAISE EXCEPTION 'Invalid profile value' USING ERRCODE='22023';END IF;
 END LOOP;
END $f$;

CREATE FUNCTION sa_domain.person_save(p_id bigint,p_role integer,p_fields jsonb,p_expected_version text,p_idempotency_key uuid,p_operation text) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,4,10]);cached jsonb;old_ record;id_ bigint:=p_id;email_ text;manager_ bigint;parent_ bigint;factory_ bigint;creator_ bigint;approved_ boolean;v text;job_ uuid;role_changed boolean:=false;relations_changed boolean:=false;
BEGIN
 PERFORM sa_domain.validate_person_fields(p_fields);
 IF p_role IS NULL OR p_role NOT BETWEEN 0 AND 12 OR NOT(a.role_id=0 OR (a.role_id=1 AND p_role IN(3,10)) OR (a.role_id=2 AND p_role IN(4,5,6,7,8,9)) OR (a.role_id=4 AND p_role IN(5,6,7,8,9)) OR (a.role_id=10 AND p_role=3)) THEN RAISE EXCEPTION 'Role creation or update is not permitted' USING ERRCODE='42501';END IF;
 IF p_fields?'features' AND (a.role_id<>0 OR p_role NOT IN(11,12)) THEN RAISE EXCEPTION 'Only Admin manages worker/team feature grants' USING ERRCODE='42501';END IF;
 IF p_role NOT IN(4,5,6,7,8,9) AND p_fields ?| ARRAY['factory_id','manager_id','parent_tailor_id'] THEN RAISE EXCEPTION 'Factory links do not apply to this role' USING ERRCODE='22023';END IF;
 IF (p_role<>4 AND p_fields?'factory_id') OR (p_role<>6 AND p_fields?'parent_tailor_id') OR (p_role=4 AND p_fields?'manager_id') THEN RAISE EXCEPTION 'Use the role-specific factory relationship' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command(p_operation,p_idempotency_key,jsonb_build_object('id',p_id,'role',p_role,'fields',p_fields,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 IF p_id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('person:'||p_id,784139));
  IF NOT sa_domain.can_manage_person(p_id) THEN RAISE EXCEPTION 'Person unavailable' USING ERRCODE='P0002';END IF;
  SELECT id,email,role,factory_id,factory_manager_id,parent_tailor_id,created_by_id,approved INTO old_ FROM sa_snapshot_20261019.sa_users WHERE id=p_id AND deleted_at IS NULL;
  IF old_.id IS NULL THEN RAISE EXCEPTION 'Person unavailable' USING ERRCODE='P0002';END IF;
  IF p_fields?'email' AND lower(btrim(p_fields->>'email')) IS DISTINCT FROM lower(btrim(old_.email)) THEN RAISE EXCEPTION 'Email changes require the verified account flow' USING ERRCODE='22023';END IF;
  role_changed:=p_role<>old_.role;
  IF role_changed AND (p_id=a.user_id OR old_.role IN(5,6) OR p_role IN(5,6) OR (old_.role=10 AND p_role=3) OR NOT(a.role_id=0 OR (a.role_id=1 AND old_.role=3 AND p_role=10))) THEN RAISE EXCEPTION 'Role conversion is not permitted' USING ERRCODE='42501';END IF;
  manager_:=CASE WHEN role_changed THEN NULL ELSE old_.factory_manager_id END;parent_:=CASE WHEN role_changed THEN NULL ELSE old_.parent_tailor_id END;factory_:=CASE WHEN role_changed THEN NULL ELSE old_.factory_id END;
  creator_:=old_.created_by_id;approved_:=old_.approved;
 ELSE
  IF p_expected_version IS NOT NULL OR coalesce(btrim(p_fields->>'name'),'')='' THEN RAISE EXCEPTION 'New person needs a name and no prior version' USING ERRCODE='22023';END IF;
  IF p_role IN(5,6) THEN
   IF p_fields?'email' THEN RAISE EXCEPTION 'Managed workforce subjects do not have login email' USING ERRCODE='22023';END IF;
   -- Legacy unique NOT NULL email needs an internal storage marker. It is never
   -- projected as a contact or enrolled in Auth; encrypted_password stays empty.
   email_:='subject+'||gen_random_uuid()::text||'@managed.invalid';
  ELSE
   email_:=lower(btrim(p_fields->>'email'));
   IF email_ IS NULL OR email_ !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' OR email_ LIKE '%@managed.invalid' THEN RAISE EXCEPTION 'Valid login email required' USING ERRCODE='22023';END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('person-email:'||email_,784139));
  IF NOT sa_domain.email_available(email_) THEN RAISE EXCEPTION 'Email is already assigned; use account recovery or review' USING ERRCODE='23505';END IF;
  creator_:=CASE WHEN a.role_id=1 THEN a.user_id WHEN a.role_id=10 THEN (SELECT created_by_id FROM sa_snapshot_20261019.sa_users WHERE id=a.user_id) END;
  approved_:=CASE WHEN p_role IN(3,10) THEN a.role_id=10 ELSE true END;
 END IF;
 IF p_fields?'factory_id' THEN factory_:=(p_fields->>'factory_id')::bigint;END IF;
 IF p_fields?'manager_id' THEN manager_:=(p_fields->>'manager_id')::bigint;END IF;
 IF p_fields?'parent_tailor_id' THEN parent_:=(p_fields->>'parent_tailor_id')::bigint;END IF;
 IF p_role=4 THEN
  IF factory_ IS NULL OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_factories WHERE id=factory_ AND nullif(deleted_at,'') IS NULL) THEN RAISE EXCEPTION 'Active factory required' USING ERRCODE='22023';END IF;
 ELSIF p_role IN(5,6,7,8,9) THEN
  IF a.role_id=4 THEN
   IF manager_ IS NOT NULL AND manager_<>a.user_id THEN RAISE EXCEPTION 'Cannot move a person to another manager' USING ERRCODE='42501';END IF;manager_:=a.user_id;
  END IF;
  IF p_role=6 THEN
   IF parent_ IS NULL THEN RAISE EXCEPTION 'Parent tailor required' USING ERRCODE='22023';END IF;
   SELECT factory_manager_id INTO factory_ FROM sa_snapshot_20261019.sa_users WHERE id=parent_ AND role=5 AND disabled IS NOT TRUE AND deleted_at IS NULL;
   IF factory_ IS NULL OR (manager_ IS NOT NULL AND manager_<>factory_) THEN RAISE EXCEPTION 'Parent tailor and manager do not match' USING ERRCODE='22023';END IF;manager_:=factory_;
  END IF;
  IF manager_ IS NULL THEN RAISE EXCEPTION 'Factory manager required' USING ERRCODE='22023';END IF;
  PERFORM sa_domain.work_person(manager_,ARRAY[4]);factory_:=NULL;
 END IF;
 IF p_id IS NOT NULL THEN
  relations_changed:=(factory_,manager_,parent_) IS DISTINCT FROM (old_.factory_id,old_.factory_manager_id,old_.parent_tailor_id);
  IF role_changed OR relations_changed THEN PERFORM sa_domain.person_structure_fence();END IF;
  IF (role_changed OR relations_changed) AND sa_domain.person_dependencies(p_id)<>'[]'::jsonb THEN RAISE EXCEPTION 'Resolve active assignments and dependent people before changing role or team' USING ERRCODE='55000';END IF;
  v:=sa_domain.bump_version('person',p_id,p_expected_version);
  UPDATE sa_snapshot_20261019.sa_users SET role=p_role,factory_id=factory_,factory_manager_id=manager_,parent_tailor_id=parent_,
   name=CASE WHEN p_fields?'name' THEN btrim(p_fields->>'name') ELSE name END,phone=CASE WHEN p_fields?'phone' THEN p_fields->>'phone' ELSE phone END,
   customer_company_name=CASE WHEN p_fields?'company_name' THEN p_fields->>'company_name' ELSE customer_company_name END,
   customer_first_name=CASE WHEN p_fields?'first_name' THEN p_fields->>'first_name' ELSE customer_first_name END,
   customer_last_name=CASE WHEN p_fields?'last_name' THEN p_fields->>'last_name' ELSE customer_last_name END,
   gst_no=CASE WHEN p_fields?'gst_no' THEN p_fields->>'gst_no' ELSE gst_no END,designation=CASE WHEN p_fields?'designation' THEN p_fields->>'designation' ELSE designation END,
   features=CASE WHEN p_fields?'features' THEN p_fields->'features' WHEN role_changed THEN '[]'::jsonb ELSE features END,updated_at=now() AT TIME ZONE 'UTC' WHERE id=p_id;
  IF role_changed AND old_.role=3 THEN
   DELETE FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=p_id;
   UPDATE sa_snapshot_20261019.sa_users SET dealers_count=0,is_direct_deal=false WHERE id=p_id;
  END IF;
 ELSE
  id_:=nextval('sa_snapshot_20261019.sa_users_id_seq');
  INSERT INTO sa_snapshot_20261019.sa_users(id,email,name,phone,role,gst_no,factory_id,factory_manager_id,parent_tailor_id,created_by_id,approved,approved_at,onboarded,onboarded_at,customer_registered_by,customer_company_name,customer_first_name,customer_last_name,designation,features,created_at,updated_at)
  VALUES(id_,email_,btrim(p_fields->>'name'),p_fields->>'phone',p_role,p_fields->>'gst_no',factory_,manager_,parent_,creator_,approved_,CASE WHEN approved_ THEN now() AT TIME ZONE 'UTC' END,a.role_id=10,CASE WHEN a.role_id=10 THEN now() AT TIME ZONE 'UTC' END,
  CASE a.role_id WHEN 10 THEN 2 WHEN 0 THEN 3 ELSE 1 END,p_fields->>'company_name',p_fields->>'first_name',p_fields->>'last_name',p_fields->>'designation',coalesce(p_fields->'features','[]'),now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC');
  IF a.role_id=10 THEN INSERT INTO sa_snapshot_20261019.sa_user_dealers(user_id,dealer_id,created_at,updated_at) VALUES(id_,a.user_id,now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC');END IF;
  v:=sa_domain.bump_version('person',id_,sa_domain.version('person',id_));
  IF p_role NOT IN(5,6) THEN INSERT INTO sa_domain.account_requests(legacy_user_id,generation,actor_id) SELECT id_,generation,a.auth_id FROM sa_domain.runtime_state RETURNING id INTO job_;END IF;
 END IF;
 RETURN sa_domain.finish_command(p_operation,p_idempotency_key,'person',id_,jsonb_build_object('id',id_::text,'role',p_role,'version',v,'account',CASE WHEN p_role IN(5,6) THEN 'managed_subject' WHEN p_id IS NULL THEN 'queued' ELSE 'existing' END,'account_request_id',job_),
 jsonb_build_object('created',p_id IS NULL,'role_changed',role_changed,'relationships_changed',relations_changed,'fields',(SELECT jsonb_agg(key) FROM jsonb_object_keys(p_fields) key)));
END $f$;

CREATE FUNCTION sa_domain.v1_person_save(p_id bigint,p_role integer,p_fields jsonb,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 PERFORM sa_domain.require_roles(ARRAY[0,1,2,10]);
 IF p_role IN(5,6,7,8,9) THEN RAISE EXCEPTION 'Use the workforce command for this role' USING ERRCODE='22023';END IF;
 RETURN sa_domain.person_save(p_id,p_role,p_fields,p_expected_version,p_idempotency_key,'person.saved');
END $f$;
CREATE FUNCTION sa_domain.v1_factory_team_save(p_id bigint,p_role integer,p_fields jsonb,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 PERFORM sa_domain.require_roles(ARRAY[0,2,4]);
 IF p_role NOT IN(7,8,9) OR p_role IS NULL THEN RAISE EXCEPTION 'Factory team role must be DI, Inspector or CM' USING ERRCODE='22023';END IF;
 RETURN sa_domain.person_save(p_id,p_role,p_fields,p_expected_version,p_idempotency_key,'person.team_saved');
END $f$;
CREATE FUNCTION sa_domain.v1_tailor_save(p_id bigint,p_fields jsonb,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $f$ SELECT sa_domain.person_save(p_id,5,p_fields,p_expected_version,p_idempotency_key,'person.tailor_saved') $f$;
CREATE FUNCTION sa_domain.v1_subtailor_save(p_id bigint,p_fields jsonb,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $f$ SELECT sa_domain.person_save(p_id,6,p_fields,p_expected_version,p_idempotency_key,'person.subtailor_saved') $f$;

CREATE FUNCTION sa_domain.v1_factory_save(p_id bigint,p_name text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,2,4]);cached jsonb;id_ bigint:=p_id;v text;
BEGIN
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Factory name required' USING ERRCODE='22023';END IF;
 IF a.role_id=4 AND (p_id IS NULL OR p_id IS DISTINCT FROM a.factory_id) THEN RAISE EXCEPTION 'Factory unavailable' USING ERRCODE='42501';END IF;
 cached:=sa_domain.begin_command('factory.saved',p_idempotency_key,jsonb_build_object('id',p_id,'name',p_name,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 IF p_id IS NULL THEN
  IF p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'New factory cannot have a prior version' USING ERRCODE='22023';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('factory-name:'||lower(btrim(p_name)),784139));
  IF EXISTS(SELECT FROM sa_snapshot_20261019.sa_factories WHERE lower(btrim(name))=lower(btrim(p_name)) AND nullif(deleted_at,'') IS NULL) THEN RAISE EXCEPTION 'Factory already exists; select it from the directory' USING ERRCODE='23505';END IF;
  INSERT INTO sa_snapshot_20261019.sa_factories(name,created_at,updated_at) VALUES(btrim(p_name),now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC') RETURNING id INTO id_;
  v:=sa_domain.bump_version('factory',id_,sa_domain.version('factory',id_));
 ELSE
  v:=sa_domain.bump_version('factory',p_id,p_expected_version);
  UPDATE sa_snapshot_20261019.sa_factories SET name=btrim(p_name),updated_at=now() AT TIME ZONE 'UTC' WHERE id=p_id AND nullif(deleted_at,'') IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factory unavailable' USING ERRCODE='P0002';END IF;
 END IF;
 RETURN sa_domain.finish_command('factory.saved',p_idempotency_key,'factory',id_,jsonb_build_object('id',id_::text,'name',btrim(p_name),'version',v));
END $f$;

CREATE FUNCTION sa_domain.v1_person_archive(p_id bigint,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,4]);cached jsonb;v text;deps jsonb;
BEGIN
 PERFORM sa_domain.command_reason(p_reason);
 cached:=sa_domain.begin_command('person.archived',p_idempotency_key,jsonb_build_object('id',p_id,'reason',p_reason,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM sa_domain.person_structure_fence();
 PERFORM pg_advisory_xact_lock(hashtextextended('person:'||p_id,784139));
 IF p_id=a.user_id OR NOT sa_domain.can_manage_person(p_id) OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=p_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Person unavailable or self-removal forbidden' USING ERRCODE='42501';END IF;
 deps:=sa_domain.person_dependencies(p_id);
 IF deps<>'[]'::jsonb THEN RAISE EXCEPTION 'Resolve dependencies before archiving: %',deps USING ERRCODE='55000';END IF;
 v:=sa_domain.bump_version('person',p_id,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_users SET deleted_at=now() AT TIME ZONE 'UTC',disabled=true,disabled_at=now() AT TIME ZONE 'UTC',updated_at=now() AT TIME ZONE 'UTC' WHERE id=p_id;
 RETURN sa_domain.finish_command('person.archived',p_idempotency_key,'person',p_id,jsonb_build_object('id',p_id::text,'version',v,'state','archived','dependencies',deps),jsonb_build_object('reason',p_reason,'revoke_sessions',true));
END $f$;

GRANT SELECT(customer_registered_by) ON sa_snapshot_20261019.sa_users TO sa_guard;
CREATE FUNCTION sa_domain.address_commercial_rules(p_user_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE u record;city_ text;zone_ bigint;price_ bigint;candidate_ bigint[]:='{}';inherited_ boolean:=false;
BEGIN
 IF NOT sa_domain.can_address(p_user_id) THEN RAISE EXCEPTION 'Address owner unavailable' USING ERRCODE='42501';END IF;
 SELECT role,customer_registered_by,is_direct_deal,rmp_price_type_id INTO u FROM sa_snapshot_20261019.sa_users WHERE id=p_user_id AND deleted_at IS NULL;
 SELECT city INTO city_ FROM sa_snapshot_20261019.sa_addresses WHERE user_id=p_user_id AND is_primary AND deleted_at IS NULL ORDER BY id LIMIT 1;
 IF (SELECT count(DISTINCT zone_id) FROM sa_snapshot_20261019.sa_cities WHERE lower(btrim(name))=lower(btrim(city_)))>1 THEN RAISE EXCEPTION 'City belongs to multiple zones; reconcile the city master first' USING ERRCODE='55000';END IF;
 SELECT zone_id INTO zone_ FROM sa_snapshot_20261019.sa_cities WHERE lower(btrim(name))=lower(btrim(city_)) ORDER BY id LIMIT 1;
 IF u.role=3 AND u.is_direct_deal IS NOT TRUE AND zone_ IS NOT NULL THEN
  SELECT coalesce(array_agg(id ORDER BY id),'{}') INTO candidate_ FROM(
   SELECT DISTINCT d.id FROM sa_snapshot_20261019.sa_users d JOIN sa_snapshot_20261019.sa_addresses ad ON ad.user_id=d.id AND ad.deleted_at IS NULL
   JOIN sa_snapshot_20261019.sa_cities c ON lower(btrim(c.name))=lower(btrim(ad.city)) AND c.zone_id=zone_
   WHERE d.role=10 AND d.disabled IS NOT TRUE AND d.deleted_at IS NULL AND d.approved IS NOT FALSE LIMIT 101) x;
  IF cardinality(candidate_)>100 THEN RAISE EXCEPTION 'Zone routing exceeds 100 dealers; review the zone configuration' USING ERRCODE='54000';END IF;
 END IF;
 IF u.role=3 AND u.customer_registered_by=2 AND u.is_direct_deal IS NOT TRUE THEN
  SELECT d.zone_id INTO zone_ FROM sa_snapshot_20261019.sa_user_dealers l JOIN sa_snapshot_20261019.sa_users d ON d.id=l.dealer_id AND d.role=10 AND d.disabled IS NOT TRUE AND d.deleted_at IS NULL WHERE l.user_id=p_user_id ORDER BY l.id LIMIT 1;
  inherited_:=true;
 END IF;
 IF u.role=3 AND u.is_direct_deal IS NOT TRUE AND (inherited_ OR cardinality(candidate_)>0 OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=p_user_id)) THEN
  SELECT id INTO price_ FROM sa_snapshot_20261019.sa_rmp_price_types WHERE zone_id=zone_ AND is_deleted IS NOT TRUE ORDER BY id LIMIT 1;
  IF price_ IS NULL THEN SELECT id INTO price_ FROM sa_snapshot_20261019.sa_rmp_price_types WHERE name='Regular' AND is_deleted IS NOT TRUE ORDER BY id LIMIT 1;END IF;
 ELSE price_:=u.rmp_price_type_id;END IF;
 RETURN jsonb_build_object('zone_id',zone_::text,'price_type_id',price_::text,'candidate_dealer_ids',to_jsonb(candidate_::text[]),'dealer_link_mode','additive_legacy','basis',CASE WHEN inherited_ THEN 'registered_dealer' ELSE 'primary_city' END);
END $f$;
ALTER FUNCTION sa_domain.address_commercial_rules(bigint) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.recalculate_address_rules(p_user_id bigint) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE rules_ jsonb:=sa_domain.address_commercial_rules(p_user_id);dealer_ text;
BEGIN
 UPDATE sa_snapshot_20261019.sa_users SET zone_id=(rules_->>'zone_id')::bigint,rmp_price_type_id=(rules_->>'price_type_id')::bigint,updated_at=now() AT TIME ZONE 'UTC' WHERE id=p_user_id;
 FOR dealer_ IN SELECT * FROM jsonb_array_elements_text(rules_->'candidate_dealer_ids') LOOP
  INSERT INTO sa_snapshot_20261019.sa_user_dealers(user_id,dealer_id,created_at,updated_at)
  SELECT p_user_id,dealer_::bigint,now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC'
  WHERE NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=p_user_id AND dealer_id=dealer_::bigint);
 END LOOP;
 UPDATE sa_snapshot_20261019.sa_users SET dealers_count=(SELECT count(*) FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=p_user_id) WHERE id=p_user_id;
 RETURN rules_;
END $f$;
CREATE FUNCTION sa_domain.address_is_used(p_id bigint,p_active_only boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_orders WHERE address_id=p_id AND
 (NOT p_active_only OR (status=0 AND uc_status IS DISTINCT FROM 'CANCELLED' AND is_deleted IS NOT TRUE AND deleted_at IS NULL)))
$f$;
ALTER FUNCTION sa_domain.address_is_used(bigint,boolean) OWNER TO sa_guard;
CREATE FUNCTION sa_domain.addresses_projection(p_user_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id::text,'address',d.address,'state',d.state,'city',d.city,'zip_code',d.zip_code,'is_primary',d.is_primary,
 'version',sa_domain.version('address',d.id),'used_on_orders',sa_domain.address_is_used(d.id)) ORDER BY d.is_primary DESC,d.id),'[]')
 FROM (SELECT * FROM sa_snapshot_20261019.sa_addresses WHERE user_id=p_user_id AND deleted_at IS NULL ORDER BY is_primary DESC,id LIMIT 50) d
$f$;
CREATE FUNCTION sa_domain.v1_address_save(p_id bigint,p_user_id bigint,p_fields jsonb,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,3,4,10,11]);cached jsonb;d sa_snapshot_20261019.sa_addresses;id_ bigint:=p_id;v text;pv text;k text;val jsonb;rules_ jsonb;primary_ bigint;
BEGIN
 PERFORM sa_domain.check_fields(p_fields,ARRAY['address','state','city','zip_code','is_primary']);
 FOR k,val IN SELECT * FROM jsonb_each(p_fields) LOOP
  IF k='is_primary' THEN IF jsonb_typeof(val)<>'boolean' THEN RAISE EXCEPTION 'Primary must be boolean' USING ERRCODE='22023';END IF;
  ELSIF jsonb_typeof(val)<>'string' OR length(btrim(val#>>'{}')) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Address fields must be nonempty text up to 500 characters' USING ERRCODE='22023';END IF;
 END LOOP;
 cached:=sa_domain.begin_command('address.saved',p_idempotency_key,jsonb_build_object('id',p_id,'user_id',p_user_id,'fields',p_fields,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('person:'||p_user_id,784139));
 IF NOT sa_domain.can_address(p_user_id) OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=p_user_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Address owner unavailable' USING ERRCODE='42501';END IF;
 IF p_id IS NULL THEN
  IF p_expected_version IS NOT NULL OR NOT(p_fields ?& ARRAY['address','state','city','zip_code']) THEN RAISE EXCEPTION 'New address requires address, state, city and zip code' USING ERRCODE='22023';END IF;
  IF (SELECT count(*) FROM sa_snapshot_20261019.sa_addresses WHERE user_id=p_user_id AND deleted_at IS NULL)>=50 THEN RAISE EXCEPTION 'Archive unused addresses before adding more' USING ERRCODE='54000';END IF;
  INSERT INTO sa_snapshot_20261019.sa_addresses(user_id,address,state,city,zip_code,is_primary,created_at,updated_at)
   VALUES(p_user_id,btrim(p_fields->>'address'),btrim(p_fields->>'state'),btrim(p_fields->>'city'),btrim(p_fields->>'zip_code'),coalesce((p_fields->>'is_primary')::boolean,false),now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC') RETURNING id INTO id_;
  v:=sa_domain.bump_version('address',id_,sa_domain.version('address',id_));
 ELSE
  SELECT * INTO d FROM sa_snapshot_20261019.sa_addresses WHERE id=p_id AND user_id=p_user_id AND deleted_at IS NULL;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Address unavailable' USING ERRCODE='P0002';END IF;
  IF sa_domain.address_is_used(p_id) AND EXISTS(SELECT FROM jsonb_each(p_fields) f WHERE f.key<>'is_primary' AND btrim(f.value#>>'{}') IS DISTINCT FROM to_jsonb(d)->>f.key) THEN RAISE EXCEPTION 'Address is used on an order; add a replacement address to preserve history' USING ERRCODE='55000';END IF;
  v:=sa_domain.bump_version('address',p_id,p_expected_version);
  UPDATE sa_snapshot_20261019.sa_addresses SET address=coalesce(btrim(p_fields->>'address'),address),state=coalesce(btrim(p_fields->>'state'),state),city=coalesce(btrim(p_fields->>'city'),city),zip_code=coalesce(btrim(p_fields->>'zip_code'),zip_code),
   is_primary=coalesce((p_fields->>'is_primary')::boolean,is_primary),updated_at=now() AT TIME ZONE 'UTC' WHERE id=p_id;
 END IF;
 SELECT id INTO primary_ FROM sa_snapshot_20261019.sa_addresses WHERE user_id=p_user_id AND deleted_at IS NULL
 ORDER BY (id=id_ AND coalesce((p_fields->>'is_primary')::boolean,false)) DESC,is_primary DESC,id LIMIT 1;
 -- Every changed primary flag receives a version, including repaired source duplicates.
 FOR d IN SELECT * FROM sa_snapshot_20261019.sa_addresses WHERE user_id=p_user_id AND deleted_at IS NULL AND is_primary IS DISTINCT FROM (id=primary_) ORDER BY id LOOP
  IF d.id<>id_ THEN PERFORM sa_domain.bump_version('address',d.id,sa_domain.version('address',d.id));END IF;
 END LOOP;
 UPDATE sa_snapshot_20261019.sa_addresses SET is_primary=(id=primary_),updated_at=now() AT TIME ZONE 'UTC' WHERE user_id=p_user_id AND deleted_at IS NULL AND is_primary IS DISTINCT FROM (id=primary_);
 rules_:=sa_domain.recalculate_address_rules(p_user_id);pv:=sa_domain.bump_version('person',p_user_id,sa_domain.version('person',p_user_id));
 RETURN sa_domain.finish_command('address.saved',p_idempotency_key,'address',id_,jsonb_build_object('id',id_::text,'version',v,'person_version',pv,'addresses',sa_domain.addresses_projection(p_user_id),'commercial_rules',rules_),jsonb_build_object('user_id',p_user_id::text,'rules',rules_));
END $f$;
CREATE FUNCTION sa_domain.v1_address_archive(p_id bigint,p_user_id bigint,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,3,4,10,11]);cached jsonb;v text;pv text;primary_ bigint;rules_ jsonb;d record;
BEGIN
 cached:=sa_domain.begin_command('address.archived',p_idempotency_key,jsonb_build_object('id',p_id,'user_id',p_user_id,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('person:'||p_user_id,784139));
 IF NOT sa_domain.can_address(p_user_id) OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_addresses WHERE id=p_id AND user_id=p_user_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Address unavailable' USING ERRCODE='42501';END IF;
 IF sa_domain.address_is_used(p_id,true) THEN RAISE EXCEPTION 'Address belongs to an active order; finish or cancel the order first' USING ERRCODE='55000';END IF;
 v:=sa_domain.bump_version('address',p_id,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_addresses SET deleted_at=now() AT TIME ZONE 'UTC',is_primary=false,updated_at=now() AT TIME ZONE 'UTC' WHERE id=p_id;
 SELECT id INTO primary_ FROM sa_snapshot_20261019.sa_addresses WHERE user_id=p_user_id AND deleted_at IS NULL ORDER BY is_primary DESC,id LIMIT 1;
 FOR d IN SELECT id FROM sa_snapshot_20261019.sa_addresses WHERE user_id=p_user_id AND deleted_at IS NULL AND is_primary IS DISTINCT FROM(id=primary_) ORDER BY id LOOP PERFORM sa_domain.bump_version('address',d.id,sa_domain.version('address',d.id));END LOOP;
 UPDATE sa_snapshot_20261019.sa_addresses SET is_primary=(id=primary_),updated_at=now() AT TIME ZONE 'UTC' WHERE user_id=p_user_id AND deleted_at IS NULL AND is_primary IS DISTINCT FROM(id=primary_);
 rules_:=sa_domain.recalculate_address_rules(p_user_id);pv:=sa_domain.bump_version('person',p_user_id,sa_domain.version('person',p_user_id));
 RETURN sa_domain.finish_command('address.archived',p_idempotency_key,'address',p_id,jsonb_build_object('id',p_id::text,'version',v,'person_version',pv,'addresses',sa_domain.addresses_projection(p_user_id),'commercial_rules',rules_),jsonb_build_object('user_id',p_user_id::text));
END $f$;
-- A completed order can still read its original archived address. New orders
-- independently require an active address in delivery_address().
DO $f$ DECLARE definition_ text;BEGIN
 definition_:=pg_get_functiondef('sa_domain.order_dispatch_destination(bigint)'::regprocedure);
 definition_:=replace(definition_,'id=o.address_id AND user_id=o.customer_id AND deleted_at IS NULL','id=o.address_id AND user_id=o.customer_id');EXECUTE definition_;
END $f$;

CREATE OR REPLACE FUNCTION sa_domain.person_projection(p jsonb,a sa_domain.actor,p_version text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',p->>'id','name',p->'name','role',p->'role','company_name',p->'customer_company_name','first_name',p->'customer_first_name','last_name',p->'customer_last_name',
 'approved',p->'approved','onboarded',p->'onboarded','disabled',p->'disabled','version',p_version)
 ||CASE WHEN a.role_id IN(0,1,4,10) OR(p->>'id')::bigint=a.user_id THEN jsonb_build_object('email',CASE WHEN(p->>'role')::int NOT IN(5,6) THEN p->'email' END,'phone',p->'phone') ELSE '{}' END
 ||CASE WHEN a.role_id IN(0,2,4,7,8,9) THEN jsonb_build_object('factory_id',p->>'factory_id') ELSE '{}' END
$f$;
CREATE OR REPLACE FUNCTION sa_domain.v1_person_get(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,3,4,7,8,9,10,11,12]);r jsonb;u record;
BEGIN
 SELECT id,name,email,phone,role,customer_company_name,customer_first_name,customer_last_name,factory_id,factory_manager_id,parent_tailor_id,created_by_id,approved,onboarded,disabled,designation,features,gst_no,zone_id,rmp_price_type_id,is_direct_deal,auto_approve_customers,stock_visibility_percentage,customer_registered_by INTO u
 FROM sa_snapshot_20261019.sa_users WHERE id=p_id AND deleted_at IS NULL;
 IF u.id IS NULL THEN RAISE EXCEPTION 'Person unavailable' USING ERRCODE='P0002';END IF;
 r:=sa_domain.person_projection(to_jsonb(u),a,sa_domain.version('person',p_id))||jsonb_build_object('designation',u.designation);
 IF a.role_id IN(0,2,4,7,8,9) THEN r:=r||jsonb_build_object('factory_id',sa_domain.effective_factory(p_id)::text,'manager_id',u.factory_manager_id::text,'parent_tailor_id',u.parent_tailor_id::text);END IF;
 IF a.role_id=0 OR p_id=a.user_id THEN r:=r||jsonb_build_object('features',u.features);END IF;
 IF sa_domain.can_address(p_id) THEN r:=r||jsonb_build_object('addresses',sa_domain.addresses_projection(p_id),'gst_no',u.gst_no,'coordinator_id',u.created_by_id::text,'zone_id',u.zone_id::text,'price_type_id',u.rmp_price_type_id::text,
  'direct_deal',u.is_direct_deal,'auto_approve_customers',u.auto_approve_customers,'stock_visibility_percentage',u.stock_visibility_percentage,'registered_by',u.customer_registered_by,
  'dealer_ids',(SELECT coalesce(jsonb_agg(dealer_id::text ORDER BY id),'[]') FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=p_id));END IF;
 IF sa_domain.can_manage_person(p_id) THEN r:=r||jsonb_build_object('archive_dependencies',sa_domain.person_dependencies(p_id),'account_request',(SELECT jsonb_build_object('id',id,'state',state,'error_code',error_code) FROM sa_domain.account_requests WHERE legacy_user_id=p_id));END IF;
 RETURN r;
END $f$;
CREATE FUNCTION sa_domain.v1_factories_list(p_search text DEFAULT '',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,2,4]);n int:=sa_domain.page_limit(p_limit);ctx jsonb:=sa_domain.page_context('factories',jsonb_build_object('search',p_search));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;
BEGIN
 IF p_search IS NULL OR length(p_search)>100 THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE='22023';END IF;
 WITH scan AS MATERIALIZED(SELECT id,name FROM sa_snapshot_20261019.sa_factories WHERE nullif(deleted_at,'') IS NULL AND id<after_ AND (p_search='' OR strpos(lower(name),lower(p_search))>0) ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'name',name,'version',sa_domain.version('factory',id)) ORDER BY id DESC),'[]'),'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;RETURN r;
END $f$;

DO $f$ DECLARE p record;args_ text;call_ text;BEGIN
 FOR p IN SELECT pr.oid,pr.proname,pg_get_function_identity_arguments(pr.oid) args,pg_get_function_arguments(pr.oid) full_args,pr.provolatile
 FROM pg_proc pr JOIN pg_namespace n ON n.oid=pr.pronamespace WHERE n.nspname='sa_domain' AND pr.proname=ANY(ARRAY[
 'person_structure_fence','can_manage_person','can_address','email_available','person_dependencies','validate_person_fields','person_save','address_commercial_rules','recalculate_address_rules','address_is_used','addresses_projection',
 'v1_person_save','v1_factory_team_save','v1_tailor_save','v1_subtailor_save','v1_factory_save','v1_person_archive','v1_address_save','v1_address_archive','v1_factories_list']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION sa_domain.%I(%s) FROM PUBLIC,anon,authenticated,sa_app',p.proname,p.args);
  EXECUTE format('GRANT EXECUTE ON FUNCTION sa_domain.%I(%s) TO sa_executor',p.proname,p.args);
  IF p.proname LIKE 'v1_%' THEN
   EXECUTE format('ALTER FUNCTION sa_domain.%I(%s) OWNER TO sa_executor',p.proname,p.args);
   SELECT string_agg(split_part(btrim(s), ' ',1),',') INTO call_ FROM unnest(string_to_array(p.args,',')) s;
   EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',p.proname,p.full_args,CASE WHEN p.provolatile='s' THEN 'STABLE' ELSE '' END,'SELECT sa_domain.'||p.proname||'('||call_||')');
   EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',p.proname,p.args);
   EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s),sa_domain.%I(%s) TO sa_app',p.proname,p.args,p.proname,p.args);
  END IF;
 END LOOP;
END $f$;
GRANT EXECUTE ON FUNCTION sa_domain.can_manage_person(bigint),sa_domain.can_address(bigint),sa_domain.address_is_used(bigint,boolean) TO sa_guard;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
