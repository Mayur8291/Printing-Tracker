-- Read-only web contracts: truthful ownership and scoped custom configuration.
BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor;
GRANT SELECT ON sa_snapshot_20261019.sa_sc_sizes TO sa_executor;
CREATE POLICY squad_catalog_read ON sa_snapshot_20261019.sa_sc_sizes FOR SELECT TO sa_executor
 USING((SELECT sa_domain.catalog_enabled()));
CREATE POLICY squad_configuration_sizes_insert ON sa_snapshot_20261019.sa_sizes FOR INSERT TO sa_executor
 WITH CHECK((SELECT (sa_domain.effective_capabilities(a.role_id,a.features)->>'configure')::boolean FROM sa_domain.actor() a));

DO $change$
DECLARE definition text; changed text;
BEGIN
 definition:=pg_get_functiondef('sa_domain.v1_me()'::regprocedure);
 changed:=replace(definition,'RETURN result;', $replacement$
 RETURN result || (SELECT jsonb_build_object('write_state',jsonb_build_object(
  'mode',CASE WHEN e.active_job IS NOT NULL THEN 'refresh' WHEN e.cutover THEN 'native'
    WHEN e.environment='staging' AND sa_domain.rehearsal_actor_allowed(a.auth_id) THEN 'test' ELSE 'mirror' END,
  'allowed',e.active_job IS NULL AND (e.cutover OR (e.environment='staging' AND sa_domain.rehearsal_actor_allowed(a.auth_id))),
  'expires_at',CASE WHEN NOT e.cutover AND e.environment='staging' AND sa_domain.rehearsal_actor_allowed(a.auth_id) THEN r.test_write_expires_at ELSE NULL END,
  'generation',r.generation::text)) FROM sa_sync.environment_state e CROSS JOIN sa_domain.runtime_state r WHERE e.singleton AND r.singleton);
 $replacement$);
 IF definition=changed THEN RAISE EXCEPTION 'v1_me return anchor missing'; END IF;
 EXECUTE changed;
 definition:=pg_get_functiondef('sa_domain.v1_configurator_options(bigint,text,bigint,bigint,text,integer)'::regprocedure);
 changed:=replace(definition,'''size_types'',''assets''','''size_types'',''sizes'',''assets''');
 changed:=replace(changed,'ctx:=sa_domain.page_context', $replacement$
 IF p_kind='sizes' AND (p_parent_id IS NULL OR NOT EXISTS(
   SELECT FROM sa_snapshot_20261019.sa_size_types st WHERE st.id=p_parent_id AND st.is_deleted IS NOT TRUE AND (
     EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_size_types b WHERE b.base_product_id=p_base_id AND b.size_type_id=st.id AND b.is_deleted IS NOT TRUE)
     OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_base_products b WHERE b.id=p_base_id AND b.size_type_id=st.id))))
 THEN RAISE EXCEPTION 'Select an available size type for this base product' USING ERRCODE='22023'; END IF;
 ctx:=sa_domain.page_context
 $replacement$);
 changed:=replace(changed,'UNION ALL SELECT ai.id,jsonb_build_object', $replacement$
 UNION ALL SELECT sc.id,jsonb_build_object('id',CASE WHEN canonical.matches=1 THEN canonical.id::text ELSE NULL END,
  'sc_size_id',sc.id::text,'name',sc.name,'position',sc.position,'available',canonical.matches=1)
 FROM sa_snapshot_20261019.sa_sc_sizes sc
 CROSS JOIN LATERAL(SELECT min(s.id) id,count(*) matches FROM sa_snapshot_20261019.sa_sizes s WHERE s.name=sc.name) canonical
 WHERE p_kind='sizes' AND sc.size_type_id=p_parent_id AND sc.is_deleted IS NOT TRUE
 UNION ALL SELECT ai.id,jsonb_build_object
 $replacement$);
 IF changed=definition OR position('canonical.matches' IN changed)=0 THEN RAISE EXCEPTION 'Configurator selector anchor missing'; END IF;
 EXECUTE changed;
 definition:=pg_get_functiondef('sa_domain.v1_person_get(bigint)'::regprocedure);
 changed:=replace(definition,'RETURN r;', $replacement$
 IF u.role=10 AND a.role_id IN(0,1) AND sa_domain.can_manage_person(p_id) THEN
  r:=r||jsonb_build_object('brand_ids',(SELECT coalesce(jsonb_agg(authorized_brand_id::text ORDER BY authorized_brand_id),'[]')
   FROM sa_snapshot_20261019.sa_assigned_brands WHERE user_id=p_id));
 END IF;
 RETURN r;
 $replacement$);
 IF changed=definition THEN RAISE EXCEPTION 'Person projection return anchor missing'; END IF;
 EXECUTE changed;
