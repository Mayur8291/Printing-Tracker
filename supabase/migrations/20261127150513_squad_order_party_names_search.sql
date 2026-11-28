BEGIN;
-- Resolve only display labels for an order the current actor can already read.
-- The helper is private; neither client roles nor arbitrary person IDs can call it.
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
CREATE FUNCTION sa_domain.order_party_labels(p_order_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE result_ jsonb;
BEGIN
 IF NOT coalesce(sa_domain.can_order(p_order_id),false) THEN
  RAISE EXCEPTION 'Order unavailable' USING ERRCODE='P0002';
 END IF;
 SELECT jsonb_build_object(
  'customer_name',coalesce(nullif(btrim(c.name),''),nullif(btrim(concat_ws(' ',c.customer_first_name,c.customer_last_name)),'')),
  'customer_company_name',nullif(btrim(c.customer_company_name),''),
  'customer_role',c.role,
  'customer_dealer_id',o.customer_dealer_id::text,
  'dealer_name',coalesce(nullif(btrim(d.name),''),nullif(btrim(concat_ws(' ',d.customer_first_name,d.customer_last_name)),'')),
  'dealer_company_name',nullif(btrim(d.customer_company_name),''))
 INTO result_ FROM sa_snapshot_20261019.sa_orders o
 LEFT JOIN sa_snapshot_20261019.sa_users c ON c.id=o.customer_id
 LEFT JOIN sa_snapshot_20261019.sa_users d ON d.id=o.customer_dealer_id
 WHERE o.id=p_order_id;
 RETURN coalesce(result_,'{}'::jsonb);
END $f$;
ALTER FUNCTION sa_domain.order_party_labels(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.order_party_labels(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.order_party_labels(bigint) TO sa_executor;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;

-- Preserve the deployed role-specific projections and all existing row filters.
DO $f$
DECLARE d text; needle_ text;
BEGIN
 d:=pg_get_functiondef('sa_domain.order_projection(jsonb,sa_domain.actor,text)'::regprocedure);
 needle_:=' || CASE WHEN a.role_id IN(0,1,2,4,7,8,9,11)';
 IF strpos(d,needle_)=0 OR strpos(d,'order_party_labels')>0 THEN RAISE EXCEPTION 'Unexpected order projection'; END IF;
 d:=replace(d,'IMMUTABLE','STABLE');
 d:=replace(d,needle_,E' || sa_domain.order_party_labels((o->>''id'')::bigint)\n'||needle_);
 EXECUTE d;
 d:=pg_get_functiondef('sa_domain.filtered_orders(jsonb)'::regprocedure);
 needle_:='(o.customer_id IN ( SELECT sa_domain.search_customer_ids((filtered_orders.p_filters ->> ''search''::text)) AS search_customer_ids))';
 IF strpos(d,needle_)=0 THEN RAISE EXCEPTION 'Unexpected order search predicate'; END IF;
 d:=replace(d,needle_,'('||needle_||' OR (o.customer_dealer_id IN (SELECT sa_domain.search_customer_ids(filtered_orders.p_filters ->> ''search''))))');
 EXECUTE d;
END $f$;
NOTIFY pgrst,'reload schema';
COMMIT;
