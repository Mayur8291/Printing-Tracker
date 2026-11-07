import decimal,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed_orders,session,rpc
from domain_sync import after_publication

class Lifecycle(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');self.n=101;session(self.c,self.n)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.n=n;self.c.execute('RESET ROLE');session(self.c,n)
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);result=r.fetchall() if r.description else None;session(self.c,self.n);return result
 def version(self,id=1001):return rpc(self.c,'v1_order_get',(id,))['version']
 def cancel(self,id=1001,kind='cancel',key=None,version=None):return rpc(self.c,'v1_order_cancel',(id,kind,'No longer needed',version or self.version(id),key or uuid.uuid4()))
 def test_priority_and_due_commands(self):
  p=rpc(self.c,'v1_order_priority_save',(1001,True,'Priority request',self.version(),uuid.uuid4()));self.assertTrue(p['is_prime'])
  d=rpc(self.c,'v1_order_due_save',(1001,'2026-12-01T10:30:00+05:30','Customer request',p['version'],uuid.uuid4()));self.assertNotEqual(p['version'],d['version'])
  self.assertEqual(self.raw('SELECT due_on FROM sa_snapshot_20261019.sa_orders WHERE id=1001')[0][0].hour,5)
 def test_priority_customer_denied(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_order_priority_save',(1001,True,'Priority',self.version(),uuid.uuid4()))
 def test_priority_other_sc_denied(self):
  self.actor(201)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_order_priority_save',(1001,True,'Priority','0:0',uuid.uuid4()))
 def test_missing_reason_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_order_due_save',(1001,'2026-12-01T00:00:00Z','',self.version(),uuid.uuid4()))
 def test_partial_payment_and_exact_retry(self):
  key=uuid.uuid4();args=(1001,'partial',decimal.Decimal('125.25'),'Transfer reference',self.version(),key)
  p=rpc(self.c,'v1_order_payment_record',args);self.assertEqual(p,rpc(self.c,'v1_order_payment_record',args));self.assertEqual(p['paid_amount'],'125.25')
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.audit WHERE command_key=%s',(key,)),[(1,)])
 def test_payment_completed_order_allowed(self):
  p=rpc(self.c,'v1_order_payment_record',(1005,'paid',1000,'Final settlement',self.version(1005),uuid.uuid4()));self.assertEqual(p['payment_status'],0)
 def test_payment_over_total_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_order_payment_record',(1001,'paid',1001,'Settlement',self.version(),uuid.uuid4()))
 def test_payment_nan_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_order_payment_record',(1001,'partial','NaN','Settlement',self.version(),uuid.uuid4()))
 def test_payment_role_denied(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_order_payment_record',(1001,'paid',1000,'Settlement',self.version(),uuid.uuid4()))
 def test_payment_cancelled_denied(self):
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):rpc(self.c,'v1_order_payment_record',(1006,'paid',1000,'Settlement',self.version(1006),uuid.uuid4()))
 def test_cancel_custom_retains_items_and_history(self):
  before=self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_items WHERE order_id=1001')[0][0]
  p=self.cancel();self.assertEqual(p['state'],'cancelled');self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_items WHERE order_id=1001')[0][0],before)
  self.assertEqual(self.raw('SELECT status,uc_status,is_force_update FROM sa_snapshot_20261019.sa_orders WHERE id=1001'),[(0,'CANCELLED',False)])
 def test_soft_delete_retains_rows_but_hides_order(self):
  p=self.cancel(kind='delete');self.assertEqual(p['state'],'deleted')
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_order_get',(1001,))
 def test_cancel_exact_retry(self):
  version=self.version();key=uuid.uuid4();r=self.cancel(key=key,version=version);self.assertEqual(r,self.cancel(key=key,version=version))
 def test_cancel_completed_denied(self):
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.cancel(1005)
 def test_cancel_partially_dispatched_denied_even_stale_order_total(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET dispatched_quantity=1 WHERE id=1001')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.cancel()
 def test_cancel_external_completion_denied(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_status='COMPLETE' WHERE id=1001")
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.cancel()
 def test_rmp_cancel_queues_and_freezes_work_until_provider_confirmation(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=1 WHERE order_id=1002');p=self.cancel(1002);self.assertEqual(p['state'],'queued');self.assertTrue(p['request_id'])
  self.assertEqual(self.raw('SELECT status,uc_status FROM sa_snapshot_20261019.sa_orders WHERE id=1002'),[(0,'')])
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):rpc(self.c,'v1_order_priority_save',(1002,True,'Priority',p['version'],uuid.uuid4()))
 def test_refresh_retires_queued_change(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id='Synthetic reference' WHERE id=1001");p=self.cancel();self.c.execute('RESET ROLE')
  result=after_publication(self.c);self.assertEqual(result['discarded_order_requests'],1)
  self.assertEqual(self.c.execute('SELECT state,spec->>\'failure_code\' FROM sa_domain.order_requests WHERE id=%s',(uuid.UUID(p['request_id']),)).fetchone(),('failed','SOURCE_REFRESH_DISCARDED'))
 def test_dealer_can_cancel_linked_fulfillment(self):
  self.actor(110);self.assertEqual(self.cancel(1004)['state'],'cancelled')
 def test_dealer_cannot_delete_linked_fulfillment(self):
  self.actor(110)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.cancel(1004,'delete')
 def test_other_dealer_denied(self):
  self.actor(210)
  with self.assertRaises(psycopg.errors.NoDataFound):self.cancel(1004,version='0:0')
 def test_force_complete_admin_exception_does_not_invent_dispatched_quantities(self):
  self.actor(100);p=rpc(self.c,'v1_order_force_complete',(1001,'Manual exception',self.version(),uuid.uuid4()));self.assertTrue(p['force_completed'])
  self.assertEqual(self.raw('SELECT status,is_force_update,dispatched_quantity,delivered_on IS NOT NULL FROM sa_snapshot_20261019.sa_orders WHERE id=1001'),[(1,True,0,True)])
 def test_force_complete_sc_denied(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_order_force_complete',(1001,'Manual exception',self.version(),uuid.uuid4()))
 def test_force_complete_cancelled_denied(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):rpc(self.c,'v1_order_force_complete',(1006,'Manual exception',self.version(1006),uuid.uuid4()))
 def test_legacy_cancel_force_flag_cannot_recompute_as_completed(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET is_force_update=true WHERE id=1006')
  self.c.execute('RESET ROLE');session(self.c,100);self.c.execute('SET LOCAL ROLE sa_executor')
  r=self.c.execute('SELECT sa_domain.recompute_order_progress(1006)').fetchone()[0];self.assertFalse(r['completed'])
 def test_mixed_requires_both_custom_dispatch_and_provider_completion(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_worker_id=NULL WHERE id=1003')
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=0,dispatched_status=1,dispatched_quantity=10 WHERE id=1003')
  self.raw('INSERT INTO sa_snapshot_20261019.sa_items(order_id,item_type,created_at,updated_at) VALUES(1003,1,now(),now())')
  self.c.execute('RESET ROLE');session(self.c,102);self.c.execute('SET LOCAL ROLE sa_executor')
  self.assertFalse(self.c.execute('SELECT sa_domain.recompute_order_progress(1003)').fetchone()[0]['completed'])
  self.c.execute('RESET ROLE');self.c.execute("UPDATE sa_snapshot_20261019.sa_orders SET uc_status='COMPLETE' WHERE id=1003");session(self.c,102);self.c.execute('SET LOCAL ROLE sa_executor')
  self.assertTrue(self.c.execute('SELECT sa_domain.recompute_order_progress(1003)').fetchone()[0]['completed'])
 def test_criteria_rollup_reads_required_unchecked_rows(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_criteria(id,name,created_at,updated_at) VALUES(900001,'Required',now(),now())")
  self.raw('INSERT INTO sa_snapshot_20261019.sa_item_criteria(item_id,criteria_id,is_checked,created_at,updated_at) VALUES(1001,900001,false,now(),now())')
  self.c.execute('RESET ROLE');session(self.c,104);self.c.execute('SET LOCAL ROLE sa_executor')
  self.assertFalse(self.c.execute('SELECT sa_domain.recompute_order_progress(1001)').fetchone()[0]['criteria_complete'])

if __name__=='__main__':unittest.main(verbosity=2)
