"""Durable provider ingress: verified cutover, environment, replay and custody."""
import datetime,json,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from fixtures import session,uid
from local_db import connect
from test_catalogue import seed_catalogue

def ownership(c):
 c.execute("UPDATE sa_sync.environment_state SET cutover=true")
 aid=uuid.uuid4()
 c.execute("""INSERT INTO sa_domain.cutover_acceptances(id,environment,source_run_id,generation,edit_revision,facts_sha256,artifact_sha256,source_frozen_at,source_watermark,freeze_attestation,verification,media_policy,media_report_sha256,identity_policy,identity_report_sha256,verified_at)
 VALUES(%s,'staging','synthetic',0,0,%s,%s,now()-interval '1 hour','synthetic','Synthetic test only','{}','all_available',%s,'all_eligible',%s,now())""",(aid,'a'*64,'a'*64,'a'*64,'a'*64))
 c.execute("""INSERT INTO sa_domain.cutover_commits(environment,actor_id,command_key,acceptance_id,generation,before_generation,edit_revision,source_run_id,source_archive_sha256,source_watermark,committed_at,result)
 VALUES('staging',%s,%s,%s,0,0,0,'synthetic',%s,'synthetic',now()-interval '1 hour','{}')""",(uid(999),uuid.uuid4(),aid,'a'*64))
 c.execute("INSERT INTO sa_snapshot_20261019.sa_settings(key,value,created_at,updated_at) VALUES('use_dashboard','true',now(),now())")
 c.execute("UPDATE sa_domain.warehouse_config SET provider='dashboard',enabled=true,one_day_facility='ONE',three_day_facility='THREE'")

