BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
-- Read-only scope guard avoids broad executor RLS enumeration inside the price
-- comparison. The internal caller must still own the order; no client grant.
CREATE OR REPLACE FUNCTION sa_domain.amendment_prices_changed(p_before jsonb,p_order_id bigint) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF NOT sa_domain.can_order(p_order_id) THEN RAISE EXCEPTION 'Order unavailable' USING ERRCODE='42501';END IF;
 RETURN(SELECT EXISTS(SELECT FROM sa_snapshot_20261019.sa_items i WHERE i.order_id=p_order_id
 AND EXISTS(SELECT FROM jsonb_array_elements(p_before->'items') old WHERE(old->>'item_type')::integer=i.item_type
 AND(old->>'product_id')::bigint IS NOT DISTINCT FROM i.product_id AND(old->>'rmp_class_id')::bigint IS NOT DISTINCT FROM i.rmp_class_id
 AND(old->>'rmp_brand_id')::bigint IS NOT DISTINCT FROM i.rmp_brand_id AND(old->>'rmp_category_id')::bigint IS NOT DISTINCT FROM i.rmp_category_id)
 AND NOT EXISTS(SELECT FROM jsonb_array_elements(p_before->'items') old WHERE(old->>'item_type')::integer=i.item_type
 AND(old->>'product_id')::bigint IS NOT DISTINCT FROM i.product_id AND(old->>'rmp_class_id')::bigint IS NOT DISTINCT FROM i.rmp_class_id
 AND(old->>'rmp_brand_id')::bigint IS NOT DISTINCT FROM i.rmp_brand_id AND(old->>'rmp_category_id')::bigint IS NOT DISTINCT FROM i.rmp_category_id
 AND(old->>'per_piece_amount')::numeric IS NOT DISTINCT FROM i.per_piece_amount)));
END $f$;
ALTER FUNCTION sa_domain.amendment_prices_changed(jsonb,bigint) OWNER TO sa_guard;
GRANT EXECUTE ON FUNCTION sa_domain.amendment_prices_changed(jsonb,bigint) TO sa_executor;
-- A delayed push cannot navigate to a reused imported notification ID.
DROP FUNCTION canto_api.v1_notifications_list(bigint,text,integer);
DROP FUNCTION sa_domain.v1_notifications_list(bigint,text,integer);
CREATE OR REPLACE FUNCTION sa_domain.v1_notifications_list(p_id bigint DEFAULT NULL::bigint, p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_generation bigint DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE a sa_domain.actor:=sa_domain.actor();n integer:=sa_domain.page_limit(p_limit);ctx jsonb:=sa_domain.page_context('notifications',jsonb_build_object('id',p_id));after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);result_ jsonb;
BEGIN
 IF p_generation IS NOT NULL AND p_generation<>(ctx->>'generation')::bigint THEN RAISE EXCEPTION 'Notification predates source refresh' USING ERRCODE='40001';END IF;
 WITH scan AS MATERIALIZED(SELECT * FROM sa_snapshot_20261019.sa_notifications WHERE recipient_id=a.user_id AND id<after_ AND(p_id IS NULL OR id=p_id) ORDER BY id DESC LIMIT n+1),
 page AS MATERIALIZED(SELECT * FROM scan ORDER BY id DESC LIMIT n),
 projected AS(SELECT s.id,s.created_at,CASE WHEN j.id IS NULL THEN s.status WHEN j.status='done' THEN 1 WHEN j.status='dead' THEN 2 ELSE 0 END status,j.result->>'push_state' push_state,coalesce(r.topic,t.topic,'legacy.activity') topic,
 CASE WHEN r.job_id IS NOT NULL THEN NOT r.removed AND r.recipient_role=a.role_id AND sa_domain.notification_can_open(r.kind,r.entity_id)
 ELSE s.order_id IS NOT NULL AND sa_domain.can_order(s.order_id) END can_open,
 CASE WHEN r.job_id IS NOT NULL THEN r.kind ELSE 'order' END kind,coalesce(r.entity_id,s.order_id) entity_id
 FROM page s LEFT JOIN sa_domain.notification_records r ON r.notification_id=s.id AND r.generation=(ctx->>'generation')::bigint
 LEFT JOIN sa_domain.outbox j ON j.id=r.job_id
 LEFT JOIN sa_domain.notification_rules t ON t.legacy_type=s.notification_type)
 SELECT jsonb_build_object('generation',ctx->>'generation','data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'title',sa_domain.notification_title(topic),
 'body',CASE WHEN can_open THEN 'Open the record to view its current details.' ELSE 'This activity is no longer available to your account.' END,
 'topic',topic,'created_at',created_at AT TIME ZONE 'UTC','delivery_status',status,'push_state',push_state,
 'target',CASE WHEN can_open THEN jsonb_build_object('kind',kind,'id',entity_id::text) END) ORDER BY id DESC),'[]'),
 'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),ctx) END) INTO result_ FROM projected;
 RETURN result_;
END $function$
;
ALTER FUNCTION sa_domain.v1_notifications_list(bigint,text,integer,bigint) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.v1_notifications_list(bigint,text,integer,bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.v1_notifications_list(bigint,text,integer,bigint) TO sa_app;
CREATE FUNCTION canto_api.v1_notifications_list(p_id bigint DEFAULT NULL,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30,p_generation bigint DEFAULT NULL) RETURNS jsonb LANGUAGE sql SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_notifications_list(p_id,p_cursor,p_limit,p_generation) $f$;
REVOKE ALL ON FUNCTION canto_api.v1_notifications_list(bigint,text,integer,bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION canto_api.v1_notifications_list(bigint,text,integer,bigint) TO sa_app;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
