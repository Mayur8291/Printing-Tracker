-- Immutable media versions are separate from the faithful legacy snapshot.
CREATE SCHEMA sa_media;
REVOKE ALL ON SCHEMA sa_media FROM PUBLIC,anon,authenticated,sa_app;
CREATE TABLE sa_media.objects (
 sha256 text PRIMARY KEY CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 object_path text UNIQUE NOT NULL, bytes bigint NOT NULL CHECK(bytes>0),
 content_type text NOT NULL, verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sa_media.references (
 resource text NOT NULL, record_id bigint NOT NULL, field text NOT NULL,
 pointer text NOT NULL DEFAULT '', source_value text NOT NULL, source_url text,
 status text NOT NULL CHECK(status IN ('ready','missing','external')),
 sha256 text REFERENCES sa_media.objects(sha256),
 PRIMARY KEY(resource,record_id,field,pointer),
 CHECK((status='ready')=(sha256 IS NOT NULL))
);
CREATE TABLE sa_media.state(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),summary jsonb NOT NULL DEFAULT '{"pending":true}',updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO sa_media.state(singleton) VALUES(true);
ALTER TABLE sa_media.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_media.references ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_media.state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA sa_media FROM PUBLIC,anon,authenticated,sa_app;
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('canto-media','canto-media',false,1073741824);
-- Only the existing live-session administrator guard can read legacy media.
-- Customer-facing access will require its own record ownership policy, not a public bucket.
CREATE POLICY canto_media_admin_read ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='canto-media' AND sa_admin.is_admin());

CREATE FUNCTION canto_api.media_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT sa_admin.is_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE='42501'; END IF;
 RETURN (SELECT jsonb_build_object('summary',s.summary,'updated_at',s.updated_at,
   'exceptions',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM
     (SELECT resource,record_id,field,pointer,status FROM sa_media.references WHERE status<>'ready' ORDER BY resource,record_id,field,pointer LIMIT 100) x)) FROM sa_media.state s WHERE singleton);
END $$;
REVOKE ALL ON FUNCTION canto_api.media_status() FROM PUBLIC,anon,sa_app;
GRANT EXECUTE ON FUNCTION canto_api.media_status() TO authenticated;

CREATE OR REPLACE FUNCTION sa_admin.read_record(p_resource text, p_id bigint, p_expand boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE spec jsonb; result jsonb; v_field text; target text; related jsonb; rel jsonb; values_ jsonb; media_ record; has_override boolean;
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
    has_override:=FOUND;
    IF has_override THEN
      result:=result||jsonb_build_object(v_field,related);
    ELSIF coalesce(result->>v_field,'')<>'' THEN
      SELECT r.status,o.object_path INTO media_ FROM sa_media.references r
        LEFT JOIN sa_media.objects o USING(sha256)
        WHERE r.resource=p_resource AND r.record_id=p_id AND r.field=v_field AND r.pointer=''
          AND r.source_value=result->>v_field;
      -- No fallback to the old server: never render broken or cross-environment URLs.
      result:=result||jsonb_build_object(v_field,CASE WHEN media_.status='ready' THEN 'canto-media://canto-media/'||media_.object_path ELSE NULL END);
      result:=jsonb_set(result,ARRAY['_media_status'],coalesce(result->'_media_status','{}')||jsonb_build_object(v_field,coalesce(media_.status,'pending')));
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

REVOKE ALL ON FUNCTION sa_admin.read_record(text,bigint,boolean) FROM PUBLIC,anon,authenticated,sa_app;
