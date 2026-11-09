BEGIN;
-- Existing callers retain id-descending pages. Explicit source-equivalent sort
-- choices use a timestamp AND id seek cursor; no page-local client sorting.
CREATE INDEX squad_orders_due_seek ON sa_snapshot_20261019.sa_orders(due_on ASC NULLS LAST,id ASC)
 WHERE is_deleted IS NOT TRUE AND deleted_at IS NULL;
CREATE INDEX squad_orders_created_seek ON sa_snapshot_20261019.sa_orders(created_at DESC NULLS LAST,id DESC)
 WHERE is_deleted IS NOT TRUE AND deleted_at IS NULL;
DO $f$ DECLARE d text;needle_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.validate_order_filters(jsonb)'::regprocedure);
 needle_:=$n$'worker_status','assignment_kind'$n$;
 IF strpos(d,needle_)=0 THEN RAISE EXCEPTION 'Expected order filter contract missing';END IF;
 d:=replace(d,needle_,$n$'worker_status','assignment_kind','sort'$n$);
 needle_:='FOR field_,value_ IN SELECT * FROM jsonb_each(p_filters) LOOP';
 IF strpos(d,needle_)=0 THEN RAISE EXCEPTION 'Expected order validation missing';END IF;
 d:=replace(d,needle_,$n$IF p_filters?'sort' AND (jsonb_typeof(p_filters->'sort')<>'string' OR p_filters->>'sort' NOT IN('id_desc','created_desc','due_asc')) THEN
 RAISE EXCEPTION 'Invalid order sort' USING ERRCODE='22023';END IF;
 $n$||needle_);EXECUTE d;
END $f$;
CREATE OR REPLACE FUNCTION sa_domain.v1_orders_list(p_filters jsonb DEFAULT '{}',p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.require_roles(ARRAY[0,1,2,3,4,7,8,9,10,11]);n integer:=sa_domain.page_limit(p_limit);
 ctx jsonb:=sa_domain.page_context('orders',p_filters);after_ bigint:=sa_domain.cursor_id(p_cursor,ctx);result_ jsonb;
 sort_ text:=coalesce(p_filters->>'sort','id_desc');after_time_ timestamp;cursor_ jsonb;raw_ jsonb;page_ jsonb;last_ jsonb;
 column_ text;direction_ text;operator_ text;sentinel_ text;after_null_ boolean:=false;null_rows_ jsonb;remaining_ integer;seek_ text;
BEGIN
 PERFORM sa_domain.validate_order_filters(p_filters);
 IF sort_='id_desc' THEN
  WITH scan AS MATERIALIZED(SELECT o.* FROM sa_domain.filtered_orders(p_filters) o WHERE o.id<after_ ORDER BY o.id DESC LIMIT n+1),
  page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
  SELECT jsonb_build_object('data',coalesce(jsonb_agg(sa_domain.order_projection(to_jsonb(p),a,(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY p.id DESC),'[]'),
   'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(p.id),ctx) END)
  INTO result_ FROM page p LEFT JOIN sa_domain.entity_versions v ON v.kind='order' AND v.entity_id=p.id;RETURN result_;
 END IF;
 IF p_cursor IS NOT NULL THEN
  cursor_:=convert_from(decode(p_cursor,'base64'),'UTF8')::jsonb;
  IF jsonb_typeof(cursor_->'after_time') IS DISTINCT FROM 'string' OR NOT pg_input_is_valid(cursor_->>'after_time','timestamp') THEN
   RAISE EXCEPTION 'Invalid order sort cursor' USING ERRCODE='22023';END IF;
  IF jsonb_typeof(cursor_->'after_null') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid order null cursor' USING ERRCODE='22023';END IF;
  after_null_:=(cursor_->>'after_null')::boolean;
  after_time_:=(cursor_->>'after_time')::timestamp;
 END IF;
 -- These SQL fragments are constants selected by the validated enum, never input.
 IF sort_='due_asc' THEN column_:='due_on';direction_:='ASC';operator_:='>';sentinel_:='infinity';
 ELSE column_:='created_at';direction_:='DESC';operator_:='<';sentinel_:='-infinity';END IF;
 -- Keep raw indexed timestamp comparisons leakproof under RLS. COALESCE in
 -- the seek expression becomes a post-index filter across the security barrier.
 -- Two disjoint bounded buckets preserve NULLS LAST without scanning earlier pages.
 raw_:='[]'::jsonb;
 IF NOT after_null_ THEN
  seek_:=CASE WHEN p_cursor IS NULL THEN '' ELSE format('AND (o.%I,o.id) %s ($2::timestamp,$3::bigint)',column_,operator_) END;
  EXECUTE format($q$
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.%1$I %2$s,x.id %2$s),'[]') FROM(
    SELECT o.* FROM sa_domain.filtered_orders($1) o WHERE o.%1$I IS NOT NULL %3$s
    ORDER BY o.%1$I %2$s NULLS LAST,o.id %2$s LIMIT $4) x
   $q$,column_,direction_,seek_) INTO raw_ USING p_filters,after_time_,after_,n+1;
 END IF;
 remaining_:=n+1-jsonb_array_length(raw_);
 IF remaining_>0 THEN
  seek_:=CASE WHEN after_null_ THEN format('AND o.id %s $2::bigint',operator_) ELSE '' END;
  EXECUTE format($q$
   SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id %2$s),'[]') FROM(
    SELECT o.* FROM sa_domain.filtered_orders($1) o WHERE o.%1$I IS NULL %3$s
    ORDER BY o.id %2$s LIMIT $3) x
   $q$,column_,direction_,seek_) INTO null_rows_ USING p_filters,after_,remaining_;
  raw_:=raw_||null_rows_;
 END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]') INTO page_ FROM jsonb_array_elements(raw_) WITH ORDINALITY WHERE ordinality<=n;
 last_:=page_->(jsonb_array_length(page_)-1);
 SELECT jsonb_build_object('data',coalesce(jsonb_agg(sa_domain.order_projection(x,a,(ctx->>'generation')||':'||coalesce(v.revision,0)) ORDER BY ordinality),'[]'),
 'next_cursor',CASE WHEN jsonb_array_length(raw_)>n THEN replace(encode(convert_to(jsonb_build_object('after',last_->>'id',
 'after_time',coalesce(last_->>column_,sentinel_),'after_null',last_->column_='null'::jsonb,'scope',md5(ctx::text))::text,'UTF8'),'base64'),E'\n','') END)
 INTO result_ FROM jsonb_array_elements(page_) WITH ORDINALITY p(x,ordinality)
 LEFT JOIN sa_domain.entity_versions v ON v.kind='order' AND v.entity_id=(x->>'id')::bigint;
 RETURN result_;
END $f$;
NOTIFY pgrst,'reload schema';
COMMIT;