class WarehouseReceipts(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');ownership(self.c);self.c.execute("UPDATE sa_snapshot_20261019.sa_orders SET order_source='dashboard',uc_order_id='ord_abcdef123456' WHERE id=1001");self.service()
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def service(self):self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);v=r.fetchall() if r.description else None;self.service();return v
 def payload(self,status='PROCESSING'):
  return {'event':'order.status_changed','event_id':'evt_'+uuid.uuid4().hex,'occurred_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'dashboard_order_id':'ord_abcdef123456','order_code':'S-1001','previous_status':'PENDING','status':status}
 def accept(self,p=None,sha='a'*64,project='scvojtvgnkmbupvyslmb'):
  p=p or self.payload();return self.c.execute('SELECT canto_api.squad_webhook_accept(%s,%s,%s,%s,%s,%s,%s)',('dashboard',p['event_id'],p['event'],p['occurred_at'],Jsonb(p),sha,project)).fetchone()[0]
 def test_acceptance_persists_receipt_and_job_atomically(self):
  r=self.accept();self.assertEqual(r['state'],'accepted');self.assertEqual(self.raw("SELECT r.state,j.event_type,j.aggregate_id FROM sa_domain.warehouse_receipts r JOIN sa_domain.outbox j ON j.id=r.job_id"),[('accepted','warehouse.webhook',1001)])
 def test_same_body_duplicate_has_one_job(self):
  p=self.payload();a=self.accept(p);b=self.accept(p);self.assertEqual(a['receipt_id'],b['receipt_id']);self.assertEqual(b['state'],'duplicate');self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='warehouse.webhook'"),[(1,)])
 def test_event_id_changed_body_rejected(self):
  p=self.payload();self.accept(p)
  with self.assertRaises(psycopg.errors.UniqueViolation):self.accept(p,'b'*64)
 def test_duplicate_survives_source_generation(self):
  p=self.payload();a=self.accept(p);self.raw('UPDATE sa_domain.runtime_state SET generation=1');self.assertEqual(self.accept(p)['state'],'duplicate');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_receipts'),[(1,)])
 def test_boolean_cutover_without_verified_epoch_quarantines(self):
  self.raw('DELETE FROM sa_domain.cutover_commits');r=self.accept();self.assertEqual(r['state'],'quarantined');self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='warehouse.webhook'"),[(0,)])
 def test_wrong_project_rejected(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.accept(project='levwrmvqdntngeasrtnb')
 def test_inactive_provider_quarantines(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_settings SET value='false' WHERE key='use_dashboard'");self.assertEqual(self.accept()['state'],'quarantined')
 def test_before_cutover_event_is_durably_ignored(self):
  p=self.payload();p['occurred_at']=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=1)).isoformat();self.assertEqual(self.accept(p)['state'],'ignored')
 def test_created_race_noop_persisted(self):
  p=self.payload('CREATED');p['previous_status']=None;p['dashboard_order_id']='ord_unknown';self.assertEqual(self.accept(p)['state'],'ignored')
 def test_unknown_order_quarantines_not_broad_lookup_by_code(self):
  p=self.payload();p['dashboard_order_id']='ord_unknown';self.assertEqual(self.accept(p)['state'],'quarantined')
 def test_wrong_order_code_quarantines(self):
  p=self.payload();p['order_code']='S-1002';self.assertEqual(self.accept(p)['state'],'quarantined')
 def test_untrusted_browser_cannot_acknowledge(self):
  self.c.execute('RESET ROLE');session(self.c,100)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.accept()
 def test_future_timestamp_rejected(self):
  p=self.payload();p['occurred_at']=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=1)).isoformat()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.accept(p)
 def test_stock_event_is_facility_bound(self):
  p=self.payload();p={'event':'stock.level_changed','event_id':p['event_id'],'occurred_at':p['occurred_at'],'facility_code':'UNKNOWN','trigger':'RESERVATION','changed_skus':[{'sku_code':'SKU A','previous_stock':20,'current_stock':10}]};self.assertEqual(self.accept(p)['state'],'quarantined')
 def test_stock_event_queues_without_changing_inventory_ledger(self):
  p=self.payload();p={'event':'stock.level_changed','event_id':p['event_id'],'occurred_at':p['occurred_at'],'facility_code':'ONE','trigger':'RESERVATION','changed_skus':[{'sku_code':'SKU A','previous_stock':20,'current_stock':10}]};self.assertEqual(self.accept(p)['state'],'accepted');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_inventory'),[(0,)])
 def test_reconciliation_owner_request_audited_idempotent(self):
  self.c.execute('RESET ROLE');session(self.c,999,'authenticated');key=uuid.uuid4();args=('dashboard','inventory',None,key);a=self.c.execute('SELECT canto_api.v1_integration_reconcile(%s,%s,%s,%s)',args).fetchone()[0];b=self.c.execute('SELECT canto_api.v1_integration_reconcile(%s,%s,%s,%s)',args).fetchone()[0];self.assertEqual(a,b);self.assertEqual(a['state'],'queued')
 def test_customer_cannot_reconcile(self):
  self.c.execute('RESET ROLE');session(self.c,103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT canto_api.v1_integration_reconcile('dashboard','inventory',NULL,%s)",(uuid.uuid4(),))


class WarehouseEffects(WarehouseReceipts):
 def claim(self):
  self.service();jobs=self.c.execute('SELECT canto_api.squad_job_claim(10)').fetchone()[0]['jobs'];self.assertEqual(len(jobs),1);self.assertEqual(jobs[0]['handler'],'warehouse_webhook');return jobs[0]
 def execute(self,j):
  self.service();return self.c.execute('SELECT canto_api.squad_warehouse_webhook(%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']))).fetchone()[0]
 def event(self,status='PROCESSING'):
  p=self.payload(status);r=self.accept(p);j=self.claim();return self.execute(j),j,p
 def test_provider_status_updates_shared_progress_once(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=1 WHERE order_id=1001');r,j,p=self.event();self.assertEqual(r['result']['state'],'applied');self.assertEqual(self.raw('SELECT uc_status FROM sa_snapshot_20261019.sa_orders WHERE id=1001'),[('PROCESSING',)]);self.assertTrue(self.execute(j)['replayed']);self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.audit WHERE operation='warehouse.event_applied'"),[(1,)])
 def test_disabled_original_user_does_not_discard_provider_truth(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=103');r,j,p=self.event();self.assertEqual(r['result']['state'],'applied')
 def test_terminal_cannot_regress_or_switch(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_status='COMPLETE',status=1 WHERE id=1001");r,j,p=self.event('CANCELLED');self.assertEqual(r['result']['state'],'quarantined');self.assertEqual(self.raw('SELECT uc_status,status FROM sa_snapshot_20261019.sa_orders WHERE id=1001'),[('COMPLETE',1)])
 def test_out_of_order_callback_ignored(self):
  r,j,p=self.event();q=self.payload('PENDING');q['occurred_at']=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=10)).isoformat();self.accept(q);r=self.execute(self.claim());self.assertEqual(r['result']['reason'],'OUT_OF_ORDER')
 def test_processing_cannot_regress_even_newer_callback(self):
  r,j,p=self.event();self.accept(self.payload('PENDING'));r=self.execute(self.claim());self.assertEqual(r['result']['reason'],'STATUS_REGRESSION')
 def test_stock_invalidates_only_bound_generation_provider_facility_sku(self):
  self.raw("INSERT INTO sa_domain.warehouse_inventory VALUES(0,'dashboard','ONE',1,20,now()-interval '1 minute',NULL),(0,'dashboard','THREE',1,20,now()-interval '1 minute',NULL),(0,'dashboard','ONE',2,20,now()-interval '1 minute',NULL)");p=self.payload();p={'event':'stock.level_changed','event_id':p['event_id'],'occurred_at':p['occurred_at'],'facility_code':'ONE','trigger':'RESERVATION','changed_skus':[{'sku_code':'SKU A','previous_stock':20,'current_stock':10}]};self.accept(p);r=self.execute(self.claim());self.assertEqual(r['result']['invalidated'],1);self.assertEqual(self.raw("SELECT available FROM sa_domain.warehouse_inventory WHERE facility_code='ONE' AND sku_id=1"),[(20,)])
 def test_fake_context_cannot_touch_another_order(self):
  r,j,p=self.event();self.c.execute('RESET ROLE');self.c.execute('SET LOCAL ROLE sa_integrator')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT sa_domain.warehouse_status_apply(1002,'dashboard','ord_x','S-1002','PROCESSING',now(),'evt_x')")
 def test_complete_dealer_purchase_uses_original_receipt_once(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET customer_id=110,customer_dealer_id=NULL WHERE id=1001");self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=1,rmp_class_id=1,rmp_brand_id=1,rmp_category_id=1 WHERE order_id=1001');r,j,p=self.event('COMPLETE');self.assertEqual(r['result']['state'],'applied');self.assertEqual(r['result']['stock_received'],1);self.assertEqual(self.raw('SELECT quantity FROM sa_snapshot_20261019.sa_stocks WHERE order_id=1001'),[(10,)]);self.accept(self.payload('COMPLETE'));self.execute(self.claim());self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_stocks WHERE order_id=1001'),[(1,)])

if __name__=='__main__':unittest.main(verbosity=2)
