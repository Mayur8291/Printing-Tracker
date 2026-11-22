-- Additive API: existing configuration reuse and outstanding requests are unchanged.
BEGIN;
GRANT CREATE ON SCHEMA sa_domain TO sa_executor;
CREATE FUNCTION sa_domain.v1_custom_design_create(p_configuration jsonb,p_name text,p_comment text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $f$
DECLARE a sa_domain.actor:=sa_domain.catalog_actor('configure');cached jsonb;config_ jsonb;hash_ text;generation_ bigint;id_ bigint;part_id_ bigint;
 part_ jsonb;addon_ jsonb;reused_ boolean;version_ text;
BEGIN
 IF nullif(btrim(p_name),'') IS NULL OR length(p_name)>120 OR p_comment IS NULL OR length(p_comment)>4000 THEN RAISE EXCEPTION 'Provide a name up to 120 characters and a comment up to 4000 characters' USING ERRCODE='22023';END IF;
 cached:=sa_domain.begin_command('preset.configured',p_idempotency_key,jsonb_build_object('configuration',p_configuration,'name',p_name,'comment',p_comment,'creation_mode','separate'));IF cached IS NOT NULL THEN RETURN cached;END IF;
 config_:=sa_domain.normalize_configuration(p_configuration);hash_:=encode(sha256(convert_to(config_::text,'UTF8')),'hex');
 SELECT generation INTO generation_ FROM sa_domain.runtime_state;
 -- Every explicit creation has its own artwork; retries still replay the same command.
 reused_:=false;
  INSERT INTO sa_snapshot_20261019.sa_products(product_type,name,comment,base_product_id,fabric_id,fabric_color_id,category_id,created_by_id,branding_enabled,created_at,updated_at)
  VALUES(0,btrim(p_name),p_comment,(config_->>'base_product_id')::bigint,(config_->>'fabric_id')::bigint,(config_->>'fabric_color_id')::bigint,(config_->>'category_id')::bigint,a.user_id,false,now(),now()) RETURNING id INTO id_;
  UPDATE sa_snapshot_20261019.sa_products SET style_number='CP-'||lpad(id_::text,greatest(4,length(id_::text)),'0') WHERE id=id_;
  FOR part_ IN SELECT value FROM jsonb_array_elements(config_->'parts') LOOP
   INSERT INTO sa_snapshot_20261019.sa_product_parts(product_id,part_id,part_color_id,created_at,updated_at)
   VALUES(id_,(part_->>'part_id')::bigint,(part_->>'color_link_id')::bigint,now(),now()) RETURNING id INTO part_id_;
   FOR addon_ IN SELECT value FROM jsonb_array_elements(part_->'addons') LOOP
    INSERT INTO sa_snapshot_20261019.sa_product_part_add_ons(product_part_id,add_on_id,add_on_color_id,created_at,updated_at)
    VALUES(part_id_,(addon_->>'addon_id')::bigint,(addon_->>'color_link_id')::bigint,now(),now());
   END LOOP;
  END LOOP;
  version_:=sa_domain.bump_version('product',id_,sa_domain.version('product',id_));
 RETURN sa_domain.finish_command('preset.configured',p_idempotency_key,'product',id_,jsonb_build_object('id',id_::text,'version',version_,'reused',reused_,'fingerprint',hash_,
 'style_number',(SELECT style_number FROM sa_snapshot_20261019.sa_products WHERE id=id_)),jsonb_build_object('reused',reused_));
END $f$;
ALTER FUNCTION sa_domain.v1_custom_design_create(jsonb,text,text,uuid) OWNER TO sa_executor;
REVOKE ALL ON FUNCTION sa_domain.v1_custom_design_create(jsonb,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION sa_domain.v1_custom_design_create(jsonb,text,text,uuid) TO sa_app;
CREATE FUNCTION canto_api.v1_custom_design_create(p_configuration jsonb,p_name text,p_comment text,p_idempotency_key uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $f$
 SELECT sa_domain.v1_custom_design_create(p_configuration,p_name,p_comment,p_idempotency_key);
$f$;
REVOKE ALL ON FUNCTION canto_api.v1_custom_design_create(jsonb,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION canto_api.v1_custom_design_create(jsonb,text,text,uuid) TO sa_app;
REVOKE CREATE ON SCHEMA sa_domain FROM sa_executor;
NOTIFY pgrst, 'reload schema';
COMMIT;
