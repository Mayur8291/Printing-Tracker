"""Bounded warehouse polling, delegated authority and existing read-only jobs."""
import unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc,uid
from test_catalogue import seed_catalogue
from test_warehouse_receipts import ownership
class Schedule(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):self.c=connect();self.c.execute('BEGIN');ownership(self.c);self.actor(100)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,id=100):self.c.execute('RESET ROLE');session(self.c,id)
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);v=r.fetchall() if r.description else None;self.actor();return v
 def worker(self):self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
 def configure(self,enabled=True,version='0:0',key=None):self.actor();return rpc(self.c,'v1_warehouse_schedule_configure',(enabled,version,key or uuid.uuid4()))
 def beat(self):self.worker();return self.c.execute('SELECT canto_api.squad_warehouse_heartbeat()').fetchone()[0]
 def claim(self):
  self.worker();rows=self.c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0]['jobs'];self.assertEqual(len(rows),1);self.assertEqual(rows[0]['handler'],'warehouse');return rows[0]
 def prepare(self,j):self.worker();return self.c.execute('SELECT canto_api.squad_warehouse_prepare(%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']))).fetchone()[0]
 def finish(self,j,payload):self.worker();return self.c.execute('SELECT canto_api.squad_warehouse_finish(%s,%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']),Jsonb(payload))).fetchone()[0]
 def settle_inventory(self):
  self.assertEqual(self.prepare(self.claim())['state'],'done')
  for _ in range(2):
   j=self.claim();p=self.prepare(j);self.assertEqual(p['operation'],'inventory');self.finish(j,{'code':'CONFIRMED','inventory':[{'sku_code':code,'known':True,'available':12} for code in p['payload']['skus']],'proof':{'facility_code':p['facility_code']}})
 def test_disabled_default_is_quiet_and_private(self):
  self.assertFalse(rpc(self.c,'v1_warehouse_schedule_status')['enabled']);self.assertEqual(self.beat()['state'],'disabled');self.actor()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT * FROM sa_domain.warehouse_schedule')
 def test_config_requires_current_admin_and_verified_ownership(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():rpc(self.c,'v1_warehouse_schedule_configure',(True,'0:0',uuid.uuid4()))
  self.raw('DELETE FROM sa_domain.cutover_commits')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.configure()
 def test_public_cannot_invoke_heartbeat(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.squad_warehouse_heartbeat()')
 def test_settings_are_idempotent_compare_and_swap_and_self_delegated(self):
  key=uuid.uuid4();a=self.configure(key=key);self.assertEqual(a,self.configure(key=key));self.assertEqual(a['owner_user_id'],'100');self.assertEqual(a['inventory_interval_seconds'],120);self.assertEqual(a['orders_interval_seconds'],300)
  with self.assertRaises(psycopg.errors.SerializationFailure):self.configure(False)
 def test_repeated_ticks_queue_each_due_scope_once_without_duplicates(self):
  self.configure();first=self.beat();self.assertEqual((first['state'],first['scope']),('queued','inventory'));again=self.beat();self.assertEqual((again['state'],again['scope']),('queued','orders'));self.assertEqual(self.beat()['state'],'waiting');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_scheduled_runs'),[(2,)])
 def test_real_inventory_jobs_update_cache_then_orders_run_then_wait(self):
  self.configure();self.beat();self.settle_inventory();self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_inventory WHERE available=12'),[(4,)]);status=self.beat();self.assertEqual(status['scope'],'orders');self.assertEqual(self.prepare(self.claim())['state'],'done');self.assertEqual(self.beat()['state'],'waiting')
 def test_overdue_scopes_alternate_even_if_inventory_round_is_slow(self):
  self.configure();self.beat();self.settle_inventory();self.raw("UPDATE sa_domain.warehouse_schedule SET next_inventory_at=now()-interval '1 hour'");self.assertEqual(self.beat()['scope'],'orders')
 def test_missed_intervals_coalesce_into_one_current_refresh(self):
  self.configure();self.raw("UPDATE sa_domain.warehouse_schedule SET next_inventory_at=now()-interval '10 days',next_orders_at=now()-interval '10 days'");self.beat();self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_reconciliations'),[(1,)]);self.assertEqual(self.raw('SELECT next_inventory_at>now() FROM sa_domain.warehouse_schedule'),[(True,)])
 def test_manual_orders_run_allows_independent_automatic_inventory(self):
  self.configure();self.actor();manual=rpc(self.c,'v1_integration_reconcile',('dashboard','orders',None,uuid.uuid4()));self.assertEqual(self.beat()['scope'],'inventory');self.assertEqual(self.beat(),{'state':'busy','id':manual['id']});self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_scheduled_runs'),[(1,)])
 def test_mirror_and_provider_disable_pause(self):
  self.configure();self.raw('UPDATE sa_sync.environment_state SET cutover=false');self.assertEqual(self.beat()['error_code'],'MIRROR_OR_REFRESH');self.raw('UPDATE sa_sync.environment_state SET cutover=true');self.raw('UPDATE sa_domain.warehouse_config SET enabled=false');self.assertEqual(self.beat()['error_code'],'WAREHOUSE_OWNERSHIP_UNAVAILABLE');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_reconciliations'),[(0,)])
 def test_owner_revocation_and_generation_change_emit_no_jobs(self):
  self.configure();self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=100');self.assertEqual(self.beat()['error_code'],'SCHEDULE_OWNER_UNAVAILABLE');self.raw('UPDATE sa_domain.runtime_state SET generation=1');self.assertEqual(self.beat()['error_code'],'SOURCE_REFRESH_RECONFIGURE');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_reconciliations'),[(0,)])
 def test_disable_after_queue_rejects_scheduler_before_enumeration(self):
  cfg=self.configure();self.beat();self.configure(False,cfg['version']);r=self.prepare(self.claim());self.assertEqual((r['state'],r['error_code']),('dead','WAREHOUSE_SCHEDULE_DISABLED'));self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='warehouse.inventory'"),[(0,)])
 def test_disable_after_enumeration_rejects_children_before_provider(self):
  cfg=self.configure();self.beat();self.prepare(self.claim());self.configure(False,cfg['version'])
  for _ in range(2):self.assertEqual(self.prepare(self.claim())['error_code'],'WAREHOUSE_SCHEDULE_DISABLED')
  self.assertEqual(self.raw('SELECT state FROM sa_domain.warehouse_reconciliations'),[('failed',)])
 def test_banned_owner_fails_current_auth_before_provider_work(self):
  self.configure();self.beat();self.raw("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=%s",(uid(100),));self.assertEqual(self.prepare(self.claim())['state'],'dead');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_operations'),[(0,)])
 def test_scheduled_orders_exclude_terminal_foreign_provider_and_unlinked(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id='ord_'||id,order_source='dashboard',uc_status=CASE id WHEN 1002 THEN 'COMPLETE' WHEN 1003 THEN 'CANCELLED' WHEN 1004 THEN 'FAILED' ELSE 'PROCESSING' END WHERE id BETWEEN 1001 AND 1006");self.raw("UPDATE sa_snapshot_20261019.sa_orders SET order_source='unicommerce' WHERE id=1005");self.raw('UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id=NULL WHERE id=1006');self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=1 WHERE order_id=1001');self.configure();self.raw("UPDATE sa_domain.warehouse_schedule SET next_inventory_at=now()+interval '1 day'");self.assertEqual(self.beat()['scope'],'orders');self.prepare(self.claim());self.assertEqual(self.raw("SELECT aggregate_id FROM sa_domain.outbox WHERE event_type='warehouse.order_reconcile'"),[(1001,)]);p=self.prepare(self.claim());self.assertEqual(p['operation'],'reconcile');self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='warehouse.order'"),[(0,)])
 def test_manual_order_reconciliation_retains_terminal_history(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id='ord_1001',order_source='dashboard',uc_status='COMPLETE' WHERE id=1001");rpc(self.c,'v1_integration_reconcile',('dashboard','orders',None,uuid.uuid4()));self.prepare(self.claim());self.assertEqual(self.raw("SELECT aggregate_id FROM sa_domain.outbox WHERE event_type='warehouse.order_reconcile'"),[(1001,)])
 def test_recent_runs_show_actual_status_not_false_delivery(self):
  self.configure();r=self.beat();self.actor();s=rpc(self.c,'v1_warehouse_schedule_status');self.assertEqual(s['runs'][0]['id'],r['id']);self.assertEqual(s['runs'][0]['state'],'queued');self.assertEqual(s['runs'][0]['processed'],'0')
 def test_provider_lock_is_nonblocking_busy(self):
  self.configure()
  with connect() as c:
   c.execute('BEGIN');c.execute("SELECT pg_advisory_xact_lock(hashtextextended('warehouse-reconcile:dashboard',784146))")
   self.assertEqual(self.beat()['state'],'busy');c.execute('ROLLBACK')

if __name__=='__main__':unittest.main()
