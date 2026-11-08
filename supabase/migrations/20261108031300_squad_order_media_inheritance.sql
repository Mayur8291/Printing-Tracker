BEGIN;
-- Inherit verified references only when the copied source leaf still matches.
CREATE OR REPLACE FUNCTION sa_domain.attach_order_design(p_item_id bigint,p_spec jsonb) RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog AS $f$
DECLARE b sa_snapshot_20261019.sa_brandings:=sa_domain.design_for_order(p_spec,true);id_ bigint;
BEGIN
 INSERT INTO sa_snapshot_20261019.sa_brandings(item_id,parent_id,image,mockup_image,attachment,comment,print_side,print_area,branding_type,graphic_dimension,graphic_width,graphic_height,graphic_unit,created_at,updated_at)
 VALUES(p_item_id,b.id,b.image,b.mockup_image,b.attachment,b.comment,b.print_side,b.print_area,b.branding_type,b.graphic_dimension,b.graphic_width,b.graphic_height,b.graphic_unit,now(),now()) RETURNING id INTO id_;
 INSERT INTO sa_media.references(resource,record_id,field,pointer,source_value,source_url,status,sha256)
 SELECT 'brandings',id_,r.field,r.pointer,r.source_value,r.source_url,r.status,r.sha256 FROM sa_media.references r WHERE r.resource='brandings' AND r.record_id=b.id
 AND r.field IN('image','mockup_image','attachment','comment')
 AND r.source_value=sa_domain.media_leaf(CASE r.field WHEN 'image' THEN b.image WHEN 'mockup_image' THEN b.mockup_image WHEN 'attachment' THEN b.attachment ELSE b.comment END,r.pointer);
 RETURN id_;
END $f$;

COMMIT;
