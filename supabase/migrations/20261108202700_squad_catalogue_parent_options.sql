BEGIN;
-- Reuse the existing catalogue selector and RLS. Parent labels are distinct,
-- bounded and seek by their exact source value, never collected client-side.
CREATE INDEX squad_rmp_parent_category_page ON sa_snapshot_20261019.sa_rmp_brands(main_category COLLATE "C",id) WHERE is_deleted IS NOT TRUE AND main_category IS NOT NULL;
DO $patch$DECLARE d text;needle_ text;BEGIN
 d:=pg_get_functiondef('sa_domain.v1_catalog_options(bigint,text,text,integer)'::regprocedure);
 needle_:=$n$'brands','categories','sizes','price_type'$n$;
 IF strpos(d,needle_)=0 THEN RAISE EXCEPTION 'Expected catalogue selector list missing';END IF;
 d:=replace(d,needle_,$n$'brands','categories','sizes','price_type','main_categories'$n$);
 needle_:=$n$ctx:=sa_domain.page_context('catalog.options.'||p_kind,commercial);after_:=sa_domain.cursor_id(p_cursor,ctx);$n$;
 IF strpos(d,needle_)=0 THEN RAISE EXCEPTION 'Expected catalogue page context missing';END IF;
 d:=replace(d,needle_,$n$ctx:=sa_domain.page_context('catalog.options.'||p_kind,commercial);
 IF p_kind='main_categories' THEN
  DECLARE seek_ jsonb:=sa_domain.catalog_cursor(p_cursor,ctx);last_ text;BEGIN
   WITH scan AS MATERIALIZED(SELECT min(b.id) id,b.main_category name FROM sa_snapshot_20261019.sa_rmp_brands b
    WHERE b.is_deleted IS NOT TRUE AND length(b.main_category) BETWEEN 1 AND 100
     AND(seek_ IS NULL OR b.main_category COLLATE "C">(seek_->>'sort') COLLATE "C")
    GROUP BY b.main_category COLLATE "C",b.main_category ORDER BY b.main_category COLLATE "C" LIMIT n+1),
   page AS(SELECT * FROM scan ORDER BY name COLLATE "C" LIMIT n)
   SELECT jsonb_build_object('context',commercial,'data',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'name',name) ORDER BY name COLLATE "C"),'[]'),
    'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.catalog_next_cursor(1,max(name COLLATE "C"),ctx) END) INTO r FROM page;
   RETURN r;
  END;
 END IF;
 after_:=sa_domain.cursor_id(p_cursor,ctx);$n$);EXECUTE d;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
