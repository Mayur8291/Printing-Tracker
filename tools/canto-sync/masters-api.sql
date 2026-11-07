-- Canto administration is isolated from Printing Tracker's public schema.
CREATE SCHEMA IF NOT EXISTS sa_admin;
CREATE SCHEMA IF NOT EXISTS canto_api;
REVOKE ALL ON SCHEMA sa_admin, canto_api FROM PUBLIC, anon, sa_app;
CREATE TABLE IF NOT EXISTS sa_admin.master_contracts (resource text PRIMARY KEY, spec jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS sa_admin.media (
  resource text NOT NULL, record_id bigint NOT NULL, field text NOT NULL, url text NOT NULL,
  PRIMARY KEY (resource, record_id, field)
);
CREATE TABLE IF NOT EXISTS sa_admin.record_extras (resource text NOT NULL,record_id bigint NOT NULL,values jsonb NOT NULL,PRIMARY KEY(resource,record_id));
ALTER TABLE sa_admin.record_extras ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS sa_admin.audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid NOT NULL,
  resource text NOT NULL, record_id bigint, operation text NOT NULL,
  before_data jsonb, after_data jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sa_sync.environment_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  edit_revision bigint NOT NULL DEFAULT 0, synced_revision bigint NOT NULL DEFAULT 0,
  cutover boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sa_sync.environment_state(singleton) VALUES(true) ON CONFLICT DO NOTHING;
ALTER TABLE sa_admin.master_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_admin.media ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_admin.audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_sync.environment_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA sa_admin FROM PUBLIC, anon, authenticated, sa_app;
REVOKE ALL ON sa_sync.environment_state FROM PUBLIC, anon, authenticated, sa_app;

CREATE OR REPLACE FUNCTION sa_admin.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT auth.uid() IS NOT NULL AND coalesce(auth.jwt()->>'role','') = 'authenticated'
    AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id=auth.uid()
      AND u.role='authenticated' AND (u.banned_until IS NULL OR u.banned_until < now())
      AND (EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=u.id AND p.role='admin')
        OR EXISTS(SELECT 1 FROM public.admin_emails a WHERE lower(a.email)=lower(u.email))))
    AND EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id::text=auth.jwt()->>'session_id'
      AND s.user_id=auth.uid() AND (s.not_after IS NULL OR s.not_after>now()));
$$;

