BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_guard,sa_worker,sa_media_writer;
-- Immutable captures and row plans live outside the replaceable legacy snapshot.
CREATE TABLE sa_domain.airtable_resources(resource text PRIMARY KEY,priority integer UNIQUE NOT NULL,contract jsonb NOT NULL);
INSERT INTO sa_domain.airtable_resources VALUES('colors',1,'{"base":"custom","table":"tblEdzGZ3AvI24omA","fields":{"name":"Name","hex_code":"Hex Code"}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('authorized_brands',2,'{"base":"ready_stock","table":"tblKsbCdhULGxMO7m","fields":{"name":"Name"}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('profit_margins',3,'{"base":"custom","table":"tbl6feEno9n4IxO7t","fields":{"name":"Name","min_range":"Min Range","max_range":"Max Range","margin_percentage":"Margin Percentage","branding_embroidery":"Branding Embroidery","branding_print":"Branding Print"},"defaults":{"margin_percentage":0,"branding_embroidery":0}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('size_types',4,'{"base":"custom","table":"tblA4OKX2RSUSYV1m","fields":{"name":"Size Type"}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('base_product_types',5,'{"base":"custom","table":"tbltnk0XfwG56hDlJ","fields":{"name":"Name","position":"Position"},"media":{"image":{"field":"Image","variant":"original"}}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('asset_infos',6,'{"base":"custom","table":"tblg8FuURZGHxzWRh","fields":{"dX":"dX","dY":"dY","mirrorDX":"mirrorDX","assetHeightRespToBox":"assetHeightRespToBox"},"media":{"asset":{"field":"asset","variant":"original"}}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('parts',7,'{"base":"custom","table":"tblovw4t42XwbqT0Z","fields":{"name":"Name","position":"Position","order_criteria":"Order Criteria"},"transforms":{"order_criteria":"boolean"},"relations":{"colors":{"field":"Colour","by":"airtable_id"},"add_ons":{"field":"Add Ons","by":"airtable_id"}},"identity":{"fallback":"name"}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('add_ons',8,'{"base":"custom","table":"tbljcmwdsGCkXVl5t","fields":{"add_on":"Add On","add_on_price":"Add On Price","add_on_of":"Add On OF","add_on_sn":"Add On SN","has_color":"hasColour","select_type":"Select Type","group_name":"groupName","position":"Position","layer_sort":"Layer Sort"},"transforms":{"has_color":"boolean"},"relations":{"colors":{"field":"Colours","by":"airtable_id"},"base_products":{"field":"Base Product","by":"airtable_id"}},"media":{"image":{"field":"Image","variant":"original"}},"identity":{"fallback":"add_on"}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('fabrics',9,'{"base":"custom","table":"tblPvwbVyHIa8CDxm","fields":{"name":"Fabric Name","fabric_type":"Fabric Type","price":"Price","uom":"UOM","gsm":"GSM"},"defaults":{"uom":""},"transforms":{"fabric_type":"fabric_type"},"relations":{"colors":{"field":"Colour","by":"airtable_id"}},"media":{"image":{"field":"Image","variant":"original"}}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('sc_sizes',10,'{"base":"custom","table":"tblfzvMnsQg5RlxBj","fields":{"name":"Size","position":"Position"},"references":{"size_type_id":{"resource":"size_types","field":"Size Type"}}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('base_products',11,'{"base":"custom","table":"tblmpXRvwZfRky0k5","fields":{"name":"Base Product","base_of":"Base OF","base_sn":"Base SN","tims_cost":"Trims Cost","adult_consumption":"Adult Consumption","kids_consumption":"Kids Consumption","over_header_percentage":"Overheader Percentage","sample_rate":"Sample Rate","position":"Sort","calculator":"Calculator","branding_sides":"branding Sides"},"references":{"base_product_type_id":{"resource":"base_product_types","field":"Base Product Type"},"asset_info_id":{"resource":"asset_infos","field":"Asset Info"}},"relations":{"size_types":{"field":"Size Type","by":"airtable_id"},"categories":{"field":"Product Categories","by":"name"},"fabrics":{"field":"Fabric","by":"airtable_id"},"parts":{"field":"Parts","by":"airtable_id"}},"media":{"image":{"field":"Image","variant":"original"}},"identity":{"fallback":"name"}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('rmp_categories',12,'{"base":"ready_stock","table":"tblVTL7LsgQ0nLWZR","fields":{"name":"Category","position":"Sort"},"media":{"image":{"field":"image","variant":"original"}}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('rmp_brands',13,'{"base":"ready_stock","table":"tblLT2Qlp4xPhKfme","fields":{"name":"Brand","position":"Position","main_category":"Parent"},"defaults":{"position":0},"references":{"authorized_brand_id":{"resource":"authorized_brands","field":"Authorized Brand"}},"relations":{"rmp_categories":{"field":"Category","by":"airtable_id"}}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('rmp_sizes',14,'{"base":"ready_stock","table":"tblu9N1fI0w0Mvy3b","fields":{"name":"Size","size_type":"Size Type","position":"Position"},"transforms":{"size_type":"parameterize"},"derived":{"canonical_size_position":"case_insensitive_name"}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('rmp_colors',15,'{"base":"ready_stock","table":"tblqlndlEEvhOzu1i","fields":{"name":"Colour","code":"Color Code"}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('rmp_classes',16,'{"base":"ready_stock","table":"tblH5zIvbwIXfMdAf","fields":{"name":"Class","position":"Position","embeded_video":"embeded video"},"defaults":{"position":0},"references":{"rmp_color_id":{"resource":"rmp_colors","field":"Colours"}},"media":{"image_1":{"field":"Image1","variant":"original"},"image_2":{"field":"Image2","variant":"original"},"image_3":{"field":"Image3","variant":"original"},"image_4":{"field":"Image4","variant":"original"},"image_5":{"field":"Image5","variant":"original"},"image_1_thumb":{"field":"Image1","variant":"large"},"image_2_thumb":{"field":"Image2","variant":"large"},"image_3_thumb":{"field":"Image3","variant":"large"},"image_4_thumb":{"field":"Image4","variant":"large"},"image_5_thumb":{"field":"Image5","variant":"large"}}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('rmp_skus',17,'{"base":"ready_stock","table":"tble9bCsRd13Ztr84","fields":{"name":"SKU","cgst":"CGST","igst":"IGST","sgst":"SGST"},"defaults":{"cgst":0,"igst":0,"sgst":0},"references":{"rmp_size_id":{"resource":"rmp_sizes","field":"Size"},"rmp_class_id":{"resource":"rmp_classes","field":"Class Name"},"rmp_brand_id":{"resource":"rmp_brands","field":"Brand"},"rmp_category_id":{"resource":"rmp_categories","field":"Category"}}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('rmp_price_types',18,'{"base":"ready_stock","table":"tblVxmOSnctLtEEeR","fields":{"name":"Price Type","price_for":"Price For"},"transforms":{"name":"trim"},"derived":{"zone_id":"zone_price_type_name"}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('rmp_prices',19,'{"base":"ready_stock","table":"tbldoRT49rKEVXDqL","fields":{"name":"Price Prefix","price":"Price","mrp":"MRP"},"defaults":{"mrp":0},"references":{"rmp_sku_id":{"resource":"rmp_skus","field":"SKU"},"rmp_price_type_id":{"resource":"rmp_price_types","field":"Price Type"}}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('base_product_asset_infos',20,'{"base":"custom","table":"tblqcrivFGVZTgUl2","fields":{},"references":{"base_product_id":{"resource":"base_products","field":"Base Product"},"asset_info_id":{"resource":"asset_infos","field":"Asset Info"},"add_on_id":{"resource":"add_ons","field":"Add On"},"part_id":{"resource":"parts","field":"Part"}},"identity":{"composite":["base_product_id","asset_info_id","add_on_id","part_id"]}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('promotional_banners',21,'{"base":"ready_stock","table":"tbl30ag7cuvGfTgE9","fields":{"status":"Status","position":"Position","title":"Title"},"references":{"rmp_category_id":{"resource":"rmp_categories","field":"Product Category"},"rmp_class_id":{"resource":"rmp_classes","field":"Class"},"rmp_brand_id":{"resource":"rmp_brands","field":"Brand"}},"media":{"image":{"field":"Image","variant":"original"}}}'::jsonb);
INSERT INTO sa_domain.airtable_resources VALUES('promotions',22,'{"base":"custom","table":"tblaG88ilnwLrZGRU","fields":{"name":"Name","upload_date":"Upload Date","link":"Link","category":"Category"},"media":{"thumbnail":{"field":"Thumbnail","variant":"original"}},"derived":{"file_size":"attachment_size"}}'::jsonb);
CREATE TABLE sa_domain.airtable_runs(
 transfer_id uuid PRIMARY KEY REFERENCES sa_domain.transfers ON DELETE CASCADE,
 phase text NOT NULL DEFAULT 'capture' CHECK(phase IN('capture','media','match','validate','apply_scalar','apply_relations','retire','statistics','done')),
 capture_rows bigint NOT NULL DEFAULT 0,capture_bytes bigint NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),captured_at timestamptz
);
CREATE TABLE sa_domain.airtable_tables(
 transfer_id uuid NOT NULL REFERENCES sa_domain.airtable_runs ON DELETE CASCADE,resource text NOT NULL REFERENCES sa_domain.airtable_resources,
 offset_token text,complete boolean NOT NULL DEFAULT false,row_count integer NOT NULL DEFAULT 0,
 candidate_cursor bigint NOT NULL DEFAULT 0,candidates_complete boolean NOT NULL DEFAULT false,
 PRIMARY KEY(transfer_id,resource)
);
CREATE TABLE sa_domain.airtable_pages(
 transfer_id uuid NOT NULL,resource text NOT NULL,offset_token text NOT NULL,
 digest text NOT NULL,next_offset text,eof boolean NOT NULL,PRIMARY KEY(transfer_id,resource,offset_token),
 FOREIGN KEY(transfer_id,resource) REFERENCES sa_domain.airtable_tables ON DELETE CASCADE
);
CREATE TABLE sa_domain.airtable_rows(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,transfer_id uuid NOT NULL REFERENCES sa_domain.airtable_runs ON DELETE CASCADE,
 resource text NOT NULL,airtable_id text NOT NULL,attributes jsonb NOT NULL,references_ jsonb NOT NULL,relations jsonb NOT NULL,media jsonb NOT NULL,
 target_id bigint,expected_version text,values_ jsonb,side_effects jsonb NOT NULL DEFAULT '{}',unique_keys jsonb NOT NULL DEFAULT '[]',
 state text NOT NULL DEFAULT 'captured' CHECK(state IN('captured','matched','valid','invalid','scalar','applied','failed')),
 errors jsonb NOT NULL DEFAULT '[]',UNIQUE(transfer_id,resource,airtable_id),CHECK(octet_length(attributes::text)+octet_length(references_::text)+octet_length(relations::text)+octet_length(media::text)<=131072)
);
CREATE INDEX squad_airtable_row_scan ON sa_domain.airtable_rows(transfer_id,state,resource,id);
CREATE UNIQUE INDEX squad_airtable_matched_once ON sa_domain.airtable_rows(transfer_id,resource,target_id) WHERE target_id IS NOT NULL;
CREATE INDEX squad_airtable_unique_keys ON sa_domain.airtable_rows USING gin(unique_keys);
CREATE TABLE sa_domain.airtable_assets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),row_id bigint NOT NULL REFERENCES sa_domain.airtable_rows ON DELETE CASCADE,
 field text NOT NULL,attachment jsonb NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','ready','failed')),
 manifest jsonb,error_code text,UNIQUE(row_id,field)
);
CREATE INDEX squad_airtable_pending_assets ON sa_domain.airtable_assets(row_id,id) WHERE state='pending';
CREATE TABLE sa_domain.airtable_retirements(
 transfer_id uuid NOT NULL REFERENCES sa_domain.airtable_runs ON DELETE CASCADE,resource text NOT NULL,record_id bigint NOT NULL,
 expected_version text NOT NULL,applied boolean NOT NULL DEFAULT false,PRIMARY KEY(transfer_id,resource,record_id)
);
CREATE TABLE sa_domain.airtable_statistics(
 transfer_id uuid NOT NULL REFERENCES sa_domain.airtable_runs ON DELETE CASCADE,class_id bigint NOT NULL,applied boolean NOT NULL DEFAULT false,
 PRIMARY KEY(transfer_id,class_id)
);
CREATE TABLE sa_domain.airtable_master_context(
 backend_pid integer NOT NULL,transaction_id bigint NOT NULL,job_id uuid NOT NULL,lease_token uuid NOT NULL,
 transfer_id uuid NOT NULL,row_id bigint,resource text NOT NULL,action text NOT NULL,dry_run boolean NOT NULL,
 payload_sha256 bytea NOT NULL,airtable_id text,PRIMARY KEY(backend_pid,transaction_id)
);
CREATE UNIQUE INDEX squad_airtable_single_active ON sa_domain.transfers((kind)) WHERE kind='airtable' AND state IN('queued','validating','validated','applying');
DO $f$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['airtable_resources','airtable_runs','airtable_tables','airtable_pages','airtable_rows','airtable_assets','airtable_retirements','airtable_statistics','airtable_master_context'] LOOP
  EXECUTE format('ALTER TABLE sa_domain.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE sa_domain.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON sa_domain.%I TO sa_guard',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON sa_domain.%I TO sa_worker',t);
  EXECUTE format('CREATE POLICY airtable_guard ON sa_domain.%I FOR SELECT TO sa_guard USING(true)',t);
  EXECUTE format('CREATE POLICY airtable_worker ON sa_domain.%I TO sa_worker USING(true) WITH CHECK(true)',t);
 END LOOP;
END $f$;
GRANT USAGE ON SEQUENCE sa_domain.airtable_rows_id_seq TO sa_worker;
GRANT SELECT ON sa_domain.airtable_rows TO sa_media_writer;
CREATE POLICY airtable_rows_owner ON sa_domain.airtable_rows FOR SELECT TO sa_media_writer USING(transfer_id IN(SELECT id FROM sa_domain.transfers));
GRANT SELECT ON sa_domain.integration_preferences TO sa_worker;
CREATE POLICY airtable_preferences_worker ON sa_domain.integration_preferences FOR SELECT TO sa_worker USING(true);
GRANT EXECUTE ON FUNCTION sa_domain.ownership_epoch() TO sa_media_writer,sa_worker;

CREATE FUNCTION sa_domain.airtable_ensure_enabled() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 IF NOT coalesce((SELECT airtable_enabled FROM sa_domain.integration_preferences WHERE singleton),false) THEN RAISE EXCEPTION 'Airtable import is disabled' USING ERRCODE='55000';END IF;
 IF sa_domain.ownership_epoch()->>'activated_at' IS NULL THEN RAISE EXCEPTION 'Verified new-system ownership required' USING ERRCODE='55000';END IF;
END $f$;
ALTER FUNCTION sa_domain.airtable_ensure_enabled() OWNER TO sa_guard;
REVOKE ALL ON FUNCTION sa_domain.airtable_ensure_enabled() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.airtable_ensure_enabled() TO sa_media_writer,sa_worker;
CREATE FUNCTION sa_domain.airtable_initialize(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE t sa_domain.transfers;
BEGIN
 SELECT * INTO t FROM sa_domain.transfers WHERE id=p_id;
 IF t.id IS NULL OR t.kind<>'airtable' OR NOT sa_domain.transfer_current(t) THEN RAISE EXCEPTION 'Import unavailable' USING ERRCODE='P0002';END IF;
 INSERT INTO sa_domain.airtable_runs(transfer_id) VALUES(t.id);
 INSERT INTO sa_domain.airtable_tables(transfer_id,resource) SELECT t.id,resource FROM sa_domain.airtable_resources;
END $f$;
ALTER FUNCTION sa_domain.airtable_initialize(uuid) OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.airtable_initialize(uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.airtable_initialize(uuid) TO sa_media_writer;
CREATE FUNCTION sa_domain.airtable_expire() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('airtable-import',784145));
 UPDATE sa_domain.transfers SET state='expired',revision=revision+1,error_code='TRANSFER_EXPIRED',completed_at=now()
 WHERE kind='airtable' AND state IN('queued','validating','validated','applying') AND(expires_at<=now() OR generation<>(SELECT generation FROM sa_domain.runtime_state));
 UPDATE sa_domain.outbox j SET status='dead',lease_token=NULL,lease_until=NULL,last_error_code='TRANSFER_EXPIRED',completed_at=now(),revision=j.revision+1
 FROM sa_domain.transfers t WHERE t.kind='airtable' AND t.state='expired' AND j.id=t.job_id AND j.status IN('pending','leased');
END $f$;
ALTER FUNCTION sa_domain.airtable_expire() OWNER TO sa_worker;
REVOKE ALL ON FUNCTION sa_domain.airtable_expire() FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.airtable_expire() TO sa_media_writer;
ALTER FUNCTION sa_domain.v1_import_request(text,jsonb,uuid) RENAME TO import_request_csv;
REVOKE ALL ON FUNCTION sa_domain.import_request_csv(text,jsonb,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
CREATE FUNCTION sa_domain.v1_import_request(p_kind text,p_request jsonb,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE ctx jsonb;t sa_domain.transfers;cached_ jsonb;action_ text:=coalesce(p_request->>'action','validate');
BEGIN
 IF p_kind IS DISTINCT FROM 'airtable' THEN RETURN sa_domain.import_request_csv(p_kind,p_request,p_idempotency_key);END IF;
 ctx:=sa_domain.transfer_context('airtable');
 IF action_ NOT IN('validate','apply','cancel') THEN RAISE EXCEPTION 'Unknown import action' USING ERRCODE='22023';END IF;
 IF action_<>'cancel' THEN PERFORM sa_domain.airtable_ensure_enabled();END IF;
 IF action_='validate' THEN PERFORM sa_domain.check_fields(p_request,ARRAY['action']);
 ELSE
  PERFORM sa_domain.check_fields(p_request,ARRAY['action','id','version']);
  IF pg_input_is_valid(p_request->>'id','uuid') IS NOT TRUE THEN RAISE EXCEPTION 'Import ID required' USING ERRCODE='22023';END IF;
  SELECT * INTO t FROM sa_domain.transfers WHERE id=(p_request->>'id')::uuid FOR UPDATE;
  IF t.id IS NULL OR t.kind<>'airtable' OR NOT sa_domain.transfer_current(t) THEN RAISE EXCEPTION 'Import unavailable' USING ERRCODE='P0002';END IF;
 END IF;
 cached_:=sa_domain.begin_media_command('import.'||action_,p_idempotency_key,jsonb_build_object('kind',p_kind,'request',p_request));IF cached_ IS NOT NULL THEN RETURN cached_;END IF;
 IF action_='validate' THEN
  PERFORM sa_domain.airtable_expire();
  INSERT INTO sa_domain.transfers(actor_id,principal,generation,direction,kind)
  SELECT(ctx->>'auth_id')::uuid,CASE WHEN(ctx->>'platform')::boolean THEN 'platform' ELSE 'legacy_admin' END,generation,'import','airtable' FROM sa_domain.runtime_state RETURNING * INTO t;
  PERFORM sa_domain.airtable_initialize(t.id);
  RETURN sa_domain.transfer_command_finish('import.validate',p_idempotency_key,t.id,'airtable.validate');
 END IF;
 IF p_request->>'version' IS DISTINCT FROM t.generation::text||':'||t.revision::text THEN RAISE EXCEPTION 'Import version changed' USING ERRCODE='40001';END IF;
 IF action_='apply' THEN
  IF t.state<>'validated' OR t.invalid_rows<>0 OR t.expires_at<=now() THEN RAISE EXCEPTION 'Validate an error-free capture first' USING ERRCODE='55000';END IF;
  UPDATE sa_domain.transfers SET state='applying',revision=revision+1,error_code=NULL WHERE id=t.id;
  RETURN sa_domain.transfer_command_finish('import.apply',p_idempotency_key,t.id,'airtable.apply');
 END IF;
 IF t.state IN('completed','cancelled','expired') THEN RAISE EXCEPTION 'Import is already terminal' USING ERRCODE='55000';END IF;
 UPDATE sa_domain.transfers SET state='cancelled',revision=revision+1,completed_at=now() WHERE id=t.id;
 UPDATE sa_domain.outbox SET status='dead',lease_token=NULL,lease_until=NULL,last_error_code='TRANSFER_CANCELLED',completed_at=now(),revision=revision+1 WHERE id=t.job_id AND status IN('pending','leased');
 RETURN sa_domain.transfer_command_finish('import.cancel',p_idempotency_key,t.id,NULL);
END $f$;
ALTER FUNCTION sa_domain.v1_import_request(text,jsonb,uuid) OWNER TO sa_media_writer;
REVOKE ALL ON FUNCTION sa_domain.v1_import_request(text,jsonb,uuid) FROM PUBLIC,anon,authenticated,sa_app,service_role;
GRANT EXECUTE ON FUNCTION sa_domain.v1_import_request(text,jsonb,uuid) TO authenticated,sa_app;
CREATE OR REPLACE FUNCTION canto_api.v1_import_request(p_kind text,p_request jsonb,p_idempotency_key uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog AS $f$ SELECT sa_domain.v1_import_request(p_kind,p_request,p_idempotency_key) $f$;
CREATE POLICY airtable_read_queue ON sa_domain.outbox FOR SELECT TO sa_media_writer USING(actor_id=(SELECT sa_domain.request_uid()) AND event_type IN('airtable.validate','airtable.apply'));
CREATE POLICY airtable_cancel_queue ON sa_domain.outbox FOR UPDATE TO sa_media_writer USING(actor_id=(SELECT sa_domain.request_uid()) AND event_type IN('airtable.validate','airtable.apply')) WITH CHECK(actor_id=(SELECT sa_domain.request_uid()) AND event_type IN('airtable.validate','airtable.apply'));
-- Keep all statuses and row errors in the existing transfer API, with opaque IDs.
DO $f$ DECLARE d text;BEGIN
 d:=pg_get_functiondef('sa_domain.import_status_current(uuid,text,integer)'::regprocedure);
 d:=replace(d,'  WITH scan AS MATERIALIZED(SELECT * FROM sa_domain.transfer_rows WHERE transfer_id=t.id',
 $s$  IF t.kind='airtable' THEN
   WITH scan AS MATERIALIZED(SELECT * FROM sa_domain.airtable_rows WHERE transfer_id=t.id AND id<after_ ORDER BY id DESC LIMIT n+1),page AS(SELECT * FROM scan ORDER BY id DESC LIMIT n)
   SELECT jsonb_build_object('data',coalesce(jsonb_agg(jsonb_build_object('row',id,'resource',resource,'airtable_id',airtable_id,'state',state,'errors',errors,'result_id',target_id::text) ORDER BY id DESC),'[]'),'next_cursor',CASE WHEN(SELECT count(*) FROM scan)>n THEN sa_domain.next_cursor(min(id),context_) END) INTO r FROM page;
  ELSE
  WITH scan AS MATERIALIZED(SELECT * FROM sa_domain.transfer_rows WHERE transfer_id=t.id$s$);
 d:=replace(d,$s$  r:=sa_domain.transfer_projection(t)||jsonb_build_object('rows',r);$s$,$s$  END IF;
  r:=sa_domain.transfer_projection(t)||jsonb_build_object('rows',r);$s$);
 IF position('sa_domain.airtable_rows' IN d)=0 THEN RAISE EXCEPTION 'Import status patch failed';END IF;EXECUTE d;
END $f$;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_guard,sa_worker,sa_media_writer;
NOTIFY pgrst,'reload schema';
COMMIT;
