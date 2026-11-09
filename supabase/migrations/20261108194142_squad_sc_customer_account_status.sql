BEGIN;
-- Source: Flutter5d55d946 customer_widget.dart128/226 allows SC→Customer
-- enable/disable only. Admin/staff archive/invitation authority is unchanged.
DO $f$ DECLARE definition_ text;needle_ text;guard_ text;BEGIN
 definition_:=pg_get_functiondef('sa_domain.account_user_status(bigint,text,text,text,uuid)'::regprocedure);
 needle_:=$n$IF NOT((ctx->>'admin')::boolean OR(ctx->>'platform')::boolean) THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';END IF;$n$;
 guard_:=$g$IF NOT((ctx->>'admin')::boolean OR(ctx->>'platform')::boolean) THEN
  IF (sa_domain.actor()).role_id<>1 OR p_action IS NULL OR p_action NOT IN('enable','disable')
   OR NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_users WHERE id=p_id AND role=3)
   OR NOT sa_domain.can_manage_person(p_id) THEN
   RAISE EXCEPTION 'Customer account unavailable' USING ERRCODE='42501';END IF;
 END IF;$g$;
 IF strpos(definition_,needle_)=0 THEN RAISE EXCEPTION 'Expected account authorization guard missing';END IF;
 definition_:=replace(definition_,needle_,guard_);
 needle_:='SELECT id,role,disabled,deleted_at INTO u FROM sa_snapshot_20261019.sa_users WHERE id=p_id FOR UPDATE;';
 IF strpos(definition_,needle_)=0 THEN RAISE EXCEPTION 'Expected account row lock missing';END IF;
 -- Re-evaluate the current relationship after the source row and structure fence
 -- are held. A former coordinator cannot act using an earlier page/version.
 definition_:=replace(definition_,needle_,needle_||E'\n '||guard_);
 EXECUTE definition_;
END $f$;
NOTIFY pgrst,'reload schema';
COMMIT;
