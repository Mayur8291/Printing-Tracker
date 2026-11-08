"""Dashboard platform boundary and atomic commands, against synthetic PostgreSQL."""
import unittest,uuid,json
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,uid
from test_catalogue import seed_catalogue

class Dashboard(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN')
  self.c.execute("UPDATE sa_snapshot_20261019.sa_orders SET created_on='2026-10-26',created_at='2026-10-26'")
  self.c.execute('UPDATE sa_snapshot_20261019.sa_items SET item_type=1,rmp_brand_id=1,rmp_class_id=1,rmp_category_id=1 WHERE id IN(1002,2002)')
  session(self.c,999,'authenticated')
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);rows=r.fetchall() if r.description else None;session(self.c,999,'authenticated');return rows
 def call(self,action,**args):return self.c.execute('SELECT canto_api.dashboard(%s,%s)',(action,Jsonb(args))).fetchone()[0]
 def query(self,report='customers',tab='',filters=None,**query):
  return self.call('query',report=report,tab=tab,filters=filters or {'from':'2026-10-01','before':'2026-11-01','from_b':'2026-09-01','before_b':'2026-10-01'},query=query)
 def save(self,id=103,values=None,version=None,key=None):
  if id is not None and version is None:version=self.call('customer_get',id=id)['version']
  return self.call('customer_save',id=id,values=values or {'company_name':'Changed'},version=version,key=str(key or uuid.uuid4()))
 def writable(self):self.raw('UPDATE sa_sync.environment_state SET cutover=true')
 def test_capabilities(self):self.assertTrue(self.call('capabilities')['atomicCustomerSave'])
 def test_all_report_paths(self):
  for report,tab in [('customers',''),('order_reports',''),('rmp_order_reports',''),('tailor_reports',''),('order_tracking',''),('rmp_sales','overview'),('rmp_sales','brand'),('rmp_sales','class'),('rmp_sales','coordinator'),('customer_performance',''),('total_inventory','')]:
   with self.subTest(report=report,tab=tab),self.c.transaction():self.assertIn('summary',self.query(report,tab))
 def test_customer_role_not_dealer(self):
  r=self.query();self.assertEqual({x['id'] for x in r['data']},{'103','203'})
 def test_private_fields_absent(self):
  r=self.call('customer_get',id=103);self.assertNotIn('encrypted_password',str(r));self.assertNotIn('password',r)
 def test_no_context_after_call(self):
  self.call('capabilities');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.dashboard_context'),[(0,)])
 def test_mobile_admin_cannot_use_dashboard(self):
  self.c.execute('RESET ROLE');session(self.c,100)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.query()
 def test_platform_cannot_forge_context(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('INSERT INTO sa_domain.dashboard_context VALUES(pg_backend_pid(),txid_current(),auth.uid())')
 def test_platform_does_not_gain_direct_mobile_access(self):
  self.call('capabilities')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT canto_api.v1_sales_report('brands','2026-10-01','2026-11-01','{}',NULL,10)")
 def test_revoked_session_denied(self):
  self.raw('DELETE FROM auth.sessions WHERE user_id=%s',(uid(999),))
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.call('capabilities')
 def test_mirror_write_fence(self):
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.save()
 def test_customer_save(self):
  self.writable();r=self.save();self.assertEqual(r['company_name'],'Changed');self.assertEqual(self.raw('SELECT role FROM sa_snapshot_20261019.sa_users WHERE id=103'),[(3,)])
 def test_idempotent_retry(self):
  self.writable();key=uuid.uuid4();v=self.call('customer_get',id=103)['version'];a=self.save(version=v,key=key);b=self.save(version=v,key=key);self.assertEqual(a,b)
 def test_stale_version(self):
  self.writable();v=self.call('customer_get',id=103)['version'];self.save()
  with self.assertRaises(psycopg.DatabaseError) as e:self.save(version=v)
  self.assertEqual(e.exception.sqlstate,'PT409')
 def test_invalid_address_rolls_back_profile(self):
  self.writable()
  with self.c.transaction():
   try:self.save(values={'company_name':'Must rollback','addresses':[{'address':'','city':{'name':'X'},'state':{'name':'Y'},'postal_code':'400001'}]})
   except psycopg.errors.InvalidParameterValue:raise psycopg.Rollback()
   else:self.fail('Invalid address accepted')
  self.assertNotEqual(self.call('customer_get',id=103)['company_name'],'Must rollback')
 def test_customer_type_cannot_change_role(self):
  self.writable()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save(values={'customer_type':'distributor'})
 def test_paging_summary_and_search(self):
  r=self.query(items=1,search='Persona');self.assertEqual(r['totalCount'],2);self.assertEqual(len(r['data']),1);self.assertEqual(r['summary']['count'],2)
 def test_revision_change_rejects_continuation(self):
  r=self.query(items=1);self.raw('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1')
  with self.assertRaises(psycopg.DatabaseError) as e:self.query(items=1,page=2,revision=r['revision'])
  self.assertEqual(e.exception.sqlstate,'PT409')
 def test_numeric_money_summary(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET total_amount=1000.37,branding_amount=10.20,igst_amount=50.17 WHERE id=1002')
  r=self.query('rmp_order_reports',filters={'id':'1002'});self.assertEqual(r['summary']['sums']['total_amount'],'1060.74')
 def test_unknown_inventory_not_zero(self):
  r=self.query('total_inventory');self.assertTrue(r['data']);self.assertTrue(all(x['inventory'] is None for x in r['data']));self.assertEqual(r['summary']['unknownInventoryCount'],2)
 def test_comparison_arbitrary_periods(self):
  r=self.query('customer_performance');self.assertEqual(r['data'][0]['qtyA'],60);self.assertEqual(r['data'][0]['qtyB'],0);self.assertEqual(r['data'][0]['qtyChangePct'],-100)
 def test_page_size_bound(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.query(items=501)

 def export(self):
  return self.call('export_request',request={'report':'customers','filters':{},'query':{}},key=str(uuid.uuid4()))
 def run_export(self):
  self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
  job=self.c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0]['jobs'][0]
  result=self.c.execute('SELECT canto_api.squad_job_execute(%s,%s)',(job['id'],job['lease_token'])).fetchone()[0]
  self.c.execute('RESET ROLE');session(self.c,999,'authenticated');return result
 def test_background_export_capture_and_download(self):
  self.writable();export=self.export();result=self.run_export();self.assertEqual(result['state'],'done',result)
  ready=self.call('export_read',id=export['id'],page=1);self.assertEqual(ready['totalCount'],2);self.assertEqual(len(ready['data']),2)
  self.raw("UPDATE sa_snapshot_20261019.sa_users SET name='Later change' WHERE id=103")
  again=self.call('export_read',id=export['id'],page=1);self.assertEqual(ready['data'],again['data'])
 def test_background_export_detects_pre_capture_changes(self):
  self.writable();export=self.export();self.raw('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1');result=self.run_export()
  self.assertEqual(result['state'],'dead',result);self.assertEqual(self.call('export_read',id=export['id'])['state'],'dead')
 def test_kpi_matches_scoped_facts(self):
  self.assertEqual(self.query('unique_customers')['data'][0]['total_unique_customers'],2)

 def new_customer(self):
  return self.save(id=None,values={'company_name':'Synthetic dashboard company','contact_person':'Synthetic Customer','email':f'dashboard-{uuid.uuid4()}@example.invalid','addresses':[
   {'address':'One road','city':{'name':'Pune'},'state':{'name':'Maharashtra'},'postal_code':'411001','is_primary':True},
   {'address':'Two road','city':{'name':'Pune'},'state':{'name':'Maharashtra'},'postal_code':'411002','is_primary':False}]})
 def test_create_addresses_single_primary_and_account_intent(self):
  self.writable();r=self.new_customer();self.assertEqual(len(r['addresses']),2);self.assertEqual(sum(a['is_primary'] for a in r['addresses']),1)
  self.assertTrue(r['customer_code'].startswith('S-'))
  self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.dashboard_effects e JOIN sa_domain.outbox j ON j.id=e.job_id WHERE customer_id=%s AND event_type='person.saved'",(int(r['id']),)),[(1,)])
 def test_archive_retry_and_customer_role_boundary(self):
  self.writable();r=self.new_customer();key=str(uuid.uuid4())
  a=self.call('customer_archive',id=r['id'],version=r['version'],key=key)
  self.assertEqual(a,self.call('customer_archive',id=r['id'],version=r['version'],key=key))
  self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.dashboard_effects e JOIN sa_domain.outbox j ON j.id=e.job_id WHERE customer_id=%s AND event_type='account.status_changed'",(int(r['id']),)),[(1,)])
 def test_duplicate_address_rejected_atomically(self):
  self.writable();r=self.call('customer_get',id=103)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save(values={'addresses':[r['addresses'][0],r['addresses'][0]]})
 def test_disable_preserves_customer_role(self):
  self.writable();r=self.save(values={'status':'inactive'});self.assertEqual(r['status'],'inactive');self.assertEqual(self.raw('SELECT role FROM sa_snapshot_20261019.sa_users WHERE id=103'),[(3,)])
 def test_page_order_numeric_and_filter_count(self):
  r=self.query(sort={'key':'id','direction':'asc','numeric':True},items=1);self.assertEqual(r['data'][0]['id'],'103')
  r=self.query(filters={'from':'2026-10-01','before':'2026-11-01'},quick={'logic':'and','conditions':[{'field':'id','operator':'equals','value':'103'}]})
  self.assertEqual(r['totalCount'],1);self.assertEqual(r['summary']['count'],1)
 def test_expired_export_rejected(self):
  self.writable();r=self.export();self.run_export();self.raw("UPDATE sa_domain.dashboard_exports SET expires_at=now()-interval '1 second'")
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.call('export_read',id=r['id'])
 def test_export_other_admin_cannot_read(self):
  self.writable();r=self.export();self.raw('UPDATE sa_domain.dashboard_exports SET actor_id=%s',(uid(100),))
  with self.assertRaises(psycopg.errors.NoDataFound):self.call('export_read',id=r['id'])

 def test_export_batches_retry_and_finalize(self):
  self.writable();self.raw("INSERT INTO sa_snapshot_20261019.sa_users(id,name,email,role,created_at,updated_at) SELECT 800000+i,'Batch Customer '||i,'batch-'||i||'@example.invalid',3,now(),now() FROM generate_series(1,505) i")
  r=self.export();first=self.run_export();self.assertEqual(first['state'],'pending',first)
  partial=self.call('export_read',id=r['id'],page=1);self.assertEqual(partial['capturedRows'],500);self.assertEqual(partial['data'],[])
  second=self.run_export();self.assertEqual(second['state'],'done',second)
  full=self.call('export_read',id=r['id'],page=2);self.assertEqual(full['totalCount'],507);self.assertEqual(len(full['data']),7)
  self.assertEqual(self.raw('SELECT count(*),count(DISTINCT row_number) FROM sa_domain.dashboard_export_rows WHERE export_id=%s',(r['id'],)),[(507,507)])
 def test_export_change_between_batches_never_exposes_partial_file(self):
  self.writable();self.raw("INSERT INTO sa_snapshot_20261019.sa_users(id,name,email,role,created_at,updated_at) SELECT 800000+i,'Batch Customer '||i,'batch-'||i||'@example.invalid',3,now(),now() FROM generate_series(1,505) i")
  r=self.export();self.assertEqual(self.run_export()['state'],'pending');self.raw('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1')
  self.assertEqual(self.run_export()['state'],'dead');self.assertEqual(self.call('export_read',id=r['id'],page=1)['data'],[])
 def test_cleanup_removes_only_expired_exports(self):
  self.writable();expired=self.export();live=self.export()
  self.raw("UPDATE sa_domain.dashboard_exports SET expires_at=now()-interval '1 second' WHERE id=%s",(expired['id'],))
  self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
  self.c.execute("SELECT canto_api.squad_document_cleanup('{}')")
  self.assertEqual(self.raw('SELECT id::text FROM sa_domain.dashboard_exports'),[(live['id'],)])
 def test_customer_options_cover_all_pages(self):
  result=self.call('customer_options');self.assertIn('zones',result)
 def test_parent_event_completed_without_hiding_account_work(self):
  self.writable();r=self.new_customer()
  self.assertEqual(self.raw("SELECT status FROM sa_domain.outbox WHERE aggregate_id=%s AND event_type='dashboard.customer_saved'",(int(r['id']),)),[('done',)])
  self.assertEqual(self.raw("SELECT status FROM sa_domain.outbox WHERE aggregate_id=%s AND event_type='person.saved'",(int(r['id']),)),[('pending',)])

 def test_every_visible_and_export_field_has_a_projection(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates(item_id,marked_at,created_at,updated_at) VALUES(1001,now(),now(),now())")
  contract=json.loads((Path(__file__).resolve().parents[2]/'docs/squad-one-audit/dashboard-customers-reports-contract.json').read_text())
  for descriptor in contract:
   with self.subTest(report=descriptor['report'],tab=descriptor['tab']):
    rows=self.query(descriptor['report'],descriptor['tab'])['data'];self.assertTrue(rows)
    required={x['key'] for x in descriptor['columns']+descriptor['exportColumns']}
    self.assertTrue(required<=set(rows[0]),required-set(rows[0]))
 def test_rmp_summary_cache_is_revision_bound(self):
  first=self.query('rmp_order_reports');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.dashboard_summaries'),[(1,)])
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET total_amount=total_amount+17 WHERE id=1002');self.raw('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1')
  second=self.query('rmp_order_reports');self.assertNotEqual(first['summary'],second['summary']);self.assertNotEqual(first['revision'],second['revision'])
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.dashboard_summaries'),[(1,)])
 def test_fast_and_sorted_summary_reconcile(self):
  for report,tab in [('order_reports',''),('rmp_order_reports',''),('tailor_reports',''),('rmp_sales','class'),('customer_performance','')]:
   with self.subTest(report=report):
    fast=self.query(report,tab);slow=self.query(report,tab,sort={'key':'id','direction':'asc','numeric':True})
    self.assertEqual(fast['totalCount'],slow['totalCount'])
    for key,value in fast['summary']['sums'].items():
     if key in slow['summary']['sums']:self.assertEqual(value,slow['summary']['sums'][key],key)

 def test_mirror_exports_work_without_business_revision_or_write_authority(self):
  before=self.raw('SELECT edit_revision FROM sa_sync.environment_state')
  r=self.export();self.assertEqual(self.run_export()['state'],'done');self.assertEqual(self.call('export_read',id=r['id'])['state'],'completed')
  self.assertEqual(self.raw('SELECT edit_revision FROM sa_sync.environment_state'),before)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.save()
 def test_export_retry_reuses_read_job_without_changing_revision(self):
  request={'report':'customers','filters':{},'query':{}};key=str(uuid.uuid4())
  first=self.call('export_request',request=request,key=key);second=self.call('export_request',request=request,key=key);self.assertEqual(first,second)
  self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='dashboard.export'"),[(1,)])
 def test_mirror_export_worker_cannot_dispatch_business_jobs(self):
  self.writable();self.save();self.raw('UPDATE sa_sync.environment_state SET cutover=false');r=self.export();self.assertEqual(self.run_export()['state'],'done')
  self.assertEqual(self.call('export_read',id=r['id'])['state'],'completed')
  self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type<>'dashboard.export' AND status='leased'"),[(0,)])

 def test_missing_tailor_rate_is_unknown_not_zero(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates(item_id,marked_at,created_at,updated_at) VALUES(1001,now(),now(),now())")
  self.raw('UPDATE sa_snapshot_20261019.sa_base_products SET base_of=NULL')
  r=self.query('tailor_reports');self.assertIsNone(r['data'][0]['total_amount']);self.assertIsNone(r['summary']['sums']['total_amount'])
 def test_ambiguous_sku_is_explicit_and_not_fabricated(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_rmp_skus(name,rmp_class_id,rmp_brand_id,rmp_category_id,rmp_size_id,created_at,updated_at) VALUES('Ambiguous A',1,1,1,1,now(),now())")
  row=self.query('rmp_order_reports',filters={'id':'1002'})['data'][0]
  self.assertTrue(row['sku_ambiguous']);self.assertIsNone(row['rmp_sku_id']);self.assertIsNone(row['rmp_sku_name'])
 def test_customer_effects_expose_queued_account_work(self):
  self.writable();r=self.new_customer();self.assertEqual(r['account_sync']['state'],'pending')
  self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
  job=self.c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0]['jobs'][0];self.assertEqual(job['handler'],'account_reconciliation')
  target=self.c.execute('SELECT canto_api.squad_account_prepare(%s,%s)',(job['id'],job['lease_token'])).fetchone()[0]
  self.assertEqual(target['legacy_user_id'],r['id']);self.assertFalse(target['allowed'])

 def test_duplicate_size_rows_do_not_make_sku_ambiguous(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,created_at,updated_at) SELECT item_id,size_id,quantity,now(),now() FROM sa_snapshot_20261019.sa_quantities WHERE item_id=1002 LIMIT 1")
  row=self.query('rmp_order_reports',filters={'id':'1002'})['data'][0]
  self.assertFalse(row['sku_ambiguous']);self.assertIsNotNone(row['rmp_sku_id'])
 def test_required_coordinator_clear_rejected_atomically(self):
  self.writable();r=self.call('customer_get',id=103);self.assertIsNotNone(r['coordinator_id'])
  with self.c.transaction():
   try:self.save(values={'company_name':'Must rollback','coordinator_id':None})
   except psycopg.errors.InvalidParameterValue:raise psycopg.Rollback()
   else:self.fail('Required coordinator cleared')
  self.assertEqual(self.call('customer_get',id=103),r)
 def test_fast_and_sorted_performance_rows_match(self):
  fast=self.query('customer_performance')['data'];slow=self.query('customer_performance',sort={'key':'id','direction':'asc','numeric':True})['data']
  self.assertEqual(sorted(fast,key=lambda r:r['id']),sorted(slow,key=lambda r:r['id']))

 def test_rmp_relational_filter_sort_matches_projected_rows(self):
  fast=self.query('rmp_order_reports')['data'];slow=self.query('rmp_order_reports',sort={'key':'total_amount','direction':'asc','numeric':True})['data']
  self.assertEqual(sorted(fast,key=lambda r:r['id']),sorted(slow,key=lambda r:r['id']))
  chosen=fast[0]
  filtered=self.query('rmp_order_reports',quick={'logic':'and','conditions':[{'field':'id','operator':'equals','value':chosen['id']}]})
  self.assertEqual(filtered['data'],[chosen]);self.assertEqual(filtered['totalCount'],1)
 def test_bulk_customer_projection_matches_detail(self):
  for row in self.query()['data']:self.assertEqual(row,self.call('customer_get',id=row['id']))

if __name__=='__main__':unittest.main()
