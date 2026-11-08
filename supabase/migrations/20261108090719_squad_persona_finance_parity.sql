BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_executor;
-- Flutter develop 5d55d946 global_constants.dart:136–148 authorizes the
-- production coordinator's selling values. Payment visibility at230–235 is
-- separate and excludes PC. Existing row/work scope is unchanged.
CREATE FUNCTION sa_domain.selling_price_visible(p_role integer) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT coalesce(p_role IN(0,1,2,3,10),false)
$f$;
ALTER FUNCTION sa_domain.selling_price_visible(integer) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.selling_price_visible(integer) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.selling_price_visible(integer) TO sa_executor,sa_guard;
DO $f$ DECLARE d text;signature_ text;BEGIN
 FOREACH signature_ IN ARRAY ARRAY['sa_domain.order_projection(jsonb,sa_domain.actor,text)','sa_domain.item_projection(jsonb,sa_domain.actor,text)','sa_domain.item_children(bigint,text,text,integer)','sa_domain.v1_dashboard(jsonb)'] LOOP
  d:=pg_get_functiondef(signature_::regprocedure);
  IF position('a.role_id IN(0,1,3,10)' IN d)=0 THEN RAISE EXCEPTION 'Selling projection contract changed: %',signature_;END IF;
  d:=replace(d,'a.role_id IN(0,1,3,10)','sa_domain.selling_price_visible(a.role_id)');
  IF signature_='sa_domain.order_projection(jsonb,sa_domain.actor,text)' THEN
   IF position($s$,
  'payment_status',o->'payment_status','paid_amount',o->>'paid_amount') ELSE '{}' END$s$ IN d)=0 THEN RAISE EXCEPTION 'Payment projection contract changed';END IF;
   d:=replace(d,$s$,
  'payment_status',o->'payment_status','paid_amount',o->>'paid_amount') ELSE '{}' END$s$,$s$) ELSE '{}' END
 || CASE WHEN a.role_id IN(0,1,3,10) THEN jsonb_build_object('payment_status',o->'payment_status','paid_amount',o->>'paid_amount') ELSE '{}' END$s$);
  END IF;
  EXECUTE d;
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
