BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
-- New-client releases are operational settings, not copied Flutter version gates.
CREATE TABLE sa_domain.app_releases(platform text PRIMARY KEY CHECK(platform IN('android','ios','web')),minimum_version text,recommended_version text,update_url text);
INSERT INTO sa_domain.app_releases(platform) VALUES('android'),('ios'),('web');
ALTER TABLE sa_domain.app_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.app_releases FORCE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE ON sa_domain.app_releases TO sa_executor;
CREATE POLICY squad_release_read ON sa_domain.app_releases FOR SELECT TO sa_executor USING(true);
CREATE POLICY squad_release_write ON sa_domain.app_releases FOR UPDATE TO sa_executor USING((SELECT(sa_domain.actor()).role_id)=0) WITH CHECK((SELECT(sa_domain.actor()).role_id)=0);
CREATE TABLE sa_domain.integration_preferences(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),airtable_enabled boolean NOT NULL DEFAULT false);
INSERT INTO sa_domain.integration_preferences(singleton) VALUES(true);
ALTER TABLE sa_domain.integration_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.integration_preferences FORCE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE ON sa_domain.integration_preferences TO sa_executor;
CREATE POLICY squad_integration_preferences_read ON sa_domain.integration_preferences FOR SELECT TO sa_executor USING((SELECT(sa_domain.actor()).role_id)=0);
CREATE POLICY squad_integration_preferences_write ON sa_domain.integration_preferences FOR UPDATE TO sa_executor USING((SELECT(sa_domain.actor()).role_id)=0) WITH CHECK((SELECT(sa_domain.actor()).role_id)=0);

CREATE FUNCTION sa_domain.release_version(p_version text) RETURNS bigint[]
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $f$
DECLARE m text[];
BEGIN
 IF p_version IS NULL THEN RETURN NULL;END IF;
 IF length(p_version)>60 THEN RAISE EXCEPTION 'Invalid release version' USING ERRCODE='22023';END IF;
 m:=regexp_match(p_version,'^(0|[1-9][0-9]{0,8})[.](0|[1-9][0-9]{0,8})[.](0|[1-9][0-9]{0,8})([+](0|[1-9][0-9]{0,8}))?$');
 IF m IS NULL THEN RAISE EXCEPTION 'Use major.minor.patch with optional +build for a release' USING ERRCODE='22023';END IF;
 RETURN ARRAY[m[1]::bigint,m[2]::bigint,m[3]::bigint,coalesce(m[5]::bigint,0)];
