-- 140: Supabase's safeupdate guard requires an explicit UPDATE predicate,
-- including singleton rows. Preserve current authorization, versions, rehearsal
-- fences and provider gates; change only these six singleton write predicates.
BEGIN;
DO $migration$
DECLARE target_ record;definition_ text;updates_ text[];statement_ text;
BEGIN
 FOR target_ IN SELECT * FROM (VALUES
  ('sa_domain.v1_weekly_tailor_schedule_configure(boolean,text,uuid)','weekly_tailor_schedule',1),
  ('sa_domain.squad_weekly_tailor_heartbeat(integer)','weekly_tailor_schedule',2),
  ('sa_domain.v1_warehouse_schedule_configure(boolean,text,uuid)','warehouse_schedule',1),
  ('sa_domain.squad_warehouse_heartbeat()','warehouse_schedule',2)
 ) AS targets(signature_,table_,expected_) LOOP
  definition_:=pg_get_functiondef(target_.signature_::regprocedure);
  SELECT array_agg(m[1]) INTO updates_
  FROM regexp_matches(definition_,'(UPDATE sa_domain\.'||target_.table_||' SET [^;]+updated_at=now\(\);)','g') AS m;
  IF cardinality(updates_) IS DISTINCT FROM target_.expected_ THEN
   RAISE EXCEPTION 'Expected singleton write anchors changed: %',target_.signature_;
  END IF;
  FOREACH statement_ IN ARRAY updates_ LOOP
   IF statement_ ~* '\mWHERE\M' THEN RAISE EXCEPTION 'Unexpected existing singleton predicate';END IF;
   definition_:=replace(definition_,statement_,left(statement_,length(statement_)-1)||' WHERE singleton;');
  END LOOP;
  EXECUTE definition_;
 END LOOP;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
