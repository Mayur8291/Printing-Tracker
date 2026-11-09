BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor;
-- Existing product/image read policies remain authoritative. New mutations are
-- limited to the exact product owner, including when SC can read another preset.
GRANT UPDATE(comment,updated_at) ON sa_snapshot_20261019.sa_product_images TO sa_executor;
CREATE POLICY squad_product_image_comment_owner ON sa_snapshot_20261019.sa_product_images
 FOR UPDATE TO sa_executor USING(product_id IN(SELECT id FROM sa_snapshot_20261019.sa_products
 WHERE created_by_id=(SELECT (sa_domain.actor()).user_id)))
 WITH CHECK(product_id IN(SELECT id FROM sa_snapshot_20261019.sa_products
 WHERE created_by_id=(SELECT (sa_domain.actor()).user_id)));
CREATE INDEX squad_product_images_page ON sa_snapshot_20261019.sa_product_images(product_id,id DESC);

CREATE FUNCTION sa_domain.v1_product_images(p_product_id bigint,p_cursor text DEFAULT NULL,p_limit integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');n integer:=sa_domain.page_limit(p_limit);
 owner_ bigint;version_ text;ctx jsonb;after_ bigint;raw_ jsonb;page_ jsonb;media_ jsonb;result_ jsonb;last_ bigint;
BEGIN
 IF p_product_id IS NULL OR p_product_id<1 THEN RAISE EXCEPTION 'Invalid product' USING ERRCODE='22023';END IF;
 SELECT created_by_id INTO owner_ FROM sa_snapshot_20261019.sa_products WHERE id=p_product_id AND product_type=0;
 IF NOT FOUND THEN RAISE EXCEPTION 'Product not found or unavailable' USING ERRCODE='P0002';END IF;
 version_:=sa_domain.version('product',p_product_id);
 ctx:=sa_domain.page_context('product_images',jsonb_build_object('product_id',p_product_id,'version',version_));
 after_:=sa_domain.cursor_id(p_cursor,ctx);
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id DESC),'[]') INTO raw_ FROM(
 SELECT id,image,comment FROM sa_snapshot_20261019.sa_product_images WHERE product_id=p_product_id AND id<after_
 ORDER BY id DESC LIMIT n+1) x;
 SELECT coalesce(jsonb_agg(value ORDER BY ordinality),'[]'),min((value->>'id')::bigint) INTO page_,last_
 FROM jsonb_array_elements(raw_) WITH ORDINALITY WHERE ordinality<=n;
 media_:=sa_domain.catalog_media_batch('product_images',page_,ARRAY['image']);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','comment',left(value->>'comment',4000),
 'comment_truncated',coalesce(length(value->>'comment')>4000,false),'image',media_->(value->>'id')->'image',
 'version',version_) ORDER BY ordinality),'[]') INTO result_ FROM jsonb_array_elements(page_) WITH ORDINALITY;
 RETURN jsonb_build_object('data',result_,'next_cursor',CASE WHEN jsonb_array_length(raw_)>n THEN sa_domain.next_cursor(last_,ctx) END,
 'product_id',p_product_id::text,'version',version_,'can_edit',coalesce(owner_=a.user_id,false));
END $f$;

CREATE FUNCTION sa_domain.v1_product_image_comment(p_image_id bigint,p_comment text,p_expected_version text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');cached jsonb;product_ bigint;old_ text;image_ text;version_ text;result_ jsonb;
BEGIN
 IF p_image_id IS NULL OR p_image_id<1 OR p_comment IS NULL OR length(p_comment)>4000 THEN
 RAISE EXCEPTION 'Provide an image and a comment up to 4000 characters' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('product_image.comment_saved',p_idempotency_key,
 jsonb_build_object('image_id',p_image_id,'comment',p_comment,'version',p_expected_version));IF cached IS NOT NULL THEN RETURN cached;END IF;
 SELECT i.product_id INTO product_ FROM sa_snapshot_20261019.sa_product_images i JOIN sa_snapshot_20261019.sa_products p ON p.id=i.product_id
 WHERE i.id=p_image_id AND p.product_type=0 AND p.created_by_id=a.user_id;
 IF product_ IS NULL THEN RAISE EXCEPTION 'Image not found or unavailable' USING ERRCODE='P0002';END IF;
 -- Share the product lock/version with append, replacement and detachment.
 PERFORM pg_advisory_xact_lock(hashtextextended('product:'||product_,784139));
 PERFORM 1 FROM sa_snapshot_20261019.sa_products WHERE id=product_ AND created_by_id=a.user_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Image not found or unavailable' USING ERRCODE='P0002';END IF;
 SELECT comment,image INTO old_,image_ FROM sa_snapshot_20261019.sa_product_images WHERE id=p_image_id AND product_id=product_ FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Image not found or unavailable' USING ERRCODE='P0002';END IF;
 version_:=sa_domain.bump_version('product',product_,p_expected_version);
 UPDATE sa_snapshot_20261019.sa_product_images SET comment=p_comment,updated_at=clock_timestamp() WHERE id=p_image_id AND product_id=product_;
 UPDATE sa_snapshot_20261019.sa_products SET updated_at=clock_timestamp() WHERE id=product_;
 result_:=jsonb_build_object('id',p_image_id::text,'product_id',product_::text,'comment',p_comment,'comment_truncated',false,
 'image',sa_domain.catalog_media('product_images',p_image_id,'image',image_),'version',version_);
 RETURN sa_domain.finish_command('product_image.comment_saved',p_idempotency_key,'product',product_,result_,
 jsonb_build_object('image_id',p_image_id::text,'before_comment',old_,'after_comment',p_comment));
END $f$;
DO $f$ DECLARE x record;args text;BEGIN
 FOR x IN SELECT p.oid,p.proname,p.proargnames FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='sa_domain' AND p.proname IN('v1_product_images','v1_product_image_comment') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO sa_executor',x.oid::regprocedure);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,sa_app,service_role',x.oid::regprocedure);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO sa_app',x.oid::regprocedure);
  SELECT string_agg(quote_ident(v),',') INTO args FROM unnest(x.proargnames) v;
  EXECUTE format('CREATE FUNCTION canto_api.%I(%s) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS %L',
   x.proname,pg_get_function_arguments(x.oid),format('SELECT sa_domain.%I(%s)',x.proname,args));
  EXECUTE format('REVOKE ALL ON FUNCTION canto_api.%I(%s) FROM PUBLIC,anon,authenticated,sa_app,service_role',x.proname,pg_get_function_identity_arguments(x.oid));
  EXECUTE format('GRANT EXECUTE ON FUNCTION canto_api.%I(%s) TO sa_app',x.proname,pg_get_function_identity_arguments(x.oid));
 END LOOP;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor;
NOTIFY pgrst,'reload schema';
COMMIT;
