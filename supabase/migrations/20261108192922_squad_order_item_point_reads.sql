BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
-- Point details must not materialize every order/product visible to the actor.
-- These private readers use the existing canonical actor/parent scope predicate;
-- no client can call them, and no table policy or list authority changes.
CREATE FUNCTION sa_domain.work_item_row(p_id bigint) RETURNS SETOF sa_snapshot_20261019.sa_items
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF NOT sa_domain.can_item(p_id) THEN RETURN;END IF;
 RETURN QUERY SELECT * FROM sa_snapshot_20261019.sa_items WHERE id=p_id;
END $f$;
ALTER FUNCTION sa_domain.work_item_row(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.work_item_row(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.work_item_row(bigint) TO sa_executor;
CREATE FUNCTION sa_domain.work_item_product(p_id bigint) RETURNS SETOF sa_snapshot_20261019.sa_products
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF NOT sa_domain.can_item(p_id) THEN RETURN;END IF;
 RETURN QUERY SELECT p.* FROM sa_snapshot_20261019.sa_products p JOIN sa_snapshot_20261019.sa_items i ON i.product_id=p.id WHERE i.id=p_id;
END $f$;
ALTER FUNCTION sa_domain.work_item_product(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.work_item_product(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.work_item_product(bigint) TO sa_executor;

DO $f$ DECLARE fn_ regprocedure;d text;needle_ text:='SELECT * INTO i FROM sa_snapshot_20261019.sa_items WHERE id=p_id;';BEGIN
 FOREACH fn_ IN ARRAY ARRAY['sa_domain.v1_order_item_get(bigint,text,text,integer)'::regprocedure,'sa_domain.item_children(bigint,text,text,integer)'::regprocedure,'sa_domain.work_detail(bigint,text,text,text,integer)'::regprocedure] LOOP
  d:=pg_get_functiondef(fn_);
  IF (length(d)-length(replace(d,needle_,'')))/length(needle_)<>1 THEN RAISE EXCEPTION 'Point read definition changed: %',fn_;END IF;
  EXECUTE replace(d,needle_,'SELECT * INTO i FROM sa_domain.work_item_row(p_id);');
 END LOOP;
 d:=pg_get_functiondef('sa_domain.v1_order_item_get(bigint,text,text,integer)'::regprocedure);
 needle_:='FROM sa_snapshot_20261019.sa_products p LEFT JOIN LATERAL';
 IF (length(d)-length(replace(d,needle_,'')))/length(needle_)<>1 THEN RAISE EXCEPTION 'Product detail definition changed';END IF;
 EXECUTE replace(d,needle_,'FROM sa_domain.work_item_product(p_id) p LEFT JOIN LATERAL');
END $f$;

-- Child policies remain enforced. Plan only the selected relation instead of
-- nine UNION branches whose unrelated RLS subplans inflate every point read.
DO $f$ DECLARE d text;old_ text;new_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.item_children(bigint,text,text,integer)'::regprocedure);
 old_:=substring(d FROM ' WITH scan AS\(SELECT id,payload FROM\([\s\S]+?INTO raw_ FROM scan;');
 IF old_ IS NULL THEN RAISE EXCEPTION 'Child query definition changed';END IF;
 new_:=$new$
 CASE p_section
 WHEN 'quantities' THEN EXECUTE $query$SELECT coalesce(jsonb_agg(payload ORDER BY id DESC),'[]') FROM(SELECT * FROM(SELECT q.id,to_jsonb(q) payload FROM sa_snapshot_20261019.sa_quantities q WHERE q.item_id=$1) eligible WHERE id<$3 ORDER BY id DESC LIMIT $4+1) bounded$query$ INTO raw_ USING p_id,i.product_id,after_,n,receipt_;
 WHEN 'bulk_plan' THEN EXECUTE $query$SELECT coalesce(jsonb_agg(payload ORDER BY id DESC),'[]') FROM(SELECT * FROM(SELECT q.id,to_jsonb(q) payload FROM sa_snapshot_20261019.sa_extra_quantities q WHERE q.item_id=$1) eligible WHERE id<$3 ORDER BY id DESC LIMIT $4+1) bounded$query$ INTO raw_ USING p_id,i.product_id,after_,n,receipt_;
 WHEN 'brandings' THEN EXECUTE $query$SELECT coalesce(jsonb_agg(payload ORDER BY id DESC),'[]') FROM(SELECT * FROM(SELECT q.id,to_jsonb(q) payload FROM sa_snapshot_20261019.sa_brandings q WHERE q.item_id=$1) eligible WHERE id<$3 ORDER BY id DESC LIMIT $4+1) bounded$query$ INTO raw_ USING p_id,i.product_id,after_,n,receipt_;
 WHEN 'criteria' THEN EXECUTE $query$SELECT coalesce(jsonb_agg(payload ORDER BY id DESC),'[]') FROM(SELECT * FROM(SELECT q.id,to_jsonb(q) payload FROM sa_snapshot_20261019.sa_item_criteria q WHERE q.item_id=$1) eligible WHERE id<$3 ORDER BY id DESC LIMIT $4+1) bounded$query$ INTO raw_ USING p_id,i.product_id,after_,n,receipt_;
 WHEN 'parts' THEN EXECUTE $query$SELECT coalesce(jsonb_agg(payload ORDER BY id DESC),'[]') FROM(SELECT * FROM(SELECT q.id,to_jsonb(q) payload FROM sa_snapshot_20261019.sa_product_parts q WHERE q.product_id=$2) eligible WHERE id<$3 ORDER BY id DESC LIMIT $4+1) bounded$query$ INTO raw_ USING p_id,i.product_id,after_,n,receipt_;
 WHEN 'addons' THEN EXECUTE $query$SELECT coalesce(jsonb_agg(payload ORDER BY id DESC),'[]') FROM(SELECT * FROM(SELECT q.id,to_jsonb(q) payload FROM sa_snapshot_20261019.sa_product_part_add_ons q JOIN sa_snapshot_20261019.sa_product_parts p ON p.id=q.product_part_id WHERE p.product_id=$2) eligible WHERE id<$3 ORDER BY id DESC LIMIT $4+1) bounded$query$ INTO raw_ USING p_id,i.product_id,after_,n,receipt_;
 WHEN 'images' THEN EXECUTE $query$SELECT coalesce(jsonb_agg(payload ORDER BY id DESC),'[]') FROM(SELECT * FROM(SELECT q.id,to_jsonb(q) payload FROM sa_snapshot_20261019.sa_product_images q WHERE q.product_id=$2) eligible WHERE id<$3 ORDER BY id DESC LIMIT $4+1) bounded$query$ INTO raw_ USING p_id,i.product_id,after_,n,receipt_;
 WHEN 'source_images' THEN EXECUTE $query$SELECT coalesce(jsonb_agg(payload ORDER BY id DESC),'[]') FROM(SELECT * FROM(SELECT m.ordinality id,jsonb_build_object('id',m.ordinality,'pointer',m.pointer,'status',m.status) payload FROM(SELECT pointer,status,row_number() OVER(ORDER BY pointer COLLATE "C") ordinality FROM sa_media.references WHERE resource='products' AND record_id=$2 AND field='images')m) eligible WHERE id<$3 ORDER BY id DESC LIMIT $4+1) bounded$query$ INTO raw_ USING p_id,i.product_id,after_,n,receipt_;
 WHEN 'variants' THEN EXECUTE $query$SELECT coalesce(jsonb_agg(payload ORDER BY id DESC),'[]') FROM(SELECT * FROM(SELECT v.ordinality id,v.value||jsonb_build_object('id',v.ordinality) payload FROM jsonb_array_elements(coalesce($5->'variants','[]')) WITH ORDINALITY v) eligible WHERE id<$3 ORDER BY id DESC LIMIT $4+1) bounded$query$ INTO raw_ USING p_id,i.product_id,after_,n,receipt_;
 END CASE;
$new$;
 EXECUTE replace(d,old_,new_);
END $f$;

-- Media descriptors for one product should only inspect items referencing that
-- product, retaining the original Admin/owned-enabled-catalogue/work union.
CREATE OR REPLACE FUNCTION sa_domain.work_product_visible(p_id bigint) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.actor();p sa_snapshot_20261019.sa_products;
BEGIN
 SELECT * INTO p FROM sa_snapshot_20261019.sa_products WHERE id=p_id;
 IF p.id IS NULL THEN RETURN false;END IF;
 IF a.role_id=0 OR(p.created_by_id=a.user_id AND(sa_domain.effective_capabilities(a.role_id,a.features)->>'catalogue')::boolean) THEN RETURN true;END IF;
 RETURN EXISTS(SELECT FROM sa_snapshot_20261019.sa_items i WHERE i.product_id=p_id AND sa_domain.can_item(i.id));
END $f$;
-- The size-type addition in120 copied the older selling-role list. Restore
-- the canonical finance guard for both item details and order previews, while
-- keeping payment fields governed separately by order_projection.
DO $f$ DECLARE d text;needle_ text:='a.role_id IN(0,1,3,10)';BEGIN
 d:=pg_get_functiondef('sa_domain.item_projection(jsonb,sa_domain.actor,text)'::regprocedure);
 IF (length(d)-length(replace(d,needle_,'')))/length(needle_)<>1 THEN RAISE EXCEPTION 'Item selling projection changed';END IF;
 EXECUTE replace(d,needle_,'sa_domain.selling_price_visible(a.role_id)');
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
