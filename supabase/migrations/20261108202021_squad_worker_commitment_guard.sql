BEGIN;
-- Pinned order_due_date.dart permits a JobWorker's first reason only, while
-- their order and worker stages are unfinished. PC correction remains available.
-- The original reason is retained across reassignment, as in the source order.
DO $patch$DECLARE d text;needle_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.v1_worker_due_save(bigint,text,text,text,uuid)'::regprocedure);
 needle_:='IF o.due_on IS NULL THEN';
 IF strpos(d,needle_)=0 THEN RAISE EXCEPTION 'Expected worker due guard missing';END IF;
 d:=replace(d,needle_,$n$IF a.role_id=11 AND(o.job_worker_reason IS NOT NULL OR o.worker_status=1) THEN
 RAISE EXCEPTION 'The first job-worker due-date change is already recorded or job work is complete; ask the Production Coordinator to review further changes' USING ERRCODE='55000';END IF;
 IF o.due_on IS NULL THEN$n$);EXECUTE d;
 d:=pg_get_functiondef('sa_domain.order_projection(jsonb,sa_domain.actor,text)'::regprocedure);
 needle_:=$n$'force_completed',o->'is_force_update','version',p_version)$n$;
 IF strpos(d,needle_)=0 THEN RAISE EXCEPTION 'Expected order projection missing';END IF;
 d:=replace(d,needle_,$n$'force_completed',o->'is_force_update','version',p_version)
 ||CASE WHEN a.role_id IN(2,11) THEN jsonb_build_object('worker_due_change_allowed',
 (o->>'status')::integer=0 AND coalesce(o->>'uc_status','')<>'CANCELLED' AND o->>'assigned_to_id' IS NULL AND o->>'assigned_worker_id' IS NOT NULL
 AND(a.role_id=2 OR((o->>'assigned_worker_id')::bigint=a.user_id AND o->>'job_worker_reason' IS NULL AND coalesce((o->>'worker_status')::integer,0)<>1))) ELSE '{}'::jsonb END$n$);EXECUTE d;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