END $f$;
CREATE FUNCTION sa_domain.v1_app_bootstrap(p_platform text,p_version text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r sa_domain.app_releases;v bigint[]:=sa_domain.release_version(p_version);
BEGIN
 IF p_platform IS NULL OR p_platform NOT IN('android','ios','web') THEN RAISE EXCEPTION 'Unknown platform' USING ERRCODE='22023';END IF;
 SELECT * INTO STRICT r FROM sa_domain.app_releases WHERE platform=p_platform;
 RETURN jsonb_build_object('api_version',1,'client','squad','platform',p_platform,'minimum_version',r.minimum_version,'recommended_version',r.recommended_version,'update_url',r.update_url,
 'update_required',coalesce(v<sa_domain.release_version(r.minimum_version),false),'update_available',coalesce(v<sa_domain.release_version(r.recommended_version),false),'version_check',CASE WHEN p_version IS NULL THEN 'unknown_client_version' WHEN r.minimum_version IS NULL THEN 'no_minimum_configured' ELSE 'checked' END);
END $f$;
CREATE FUNCTION sa_domain.effective_capabilities(p_role integer,p_features jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('notes',p_role IN(0,1,2,4) OR(p_role IN(11,12) AND sa_domain.feature(p_features,'1')),
 'goals',p_role IN(0,1,2) OR(p_role IN(11,12) AND sa_domain.feature(p_features,'2')),
 'catalogue',p_role IN(0,1,2,3,10) OR(p_role IN(11,12) AND sa_domain.feature(p_features,'3')),
 'configure',p_role IN(0,1,3,10) OR(p_role IN(11,12) AND sa_domain.feature(p_features,'3.3')),
 'documents',p_role IN(0,1,3,10) OR(p_role IN(11,12) AND sa_domain.feature(p_features,'3.2')),
 'promotions',p_role IN(0,1,2,3,10) OR(p_role IN(11,12) AND sa_domain.feature(p_features,'3.4')),'place_orders',p_role IN(1,3,10))
$f$;
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.v1_me()'::regprocedure);
 d:=regexp_replace(d,'''capabilities'',jsonb_build_object[\s\S]*?''place_orders'',a.role_id IN\(1,3,10\)\)\)', '''capabilities'',sa_domain.effective_capabilities(a.role_id,a.features))');EXECUTE d;
 d:=pg_get_functiondef('sa_domain.validate_person_fields(jsonb)'::regprocedure);
 d:=replace(d,$old$IF child->>'key' IS NULL$old$,$new$IF child->>'key'='3.1' AND child->>'checked'='true' THEN RAISE EXCEPTION 'Place Order is a retired placeholder, not a worker capability' USING ERRCODE='22023';END IF; IF child->>'key' IS NULL$new$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.catalog_actor(text)'::regprocedure);
 d:=replace(d,$old$a.role_id=2 AND p_capability='browse'$old$,$new$a.role_id=2 AND p_capability IN('browse','promotions')$new$);EXECUTE d;
END $f$;
CREATE FUNCTION sa_domain.v1_person_capabilities_save(p_id bigint,p_features jsonb,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE cached jsonb;v text;role_ integer;
BEGIN
 PERFORM sa_domain.require_roles(ARRAY[0]);PERFORM sa_domain.command_reason(p_reason);PERFORM sa_domain.validate_person_fields(jsonb_build_object('features',p_features));
 cached:=sa_domain.begin_command('person.capabilities_changed',p_idempotency_key,jsonb_build_object('id',p_id,'features',p_features,'reason',p_reason,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('person:'||p_id,784139));
 SELECT role INTO role_ FROM sa_snapshot_20261019.sa_users WHERE id=p_id AND role IN(11,12) AND deleted_at IS NULL;
 IF role_ IS NULL THEN RAISE EXCEPTION 'Job Worker or Team member unavailable' USING ERRCODE='42501';END IF;
 v:=sa_domain.bump_version('person',p_id,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_users SET features=p_features,updated_at=now() AT TIME ZONE 'UTC' WHERE id=p_id;
 RETURN sa_domain.finish_command('person.capabilities_changed',p_idempotency_key,'person',p_id,jsonb_build_object('id',p_id::text,'version',v,'features',p_features,'capabilities',sa_domain.effective_capabilities(role_,p_features)),jsonb_build_object('reason',p_reason,'features',p_features));
END $f$;

GRANT SELECT ON sa_snapshot_20261019.sa_promotions,sa_snapshot_20261019.sa_promotional_banners TO sa_executor;
CREATE POLICY squad_promotion_read ON sa_snapshot_20261019.sa_promotions FOR SELECT TO sa_executor USING((SELECT(sa_domain.effective_capabilities(a.role_id,a.features)->>'promotions')::boolean FROM sa_domain.actor() a));
CREATE POLICY squad_banner_read ON sa_snapshot_20261019.sa_promotional_banners FOR SELECT TO sa_executor USING((SELECT sa_domain.catalog_enabled()));
CREATE INDEX squad_promotion_page ON sa_snapshot_20261019.sa_promotions(updated_at DESC,id DESC) WHERE is_deleted IS NOT TRUE;
CREATE INDEX squad_promotion_category_page ON sa_snapshot_20261019.sa_promotions(category,updated_at DESC,id DESC) WHERE is_deleted IS NOT TRUE;
CREATE INDEX squad_banner_page ON sa_snapshot_20261019.sa_promotional_banners((sa_domain.catalog_sort(position)),id) WHERE is_deleted IS NOT TRUE;
CREATE FUNCTION sa_domain.promotion_link(p_id bigint,p_link text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT CASE WHEN nullif(btrim(p_link),'') IS NULL THEN NULL
 WHEN p_link ~* '^https://(www[.])?(youtube[.]com|youtu[.]be|drive[.]google[.]com|docs[.]google[.]com|vimeo[.]com)/[^[:space:]]*$' AND length(p_link)<=4096
 THEN jsonb_build_object('kind','external','url',p_link,'provider',CASE WHEN p_link~*'(youtube[.]com|youtu[.]be)/' THEN 'youtube' WHEN p_link~*'vimeo[.]com/' THEN 'vimeo' ELSE 'google_drive' END)
 ELSE jsonb_build_object('kind','file','media',sa_domain.catalog_media('promotions',p_id,'link',p_link)) END
$f$;
CREATE FUNCTION sa_domain.v1_promotions_list(p_filters jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('promotions');n int:=sa_domain.page_limit(p_limit);ctx jsonb:=sa_domain.page_context('promotions',p_filters);cur jsonb:=sa_domain.catalog_cursor(p_cursor,ctx);r jsonb;mode_ text:=coalesce(p_filters->>'mode','assets');date_ date;sort_ timestamp;
BEGIN
 PERFORM sa_domain.check_fields(p_filters,ARRAY['mode','category','upload_date']);
 IF mode_ NOT IN('assets','categories') OR(p_filters?'mode' AND jsonb_typeof(p_filters->'mode')<>'string') OR(p_filters?'category' AND(jsonb_typeof(p_filters->'category')<>'string' OR length(p_filters->>'category')>200)) THEN RAISE EXCEPTION 'Invalid promotion filters' USING ERRCODE='22023';END IF;
 IF p_filters?'upload_date' THEN IF jsonb_typeof(p_filters->'upload_date')<>'string' OR p_filters->>'upload_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Invalid upload date' USING ERRCODE='22023';END IF;date_:=(p_filters->>'upload_date')::date;END IF;
 IF mode_='categories' THEN
  WITH groups_ AS(SELECT min(id) id,category FROM sa_snapshot_20261019.sa_promotions WHERE is_deleted IS NOT TRUE AND nullif(btrim(category),'') IS NOT NULL GROUP BY category),
  scan AS MATERIALIZED(SELECT * FROM groups_ WHERE cur IS NULL OR(category COLLATE "C",id)>(cur->>'sort',(cur->>'id')::bigint) ORDER BY category COLLATE "C",id LIMIT n+1),page AS(SELECT * FROM scan ORDER BY category COLLATE "C",id LIMIT n)
  SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('category',category) ORDER BY category COLLATE "C",id),'[]'),'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN(SELECT sa_domain.catalog_next_cursor(id,category,ctx) FROM page ORDER BY category COLLATE "C" DESC,id DESC LIMIT 1) END) INTO r FROM page;RETURN r;
 END IF;
 IF cur IS NOT NULL THEN BEGIN sort_:=(cur->>'sort')::timestamp;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid promotion cursor' USING ERRCODE='22023';END;END IF;
 WITH scan AS MATERIALIZED(SELECT * FROM sa_snapshot_20261019.sa_promotions WHERE is_deleted IS NOT TRUE AND(NOT p_filters?'category' OR category=p_filters->>'category') AND(date_ IS NULL OR upload_date=date_) AND(cur IS NULL OR(updated_at,id)<(sort_,(cur->>'id')::bigint)) ORDER BY updated_at DESC,id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY updated_at DESC,id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'name',name,'category',category,'upload_date',upload_date,'file_size',file_size,'thumbnail',sa_domain.catalog_media('promotions',id,'thumbnail',thumbnail),'content',sa_domain.promotion_link(id,link),'updated_at',updated_at AT TIME ZONE 'UTC') ORDER BY updated_at DESC,id DESC),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN(SELECT sa_domain.catalog_next_cursor(id,updated_at::text,ctx) FROM page ORDER BY updated_at,id LIMIT 1) END) INTO r FROM page;RETURN r;
END $f$;
CREATE FUNCTION sa_domain.v1_banners_list(p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor();n int:=sa_domain.page_limit(p_limit);ctx jsonb:=sa_domain.page_context('banners','{}');cur jsonb:=sa_domain.catalog_cursor(p_cursor,ctx);r jsonb;
BEGIN
 WITH scan AS MATERIALIZED(SELECT b.* FROM sa_snapshot_20261019.sa_promotional_banners b WHERE b.is_deleted IS NOT TRUE
 AND(b.rmp_brand_id IS NULL OR b.rmp_brand_id IN(SELECT sa_domain.catalog_brand_ids()))
 AND(b.rmp_class_id IS NULL OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_classes c WHERE c.id=b.rmp_class_id AND c.is_deleted IS NOT TRUE AND EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_skus sku WHERE sku.rmp_class_id=c.id AND sku.is_deleted IS NOT TRUE AND sku.rmp_brand_id IN(SELECT sa_domain.catalog_brand_ids()))))
 AND(cur IS NULL OR(sa_domain.catalog_sort(b.position),b.id)>(cur->>'sort',(cur->>'id')::bigint)) ORDER BY sa_domain.catalog_sort(b.position),b.id LIMIT n+1),page AS(SELECT * FROM scan ORDER BY sa_domain.catalog_sort(position),id LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'title',title,'status',status,'position',position,'image',sa_domain.catalog_media('promotional_banners',id,'image',image),'destination',jsonb_build_object('brand_id',rmp_brand_id::text,'category_id',rmp_category_id::text,'class_id',rmp_class_id::text),'availability',jsonb_build_object('state','not_loaded')) ORDER BY sa_domain.catalog_sort(position),id),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN(SELECT sa_domain.catalog_next_cursor(id,sa_domain.catalog_sort(position),ctx) FROM page ORDER BY sa_domain.catalog_sort(position) DESC,id DESC LIMIT 1) END) INTO r FROM page;RETURN r;
END $f$;

-- Admin business settings only. Provider credentials never enter this contract.
GRANT SELECT ON sa_snapshot_20261019.sa_app_configs,sa_snapshot_20261019.sa_cities,sa_snapshot_20261019.sa_zones TO sa_executor;
GRANT INSERT,UPDATE,DELETE ON sa_snapshot_20261019.sa_cities,sa_snapshot_20261019.sa_criteria TO sa_executor;
GRANT INSERT,UPDATE ON sa_snapshot_20261019.sa_zones TO sa_executor;
GRANT USAGE ON SEQUENCE sa_snapshot_20261019.sa_cities_id_seq,sa_snapshot_20261019.sa_zones_id_seq TO sa_executor;
GRANT SELECT(id,key,value) ON sa_snapshot_20261019.sa_settings TO sa_executor;
CREATE POLICY squad_setting_read ON sa_snapshot_20261019.sa_settings FOR SELECT TO sa_executor USING((SELECT(sa_domain.actor()).role_id)=0 AND key IN('airtable_sync_enabled','use_dashboard'));
CREATE POLICY squad_app_config_read ON sa_snapshot_20261019.sa_app_configs FOR SELECT TO sa_executor USING((SELECT(sa_domain.actor()).role_id)=0);
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['cities','zones','criteria'] LOOP
  EXECUTE format('CREATE POLICY squad_settings_read ON sa_snapshot_20261019.sa_%I FOR SELECT TO sa_executor USING((SELECT(sa_domain.actor()).role_id)=0)',t);
  EXECUTE format('CREATE POLICY squad_settings_insert ON sa_snapshot_20261019.sa_%I FOR INSERT TO sa_executor WITH CHECK((SELECT(sa_domain.actor()).role_id)=0)',t);
  EXECUTE format('CREATE POLICY squad_settings_update ON sa_snapshot_20261019.sa_%I FOR UPDATE TO sa_executor USING((SELECT(sa_domain.actor()).role_id)=0) WITH CHECK((SELECT(sa_domain.actor()).role_id)=0)',t);
  IF t<>'zones' THEN EXECUTE format('CREATE POLICY squad_settings_delete ON sa_snapshot_20261019.sa_%I FOR DELETE TO sa_executor USING((SELECT(sa_domain.actor()).role_id)=0)',t);END IF;
 END LOOP;
END $f$;
CREATE FUNCTION sa_domain.v1_settings_read(p_group text,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);n int:=sa_domain.page_limit(p_limit);ctx jsonb:=sa_domain.page_context('settings',jsonb_build_object('group',p_group));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;
BEGIN
 IF p_group='app_releases' THEN
  SELECT jsonb_build_object('data',jsonb_agg(jsonb_build_object('platform',platform,'minimum_version',minimum_version,'recommended_version',recommended_version,'update_url',update_url,'version',sa_domain.version('app_release',CASE platform WHEN 'android' THEN 1 WHEN 'ios' THEN 2 ELSE 3 END)) ORDER BY platform),'next_cursor',NULL,
  'legacy_flutter_version',(SELECT version FROM sa_snapshot_20261019.sa_app_configs ORDER BY id LIMIT 1),'legacy_version_applied_to_squad',false) INTO r FROM sa_domain.app_releases;RETURN r;
 ELSIF p_group='integrations' THEN
  SELECT jsonb_build_object('version',sa_domain.version('integration_preferences',1),'airtable_enabled',airtable_enabled,'warehouse_provider',CASE WHEN EXISTS(SELECT FROM sa_snapshot_20261019.sa_settings WHERE key='use_dashboard' AND value='true') THEN 'dashboard' ELSE 'unicommerce' END,
  'warehouse_provider_mutable',false,'imported_airtable_enabled',EXISTS(SELECT FROM sa_snapshot_20261019.sa_settings WHERE key='airtable_sync_enabled' AND value='true'),'provider_configuration','server_only') INTO r FROM sa_domain.integration_preferences;RETURN r;
 ELSIF p_group NOT IN('cities','zones','criteria') OR p_group IS NULL THEN RAISE EXCEPTION 'Unknown settings group' USING ERRCODE='22023';END IF;
 WITH scan AS MATERIALIZED(
  SELECT id,name,zone_id parent_id,false archived FROM sa_snapshot_20261019.sa_cities WHERE p_group='cities' AND id<after_
  UNION ALL SELECT id,name,NULL::bigint,coalesce(is_deleted,false) FROM sa_snapshot_20261019.sa_zones WHERE p_group='zones' AND id<after_
  UNION ALL SELECT id,name,NULL::bigint,false FROM sa_snapshot_20261019.sa_criteria WHERE p_group='criteria' AND id<after_
  ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'name',name,'parent_id',parent_id::text,'archived',archived,'version',sa_domain.version('setting_'||p_group,id)) ORDER BY id DESC),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;RETURN r;
