BEGIN;
-- STOCK.01 / APP.04: labels for already-authorized records; never widen scope.
-- Stock size_id refers to canonical sa_sizes, NOT the separate sa_rmp_sizes.
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
GRANT SELECT(name,phone,approved,disabled,deleted_at,created_by_id) ON sa_snapshot_20261019.sa_users TO sa_guard;
CREATE FUNCTION sa_domain.person_relationship_labels(p_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE result_ jsonb;
BEGIN
 IF NOT coalesce(sa_domain.can_address(p_id),false) THEN RAISE EXCEPTION 'Person unavailable' USING ERRCODE='P0002';END IF;
 SELECT jsonb_build_object(
 'linked_dealers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id::text,'name',d.name) ORDER BY d.id),'[]')
  FROM sa_snapshot_20261019.sa_user_dealers l JOIN sa_snapshot_20261019.sa_users d ON d.id=l.dealer_id
  WHERE l.user_id=p_id AND d.role=10 AND d.deleted_at IS NULL AND d.disabled IS NOT TRUE AND d.approved IS NOT FALSE),
 'coordinator_contact',(SELECT jsonb_build_object('id',sc.id::text,'name',sc.name,'phone',sc.phone)
  FROM sa_snapshot_20261019.sa_users sc WHERE u.role IN(3,10) AND sc.id=u.created_by_id
  AND sc.role=1 AND sc.deleted_at IS NULL AND sc.disabled IS NOT TRUE)) INTO result_
 FROM sa_snapshot_20261019.sa_users u WHERE u.id=p_id AND u.deleted_at IS NULL;
 RETURN coalesce(result_,'{}');
END $f$;
ALTER FUNCTION sa_domain.person_relationship_labels(bigint) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.person_relationship_labels(bigint) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.person_relationship_labels(bigint) TO sa_executor;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
DO $f$
DECLARE definition_ text;needle_ text;
BEGIN
 definition_:=pg_get_functiondef('sa_domain.v1_dealer_stock(bigint,bigint,jsonb,text,integer)'::regprocedure);
 needle_:='''status'',CASE WHEN needs_reconciliation THEN ''needs_reconciliation'' ELSE ''ready'' END,';
 IF position(needle_ IN definition_)=0 THEN RAISE EXCEPTION 'Stock label insertion point unavailable';END IF;
 definition_:=replace(definition_,needle_,$sql$
 'size_name',(SELECT z.name FROM sa_snapshot_20261019.sa_sizes z WHERE z.id=page.size_id),
 'product_name',CASE WHEN stock_type=1 THEN (SELECT z.name FROM sa_snapshot_20261019.sa_products z WHERE z.id=page.product_id)
  ELSE (SELECT z.name FROM sa_snapshot_20261019.sa_rmp_classes z WHERE z.id=page.rmp_class_id) END,
 'brand_name',CASE WHEN stock_type=0 THEN (SELECT z.name FROM sa_snapshot_20261019.sa_rmp_brands z WHERE z.id=page.rmp_brand_id) END,
 'status',CASE WHEN needs_reconciliation THEN 'needs_reconciliation' ELSE 'ready' END,$sql$);
 EXECUTE definition_;
 definition_:=pg_get_functiondef('sa_domain.v1_person_get(bigint)'::regprocedure);
 needle_:='IF sa_domain.can_manage_person(p_id) THEN';
 IF position(needle_ IN definition_)=0 THEN RAISE EXCEPTION 'Person relation label insertion point unavailable';END IF;
 definition_:=replace(definition_,needle_,'IF sa_domain.can_address(p_id) THEN r:=r||sa_domain.person_relationship_labels(p_id);END IF; '||needle_);
 EXECUTE definition_;
END $f$;
NOTIFY pgrst,'reload schema';
COMMIT;
