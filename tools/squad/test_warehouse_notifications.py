"""Warehouse transitions reuse current recipient rules without false completion."""
import unittest,uuid
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed_orders,uid

class WarehouseNotifications(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):self.c=connect();self.c.execute('BEGIN')
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def emit(self,status,previous='PENDING',previous_order=0):
  id=uuid.uuid4()
  self.c.execute("INSERT INTO sa_domain.outbox(id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload) VALUES(%s,%s,'warehouse.status_changed','order',1001,%s,0,%s)",(id,uid(101),uuid.uuid4(),Jsonb({'status':status,'previous_status':previous,'previous_order_status':previous_order})))
  return [r[0] for r in self.c.execute('SELECT payload FROM sa_domain.outbox WHERE parent_id=%s',(id,))]
 def types(self,rows):return {n for row in rows for n in row['types']}
 def test_processing_uses_original_customer_and_sales_notices(self):self.assertEqual(self.types(self.emit('PROCESSING')),{16,17})
 def test_cancelled_uses_original_provider_cancellation_notices(self):self.assertEqual(self.types(self.emit('CANCELLED')),{18,19})
 def test_unchanged_status_does_not_fan_out(self):self.assertEqual(self.emit('PROCESSING','PROCESSING'),[])
 def test_pending_and_failed_are_not_invented_push_events(self):
  self.assertEqual(self.emit('PENDING',''),[]);self.assertEqual(self.emit('FAILED'),[])
 def test_incomplete_mixed_order_is_not_announced_complete(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET order_item_type=2,status=0 WHERE id=1001');self.assertEqual(self.emit('COMPLETE'),[])
 def test_completed_order_notifies_once_on_transition(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET status=1 WHERE id=1001');self.assertEqual(self.types(self.emit('COMPLETE')),{22,23});self.assertEqual(self.emit('COMPLETE','COMPLETE',1),[])
 def test_previously_force_completed_order_does_not_repeat_completion(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET status=1 WHERE id=1001');self.assertEqual(self.emit('COMPLETE','PROCESSING',1),[])
 def test_missing_prior_order_state_does_not_claim_new_completion(self):
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET status=1 WHERE id=1001');self.assertEqual(self.emit('COMPLETE','PROCESSING',None),[])
 def test_existing_provider_cancel_workflow_remains_unchanged(self):
  rows=[r[0] for r in self.c.execute("SELECT * FROM sa_domain.notification_plan('order.provider_cancelled','order',1001,%s,'{}')",(uid(101),))];self.assertTrue(self.types(rows))
 def test_customer_cannot_publish_status_event(self):
  from fixtures import session
  import psycopg
  session(self.c,103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.emit('COMPLETE')

if __name__=='__main__':unittest.main()
