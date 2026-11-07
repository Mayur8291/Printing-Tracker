BEGIN;
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.metrics_item_ids(bigint,bigint)'::regprocedure);
 d:=replace(d,'i.id IN(SELECT sa_domain.scope_item_ids()) AND i.item_type=0','CASE WHEN a.role_id=0 THEN true ELSE i.id IN(SELECT sa_domain.scope_item_ids()) END AND i.item_type=0');EXECUTE d;
 d:=pg_get_functiondef('sa_domain.v1_tailor_leaderboard(bigint,date,date,text,integer)'::regprocedure);
 d:=replace(d,'SELECT coalesce(array_agg(x),''{}'') INTO items_ FROM sa_domain.scope_item_ids() x;',
 'IF a.role_id<>0 THEN SELECT coalesce(array_agg(x),''{}'') INTO items_ FROM sa_domain.scope_item_ids() x;END IF;');EXECUTE d;
END $f$;
NOTIFY pgrst,'reload schema';
COMMIT;
