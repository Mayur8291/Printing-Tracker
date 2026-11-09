BEGIN;
-- Pinned customer_signup accepts a single name, an optional GST number and a
-- ten-digit phone. Keep the guest profile vocabulary/approval/identity fences.
DO $patch$ DECLARE d text;needle_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.validate_registration(jsonb)'::regprocedure);
 needle_:=$n$IF k<>'gst_no' AND$n$;
 IF strpos(d,needle_)=0 THEN RAISE EXCEPTION 'Expected registration required-field guard missing';END IF;
 d:=replace(d,needle_,$n$IF k NOT IN('gst_no','last_name') AND$n$);
 needle_:='PERFORM sa_domain.validate_person_fields(profile_);';
 IF strpos(d,needle_)=0 THEN RAISE EXCEPTION 'Expected registration field validation missing';END IF;
 d:=replace(d,needle_,needle_||$n$
 IF jsonb_typeof(p_fields->'last_name') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Last name must be text; it may be empty' USING ERRCODE='22023';END IF;
 IF p_fields->>'phone' !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'Enter a ten-digit phone number' USING ERRCODE='22023';END IF;
 $n$);EXECUTE d;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