CREATE OR REPLACE FUNCTION sa_admin.read_record(p_resource text, p_id bigint, p_expand boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE spec jsonb; result jsonb; v_field text; target text; related jsonb; rel jsonb; values_ jsonb;
BEGIN
  SELECT c.spec INTO spec FROM sa_admin.master_contracts c WHERE resource=p_resource;
  IF spec IS NULL THEN RAISE EXCEPTION 'Unknown master' USING ERRCODE='22023'; END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM sa_snapshot_20261019.%I t WHERE id=$1','sa_'||p_resource) INTO result USING p_id;
  IF result IS NULL THEN RETURN NULL; END IF;
  SELECT e.values INTO related FROM sa_admin.record_extras e WHERE e.resource=p_resource AND e.record_id=p_id;
  result:=result||coalesce(related,'{}');
  FOR v_field,values_ IN SELECT * FROM jsonb_each(coalesce(spec->'enums','{}')) LOOP
    IF result->>v_field IS NOT NULL THEN result:=jsonb_set(result,ARRAY[v_field],values_->((result->>v_field)::int)); END IF;
  END LOOP;
  FOR v_field IN SELECT jsonb_array_elements_text(spec->'media') LOOP
    SELECT to_jsonb(m.url) INTO related FROM sa_admin.media m WHERE m.resource=p_resource AND m.record_id=p_id AND m.field=v_field;
    IF related IS NOT NULL THEN result:=result||jsonb_build_object(v_field,related); END IF;
    IF coalesce(result->>v_field,'')<>'' AND result->>v_field !~ '^https?://' THEN
      result:=result||jsonb_build_object(v_field,'/uploads/'||(spec->>'model')||'/'||v_field||'/'||p_id||'/'||(result->>v_field));
    END IF;
    IF v_field IN ('image','logo','asset','thumbnail') THEN result:=result||jsonb_build_object(v_field||'_url',result->v_field); END IF;
  END LOOP;
  IF p_expand THEN
    FOR v_field,target IN SELECT key,value FROM jsonb_each_text(coalesce(spec->'references','{}')) LOOP
      IF result->>v_field IS NOT NULL THEN
        related:=sa_admin.read_record(target,(result->>v_field)::bigint,false);
        result:=result||jsonb_build_object(left(v_field,length(v_field)-3),related);
      END IF;
    END LOOP;
    FOR target,rel IN SELECT * FROM jsonb_each(coalesce(spec->'relations','{}')) LOOP
      EXECUTE format('SELECT coalesce(jsonb_agg(sa_admin.read_record($2,j.%I,false) ORDER BY j.id),''[]''::jsonb) FROM sa_snapshot_20261019.%I j WHERE j.%I=$1 AND NOT coalesce(j.is_deleted,false)',rel->>2,'sa_'||(rel->>0),rel->>1)
        INTO related USING p_id,target;
      result:=result||jsonb_build_object(target,related,'active_'||target,related,'ck_active_'||target,related);
    END LOOP;
  END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION sa_admin.write_relations(p_resource text,p_id bigint,p_relations jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE spec jsonb; target text; ids jsonb; rel jsonb; item text; exists_ boolean; source_column text;
BEGIN
  SELECT c.spec INTO spec FROM sa_admin.master_contracts c WHERE resource=p_resource;
  FOR target,ids IN SELECT * FROM jsonb_each(p_relations) LOOP
    rel:=spec->'relations'->target;
    IF rel IS NULL OR jsonb_typeof(ids)<>'array' OR jsonb_array_length(ids)>1000 THEN RAISE EXCEPTION 'Invalid relation %',target USING ERRCODE='22023'; END IF;
    EXECUTE format('UPDATE sa_snapshot_20261019.%I SET is_deleted=true,updated_at=now() WHERE %I=$1','sa_'||(rel->>0),rel->>1) USING p_id;
    FOR item IN SELECT DISTINCT jsonb_array_elements_text(ids) LOOP
      IF item !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Invalid relation ID' USING ERRCODE='22023'; END IF;
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM sa_snapshot_20261019.%I WHERE id=$1)','sa_'||target) INTO exists_ USING item::bigint;
      IF NOT exists_ THEN RAISE EXCEPTION 'Related % record does not exist',target USING ERRCODE='23503'; END IF;
      EXECUTE format('UPDATE sa_snapshot_20261019.%I SET is_deleted=false,updated_at=now() WHERE %I=$1 AND %I=$2','sa_'||(rel->>0),rel->>1,rel->>2) USING p_id,item::bigint;
      GET DIAGNOSTICS source_column=ROW_COUNT;
      IF source_column::bigint=0 THEN
        EXECUTE format('INSERT INTO sa_snapshot_20261019.%I (%I,%I,is_deleted,created_at,updated_at) VALUES($1,$2,false,now(),now())','sa_'||(rel->>0),rel->>1,rel->>2) USING p_id,item::bigint;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION sa_admin.refresh_min_stats(p_classes bigint[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE class_id bigint; type_ record; min_price_ numeric; min_mrp_ numeric;
BEGIN
  FOR class_id IN SELECT DISTINCT unnest(p_classes) LOOP
    IF class_id IS NULL THEN CONTINUE; END IF;
    FOR type_ IN SELECT id,name,is_deleted FROM sa_snapshot_20261019.sa_rmp_price_types LOOP
      SELECT coalesce(min(p.price),0),coalesce(min(p.mrp),0) INTO min_price_,min_mrp_
      FROM sa_snapshot_20261019.sa_rmp_skus s
      JOIN sa_snapshot_20261019.sa_rmp_sku_prices l ON l.rmp_sku_id=s.id AND l.is_deleted=false
      JOIN sa_snapshot_20261019.sa_rmp_prices p ON p.id=l.rmp_price_id AND p.is_deleted=false
      WHERE s.rmp_class_id=class_id AND s.is_deleted=false AND p.rmp_price_type_id=type_.id AND type_.is_deleted=false;
      UPDATE sa_snapshot_20261019.sa_rmp_min_infos SET price='DN-'||left(class_id::text,1)||trunc(min_price_)::text,mrp=trunc(min_mrp_),updated_at=now()
        WHERE rmp_class_id=class_id AND rmp_price_type_id=type_.id;
      IF NOT FOUND THEN
        INSERT INTO sa_snapshot_20261019.sa_rmp_min_infos(rmp_class_id,rmp_price_type_id,price,mrp,created_at,updated_at)
        VALUES(class_id,type_.id,'DN-'||left(class_id::text,1)||trunc(min_price_)::text,trunc(min_mrp_),now(),now());
      END IF;
      IF type_.name='Regular' THEN
        UPDATE sa_snapshot_20261019.sa_rmp_classes SET min_price='DN-'||left(class_id::text,1)||trunc(min_price_)::text,min_mrp=trunc(min_mrp_)::text,updated_at=now() WHERE id=class_id;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION sa_admin.master_request(p_resource text,p_action text,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_column
<<ctx>>
DECLARE spec jsonb; field text; value jsonb; payload jsonb; before_ jsonb; after_ jsonb;
  row_ jsonb; record_id bigint; cols text; vals text; assignments text; field_type text;
  exists_ boolean; target text; enum_values jsonb; enum_index int; page_ int; size_ int;
  total_ bigint; result jsonb; where_ text; search_ text; search_expr text; ids jsonb; item text;
BEGIN
  IF NOT sa_admin.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  SELECT c.spec INTO spec FROM sa_admin.master_contracts c WHERE resource=p_resource;
  IF spec IS NULL THEN RAISE EXCEPTION 'Unknown master' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_data)<>'object' THEN RAISE EXCEPTION 'Invalid request' USING ERRCODE='22023'; END IF;
  IF pg_column_size(p_data)>1048576 THEN RAISE EXCEPTION 'Request is too large' USING ERRCODE='22023'; END IF;
  IF p_action='list' THEN
    page_:=greatest(1,coalesce((p_data->>'page')::int,1));
    size_:=least(1000,greatest(1,coalesce((p_data->>'items')::int,100)));
    where_:='true';
    IF spec->'columns' ? 'is_deleted' AND NOT coalesce((p_data->>'includeInactive')::boolean,false) THEN where_:=where_||' AND NOT coalesce(t.is_deleted,false)'; END IF;
    search_:=left(coalesce(p_data->>'search',''),200);
    SELECT string_agg(format('coalesce(t.%I::text,'''')',f),' || '' '' || ') INTO search_expr FROM jsonb_array_elements_text(spec->'search') f;
    IF search_<>'' AND search_expr IS NOT NULL THEN where_:=where_||format(' AND (%s) ILIKE %L',search_expr,'%'||replace(replace(replace(search_,E'\\',E'\\\\'),'%','\%'),'_','\_')||'%'); END IF;
    FOR field,value IN SELECT * FROM jsonb_each(coalesce(p_data->'filters','{}')) LOOP
      IF NOT (spec->'references' ? field) THEN RAISE EXCEPTION 'Unsupported filter' USING ERRCODE='22023'; END IF;
      where_:=where_||format(' AND t.%I=%L',field,value#>>'{}');
    END LOOP;
    EXECUTE format('SELECT count(*) FROM sa_snapshot_20261019.%I t WHERE %s','sa_'||p_resource,where_) INTO total_;
    EXECUTE format('SELECT coalesce(jsonb_agg(sa_admin.read_record($1,id) ORDER BY id),''[]''::jsonb) FROM (SELECT id FROM sa_snapshot_20261019.%I t WHERE %s ORDER BY id LIMIT $2 OFFSET $3) x','sa_'||p_resource,where_) INTO result USING p_resource,size_,(page_-1)::bigint*size_;
    RETURN jsonb_build_object('data',result,'page',page_,'pageSize',size_,'totalCount',total_,'totalPages',ceil(total_::numeric/size_),'totalCountIsExact',true);
  ELSIF p_action='get' THEN
    result:=sa_admin.read_record(p_resource,(p_data->>'id')::bigint);
    IF result IS NULL THEN RAISE EXCEPTION 'Record not found' USING ERRCODE='P0002'; END IF;
    RETURN result;
  END IF;
  IF coalesce((spec->>'readOnly')::boolean,false) THEN RAISE EXCEPTION 'Read-only options' USING ERRCODE='42501'; END IF;
  IF p_action NOT IN ('create','update','delete','bulk_delete','relations') THEN RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023'; END IF;
  IF NOT pg_try_advisory_xact_lock(20261107,1) THEN RAISE EXCEPTION 'A refresh or another save is running. Try again.' USING ERRCODE='55P03'; END IF;
  -- A publication owns the same lock; edits cannot race the capture/comparison/apply cycle.
  IF p_action='bulk_delete' THEN
    ids:=p_data->'ids';
    IF jsonb_typeof(ids)<>'array' OR jsonb_array_length(ids)>1000 THEN RAISE EXCEPTION 'Choose up to 1000 records' USING ERRCODE='22023'; END IF;
    FOR item IN SELECT jsonb_array_elements_text(ids) LOOP
      PERFORM sa_admin.master_request(p_resource,'delete',jsonb_build_object('id',item));
    END LOOP;
    RETURN jsonb_build_object('deleted',jsonb_array_length(ids));
  END IF;
  IF EXISTS(SELECT 1 FROM sa_sync.environment_state s WHERE singleton AND to_jsonb(s)->>'active_job' IS NOT NULL) THEN
    RAISE EXCEPTION 'A refresh is queued or running. Wait before editing masters.' USING ERRCODE='55P03';
  END IF;
  IF p_action<>'create' THEN
    record_id:=(p_data->>'id')::bigint;
    EXECUTE format('SELECT to_jsonb(t) FROM sa_snapshot_20261019.%I t WHERE id=$1 FOR UPDATE','sa_'||p_resource) INTO before_ USING record_id;
    IF before_ IS NULL THEN RAISE EXCEPTION 'Record not found' USING ERRCODE='P0002'; END IF;
    IF p_data->>'expectedUpdatedAt' IS NOT NULL AND (p_data->>'expectedUpdatedAt')::timestamp IS DISTINCT FROM (before_->>'updated_at')::timestamp THEN
      RAISE EXCEPTION 'This record changed. Reload it before saving.' USING ERRCODE='40001';
    END IF;
  END IF;
  payload:=coalesce(p_data->'values','{}');
  IF p_action='delete' THEN payload:='{"is_deleted":true}'; END IF;
  IF jsonb_typeof(payload)<>'object' THEN RAISE EXCEPTION 'Invalid fields' USING ERRCODE='22023'; END IF;
  FOR field,value IN SELECT * FROM jsonb_each(payload) LOOP
    IF NOT (spec->'fields' ? field) THEN RAISE EXCEPTION 'Field % is not writable',field USING ERRCODE='22023'; END IF;
    enum_values:=spec->'enums'->field;
    IF enum_values IS NOT NULL AND value<>'null'::jsonb THEN
      SELECT ordinality::int-1 INTO enum_index FROM jsonb_array_elements_text(enum_values) WITH ORDINALITY e(v,ordinality) WHERE v=value#>>'{}';
      IF enum_index IS NULL THEN RAISE EXCEPTION 'Invalid % value',field USING ERRCODE='22023'; END IF;
      payload:=jsonb_set(payload,ARRAY[field],to_jsonb(enum_index));
    END IF;
    field_type:=spec->'columns'->field->>'type';
    IF value='""'::jsonb AND field_type NOT IN ('character varying','text') THEN payload:=jsonb_set(payload,ARRAY[field],'null'); END IF;
    IF spec->'media' ? field AND value<>'null'::jsonb AND value#>>'{}'<>'' AND value#>>'{}' !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/canto-masters/' THEN
      RAISE EXCEPTION 'Upload this file to Canto storage before saving' USING ERRCODE='22023';
    END IF;
  END LOOP;
  row_:=coalesce(before_,'{}')||payload;
  IF p_resource='asset_infos' AND nullif(payload->>'add_on_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sa_snapshot_20261019.sa_add_ons WHERE id=(payload->>'add_on_id')::bigint) THEN
    RAISE EXCEPTION 'Related add-on does not exist' USING ERRCODE='23503';
  END IF;
  IF p_action NOT IN ('delete','relations') THEN
    FOR field IN SELECT jsonb_array_elements_text(spec->'required') LOOP
      IF coalesce(btrim(row_->>field),'')='' THEN RAISE EXCEPTION '% is required',field USING ERRCODE='23514'; END IF;
    END LOOP;
    FOR field,value IN SELECT * FROM jsonb_each(spec->'unique') LOOP
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM sa_snapshot_20261019.%I WHERE %s AND id IS DISTINCT FROM $2)','sa_'||p_resource,
        CASE WHEN value='true'::jsonb THEN format('lower(%I)=lower($1)',field) ELSE format('%I=$1',field) END)
        INTO exists_ USING row_->>field,record_id;
      IF exists_ THEN RAISE EXCEPTION '% has already been taken',field USING ERRCODE='23505'; END IF;
    END LOOP;
    FOR field,target IN SELECT * FROM jsonb_each_text(spec->'references') LOOP
      IF row_->>field IS NOT NULL THEN
        EXECUTE format('SELECT EXISTS(SELECT 1 FROM sa_snapshot_20261019.%I WHERE id=$1)','sa_'||target) INTO exists_ USING (row_->>field)::bigint;
        IF NOT exists_ THEN RAISE EXCEPTION 'Related % record does not exist',target USING ERRCODE='23503'; END IF;
      END IF;
    END LOOP;
  END IF;
  -- Snapshot columns retain their original names/types. Private media supplies UI-only upload fields.
  SELECT string_agg(format('%I',key),','),string_agg(format('(jsonb_populate_record(NULL::sa_snapshot_20261019.%I,$1)).%I','sa_'||p_resource,key),','),
    string_agg(format('%I=(jsonb_populate_record(NULL::sa_snapshot_20261019.%I,$1)).%I',key,'sa_'||p_resource,key),',')
    INTO cols,vals,assignments FROM jsonb_object_keys(payload) key WHERE spec->'columns' ? key;
  IF p_action='create' THEN
    EXECUTE format('INSERT INTO sa_snapshot_20261019.%I (%s%screated_at,updated_at,source) SELECT %s%snow(),now(),1 RETURNING id','sa_'||p_resource,coalesce(cols,''),CASE WHEN cols IS NULL THEN '' ELSE ',' END,coalesce(vals,''),CASE WHEN vals IS NULL THEN '' ELSE ',' END)
      INTO record_id USING payload;
  ELSE
    EXECUTE format('UPDATE sa_snapshot_20261019.%I SET %s%supdated_at=now(),source=1 WHERE id=$2','sa_'||p_resource,coalesce(assignments,''),CASE WHEN assignments IS NULL THEN '' ELSE ',' END) USING payload,record_id;
  END IF;
  FOR field,value IN SELECT * FROM jsonb_each(payload) LOOP
    IF spec->'media' ? field THEN
      IF coalesce(value#>>'{}','')='' THEN DELETE FROM sa_admin.media WHERE resource=p_resource AND sa_admin.media.record_id=ctx.record_id AND sa_admin.media.field=ctx.field;
      ELSE INSERT INTO sa_admin.media VALUES(p_resource,record_id,field,value#>>'{}') ON CONFLICT(resource,record_id,field) DO UPDATE SET url=excluded.url; END IF;
    END IF;
  END LOOP;
  IF p_resource='asset_infos' THEN
    INSERT INTO sa_admin.record_extras(resource,record_id,values) VALUES(p_resource,record_id,payload-ARRAY(SELECT jsonb_object_keys(spec->'columns')))
      ON CONFLICT(resource,record_id) DO UPDATE SET values=sa_admin.record_extras.values||excluded.values;
  END IF;
  PERFORM sa_admin.write_relations(p_resource,record_id,coalesce(p_data->'relations','{}'));
  IF p_resource='rmp_prices' THEN
    EXECUTE 'SELECT to_jsonb(t) FROM sa_snapshot_20261019.sa_rmp_prices t WHERE id=$1' INTO row_ USING record_id;
    UPDATE sa_snapshot_20261019.sa_rmp_sku_prices SET is_deleted=true,updated_at=now() WHERE rmp_price_id=record_id;
    IF NOT coalesce((row_->>'is_deleted')::boolean,false) THEN
      UPDATE sa_snapshot_20261019.sa_rmp_sku_prices SET is_deleted=false,updated_at=now(),source=1 WHERE rmp_price_id=record_id AND rmp_sku_id=(row_->>'rmp_sku_id')::bigint;
      IF NOT FOUND THEN INSERT INTO sa_snapshot_20261019.sa_rmp_sku_prices(rmp_price_id,rmp_sku_id,is_deleted,created_at,updated_at,source) VALUES(record_id,(row_->>'rmp_sku_id')::bigint,false,now(),now(),1); END IF;
    END IF;
    PERFORM sa_admin.refresh_min_stats(ARRAY(SELECT DISTINCT rmp_class_id FROM sa_snapshot_20261019.sa_rmp_skus WHERE id IN ((before_->>'rmp_sku_id')::bigint,(row_->>'rmp_sku_id')::bigint)));
  ELSIF p_resource='rmp_skus' THEN
    PERFORM sa_admin.refresh_min_stats(ARRAY[(before_->>'rmp_class_id')::bigint,(sa_admin.read_record(p_resource,record_id)->>'rmp_class_id')::bigint]);
  ELSIF p_resource='rmp_price_types' THEN
    PERFORM sa_admin.refresh_min_stats(ARRAY(SELECT DISTINCT s.rmp_class_id FROM sa_snapshot_20261019.sa_rmp_skus s JOIN sa_snapshot_20261019.sa_rmp_prices p ON p.rmp_sku_id=s.id WHERE p.rmp_price_type_id=record_id));
  END IF;
  after_:=sa_admin.read_record(p_resource,record_id);
  INSERT INTO sa_admin.audit(actor_id,resource,record_id,operation,before_data,after_data) VALUES(auth.uid(),p_resource,record_id,p_action,before_,after_);
  UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1,updated_at=now() WHERE singleton;
  RETURN after_;
END;
$$;

CREATE OR REPLACE FUNCTION canto_api.masters(resource text, action text, payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT sa_admin.master_request(resource,action,payload);
$$;
CREATE OR REPLACE FUNCTION canto_api.access() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT sa_admin.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
  RETURN (SELECT to_jsonb(s) FROM sa_sync.environment_state s WHERE singleton);
END;
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sa_admin, canto_api FROM PUBLIC, anon, authenticated, sa_app;
GRANT USAGE ON SCHEMA canto_api,sa_admin TO authenticated;
GRANT EXECUTE ON FUNCTION sa_admin.is_admin(), sa_admin.master_request(text,text,jsonb),canto_api.masters(text,text,jsonb),canto_api.access() TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('canto-masters','canto-masters',true,8388608,ARRAY['image/png','image/jpeg','image/webp','image/gif'])
ON CONFLICT(id) DO NOTHING;
DROP POLICY IF EXISTS canto_masters_admin_read ON storage.objects;
CREATE POLICY canto_masters_admin_read ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='canto-masters' AND sa_admin.is_admin());
DROP POLICY IF EXISTS canto_masters_admin_upload ON storage.objects;
CREATE POLICY canto_masters_admin_upload ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='canto-masters' AND split_part(name,'/',1)=auth.uid()::text AND sa_admin.is_admin());
DROP POLICY IF EXISTS canto_masters_admin_delete ON storage.objects;
CREATE POLICY canto_masters_admin_delete ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='canto-masters' AND split_part(name,'/',1)=auth.uid()::text AND sa_admin.is_admin());
