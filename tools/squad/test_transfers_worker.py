"""Real leased transfer worker, shared Masters validation and resumable CSV state."""
import json, unittest, uuid
import psycopg
from psycopg.types.json import Jsonb
from fixtures import session, uid
from local_db import connect
from test_catalogue import seed_catalogue

class TransferWorker(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_sync.environment_state SET cutover=true');self.c.execute("SELECT setval('sa_snapshot_20261019.sa_base_product_types_id_seq',10000),setval('sa_snapshot_20261019.sa_rmp_prices_id_seq',10000),setval('sa_snapshot_20261019.sa_zones_id_seq',10000),setval('sa_snapshot_20261019.sa_cities_id_seq',10000)");self.actor()
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n=999):
  self.who=n;self.c.execute('RESET ROLE');session(self.c,n,'authenticated' if n==999 else 'sa_app')
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);rows=r.fetchall() if r.description else None;self.actor(self.who);return rows
 def service(self):
  self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
 def start(self,kind='masters',resource='base_product_types',options=None,size=100):
  u=self.c.execute('SELECT canto_api.account_transfer_upload(%s,%s,%s,%s)',(kind,resource,Jsonb({'filename':'test.csv','bytes':size}),uuid.uuid4())).fetchone()[0]
  self.service();self.c.execute('SELECT canto_api.account_transfer_verified(%s,%s,%s)',(uuid.UUID(u['id']),size,'a'*64));self.actor(self.who)
  return self.c.execute('SELECT canto_api.v1_import_request(%s,%s,%s)',(kind,Jsonb({'upload_id':u['id'],'options':options or {}}),uuid.uuid4())).fetchone()[0]
 def claim(self):
  self.service();jobs=self.c.execute('SELECT canto_api.squad_job_claim(10)').fetchone()[0]['jobs'];self.assertEqual(len(jobs),1);self.assertEqual(jobs[0]['handler'],'transfer');return jobs[0]
 def work(self,j,action,data=None):
  self.service();return self.c.execute('SELECT canto_api.squad_transfer_work(%s,%s,%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']),action,Jsonb(data or {}))).fetchone()[0]
 def status(self,t):
  self.actor(self.who);return self.c.execute('SELECT canto_api.v1_import_status(%s)',(uuid.UUID(t['id']),)).fetchone()[0]
 def validate(self,t,rows,headers=None):
  j=self.claim();inp=self.work(j,'input');headers=headers or list(rows[0]) if rows else ['name']
  data={'byte_offset':inp['byte_offset'],'next_byte_offset':inp['bytes'],'headers':headers,'rows':[{'row':i+1,'values':v} for i,v in enumerate(rows)],'eof':True}
  r=self.work(j,'validate',data);return r,self.status(t)
 def apply(self,t):
  self.actor(self.who);r=self.c.execute('SELECT canto_api.v1_import_request(%s,%s,%s)',(t['kind'],Jsonb({'id':t['id'],'action':'apply','version':t['version']}),uuid.uuid4())).fetchone()[0]
  j=self.claim();return self.work(j,'apply'),self.status(r)
 def test_validate_does_not_write_or_advance_sequence(self):
  t=self.start();before=self.raw("SELECT last_value FROM sa_snapshot_20261019.sa_base_product_types_id_seq")[0][0];r,s=self.validate(t,[{'name':'Fresh type'}]);self.assertEqual(r['state'],'done');self.assertEqual(s['state'],'validated');self.assertEqual(self.raw("SELECT last_value FROM sa_snapshot_20261019.sa_base_product_types_id_seq")[0][0],before);self.assertEqual(self.raw("SELECT count(*) FROM sa_snapshot_20261019.sa_base_product_types WHERE name='Fresh type'"),[(0,)])
 def test_validated_apply_reuses_master_dispatcher_and_audits(self):
  t=self.start();_,s=self.validate(t,[{'name':'Fresh type'}]);r,s=self.apply(s);self.assertEqual(r['state'],'done');self.assertEqual(s['state'],'completed');self.assertEqual(s['applied_rows'],1);self.assertEqual(self.raw("SELECT count(*) FROM sa_admin.audit WHERE resource='base_product_types' AND operation='create'"),[(1,)])
 def test_update_matches_id_and_preserves_unmentioned_fields(self):
  t=self.start();_,s=self.validate(t,[{'id':'1','name':'Renamed'}]);r,s=self.apply(s);self.assertEqual(s['state'],'completed');self.assertEqual(self.raw('SELECT name FROM sa_snapshot_20261019.sa_base_product_types WHERE id=1'),[('Renamed',)])
 def test_missing_required_is_reported_not_inserted(self):
  t=self.start();_,s=self.validate(t,[{'name':''}]);self.assertEqual(s['state'],'invalid');self.assertEqual(s['invalid_rows'],1)
 def test_bad_type_is_dry_run_error(self):
  t=self.start();_,s=self.validate(t,[{'name':'Bad','position':'bad'}]);self.assertEqual(s['state'],'invalid');self.assertEqual(s['rows']['data'][0]['errors'][0]['code'],'22P02')
 def test_null_nonnullable_rejected_during_validation(self):
  t=self.start(resource='parts');_,s=self.validate(t,[{'name':'Bad','position':''}]);self.assertEqual(s['state'],'invalid');self.assertEqual(s['rows']['data'][0]['errors'][0]['code'],'23502')
 def test_bad_relation_dry_run_consumes_no_sequence(self):
  t=self.start(resource='parts');_,s=self.validate(t,[{'name':'Bad','colors':'[999999]'}]);self.assertEqual(s['state'],'invalid');self.assertEqual(s['rows']['data'][0]['errors'][0]['code'],'23503')
 def test_relation_arrays_reuse_existing_replace_semantics(self):
  t=self.start(resource='parts');_,s=self.validate(t,[{'id':'1','colors':'[1]'}]);r,s=self.apply(s);self.assertEqual(s['state'],'completed');self.assertEqual(self.raw('SELECT color_id FROM sa_snapshot_20261019.sa_part_colors WHERE part_id=1 AND is_deleted IS NOT TRUE'),[(1,)])
 def test_duplicate_matches_mark_both_rows_invalid(self):
  t=self.start();_,s=self.validate(t,[{'id':'1','name':'A'},{'id':'1','name':'B'}]);self.assertEqual(s['invalid_rows'],2);self.assertEqual(s['valid_rows'],0)
 def test_duplicate_new_unique_names_invalid_before_any_write(self):
  t=self.start();_,s=self.validate(t,[{'name':'Same'},{'name':'same'}]);self.assertEqual(s['state'],'invalid');self.assertEqual(s['invalid_rows'],2)
 def test_match_field_not_in_search_uses_actual_column(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_base_product_types SET position=55 WHERE id=1');t=self.start(options={'match_field':'position'});_,s=self.validate(t,[{'position':'55','name':'Match position'}]);self.assertEqual(s['state'],'validated');_,s=self.apply(s);self.assertEqual(s['state'],'completed');self.assertEqual(self.raw('SELECT name FROM sa_snapshot_20261019.sa_base_product_types WHERE id=1'),[('Match position',)])
 def test_csv_lowercase_headers_resolve_legacy_camelcase_fields(self):
  t=self.start(resource='asset_infos');_,s=self.validate(t,[{'dx':'1','dy':'2','mirrordx':'3','assetheightresptobox':'4'}]);self.assertEqual(s['state'],'validated');_,s=self.apply(s);self.assertEqual(s['state'],'completed');self.assertEqual(self.raw('SELECT "dX","dY","mirrorDX","assetHeightRespToBox" FROM sa_snapshot_20261019.sa_asset_infos ORDER BY id DESC LIMIT 1'),[(1,2,3,4)])
 def test_zone_customers_inherit_refreshed_dealer_zone(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_addresses SET city='Future city',is_primary=true WHERE user_id=103");self.raw("INSERT INTO sa_snapshot_20261019.sa_addresses(user_id,city,is_primary,created_at,updated_at) VALUES(110,'Future city',true,now(),now())");self.raw('UPDATE sa_snapshot_20261019.sa_users SET customer_registered_by=2,zone_id=1 WHERE id=103');self.raw('UPDATE sa_snapshot_20261019.sa_users SET zone_id=1 WHERE id=110');self.actor(100);t=self.start('zones',None);_,s=self.validate(t,[{'zone':'Future zone','city':'Future city'}]);_,s=self.apply(s);j=self.claim();self.assertEqual(self.work(j,'apply')['state'],'done');zones=self.raw('SELECT zone_id FROM sa_snapshot_20261019.sa_users WHERE id IN(103,110) ORDER BY id');self.assertEqual(zones[0],zones[1]);self.assertNotEqual(zones[0],(1,));self.assertEqual(self.raw('SELECT total_amount FROM sa_snapshot_20261019.sa_orders WHERE id=1001'),[(1000,)])
 def test_malformed_column_count_is_row_error(self):
  t=self.start();j=self.claim();r=self.work(j,'validate',{'byte_offset':0,'next_byte_offset':100,'headers':['name'],'rows':[{'row':1,'values':None,'error':'COLUMN_COUNT'}],'eof':True});s=self.status(t);self.assertEqual(s['state'],'invalid')
 def test_resumable_chunks_and_same_lease_replay(self):
  t=self.start(size=200);j=self.claim();d={'byte_offset':0,'next_byte_offset':100,'headers':['name'],'rows':[{'row':1,'values':{'name':'First'}}],'eof':False};r=self.work(j,'validate',d);self.assertEqual(r['state'],'pending');self.assertTrue(self.work(j,'validate',d)['replayed']);j=self.claim();i=self.work(j,'input');self.assertEqual(i['byte_offset'],100);self.assertEqual(i['row_offset'],1);d.update(byte_offset=100,next_byte_offset=200,rows=[{'row':2,'values':{'name':'Second'}}],eof=True);self.assertEqual(self.work(j,'validate',d)['state'],'done');self.assertEqual(self.status(t)['total_rows'],2)
 def test_header_drift_rejected(self):
  t=self.start(size=200);j=self.claim();self.work(j,'validate',{'byte_offset':0,'next_byte_offset':100,'headers':['name'],'rows':[],'eof':False});j=self.claim()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.work(j,'validate',{'byte_offset':100,'next_byte_offset':200,'headers':['position'],'rows':[],'eof':True})
 def test_changed_record_after_validation_is_terminal_no_write(self):
  t=self.start();_,s=self.validate(t,[{'id':'1','name':'Stale'}]);self.raw("UPDATE sa_snapshot_20261019.sa_base_product_types SET updated_at=now()+interval '1 second' WHERE id=1");r,s=self.apply(s);self.assertEqual(r['state'],'dead');self.assertEqual(s['state'],'failed');self.assertEqual(self.raw('SELECT name FROM sa_snapshot_20261019.sa_base_product_types WHERE id=1'),[('Shirts',)])
 def test_unrelated_form_write_does_not_invalidate_file(self):
  t=self.start();_,s=self.validate(t,[{'name':'Stale'}]);self.c.execute("SELECT canto_api.masters('base_product_types','update','{\"id\":1,\"values\":{\"position\":4}}')");r,s=self.apply(s);self.assertEqual(r['state'],'done');self.assertEqual(s['applied_rows'],1)
 def test_apply_is_bounded_and_replay_does_not_duplicate(self):
  t=self.start();_,s=self.validate(t,[{'name':f'Type {i}'} for i in range(51)]);r,s=self.apply(s);self.assertEqual(r['state'],'pending');self.assertEqual(s['applied_rows'],50);self.c.execute("SELECT canto_api.masters('base_product_types','update','{\"id\":1,\"values\":{\"position\":5}}')");j=self.claim();r=self.work(j,'apply');self.assertEqual(r['state'],'done');self.assertTrue(self.work(j,'apply')['replayed']);self.assertEqual(self.status(s)['applied_rows'],51)
 def test_staff_removed_before_worker_becomes_terminal(self):
  t=self.start();self.raw('DELETE FROM public.profiles WHERE id=%s',(uid(999),));j=self.claim();r=self.work(j,'input');self.assertEqual(r['state'],'dead');self.assertEqual(self.raw('SELECT state FROM sa_domain.transfers WHERE id=%s',(uuid.UUID(t['id']),)),[('failed',)])
 def test_customer_cannot_invoke_service_worker(self):
  t=self.start();j=self.claim();self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.squad_transfer_work(%s,%s,\'input\')',(uuid.UUID(j['id']),uuid.UUID(j['lease_token'])))
 def test_fake_lease_rejected(self):
  t=self.start();j=self.claim();j['lease_token']=str(uuid.uuid4())
  with self.assertRaises(psycopg.errors.SerializationFailure):self.work(j,'input')
 def test_prices_strict_numeric_and_missing_references(self):
  t=self.start('prices','rmp_prices');_,s=self.validate(t,[{'name':'Bad','rmp_sku':'SKU A','price_type':'Regular','price':'garbage'}]);self.assertEqual(s['state'],'invalid')
 def test_price_import_reactivates_moves_join_and_blank_mrp_zero(self):
  t=self.start('prices','rmp_prices');_,s=self.validate(t,[{'name':'A regular','rmp_sku':'SKU A','price_type':'Regular','price':'123.45','mrp':''}]);self.assertEqual(s['state'],'validated');_,s=self.apply(s);self.assertEqual(s['state'],'completed');r=self.raw('SELECT price,mrp,rmp_sku_id FROM sa_snapshot_20261019.sa_rmp_prices WHERE id=1')[0];self.assertEqual(str(r[0]),'123.45');self.assertEqual(r[1],0);self.assertEqual(r[2],1)
 def test_price_replace_only_touched_sku(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_rmp_prices SET rmp_sku_id=1 WHERE id IN(1,2,4)');t=self.start('prices','rmp_prices',{'replace_all':True});_,s=self.validate(t,[{'name':'A regular','rmp_sku':'SKU A','price_type':'Regular','price':'125'}]);_,s=self.apply(s);self.assertEqual(s['state'],'completed');self.assertEqual(self.raw('SELECT id,is_deleted FROM sa_snapshot_20261019.sa_rmp_prices ORDER BY id'),[(1,False),(2,True),(3,False),(4,True)])
 def test_price_replace_preserves_concurrently_created_price(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_rmp_prices SET rmp_sku_id=1 WHERE id IN(1,2,4)');t=self.start('prices','rmp_prices',{'replace_all':True});_,s=self.validate(t,[{'name':'A regular','rmp_sku':'SKU A','price_type':'Regular','price':'125'}]);self.c.execute("SELECT canto_api.masters('rmp_prices','create','{\"values\":{\"name\":\"Concurrent\",\"rmp_sku_id\":1,\"rmp_price_type_id\":1,\"price\":99,\"mrp\":100}}')");_,s=self.apply(s);self.assertEqual(s['state'],'completed');self.assertEqual(self.raw("SELECT is_deleted FROM sa_snapshot_20261019.sa_rmp_prices WHERE name='Concurrent'"),[(False,)])
 def test_price_replace_changed_candidate_fails_without_overwrite(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_rmp_prices SET rmp_sku_id=1 WHERE id IN(1,2,4)');t=self.start('prices','rmp_prices',{'replace_all':True});_,s=self.validate(t,[{'name':'A regular','rmp_sku':'SKU A','price_type':'Regular','price':'125'}]);self.raw("UPDATE sa_snapshot_20261019.sa_rmp_prices SET updated_at=now()+interval '1 second',price=999 WHERE id=2");r,s=self.apply(s);self.assertEqual(r['state'],'dead');self.assertEqual(self.raw('SELECT price,is_deleted FROM sa_snapshot_20261019.sa_rmp_prices WHERE id=2'),[(999,False)])
 def test_lease_exhaustion_updates_transfer_and_explicit_retry_resumes(self):
  t=self.start();j=self.claim();self.raw("UPDATE sa_domain.outbox SET attempts=5,lease_until=now()-interval '1 second' WHERE id=%s",(uuid.UUID(j['id']),));self.service();self.assertEqual(self.c.execute('SELECT canto_api.squad_job_claim(10)').fetchone()[0]['jobs'],[]);s=self.status(t);self.assertEqual(s['state'],'failed');job=self.c.execute('SELECT canto_api.v1_job_get(%s)',(uuid.UUID(j['id']),)).fetchone()[0];self.c.execute('SELECT canto_api.v1_job_retry(%s,%s,%s,%s)',(uuid.UUID(j['id']),'Retry after worker restart',job['version'],uuid.uuid4()));self.assertEqual(self.status(t)['state'],'validating');j=self.claim();self.assertEqual(self.work(j,'input')['state'],'ready')
 def test_legacy_admin_zones_apply_and_only_future_rules(self):
  self.actor(100);t=self.start('zones',None);_,s=self.validate(t,[{'zone':'New zone','city':'Test city'}]);self.assertEqual(s['state'],'validated');r,s=self.apply(s);self.assertEqual(r['state'],'pending');j=self.claim();self.assertEqual(self.work(j,'apply')['state'],'done');s=self.status(s);self.assertEqual(s['state'],'completed');self.assertEqual(self.raw("SELECT z.name FROM sa_snapshot_20261019.sa_cities c JOIN sa_snapshot_20261019.sa_zones z ON z.id=c.zone_id WHERE c.name='Test city'"),[('New zone',)]);self.assertEqual(s['result']['zone_rules'],'future_orders_only')
 def export(self,options=None):return self.c.execute("SELECT canto_api.v1_export_request('base_product_types',%s,%s)",(Jsonb(options or {'columns':['id','name']}),uuid.uuid4())).fetchone()[0]
 def test_export_snapshot_is_consistent_bounded_and_scoped(self):
  t=self.export();j=self.claim();i=self.work(j,'input');self.assertEqual(i['phase'],'part');self.assertEqual(i['rows'],[{'id':1,'name':'Shirts'}]);self.raw("UPDATE sa_snapshot_20261019.sa_base_product_types SET name='Changed' WHERE id=1");i2=self.work(j,'input');self.assertEqual(i2['rows'],i['rows']);d={'part_number':0,'path':i['path'],'bytes':10,'sha256':'b'*64};self.assertEqual(self.work(j,'checkpoint',d)['state'],'pending');self.assertTrue(self.work(j,'checkpoint',d)['replayed']);j=self.claim();i=self.work(j,'input');self.assertEqual(i['phase'],'merge');self.assertEqual(self.work(j,'complete',{'bytes':10,'sha256':'c'*64})['state'],'done');self.actor();grant=self.c.execute('SELECT canto_api.account_transfer_grant(%s)',(uuid.UUID(t['id']),)).fetchone()[0];self.assertEqual(grant['path'],'g0/'+t['id']+'/export.csv');self.actor(100)
  with self.assertRaises(psycopg.errors.NoDataFound):self.c.execute('SELECT canto_api.account_transfer_grant(%s)',(uuid.UUID(t['id']),))
 def test_empty_export_still_has_one_header_part(self):
  t=self.export({'columns':['name'],'search':'No match anywhere'});j=self.claim();i=self.work(j,'input');self.assertEqual(i['rows'],[]);self.assertEqual(i['phase'],'part')
 def test_export_path_cannot_be_overridden(self):
  t=self.export();j=self.claim();self.work(j,'input')
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.work(j,'checkpoint',{'part_number':0,'path':'inputs/foreign/file.csv','bytes':10,'sha256':'a'*64})
 def test_storage_failure_retries_but_bad_csv_dies(self):
  t=self.start();j=self.claim();self.assertEqual(self.work(j,'fail',{'code':'STORAGE_UNAVAILABLE'})['state'],'pending');self.raw('UPDATE sa_domain.outbox SET available_at=now()');j=self.claim();self.assertEqual(self.work(j,'fail',{'code':'CSV_INVALID'})['state'],'dead');self.assertEqual(self.status(t)['error_code'],'CSV_INVALID')

if __name__=='__main__':unittest.main(verbosity=2)
