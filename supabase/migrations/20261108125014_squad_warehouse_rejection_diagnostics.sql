BEGIN;
-- Preserve only bounded provider numeric diagnostics. Rejection remains an
-- attempted, blocked external outcome; it never proves customer absence or
-- grants permission to resend an uncertain create/edit operation.
DO $patch$
DECLARE definition_ text; old_ text; replacement_ text;
BEGIN
 definition_:=pg_get_functiondef('sa_domain.warehouse_rehearsal_result(jsonb,text,jsonb)'::regprocedure);
 old_:=$old$IF p_result?'proof' THEN PERFORM sa_domain.check_fields(proof_,ARRAY['mutation_attempted']);
   IF proof_->'mutation_attempted' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Invalid negative mutation proof' USING ERRCODE='22023';END IF;
  END IF;$old$;
 replacement_:=$new$IF p_result?'proof' THEN
   IF proof_->>'source'='provider_rejection' THEN
    PERFORM sa_domain.check_fields(proof_,ARRAY['source','http_status','error_codes']);
    IF code_<>'REJECTED' OR p_result->>'error_code' IS DISTINCT FROM 'PROVIDER_REJECTED'
     OR jsonb_typeof(proof_->'http_status') IS DISTINCT FROM 'number'
     OR proof_->>'http_status' !~ '^[1-5][0-9]{2}$'
     OR jsonb_typeof(proof_->'error_codes') IS DISTINCT FROM 'array'
     OR jsonb_array_length(proof_->'error_codes')>10 THEN
     RAISE EXCEPTION 'Invalid numeric provider rejection proof' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(proof_->'error_codes') x
       WHERE jsonb_typeof(x) IS DISTINCT FROM 'number' OR x#>>'{}' !~ '^(0|[1-9][0-9]{0,5})$')
     OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(proof_->'error_codes') x)<>jsonb_array_length(proof_->'error_codes') THEN
     RAISE EXCEPTION 'Invalid numeric provider rejection codes' USING ERRCODE='22023';
    END IF;
   ELSE
    PERFORM sa_domain.check_fields(proof_,ARRAY['mutation_attempted']);
    IF proof_->'mutation_attempted' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Invalid negative mutation proof' USING ERRCODE='22023';END IF;
   END IF;
  END IF;$new$;
 IF position(old_ IN definition_)=0 THEN RAISE EXCEPTION 'Warehouse rehearsal error-proof contract changed';END IF;
 EXECUTE replace(definition_,old_,replacement_);
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
