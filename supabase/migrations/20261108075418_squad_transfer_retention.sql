BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_worker;
CREATE TABLE sa_domain.transfer_cleanup(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),path text UNIQUE NOT NULL,
 upload_id uuid REFERENCES sa_domain.transfer_uploads,transfer_id uuid REFERENCES sa_domain.transfers,
 created_at timestamptz NOT NULL DEFAULT now(),claimed_at timestamptz,cleaned_at timestamptz,
 CHECK((upload_id IS NULL)<>(transfer_id IS NULL)),
 CHECK(path~'^(inputs/[a-f0-9-]{36}/file[.]csv|g[0-9]+/[a-f0-9-]{36}/(export|part-[0-9]{4})[.]csv)$')
);
CREATE INDEX squad_transfer_cleanup_pending ON sa_domain.transfer_cleanup(created_at,id) WHERE cleaned_at IS NULL;
CREATE UNIQUE INDEX squad_transfer_cleanup_upload ON sa_domain.transfer_cleanup(upload_id) WHERE upload_id IS NOT NULL;
CREATE INDEX squad_transfer_upload_expiry ON sa_domain.transfer_uploads(expires_at,id) WHERE cleaned_at IS NULL;
CREATE INDEX squad_transfer_expiry ON sa_domain.transfers(expires_at,id);
ALTER TABLE sa_domain.transfer_cleanup ENABLE ROW LEVEL SECURITY;
ALTER TABLE sa_domain.transfer_cleanup FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON sa_domain.transfer_cleanup TO sa_worker;
CREATE POLICY transfer_cleanup_worker ON sa_domain.transfer_cleanup TO sa_worker USING(true) WITH CHECK(true);

