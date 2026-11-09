/** Positive transport allowlist for a read-only acceptance run. */
export const STAGING_ORIGIN='https://scvojtvgnkmbupvyslmb.supabase.co';
const READ_RPC=new Set(`v1_me v1_app_bootstrap v1_audit_list v1_base_product_get v1_banners_list v1_catalog_options v1_catalog_tree v1_configurator_options v1_coordinator_requests v1_cutting_detail v1_cutting_queue v1_dashboard v1_dealer_stock v1_deliveries_list v1_delivery_failures v1_dispatch_detail v1_dispatch_queue v1_document_get v1_documents_list v1_factories_list v1_factory_queue v1_import_status v1_integration_get v1_job_get v1_jobs_list v1_jobsheets_list v1_mail_settings_read v1_milestones_list v1_notifications_list v1_operational_items v1_order_get v1_order_item_get v1_orders_list v1_people_list v1_person_get v1_presets_list v1_product_images v1_production_progress v1_promotions_list v1_ratings_list v1_relationship_options v1_responsibilities_list v1_responsibility_get v1_rmp_detail v1_rmp_search v1_rmp_variants v1_sales_coordinator_metrics v1_sales_report v1_settings_read v1_tailor_earnings v1_tailor_leaderboard v1_tailor_work v1_task_assignees v1_task_get v1_tasks_list v1_work_metrics v1_warehouse_schedule_status v1_weekly_tailor_schedule_status v1_airtable_reports_status`.split(' '));
export function transportAllowed({url,method,body},base='http://localhost:5183') {
 let parsed;try{parsed=new URL(url);}catch{return false;}
 if(['data:','blob:','about:'].includes(parsed.protocol))return true;
 if(parsed.origin===new URL(base).origin)return ['GET','HEAD'].includes(method);
 if(parsed.origin!==STAGING_ORIGIN)return false;
 if(method==='OPTIONS')return true;
 const p=parsed.pathname;
 if(p==='/auth/v1/token')return method==='POST'&&['password','refresh_token'].includes(parsed.searchParams.get('grant_type'));
 if(p==='/auth/v1/user')return method==='GET';
 if(p==='/auth/v1/logout')return method==='POST';
 if(p.startsWith('/rest/v1/rpc/')&&method==='POST'){
  const name=p.slice('/rest/v1/rpc/'.length);
  if(READ_RPC.has(name))return true;
  if(name==='v1_stock_reconciliation'){
   try{return ['review','history'].includes(JSON.parse(body??'{}').p_action);}catch{return false;}
  }
 }
 if(p==='/functions/v1/squad-account/media/grants')return method==='POST';
 if(p.startsWith('/storage/v1/object/sign/'))return method==='GET';
 return false;
}
