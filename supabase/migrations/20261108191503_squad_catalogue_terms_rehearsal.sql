BEGIN;
-- Extend only the existing staging exact-job capability. Ordinary queue claims,
-- production rendering, mail delivery and client permissions are unchanged.
ALTER TABLE sa_domain.document_rehearsal_receipts
 ADD COLUMN attachment_id bigint,
 ADD COLUMN attachment_xmin text,
 ADD COLUMN attachment_row_sha256 text,
 ADD CONSTRAINT document_rehearsal_attachment_receipt CHECK(
  (attachment_id IS NULL AND attachment_xmin IS NULL AND attachment_row_sha256 IS NULL)
  OR (attachment_id IS NOT NULL AND attachment_xmin IS NOT NULL AND attachment_row_sha256 IS NOT NULL AND attachment_row_sha256~'^[a-f0-9]{64}$'));

GRANT SELECT ON sa_domain.document_attachments TO sa_worker;
CREATE POLICY document_attachment_exact_rehearsal ON sa_domain.document_attachments
 FOR SELECT TO sa_worker USING(EXISTS(
  SELECT 1 FROM sa_domain.document_rehearsals c JOIN sa_domain.documents d ON d.id=c.document_id
  WHERE c.actor_id=document_attachments.actor_id AND c.generation=document_attachments.generation
   AND c.expires_at>clock_timestamp() AND d.actor_id=c.actor_id AND d.generation=c.generation
   AND d.kind='catalogue' AND d.request->'terms_reference'->>'resource'='document_attachments'
   AND d.request->'terms_reference'->>'record_id'=document_attachments.id::text
   AND d.request->'terms_reference'->>'field'='terms'));