CREATE FUNCTION sa_domain.squad_transfer_cleanup(p_ack uuid[] DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ids_ uuid[];
BEGIN
 PERFORM sa_domain.assert_service_worker();
 IF p_limit NOT BETWEEN 1 AND 25 OR p_limit IS NULL OR coalesce(cardinality(p_ack),0)>25 THEN RAISE EXCEPTION 'Cleanup batch must be 1..25' USING ERRCODE='22023';END IF;
 IF NOT pg_try_advisory_xact_lock_shared(20261107,1) THEN RETURN jsonb_build_object('objects','[]'::jsonb,'paused',true);END IF;
 UPDATE sa_domain.transfer_cleanup SET cleaned_at=now() WHERE id=ANY(p_ack) AND claimed_at IS NOT NULL AND cleaned_at IS NULL;
 UPDATE sa_domain.transfer_uploads u SET cleaned_at=q.cleaned_at FROM sa_domain.transfer_cleanup q WHERE q.upload_id=u.id AND q.cleaned_at IS NOT NULL AND u.cleaned_at IS NULL;
 IF coalesce(cardinality(p_ack),0)>0 THEN RETURN jsonb_build_object('objects','[]'::jsonb);END IF;
 -- Expiration closes both the public lifecycle and any outstanding lease before
 -- files become eligible for deletion. Imports retain their applied-row report.
 WITH due AS(SELECT id FROM sa_domain.transfers WHERE expires_at<=now() AND state<>'expired' ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)
 UPDATE sa_domain.transfers t SET state='expired',revision=revision+1,completed_at=coalesce(completed_at,now()),error_code=coalesce(error_code,'TRANSFER_EXPIRED') FROM due WHERE t.id=due.id;
 UPDATE sa_domain.outbox j SET status='dead',last_error_code='TRANSFER_EXPIRED',lease_token=NULL,lease_until=NULL,completed_at=now(),revision=revision+1
 WHERE j.status IN('pending','leased') AND EXISTS(SELECT FROM sa_domain.transfers t WHERE t.job_id=j.id AND t.state='expired');
 UPDATE sa_domain.job_attempts a SET state='failed',error_code='TRANSFER_EXPIRED',finished_at=now()
 WHERE a.state='leased' AND EXISTS(SELECT FROM sa_domain.outbox j WHERE j.id=a.job_id AND j.status='dead' AND j.last_error_code='TRANSFER_EXPIRED');
 WITH due AS(SELECT id FROM sa_domain.transfer_uploads WHERE expires_at<=now() AND state<>'expired' ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)
 UPDATE sa_domain.transfer_uploads u SET state='expired' FROM due WHERE u.id=due.id;
 INSERT INTO sa_domain.transfer_cleanup(path,upload_id)
 SELECT 'inputs/'||u.id::text||'/file.csv',u.id FROM sa_domain.transfer_uploads u
 -- Supabase signed uploads last two hours. A one-hour reservation can be
 -- re-signed until it expires, so wait three hours plus in-flight tolerance.
 WHERE u.state='expired' AND u.created_at<now()-interval '3 hours 15 minutes' AND u.cleaned_at IS NULL AND NOT EXISTS(SELECT FROM sa_domain.transfer_cleanup q WHERE q.upload_id=u.id)
 ORDER BY u.expires_at LIMIT 100 ON CONFLICT(path) DO NOTHING;
 -- Enumerate bounded deterministic output paths, including a file uploaded just
 -- before a lost checkpoint response. No bucket listing or caller paths needed.
 INSERT INTO sa_domain.transfer_cleanup(path,transfer_id)
 SELECT path_,id FROM(
  SELECT t.id,t.expires_at,'g'||t.generation::text||'/'||t.id::text||'/'||CASE WHEN part=-1 THEN 'export' ELSE 'part-'||lpad(part::text,4,'0') END||'.csv' AS path_
  FROM sa_domain.transfers t CROSS JOIN LATERAL generate_series(-1,least(199,greatest(0,ceil(t.total_rows::numeric/100)::integer-1))) part
  WHERE t.state='expired' AND t.direction='export' AND t.expires_at<now()-interval '5 minutes'
 ) x WHERE NOT EXISTS(SELECT FROM sa_domain.transfer_cleanup q WHERE q.path=x.path_)
 ORDER BY expires_at,id,path_ LIMIT 100 ON CONFLICT(path) DO NOTHING;
 WITH due AS(SELECT r.transfer_id,r.row_number FROM sa_domain.transfer_rows r JOIN sa_domain.transfers t ON t.id=r.transfer_id
  WHERE t.state='expired' AND(r.raw<>'{}' OR r.normalized IS NOT NULL) ORDER BY t.expires_at,r.transfer_id,r.row_number LIMIT 1000 FOR UPDATE OF r SKIP LOCKED)
 UPDATE sa_domain.transfer_rows r SET raw='{}',normalized=NULL FROM due WHERE r.transfer_id=due.transfer_id AND r.row_number=due.row_number;
 WITH chosen AS(SELECT id FROM sa_domain.transfer_cleanup WHERE cleaned_at IS NULL AND(claimed_at IS NULL OR claimed_at<now()-interval '2 minutes') ORDER BY created_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED),
 claimed AS(UPDATE sa_domain.transfer_cleanup q SET claimed_at=now() FROM chosen WHERE q.id=chosen.id RETURNING q.id)
 SELECT array_agg(id) INTO ids_ FROM claimed;
 RETURN jsonb_build_object('objects',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'paths',jsonb_build_array(path)) ORDER BY id) FROM sa_domain.transfer_cleanup WHERE id=ANY(ids_)),'[]'::jsonb));
END $f$;
ALTER FUNCTION sa_domain.squad_transfer_cleanup(uuid[],integer) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.squad_transfer_cleanup(uuid[],integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.squad_transfer_cleanup(uuid[],integer) TO service_role;
CREATE FUNCTION canto_api.squad_transfer_cleanup(p_ack uuid[] DEFAULT NULL,p_limit integer DEFAULT 25) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.squad_transfer_cleanup(p_ack,p_limit) $f$;
REVOKE ALL ON FUNCTION canto_api.squad_transfer_cleanup(uuid[],integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.squad_transfer_cleanup(uuid[],integer) TO service_role;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_worker;
NOTIFY pgrst,'reload schema';
COMMIT;
