from sqlstate_assertions import assert_app_conflict
import unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from fixtures import seed_orders,session,rpc,uid
from local_db import connect
import test_production_execution as work

class Deliveries(unittest.TestCase):
 setUpClass=work.Execution.__dict__['setUpClass'];setUp=work.Execution.setUp;tearDown=work.Execution.tearDown
 actor=work.Execution.actor;raw=work.Execution.raw;iv=work.Execution.iv;cut=work.Execution.cut;assign=work.Execution.assign;inspect=work.Execution.inspect;dispatch=work.Execution.dispatch;prepare=work.Execution.prepare
 def ov(self):return self.raw("SELECT sa_domain.version('order',1001)")[0][0]
 def destination(self,mode='customer',key=None,version=None,id=1001):return rpc(self.c,'v1_dispatch_destination_save',(id,mode,'Route decision',version or self.ov(),key or uuid.uuid4()))
 def deliveries(self,filters=None,cursor=None,limit=30):return rpc(self.c,'v1_deliveries_list',(Jsonb(filters or {}),cursor,limit))
 def test_dispatch_captures_destination_and_address(self):
  self.prepare();self.actor(107);self.destination();self.dispatch(3);r=self.deliveries()['data'][0]
  self.assertEqual(r['quantity'],3);self.assertEqual(r['destination']['mode'],'customer');self.assertEqual(r['destination']['address']['id'],'100');self.assertEqual(r['destination_basis'],'dispatch_snapshot')
 def test_remaining_destination_change_does_not_rewrite_prior_dispatch(self):
  self.prepare();self.actor(107);self.destination();self.dispatch(3);self.destination('ho');self.dispatch(7)
  rows=self.deliveries()['data'];self.assertEqual([x['destination']['mode'] for x in rows],['ho','customer']);self.assertEqual([x['quantity'] for x in rows],[7,3])
 def test_address_edit_does_not_change_recorded_delivery(self):
  self.prepare();self.actor(107);self.destination();self.dispatch(3);self.raw("UPDATE sa_snapshot_20261019.sa_addresses SET address='New address' WHERE id=100")
  self.assertEqual(self.deliveries()['data'][0]['destination']['address']['address'],'Synthetic address')
 def test_unrecorded_historical_destination_is_explicit(self):
  self.prepare();self.dispatch(3);self.raw('DELETE FROM sa_domain.dispatch_receipts');r=self.deliveries()['data'][0];self.assertEqual(r['destination_basis'],'current_order_only')
 def test_foreign_factory_cannot_change_or_read(self):
  self.prepare();self.dispatch(3);self.actor(207);self.assertEqual(self.deliveries()['data'],[])
  with self.assertRaises(psycopg.errors.NoDataFound):self.destination()
 def test_customer_cannot_change_destination(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.destination()
 def test_factory_manager_can_read_but_not_change_route(self):
  self.prepare();self.dispatch(3);self.actor(104);self.assertEqual(self.deliveries()['data'][0]['quantity'],3)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.destination()
 def test_coordinator_can_change_owned_order(self):
  self.actor(101);self.assertEqual(self.destination('makali_factory')['destination']['mode'],'makali_factory')
 def test_cutting_view_does_not_gain_customer_shipping_address(self):
  self.actor(107);self.destination();self.actor(109);r=rpc(self.c,'v1_order_get',(1001,))
  self.assertEqual(r['dispatch_destination']['mode'],'customer');self.assertIsNone(r['dispatch_destination']['address'])
 def test_stale_destination_rejected(self):
  self.actor(107);v=self.ov();self.destination()
  with assert_app_conflict(self):self.destination('ho',version=v)
 def test_exact_retry_returns_original_route_version(self):
  self.actor(107);v=self.ov();k=uuid.uuid4();r=self.destination(key=k,version=v);self.assertEqual(r,self.destination(key=k,version=v))
 def test_completed_order_route_is_immutable(self):
  self.prepare();self.dispatch()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.destination()
 def test_missing_customer_address_rejects_route(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET address_id=200 WHERE id=1001');self.actor(107)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.destination()
 def test_modes_are_allowlisted(self):
  self.actor(107)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.destination('warehouse-123')
 def test_delivery_pages_do_not_repeat(self):
  self.prepare();self.dispatch(3);self.dispatch(7);p=self.deliveries(limit=1);n=self.deliveries(cursor=p['next_cursor'],limit=1);self.assertNotEqual(p['data'][0]['id'],n['data'][0]['id']);self.assertIsNone(n['next_cursor'])
 def test_cursor_cannot_change_scope(self):
  self.prepare();self.dispatch(3);self.dispatch(7);p=self.deliveries(limit=1)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.deliveries({'order_id':'1001'},p['next_cursor'])
 def test_delivery_range_applied_before_pagination(self):
  self.prepare();self.dispatch(3);self.assertEqual(self.deliveries({'before':'2001-01-01T00:00:00Z'})['data'],[])
 def test_old_generation_receipt_does_not_attach_to_reused_dispatch(self):
  self.prepare();self.actor(107);self.destination();r=self.dispatch(3);self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1')
  self.assertEqual(self.deliveries()['data'][0]['destination_basis'],'current_order_only')
  self.raw("INSERT INTO sa_domain.dispatch_receipts(dispatch_id,order_id,actor_id,generation,destination) VALUES(%s,1001,%s,1,'{\"mode\":\"ho\"}')",(int(r['history_id']),uid(107)))
  self.assertEqual(self.deliveries()['data'][0]['destination']['mode'],'ho')
 def test_private_receipts_cannot_be_mutated_by_executor(self):
  self.prepare();self.dispatch(3);self.c.execute('SET LOCAL ROLE sa_executor')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("UPDATE sa_domain.dispatch_receipts SET destination='{}'")
 def test_reused_source_order_ids_keep_generation_separate(self):
  args=(uid(103),)
  self.raw("INSERT INTO sa_domain.order_receipts(order_id,quote_id,actor_id,generation,pricing,delivery,rounding_adjustment) VALUES(1001,gen_random_uuid(),%s,0,'{}','{}',0)",args)
  self.raw('UPDATE sa_domain.runtime_state SET generation=1')
  self.raw("INSERT INTO sa_domain.order_receipts(order_id,quote_id,actor_id,generation,pricing,delivery,rounding_adjustment) VALUES(1001,gen_random_uuid(),%s,1,'{}','{}',0)",args)
  self.actor(103);self.c.execute('SET LOCAL ROLE sa_executor');self.assertEqual(self.c.execute('SELECT generation FROM sa_domain.order_receipts WHERE order_id=1001').fetchall(),[(1,)])
 def test_reused_source_design_ids_keep_generation_separate(self):
  self.raw('INSERT INTO sa_domain.design_owners(branding_id,actor_id,generation) VALUES(9999,%s,0)',(uid(103),));self.raw('UPDATE sa_domain.runtime_state SET generation=1');self.raw('INSERT INTO sa_domain.design_owners(branding_id,actor_id,generation) VALUES(9999,%s,1)',(uid(103),))
  self.actor(103);self.c.execute('SET LOCAL ROLE sa_executor');self.assertEqual(self.c.execute('SELECT generation FROM sa_domain.design_owners WHERE branding_id=9999').fetchall(),[(1,)])

if __name__=='__main__':unittest.main(verbosity=2)
