BEGIN;
-- Resolve authorized candidate IDs before expensive point-check RLS projection.
-- Existing table policies/grants stay unchanged, including the final executor
-- checks. sa_guard already has narrow history reads for work/earnings reports.
CREATE INDEX squad_assignment_item_page ON sa_snapshot_20261019.sa_job_sheet_assign_quantities(item_id,id DESC);
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
CREATE FUNCTION sa_domain.jobsheet_page_ids(p_item_id bigint,p_tailor_id bigint,p_after bigint,p_limit integer)
RETURNS SETOF bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2,4,7,8]);n integer:=sa_domain.page_limit(p_limit);
BEGIN
 -- Every joined parent retains its own authorized-item membership. Legacy
 -- malformed cross-factory parent links must not leak or consume page slots.
 RETURN QUERY WITH allowed AS MATERIALIZED(SELECT id FROM sa_domain.scope_item_ids() s(id))
 SELECT q.id FROM sa_snapshot_20261019.sa_job_sheet_assign_quantities q
 JOIN sa_snapshot_20261019.sa_item_tailors it ON it.id=q.item_tailor_id
 JOIN sa_snapshot_20261019.sa_job_sheet_assign_dates d ON d.id=q.job_sheet_assign_date_id
 WHERE q.id<p_after AND (p_item_id IS NULL OR q.item_id=p_item_id)
  AND (p_tailor_id IS NULL OR it.tailor_id=p_tailor_id)
  AND q.item_id IN(SELECT id FROM allowed)
  AND it.item_id IN(SELECT id FROM allowed)
  AND d.item_id IN(SELECT id FROM allowed)
 ORDER BY q.id DESC LIMIT n+1;
END $f$;
ALTER FUNCTION sa_domain.jobsheet_page_ids(bigint,bigint,bigint,integer) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.jobsheet_page_ids(bigint,bigint,bigint,integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.jobsheet_page_ids(bigint,bigint,bigint,integer) TO sa_executor;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;

CREATE OR REPLACE FUNCTION sa_domain.v1_jobsheets_list(p_item_id bigint DEFAULT NULL,p_tailor_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[2,4,7,8]);n int:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('jobsheets',jsonb_build_object('item',p_item_id,'tailor',p_tailor_id));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);r jsonb;
BEGIN
 WITH scan AS MATERIALIZED(SELECT q.id,q.item_id,q.quantity_id,q.item_tailor_id,q.job_sheet_assign_date_id,q.assigned_quantity,q.completed_quantity,it.tailor_id,d.assign_at
  FROM sa_domain.jobsheet_page_ids(p_item_id,p_tailor_id,after_,p_limit) authorized(id)
  JOIN sa_snapshot_20261019.sa_job_sheet_assign_quantities q ON q.id=authorized.id JOIN sa_snapshot_20261019.sa_item_tailors it ON it.id=q.item_tailor_id
  JOIN sa_snapshot_20261019.sa_job_sheet_assign_dates d ON d.id=q.job_sheet_assign_date_id
  WHERE q.id<after_ AND (p_item_id IS NULL OR q.item_id=p_item_id) AND (p_tailor_id IS NULL OR it.tailor_id=p_tailor_id) ORDER BY q.id DESC LIMIT n+1),
 page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'item_id',item_id::text,'quantity_id',quantity_id::text,'item_tailor_id',item_tailor_id::text,
 'tailor_id',tailor_id::text,'assignment_id',job_sheet_assign_date_id::text,'assigned',assigned_quantity,'inspected',completed_quantity,'picked',completed_quantity,'occurred_at',assign_at AT TIME ZONE 'UTC') ORDER BY id DESC),'[]'),
 'next_cursor',CASE WHEN (SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO r FROM page;RETURN r;
END $f$;
NOTIFY pgrst,'reload schema';
COMMIT;
