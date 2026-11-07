BEGIN;
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.relationship_options(text,bigint,text,bigint,integer)'::regprocedure);
 d:=replace(d,'c.zone_id IN(SELECT id FROM sa_snapshot_20261019.sa_zones WHERE is_deleted IS NOT TRUE)',
 'c.zone_id IN(SELECT active_zone.id FROM sa_snapshot_20261019.sa_zones active_zone WHERE active_zone.is_deleted IS NOT TRUE)');
 EXECUTE d;
END $f$;
NOTIFY pgrst,'reload schema';
COMMIT;