END $f$;
CREATE FUNCTION sa_domain.setting_dependencies(p_group text,p_id bigint) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 PERFORM sa_domain.require_roles(ARRAY[0]);
 IF p_group='cities' THEN RETURN EXISTS(SELECT FROM sa_snapshot_20261019.sa_addresses a JOIN sa_snapshot_20261019.sa_cities c ON lower(btrim(a.city))=lower(btrim(c.name)) WHERE c.id=p_id AND a.deleted_at IS NULL);
 ELSIF p_group='zones' THEN RETURN EXISTS(SELECT FROM sa_snapshot_20261019.sa_cities WHERE zone_id=p_id) OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE zone_id=p_id AND deleted_at IS NULL) OR EXISTS(SELECT FROM sa_snapshot_20261019.sa_rmp_price_types WHERE zone_id=p_id AND is_deleted IS NOT TRUE);
 ELSIF p_group='criteria' THEN RETURN EXISTS(SELECT FROM sa_snapshot_20261019.sa_item_criteria WHERE criteria_id=p_id);
 ELSE RAISE EXCEPTION 'Unknown settings group' USING ERRCODE='22023';END IF;
END $f$;
ALTER FUNCTION sa_domain.setting_dependencies(text,bigint) OWNER TO sa_guard;
GRANT SELECT ON sa_snapshot_20261019.sa_item_criteria TO sa_guard;
CREATE POLICY squad_guard_setting_criteria ON sa_snapshot_20261019.sa_item_criteria FOR SELECT TO sa_guard USING(true);
CREATE FUNCTION sa_domain.v1_settings_save(p_group text,p_id bigint,p_fields jsonb,p_reason text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0]);cached jsonb;id_ bigint:=p_id;v text;r jsonb;platform_ text;minimum_ text;recommended_ text;url_ text;old_ jsonb;name_ text;zone_ bigint;archive_ boolean:=false;kind_ text;duplicate_ boolean;
BEGIN
 PERFORM sa_domain.command_reason(p_reason);
 IF p_group IS NULL OR p_group NOT IN('app_releases','integrations','cities','zones','criteria') THEN RAISE EXCEPTION 'Unknown settings group' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('settings.saved',p_idempotency_key,jsonb_build_object('group',p_group,'id',p_id,'fields',p_fields,'reason',p_reason,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 IF p_group='app_releases' THEN
  PERFORM sa_domain.check_fields(p_fields,ARRAY['platform','minimum_version','recommended_version','update_url']);platform_:=p_fields->>'platform';
  IF p_id IS NOT NULL OR platform_ IS NULL OR platform_ NOT IN('android','ios','web') OR NOT p_fields?'minimum_version' OR NOT p_fields?'recommended_version' OR NOT p_fields?'update_url' OR EXISTS(SELECT FROM jsonb_each(p_fields) WHERE jsonb_typeof(value) NOT IN('string','null')) THEN RAISE EXCEPTION 'Supply a complete platform release policy' USING ERRCODE='22023';END IF;
  minimum_:=p_fields->>'minimum_version';recommended_:=p_fields->>'recommended_version';url_:=p_fields->>'update_url';
  PERFORM sa_domain.release_version(minimum_);PERFORM sa_domain.release_version(recommended_);
  IF (minimum_ IS NOT NULL AND recommended_ IS NOT NULL AND sa_domain.release_version(recommended_)<sa_domain.release_version(minimum_)) OR(url_ IS NOT NULL AND(length(url_)>2048 OR url_ !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]+(:[0-9]+)?/[^[:space:]]*$')) OR((minimum_ IS NOT NULL OR recommended_ IS NOT NULL) AND url_ IS NULL) THEN RAISE EXCEPTION 'Invalid release policy or update URL' USING ERRCODE='22023';END IF;
  id_:=CASE platform_ WHEN 'android' THEN 1 WHEN 'ios' THEN 2 ELSE 3 END;kind_:='app_release';v:=sa_domain.bump_version(kind_,id_,p_expected_version);
  UPDATE sa_domain.app_releases SET minimum_version=minimum_,recommended_version=recommended_,update_url=url_ WHERE platform=platform_;
  r:=jsonb_build_object('platform',platform_,'minimum_version',minimum_,'recommended_version',recommended_,'update_url',url_,'version',v);
 ELSIF p_group='integrations' THEN
  PERFORM sa_domain.check_fields(p_fields,ARRAY['airtable_enabled']);
  IF p_id IS NOT NULL OR jsonb_typeof(p_fields->'airtable_enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Specify airtable_enabled as a boolean' USING ERRCODE='22023';END IF;
  id_:=1;kind_:='integration_preferences';v:=sa_domain.bump_version(kind_,id_,p_expected_version);
  UPDATE sa_domain.integration_preferences SET airtable_enabled=(p_fields->>'airtable_enabled')::boolean;
  r:=sa_domain.v1_settings_read('integrations');
 ELSE
  PERFORM sa_domain.check_fields(p_fields,CASE WHEN p_group='cities' THEN ARRAY['name','zone_id','archive'] ELSE ARRAY['name','archive'] END);
  IF (p_fields?'archive' AND jsonb_typeof(p_fields->'archive')<>'boolean') OR(p_fields?'name' AND(jsonb_typeof(p_fields->'name')<>'string' OR length(btrim(p_fields->>'name')) NOT BETWEEN 1 AND 200)) THEN RAISE EXCEPTION 'Invalid master values' USING ERRCODE='22023';END IF;
  archive_:=coalesce((p_fields->>'archive')::boolean,false);name_:=btrim(p_fields->>'name');
  IF archive_ AND (p_id IS NULL OR p_fields?'name' OR p_fields?'zone_id') THEN RAISE EXCEPTION 'Archive requires only an existing ID' USING ERRCODE='22023';END IF;
  IF NOT archive_ AND name_ IS NULL THEN RAISE EXCEPTION 'Name required' USING ERRCODE='22023';END IF;
  PERFORM sa_domain.person_structure_fence();
  PERFORM pg_advisory_xact_lock(hashtextextended('settings:'||p_group,784139));
  IF p_fields?'zone_id' THEN zone_:=sa_domain.input_id(p_fields->'zone_id');IF NOT sa_domain.active_master_ids('zone',ARRAY[zone_]) THEN RAISE EXCEPTION 'Zone unavailable' USING ERRCODE='22023';END IF;END IF;
  IF p_group='cities' AND NOT archive_ AND zone_ IS NULL THEN RAISE EXCEPTION 'City zone required' USING ERRCODE='22023';END IF;
  IF p_id IS NOT NULL THEN
   EXECUTE format('SELECT to_jsonb(t) FROM sa_snapshot_20261019.%I t WHERE id=$1','sa_'||p_group) INTO old_ USING p_id;
   IF old_ IS NULL THEN RAISE EXCEPTION 'Setting unavailable' USING ERRCODE='P0002';END IF;
   IF(sa_domain.setting_dependencies(p_group,p_id)) AND(archive_ OR p_group IN('cities','criteria') AND(name_ IS DISTINCT FROM old_->>'name' OR(p_group='cities' AND zone_ IS DISTINCT FROM(old_->>'zone_id')::bigint))) THEN RAISE EXCEPTION 'This master is in use; preserve history and reconcile its dependants before replacing it' USING ERRCODE='55000';END IF;
  ELSIF p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'New master must not supply a version' USING ERRCODE='22023';END IF;
  IF NOT archive_ THEN
   EXECUTE format('SELECT EXISTS(SELECT FROM sa_snapshot_20261019.%I WHERE lower(btrim(name))=lower($1) AND id IS DISTINCT FROM $2)','sa_'||p_group) INTO duplicate_ USING name_,p_id;
   IF duplicate_ THEN RAISE EXCEPTION 'Master name already exists' USING ERRCODE='23505';END IF;
  END IF;
  kind_:='setting_'||p_group;
  IF p_id IS NULL THEN
   IF p_group='cities' THEN INSERT INTO sa_snapshot_20261019.sa_cities(name,zone_id,created_at,updated_at) VALUES(name_,zone_,now() AT TIME ZONE 'UTC',now() AT TIME ZONE 'UTC') RETURNING id INTO id_;
   ELSE EXECUTE format('INSERT INTO sa_snapshot_20261019.%I(name,created_at,updated_at) VALUES($1,now() AT TIME ZONE ''UTC'',now() AT TIME ZONE ''UTC'') RETURNING id','sa_'||p_group) INTO id_ USING name_;END IF;
   v:=sa_domain.bump_version(kind_,id_,sa_domain.version(kind_,id_));
  ELSE
   v:=sa_domain.bump_version(kind_,id_,p_expected_version);
   IF archive_ AND p_group<>'zones' THEN EXECUTE format('DELETE FROM sa_snapshot_20261019.%I WHERE id=$1','sa_'||p_group) USING id_;
   ELSIF p_group='cities' THEN UPDATE sa_snapshot_20261019.sa_cities SET name=name_,zone_id=zone_,updated_at=now() AT TIME ZONE 'UTC' WHERE id=id_;
   ELSIF p_group='zones' THEN UPDATE sa_snapshot_20261019.sa_zones SET name=coalesce(name_,name),is_deleted=archive_,updated_at=now() AT TIME ZONE 'UTC' WHERE id=id_;
   ELSE UPDATE sa_snapshot_20261019.sa_criteria SET name=name_,updated_at=now() AT TIME ZONE 'UTC' WHERE id=id_;END IF;
  END IF;
  r:=jsonb_build_object('id',id_::text,'version',v,'name',coalesce(name_,old_->>'name'),'archived',archive_);
 END IF;
 RETURN sa_domain.finish_command('settings.saved',p_idempotency_key,kind_,id_,r,jsonb_build_object('group',p_group,'fields',p_fields,'reason',p_reason));
END $f$;

-- Deleted zones must not grant eligibility or select a zone price.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.active_master_ids(text,bigint[])'::regprocedure);
 d:=replace(d,'LEFT JOIN sa_snapshot_20261019.sa_zones b ON b.id=x WHERE','LEFT JOIN sa_snapshot_20261019.sa_zones b ON b.id=x AND b.is_deleted IS NOT TRUE WHERE');EXECUTE d;
 d:=pg_get_functiondef('sa_domain.relationship_options(text,bigint,text,bigint,integer)'::regprocedure);
 d:=replace(d,'sa_snapshot_20261019.sa_zones z WHERE z.id<p_after','sa_snapshot_20261019.sa_zones z WHERE z.is_deleted IS NOT TRUE AND z.id<p_after');
 d:=replace(d,'sa_snapshot_20261019.sa_cities c WHERE c.id<p_after','sa_snapshot_20261019.sa_cities c WHERE c.zone_id IN(SELECT id FROM sa_snapshot_20261019.sa_zones WHERE is_deleted IS NOT TRUE) AND c.id<p_after');EXECUTE d;
 d:=pg_get_functiondef('sa_domain.address_commercial_rules(bigint)'::regprocedure);
 d:=replace(d,'sa_snapshot_20261019.sa_cities WHERE lower','sa_snapshot_20261019.sa_cities WHERE zone_id IN(SELECT id FROM sa_snapshot_20261019.sa_zones WHERE is_deleted IS NOT TRUE) AND lower');
 d:=replace(d,'IF u.role=3 AND u.is_direct_deal IS NOT TRUE AND (inherited_', 'IF NOT sa_domain.active_master_ids(''zone'',ARRAY[zone_]) THEN zone_:=NULL;END IF; IF u.role=3 AND u.is_direct_deal IS NOT TRUE AND (inherited_');EXECUTE d;
 d:=pg_get_functiondef('sa_domain.commercial_context(bigint)'::regprocedure);
 d:=replace(d,'SELECT id INTO price_ FROM sa_snapshot_20261019.sa_rmp_price_types WHERE zone_id=zone_', 'IF NOT sa_domain.active_master_ids(''zone'',ARRAY[zone_]) THEN zone_:=NULL;END IF; SELECT id INTO price_ FROM sa_snapshot_20261019.sa_rmp_price_types WHERE zone_id=zone_');EXECUTE d;
END $f$;
GRANT EXECUTE ON FUNCTION sa_domain.active_master_ids(text,bigint[]) TO sa_guard;

DO $f$ DECLARE p record;call_ text;BEGIN
 FOR p IN SELECT pr.proname,pg_get_function_identity_arguments(pr.oid) args,pg_get_function_arguments(pr.oid) full_args,pr.provolatile FROM pg_proc pr JOIN pg_namespace n ON n.oid=pr.pronamespace WHERE n.nspname='sa_domain' AND pr.proname=ANY(ARRAY[
 'release_version','effective_capabilities','promotion_link','setting_dependencies',
 'v1_app_bootstrap','v1_person_capabilities_save','v1_promotions_list','v1_banners_list','v1_settings_read','v1_settings_save']) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION sa_domain.%I(%s) FROM PUBLIC,anon,authenticated,sa_app',p.proname,p.args);
  EXECUTE format('GRANT EXECUTE ON FUNCTION sa_domain.%I(%s) TO sa_executor',p.proname,p.args);
  IF p.proname LIKE 'v1_%' THEN
   EXECUTE format('ALTER FUNCTION sa_domain.%I(%s) OWNER TO sa_executor',p.proname,p.args);
   SELECT string_agg(split_part(btrim(s),' ',1),',') INTO call_ FROM unnest(string_to_array(p.args,',')) s;
   EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql %s SECURITY INVOKER SET search_path=pg_catalog AS %L',p.proname,p.full_args,CASE WHEN p.provolatile='s' THEN 'STABLE' ELSE '' END,'SELECT sa_domain.'||p.proname||'('||call_||')');
   EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated',p.proname,p.args);
   EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s),sa_domain.%I(%s) TO sa_app',p.proname,p.args,p.proname,p.args);
  END IF;
 END LOOP;
END $f$;
GRANT EXECUTE ON FUNCTION sa_domain.effective_capabilities(integer,jsonb) TO sa_guard;
-- The sole anonymous domain endpoint: a fixed, bounded, read-only release policy.
GRANT USAGE ON SCHEMA canto_api,sa_domain TO anon;
GRANT EXECUTE ON FUNCTION canto_api.v1_app_bootstrap(text,text),sa_domain.v1_app_bootstrap(text,text) TO anon;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