DO $f$ DECLARE d text;anchor_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.document_rehearsal_register()'::regprocedure);
 anchor_:=$s$d.kind NOT IN('delivery_challan','tailor_weekly')$s$;
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing exact document kind registration anchor';END IF;
 d:=replace(d,anchor_,$s$d.kind NOT IN('delivery_challan','tailor_weekly','catalogue')$s$);
 anchor_:=' NEW.request_hash:=';
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing exact document request hash anchor';END IF;
 d:=replace(d,anchor_,$s$
 -- This acceptance capability is intentionally narrower than ordinary catalogue
 -- functionality: one selected class and one fresh actor-owned terms upload.
 IF d.kind='catalogue' THEN
  IF d.request->'terms_reference'->>'resource' IS DISTINCT FROM 'document_attachments'
   OR d.request->'terms_reference'->>'field' IS DISTINCT FROM 'terms'
   OR coalesce(d.request->'terms_reference'->>'pointer','')<>''
   OR jsonb_typeof(d.request->'selection'->'class_ids') IS DISTINCT FROM 'array'
   OR jsonb_array_length(d.request->'selection'->'class_ids')<>1
   OR (d.request->'selection')-'class_ids'<>'{}'::jsonb THEN
   RAISE EXCEPTION 'Catalogue rehearsal requires one class and owned terms' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM sa_domain.document_attachments a WHERE a.id::text=d.request->'terms_reference'->>'record_id'
   AND a.actor_id=d.actor_id AND a.generation=d.generation AND a.purpose='catalogue_terms'
   AND a.state='ready' AND a.sha256 IS NOT NULL AND a.claimed_at IS NULL AND a.expires_at>clock_timestamp()
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fresh owned terms unavailable' USING ERRCODE='42501';END IF;
  IF EXISTS(SELECT FROM sa_domain.documents other WHERE other.id<>d.id
   AND other.request->'terms_reference'->>'resource'='document_attachments'
   AND other.request->'terms_reference'->>'record_id'=d.request->'terms_reference'->>'record_id') THEN
   RAISE EXCEPTION 'Terms are referenced by another document' USING ERRCODE='42501';END IF;
 END IF;
$s$||anchor_);EXECUTE d;

 d:=pg_get_functiondef('sa_domain.document_rehearsal_seed_receipt()'::regprocedure);
 anchor_:=' RETURN NEW;';
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing receipt seed anchor';END IF;
 d:=replace(d,anchor_,$s$
 UPDATE sa_domain.document_rehearsal_receipts proof SET attachment_id=a.id,
  attachment_xmin=a.xmin::text,attachment_row_sha256=encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')
 FROM sa_domain.documents d JOIN sa_domain.document_attachments a
  ON a.id::text=d.request->'terms_reference'->>'record_id'
 WHERE proof.job_id=NEW.job_id AND d.id=NEW.document_id AND d.kind='catalogue'
  AND a.actor_id=d.actor_id AND a.generation=d.generation AND a.state='ready';
$s$||anchor_);EXECUTE d;

 d:=pg_get_functiondef('sa_domain.document_rehearsal_scope(uuid)'::regprocedure);
 anchor_:=$s$d.kind NOT IN('delivery_challan','tailor_weekly')$s$;
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing exact document scope kind anchor';END IF;
 d:=replace(d,anchor_,$s$d.kind NOT IN('delivery_challan','tailor_weekly','catalogue')$s$);
 anchor_:=' RETURN c;';
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing exact document scope return anchor';END IF;
 d:=replace(d,anchor_,$s$
 IF d.kind='catalogue' AND NOT EXISTS(
  SELECT 1 FROM sa_domain.document_rehearsal_receipts proof JOIN sa_domain.document_attachments a ON a.id=proof.attachment_id
  WHERE proof.job_id=c.job_id AND proof.document_id=d.id AND a.actor_id=d.actor_id AND a.generation=d.generation
   AND a.id::text=d.request->'terms_reference'->>'record_id' AND a.purpose='catalogue_terms' AND a.state='ready'
   AND proof.attachment_xmin=a.xmin::text
   AND proof.attachment_row_sha256=encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')) THEN
  RAISE EXCEPTION 'Terms changed outside the exact document worker' USING ERRCODE='42501';
 END IF;
 IF d.kind='catalogue' AND EXISTS(SELECT FROM sa_domain.documents other WHERE other.id<>d.id
  AND other.request->'terms_reference'->>'resource'='document_attachments'
  AND other.request->'terms_reference'->>'record_id'=d.request->'terms_reference'->>'record_id') THEN
  RAISE EXCEPTION 'Terms acquired another document reference' USING ERRCODE='42501';
 END IF;
$s$||anchor_);EXECUTE d;

 d:=pg_get_functiondef('sa_domain.document_rehearsal_record(uuid,uuid,text)'::regprocedure);
 anchor_:=$s$ IF NOT FOUND THEN RAISE EXCEPTION 'Document rehearsal receipt unavailable' USING ERRCODE='42501';END IF;$s$;
 IF strpos(d,anchor_)=0 THEN RAISE EXCEPTION 'Missing exact receipt record anchor';END IF;
 d:=replace(d,anchor_,anchor_||$s$
 IF EXISTS(SELECT FROM sa_domain.document_rehearsals c JOIN sa_domain.documents d ON d.id=c.document_id WHERE c.job_id=p_id AND d.kind='catalogue') THEN
  UPDATE sa_domain.document_rehearsal_receipts proof SET attachment_xmin=a.xmin::text,
   attachment_row_sha256=encode(sha256(convert_to(to_jsonb(a)::text,'UTF8')),'hex')
  FROM sa_domain.document_rehearsals c JOIN sa_domain.documents d ON d.id=c.document_id
  JOIN sa_domain.document_attachments a ON a.id::text=d.request->'terms_reference'->>'record_id'
  WHERE proof.job_id=p_id AND c.job_id=p_id AND proof.attachment_id=a.id
   AND a.actor_id=d.actor_id AND a.generation=d.generation AND a.state='ready'
   AND (d.snapshot IS NULL OR (a.claimed_at IS NOT NULL AND jsonb_array_length(d.snapshot->'rows') BETWEEN 1 AND 100
    AND d.snapshot->'terms_attachment'->>'path'='sha256/'||left(a.sha256,2)||'/'||a.sha256
    AND d.parts='[]'::jsonb AND d.next_part=0));
  IF NOT FOUND THEN RAISE EXCEPTION 'Terms capture exceeds exact rehearsal scope' USING ERRCODE='42501';END IF;
 END IF;
$s$);EXECUTE d;
END $f$;
NOTIFY pgrst,'reload schema';
COMMIT;
