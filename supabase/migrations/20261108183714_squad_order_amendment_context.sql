BEGIN;
-- Preserve the original ordered size type during a lossless replacement amendment.
-- This pure projection receives only already-authorized item records; no new lookup or ACL.
CREATE OR REPLACE FUNCTION sa_domain.item_projection(i jsonb,a sa_domain.actor,p_version text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $f$
 SELECT jsonb_build_object('id',i->>'id','order_id',i->>'order_id','type',i->'item_type','product_id',i->>'product_id',
 'rmp_class_id',i->>'rmp_class_id','rmp_brand_id',i->>'rmp_brand_id','rmp_category_id',i->>'rmp_category_id',
 'size_type',i->'size_type','total_quantity',i->'total_quantity','sample_order',i->'sample_order','worker_stage',i->'job_worker_status',
 'cut',i->'cutting_done','assigned',i->'assigned_to_tailor_quantity','sewn',i->'completed_by_tailor_quantity','dispatched',i->'dispatched_quantity',
 'provider_status',i->'uc_order_status','comment',left(i->>'comment',4000),'comment_truncated',length(i->>'comment')>4000,
 'version',p_version,'progress',jsonb_build_object('cutting',i->'cutting_status','sample_cutting',i->'sample_cutting_status',
 'sample_cut',i->'sample_cutting_done','tailor',i->'tailor_job_status','inspection',i->'completed_by_tailor_quantity_status','dispatch',i->'dispatched_status',
 'jobsheet_assigned',i->'job_sheet_assigned','jobsheet_due_at',(i->>'job_sheet_due_on')||'Z','jobsheet_completed_at',(i->>'job_sheet_completion_by')||'Z'))
 ||CASE WHEN a.role_id IN(0,1,3,10) THEN jsonb_build_object('unit_amount',i->>'per_piece_amount','total_amount',i->>'total_amount',
 'branding_amount',i->>'branding_amount','sample_amount',i->>'sample_total_amount','cgst_amount',i->>'cgst_amount','sgst_amount',i->>'sgst_amount','igst_amount',i->>'igst_amount') ELSE '{}' END
 ||CASE WHEN a.role_id IN(2,11) THEN jsonb_build_object('worker_unit_cost',i->>'worker_per_piece_amount','worker_total_cost',i->>'worker_total_amount') ELSE '{}' END
 ||CASE WHEN a.role_id IN(0,1,2,4,8,11) THEN jsonb_build_object('fabric_consumption',jsonb_build_object('per_piece',i->>'weight_per_piece','total',i->>'total_weight','basis','stored_order_item')) ELSE '{}' END
$f$;

NOTIFY pgrst,'reload schema';
COMMIT;