END $change$;

CREATE FUNCTION sa_domain.v1_configuration_size_resolve(p_base_id bigint,p_sc_size_id bigint,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');cached jsonb;size_name text;size_id bigint;matches bigint;
BEGIN
 cached:=sa_domain.begin_command('configuration.size_resolved',p_idempotency_key,jsonb_build_object('base_id',p_base_id,'sc_size_id',p_sc_size_id));
 IF cached IS NOT NULL THEN RETURN cached; END IF;
 SELECT sc.name INTO size_name FROM sa_snapshot_20261019.sa_sc_sizes sc
 JOIN sa_snapshot_20261019.sa_size_types st ON st.id=sc.size_type_id AND st.is_deleted IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_base_products b ON b.id=p_base_id AND b.is_deleted IS NOT TRUE
 WHERE sc.id=p_sc_size_id AND sc.is_deleted IS NOT TRUE AND (b.size_type_id=st.id OR EXISTS(
   SELECT FROM sa_snapshot_20261019.sa_base_size_types bs WHERE bs.base_product_id=b.id AND bs.size_type_id=st.id AND bs.is_deleted IS NOT TRUE));
 IF size_name IS NULL THEN RAISE EXCEPTION 'Size unavailable for this product' USING ERRCODE='P0002'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('size:'||size_name,0));
 SELECT count(*) INTO matches FROM sa_snapshot_20261019.sa_sizes WHERE name=size_name;
 IF matches>1 THEN RAISE EXCEPTION 'Size needs administrative reconciliation' USING ERRCODE='PT409'; END IF;
 size_id:=sa_domain.order_size(size_name);
 RETURN sa_domain.finish_command('configuration.size_resolved',p_idempotency_key,'size',size_id,
  jsonb_build_object('id',size_id::text,'sc_size_id',p_sc_size_id::text,'name',size_name),jsonb_build_object('base_id',p_base_id::text));
END $fn$;
ALTER FUNCTION sa_domain.v1_configuration_size_resolve(bigint,bigint,uuid) OWNER TO sa_executor;
CREATE FUNCTION canto_api.v1_configuration_size_resolve(p_base_id bigint,p_sc_size_id bigint,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
 SELECT sa_domain.v1_configuration_size_resolve(p_base_id,p_sc_size_id,p_idempotency_key) $fn$;
REVOKE ALL ON FUNCTION sa_domain.v1_configuration_size_resolve(bigint,bigint,uuid),canto_api.v1_configuration_size_resolve(bigint,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION sa_domain.v1_configuration_size_resolve(bigint,bigint,uuid),canto_api.v1_configuration_size_resolve(bigint,bigint,uuid) TO sa_app;

CREATE FUNCTION sa_domain.v1_configuration_quote(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $fn$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');
BEGIN
 PERFORM sa_domain.check_fields(p_request,ARRAY['lines']);
 IF octet_length(p_request::text)>131072 OR jsonb_typeof(p_request->'lines') IS DISTINCT FROM 'array'
 OR jsonb_array_length(p_request->'lines') NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION 'Provide 1..50 configuration lines within 128 KB' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_request->'lines') l WHERE l->>'kind' IS DISTINCT FROM 'custom') THEN
  RAISE EXCEPTION 'Only custom configuration lines are supported' USING ERRCODE='22023';
 END IF;
 RETURN sa_domain.calculate_quote(p_request,true)||jsonb_build_object('purpose','configuration_display_only');
END $fn$;
ALTER FUNCTION sa_domain.v1_configuration_quote(jsonb) OWNER TO sa_executor;
CREATE FUNCTION canto_api.v1_configuration_quote(p_request jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
 AS $fn$ SELECT sa_domain.v1_configuration_quote(p_request) $fn$;
REVOKE ALL ON FUNCTION sa_domain.v1_configuration_quote(jsonb),canto_api.v1_configuration_quote(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION sa_domain.v1_configuration_quote(jsonb),canto_api.v1_configuration_quote(jsonb) TO sa_app;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
