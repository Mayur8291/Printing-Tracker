BEGIN;
-- Retries count consecutive failures, not the total number of successful
-- checkpoints in a long import. Invalid captured data becomes a visible
-- terminal result; ambiguous commits/serialization failures remain replayable.
DO $f$ DECLARE d text;old_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.squad_airtable_work(uuid,uuid,text,jsonb)'::regprocedure);
 old_:='delay_ integer:=0;classes_ bigint[];';
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Airtable worker declaration changed';END IF;
 d:=replace(d,old_,old_||'progressed_ boolean:=false;sqlstate_ text;');
 old_:='PERFORM sa_domain.airtable_capture_page(t.id,p_input);';
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Airtable capture checkpoint changed';END IF;
 d:=replace(d,old_,$s$progressed_:=NOT EXISTS(SELECT FROM sa_domain.airtable_pages WHERE transfer_id=t.id AND resource=p_input->>'resource' AND offset_token=coalesce(p_input->>'offset',''));
   PERFORM sa_domain.airtable_capture_page(t.id,p_input);$s$);
 old_:=$s$UPDATE sa_domain.airtable_assets SET state=v->>'status',manifest=v->'manifest',error_code=v->>'error_code' WHERE id=a.id;$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Airtable media checkpoint changed';END IF;
 d:=replace(d,old_,old_||'progressed_:=true;');
 old_:='done_:=sa_domain.airtable_validate_batch(t.id);';
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Airtable validation checkpoint changed';END IF;
 d:=replace(d,old_,old_||'progressed_:=true;');
 old_:='done_:=sa_domain.airtable_apply_batch(t.id);';
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Airtable apply checkpoint changed';END IF;
 d:=replace(d,old_,old_||'progressed_:=true;');
 old_:=$s$ EXCEPTION WHEN insufficient_privilege OR invalid_authorization_specification OR object_not_in_prerequisite_state THEN$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Airtable exception boundary changed';END IF;
 d:=replace(d,old_,$s$ EXCEPTION WHEN data_exception OR integrity_constraint_violation OR program_limit_exceeded THEN
  IF p_action NOT IN('capture','media','validate','apply') THEN RAISE;END IF;
  GET STACKED DIAGNOSTICS sqlstate_=RETURNED_SQLSTATE;
  code_:=CASE WHEN p_action='apply' THEN 'AIRTABLE_APPLY_CONFLICT'
   WHEN p_action='media' THEN CASE WHEN sqlstate_ LIKE '54%' THEN 'AIRTABLE_MEDIA_LIMIT' ELSE 'AIRTABLE_INVALID_MEDIA' END
   WHEN sqlstate_ LIKE '54%' THEN 'AIRTABLE_RESPONSE_LIMIT'
   WHEN sqlstate_='23505' AND p_action='capture' THEN 'AIRTABLE_CAPTURE_CONFLICT'
   WHEN sqlstate_='23503' THEN 'AIRTABLE_INVALID_REFERENCE' ELSE 'AIRTABLE_INVALID_RECORD' END;
  state_:='dead';
  UPDATE sa_domain.transfers SET result=result||jsonb_build_object('failure',jsonb_build_object('code',code_,'sqlstate',sqlstate_,'action',p_action)) WHERE id=t.id;
 WHEN insufficient_privilege OR invalid_authorization_specification OR object_not_in_prerequisite_state THEN$s$);
 old_:=$s$'partial',state='failed' AND EXISTS(SELECT FROM sa_domain.airtable_rows WHERE transfer_id=t.id AND state IN('scalar','applied'))$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Airtable partial-result contract changed';END IF;
 d:=replace(d,old_,$s$'partial',(state_='dead' OR state='failed') AND(EXISTS(SELECT FROM sa_domain.airtable_rows WHERE transfer_id=t.id AND state IN('scalar','applied')) OR EXISTS(SELECT FROM sa_domain.airtable_retirements WHERE transfer_id=t.id AND applied))$s$);
 old_:=$s$ IF state_='ready' THEN RETURN coalesce(r,'{}')||jsonb_build_object('id',j.id,'state','ready');END IF;$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Airtable continuation contract changed';END IF;
 d:=replace(d,old_,$s$ IF progressed_ AND state_ IN('ready','done') THEN
  UPDATE sa_domain.outbox SET attempts=1,last_error_code=NULL WHERE id=j.id;
 END IF;
$s$||old_);
 EXECUTE d;

 -- Existing claim recovery already fails transfers when an abandoned fifth
 -- lease dies. Finish its observable lifecycle and partial-progress metadata
 -- before the existing statistics-repair hook runs, without changing dispatch.
 d:=pg_get_functiondef('sa_domain.squad_job_claim(integer)'::regprocedure);
 old_:=$s$ PERFORM sa_domain.airtable_queue_statistics(t.id) FROM sa_domain.transfers t$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Airtable abandoned-lease hook changed';END IF;
 d:=replace(d,old_,$s$ UPDATE sa_domain.transfers t SET completed_at=now(),revision=revision+1,
 result=result||jsonb_build_object('partial',EXISTS(SELECT FROM sa_domain.airtable_rows r WHERE r.transfer_id=t.id AND r.state IN('scalar','applied')) OR EXISTS(SELECT FROM sa_domain.airtable_retirements r WHERE r.transfer_id=t.id AND r.applied))
 WHERE t.kind='airtable' AND t.generation=g AND t.state='failed' AND t.completed_at IS NULL
 AND EXISTS(SELECT FROM sa_domain.outbox j WHERE j.id=t.job_id AND j.status='dead');
$s$||old_);
 EXECUTE d;
END $f$;
NOTIFY pgrst,'reload schema';
COMMIT;
