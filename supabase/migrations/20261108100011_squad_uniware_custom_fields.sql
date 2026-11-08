BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard;
-- Rails CreateOrderService#request_body, lines155-168 and214-217,
-- is identical on audited main14277820 and develop058ffb16.
CREATE FUNCTION sa_domain.uniware_custom_fields(p_name text,p_due timestamptz,p_comments jsonb)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_array(
  jsonb_build_object('name','Customer_Details','value',coalesce(p_name,'')),
  jsonb_build_object('name','PICKUPDATE','value',to_char(p_due AT TIME ZONE 'Asia/Kolkata','DD/MM/YY')),
  jsonb_build_object('name','Comment','value',coalesce((SELECT string_agg(value,', ' ORDER BY ordinal)
    FROM jsonb_array_elements_text(p_comments) WITH ORDINALITY AS x(value,ordinal)
    WHERE value~'[^[:space:]]'),'')))
$f$;
CREATE FUNCTION sa_domain.uniware_piece_comment(p_comment text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT CASE WHEN p_comment~'[^[:space:]]' THEN left(' : '||p_comment,350) ELSE '' END
$f$;
ALTER FUNCTION sa_domain.uniware_custom_fields(text,timestamptz,jsonb) OWNER TO sa_guard;
ALTER FUNCTION sa_domain.uniware_piece_comment(text) OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.uniware_custom_fields(text,timestamptz,jsonb),sa_domain.uniware_piece_comment(text)
 FROM PUBLIC,anon,authenticated,sa_app,service_role;

DO $f$ DECLARE d text;old_ text;new_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.warehouse_order_payload(bigint,text,text)'::regprocedure);
 old_:=$s$'value',left(coalesce(row_.comment,''),350)$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Initial per-piece comment contract changed';END IF;
 d:=replace(d,old_,$s$'value',sa_domain.uniware_piece_comment(row_.comment)$s$);
 old_:=$s$'fulfillmentTat',o.due_on AT TIME ZONE 'UTC','saleOrderItems',lines_$s$;
 new_:=$s$'fulfillmentTat',o.due_on AT TIME ZONE 'UTC','customFieldValues',sa_domain.uniware_custom_fields(name_,o.due_on AT TIME ZONE 'UTC',(SELECT coalesce(jsonb_agg(i.comment ORDER BY i.id),'[]'::jsonb) FROM sa_snapshot_20261019.sa_items i WHERE i.order_id=p_order)),'saleOrderItems',lines_$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Initial Uniware order payload changed';END IF;
 EXECUTE replace(d,old_,new_);

 d:=pg_get_functiondef('sa_domain.warehouse_amendment_payload(uuid,text,text,text)'::regprocedure);
 old_:=$s$'value',left(coalesce(comment_,''),350)$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Amendment per-piece comment contract changed';END IF;
 d:=replace(d,old_,$s$'value',sa_domain.uniware_piece_comment(comment_)$s$);
 old_:=$s$'fulfillmentTat',r.spec->'details'->>'due_at','saleOrderItems',lines_$s$;
 new_:=$s$'fulfillmentTat',r.spec->'details'->>'due_at','customFieldValues',sa_domain.uniware_custom_fields(name_,(r.spec->'details'->>'due_at')::timestamptz,(SELECT coalesce(jsonb_agg(r.spec->'details'->'line_settings'->(value->>'line')->'comment' ORDER BY ordinal),'[]'::jsonb) FROM jsonb_array_elements(r.spec->'group'->'lines') WITH ORDINALITY AS x(value,ordinal))),'saleOrderItems',lines_$s$;
 IF position(old_ IN d)=0 THEN RAISE EXCEPTION 'Amendment Uniware order payload changed';END IF;
 EXECUTE replace(d,old_,new_);
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard;
NOTIFY pgrst,'reload schema';
COMMIT;
