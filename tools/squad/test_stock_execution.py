import concurrent.futures,threading,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue
from test_presets import CONFIG

class StockExecution(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');self.n=110
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET customer_id=110,customer_dealer_id=NULL,assigned_worker_id=NULL WHERE id IN(1001,1002)')
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_worker_id=NULL,assigned_to_id=NULL WHERE id=1004')
  self.c.execute("UPDATE sa_snapshot_20261019.sa_items SET item_type=1,rmp_class_id=1,rmp_brand_id=1,rmp_category_id=1,uc_order_status='COMPLETE' WHERE id IN(1001,1002,1004)")
  self.c.execute('UPDATE sa_snapshot_20261019.sa_quantities SET quantity=CASE item_id WHEN 1001 THEN 3 WHEN 1002 THEN 7 ELSE 10 END WHERE item_id IN(1001,1002,1004)')
  self.q=self.c.execute('SELECT id FROM sa_snapshot_20261019.sa_quantities WHERE item_id=1004').fetchone()[0];session(self.c,self.n)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.n=n;self.c.execute('RESET ROLE');session(self.c,n)
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);result=r.fetchall() if r.description else None;session(self.c,self.n);return result
 def iv(self,id=1004):return self.raw("SELECT sa_domain.version('item',%s)",(id,))[0][0]
 def receive(self,id):
  self.c.execute('SET LOCAL ROLE sa_executor');r=self.c.execute('SELECT sa_domain.receive_dealer_stock(%s)',(id,)).fetchone()[0];self.c.execute('SET LOCAL ROLE sa_app');return r
 def stock(self):return rpc(self.c,'v1_dealer_stock')['data']
 def supply(self):self.receive(1001);self.receive(1002)
 def dispatch(self,n=6,key=None,version=None,at=None):return rpc(self.c,'v1_dispatch_record',(1004,Jsonb([{'quantity_id':str(self.q),'quantity':n}]),at,version or self.iv(),key or uuid.uuid4()))
 def test_receipt_origin_retry_does_not_duplicate(self):
  self.assertEqual(self.receive(1001)['received'],1);self.assertEqual(self.receive(1001)['received'],0);self.assertEqual(self.stock()[0]['available'],3)
 def test_receive_rmp_resolves_legacy_size_by_name(self):
  self.receive(1001);self.assertEqual(self.raw('SELECT rmp_sku_id FROM sa_snapshot_20261019.sa_stocks WHERE item_id=1001'),[(1,)])
 def test_rmp_waits_for_provider_completion(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_items SET uc_order_status='CREATED' WHERE id=1001");self.assertEqual(self.receive(1001)['state'],'awaiting_completion');self.assertEqual(self.stock(),[])
 def test_duplicate_receipt_origin_rejected(self):
  self.receive(1001);self.raw('INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,rmp_class_id,rmp_brand_id,rmp_category_id,created_at,updated_at) VALUES(110,1001,1001,1,0,3,1,1,1,now(),now())')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.receive(1001)
 def test_changed_origin_quantity_requires_reconciliation(self):
  self.receive(1001);self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET quantity=4 WHERE item_id=1001')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.receive(1001)
 def test_fifo_allocation_fixes_legacy_subtraction_bug(self):
  self.supply();r=self.dispatch(6);self.assertEqual([x['quantity'] for x in r['stock_allocations']],[3,3]);self.assertEqual(self.stock()[0]['available'],4)
  self.assertEqual(self.raw('SELECT quantity,dispatched_quantity FROM sa_snapshot_20261019.sa_stocks ORDER BY id'),[(3,3),(7,3)])
 def test_exact_dispatch_retry_does_not_double_consume(self):
  self.supply();v=self.iv();k=uuid.uuid4();r=self.dispatch(6,k,v);self.assertEqual(r,self.dispatch(6,k,v));self.assertEqual(self.stock()[0]['available'],4)
 def test_second_dispatch_completes_local_rmp_without_provider_status(self):
  self.supply();self.dispatch(6);r=self.dispatch(4);self.assertTrue(r['progress']['order_completed']);self.assertEqual(self.stock()[0]['available'],0)
  self.assertEqual(self.raw('SELECT status,uc_status FROM sa_snapshot_20261019.sa_orders WHERE id=1004'),[(1,'')])
 def test_insufficient_stock_rejects_whole_dispatch(self):
  self.receive(1001)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):
   with self.c.transaction():self.dispatch(6)
  self.assertEqual(self.raw('SELECT dispatched_quantity FROM sa_snapshot_20261019.sa_quantities WHERE id=%s',(self.q,)),[(0,)])
  self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_stock_useds'),[(0,)])
 def test_foreign_dealer_cannot_dispatch(self):
  self.supply();self.actor(210)
  with self.assertRaises(psycopg.errors.NoDataFound):self.dispatch(1)
 def test_customer_cannot_dispatch(self):
  self.supply();self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.dispatch(1)
 def test_stock_anomaly_blocks_allocation(self):
  self.supply();self.raw('UPDATE sa_snapshot_20261019.sa_stocks SET dispatched_quantity=1 WHERE item_id=1001')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.dispatch(1)
 def test_dealer_cannot_dispatch_self_purchase_as_customer_fulfillment(self):
  self.supply();self.raw('UPDATE sa_snapshot_20261019.sa_orders SET customer_id=110 WHERE id=1004')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.dispatch(1)
 def test_conflicting_factory_assignment_denied(self):
  self.supply();self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=104 WHERE id=1004')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.dispatch(1)
 def test_stock_created_after_dispatch_time_cannot_be_used(self):
  self.supply();self.raw("UPDATE sa_snapshot_20261019.sa_stocks SET created_at=now()+interval '1 day'")
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.dispatch(1)
 def test_negative_consumed_counter_requires_reconciliation(self):
  self.supply();self.raw('UPDATE sa_snapshot_20261019.sa_stocks SET dispatched_quantity=-1')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.dispatch(1)
 def test_stale_dispatch_history_requires_reconciliation(self):
  self.supply();self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET dispatched_quantity=1 WHERE id=%s',(self.q,))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.dispatch(1)
 def test_receipt_cancelled_purchase_rejected(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_status='CANCELLED' WHERE id=1001")
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.receive(1001)
 def test_optional_rmp_category_is_supported(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_rmp_skus SET rmp_category_id=NULL WHERE id=1');self.raw('UPDATE sa_snapshot_20261019.sa_items SET rmp_category_id=NULL WHERE id IN(1001,1002,1004)')
  self.supply();self.dispatch(6);self.assertEqual(self.stock()[0]['available'],4)
 def test_private_receipt_method_cannot_be_called_by_client(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT sa_domain.receive_dealer_stock(1001)')
 def test_custom_comparable_stock_can_fulfill_equivalent_preset(self):
  p1=rpc(self.c,'v1_product_configure',(Jsonb(CONFIG),'Supply','',uuid.uuid4()));self.actor(103);p2=rpc(self.c,'v1_product_configure',(Jsonb(CONFIG),'Customer','',uuid.uuid4()));self.actor(110)
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=0,rmp_class_id=NULL,rmp_brand_id=NULL,rmp_category_id=NULL,product_id=%s WHERE id IN(1001,1002)',(int(p1['id']),))
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=0,rmp_class_id=NULL,rmp_brand_id=NULL,rmp_category_id=NULL,product_id=%s WHERE id=1004',(int(p2['id']),))
  self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET dispatched_quantity=quantity WHERE item_id IN(1001,1002)')
  self.supply();self.assertEqual(self.dispatch(6)['progress']['dispatched'],6);self.assertEqual(self.stock()[0]['available'],4)
 def test_worker_completion_receives_stock_without_fake_factory_counters(self):
  p=rpc(self.c,'v1_product_configure',(Jsonb(CONFIG),'Worker supply','',uuid.uuid4()))
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=NULL,assigned_worker_id=111,order_item_type=1 WHERE id=1001')
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=0,product_id=%s,rmp_class_id=NULL,rmp_brand_id=NULL,rmp_category_id=NULL WHERE id=1001',(int(p['id']),));self.actor(111)
  for n in range(1,6):r=rpc(self.c,'v1_worker_stage_save',(1001,n,'Stage progress',self.iv(1001),uuid.uuid4()))
  self.assertEqual(r['stock_receipt']['received'],1);self.assertEqual(self.raw('SELECT dispatched_quantity,cutting_done FROM sa_snapshot_20261019.sa_quantities WHERE item_id=1001'),[(0,0)])
  self.actor(110);self.assertEqual(self.stock()[0]['available'],3)

 def test_dealer_dispatch_detail_uses_order_balance_and_stock(self):
  self.supply();r=rpc(self.c,'v1_dispatch_detail',(1004,));self.assertEqual(r['quantities']['data'][0]['remaining'],10);self.assertEqual(r['available_to_dispatch'],10);self.assertEqual(r['stock_status'],'ready')
 def test_dealer_queue_waiting_partial_and_ready_stock(self):
  r=rpc(self.c,'v1_dispatch_queue',(False,1004))['data'][0];self.assertEqual(r['stock_status'],'waiting_stock')
  self.receive(1001);r=rpc(self.c,'v1_dispatch_queue',(False,1004))['data'][0];self.assertEqual(r['stock_status'],'partial');self.assertEqual(r['available_to_dispatch'],3)
  self.receive(1002);r=rpc(self.c,'v1_dispatch_queue',(False,1004))['data'][0];self.assertEqual(r['stock_status'],'ready');self.assertEqual(r['available_to_dispatch'],10)
 def test_completed_dealer_dispatch_remains_in_history(self):
  self.supply();self.dispatch(10);r=rpc(self.c,'v1_dispatch_queue',(True,1004))['data'][0];self.assertEqual(r['stock_status'],'complete');self.assertEqual(r['remaining_quantity'],0)
 def test_dealer_dispatch_view_excludes_self_purchase(self):
  self.supply();self.assertEqual(rpc(self.c,'v1_dispatch_queue',(False,1001))['data'],[])
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_dispatch_detail',(1001,))
 def test_dealer_read_availability_cannot_disclose_other_dealer(self):
  self.supply();self.actor(210);self.assertEqual(rpc(self.c,'v1_dispatch_queue',(False,1004))['data'],[])
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_dispatch_detail',(1004,))
 def test_availability_groups_duplicate_size_lines_before_comparing_stock(self):
  self.receive(1002);self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET quantity=3 WHERE id=%s',(self.q,))
  self.raw('INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,created_at,updated_at) VALUES(1004,1,7,now(),now())')
  r=rpc(self.c,'v1_dispatch_detail',(1004,));self.assertEqual(r['available_to_dispatch'],7);self.assertEqual(r['remaining_quantity'],10)
 def test_unreconciled_stock_is_explicit_in_dispatch_view(self):
  self.supply();self.raw('UPDATE sa_snapshot_20261019.sa_stocks SET dispatched_quantity=-1 WHERE item_id=1001')
  r=rpc(self.c,'v1_dispatch_detail',(1004,));self.assertEqual(r['stock_status'],'needs_reconciliation');self.assertIsNone(r['available_to_dispatch'])
 def test_dealer_cannot_read_cutting_dashboard(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_cutting_queue')

class ConcurrentDealerDispatch(unittest.TestCase):
 def test_two_orders_cannot_consume_the_same_stock(self):
  keys=[uuid.uuid4(),uuid.uuid4()];order_ids=[9000011,9000012,9000013];barrier=threading.Barrier(2);quantities={}
  with connect() as c,c.transaction():
   seed_catalogue(c);before=c.execute('SELECT edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
   for index,id_ in enumerate(order_ids):
    c.execute('INSERT INTO sa_snapshot_20261019.sa_orders(id,customer_id,address_id,customer_dealer_id,customer_sc_id,order_item_type,created_at,updated_at) VALUES(%s,%s,100,%s,101,0,now(),now())',(id_,110 if index==0 else 103,None if index==0 else 110))
    c.execute("INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,item_type,rmp_class_id,rmp_brand_id,rmp_category_id,uc_order_status,total_quantity,created_at,updated_at) VALUES(%s,%s,1,1,1,1,'COMPLETE',%s,now(),now())",(id_,id_,10 if index==0 else 7))
    quantities[id_]=c.execute('INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,created_at,updated_at) VALUES(%s,1,%s,now(),now()) RETURNING id',(id_,10 if index==0 else 7)).fetchone()[0]
   session(c,110);c.execute('SET LOCAL ROLE sa_executor');c.execute('SELECT sa_domain.receive_dealer_stock(%s)',(order_ids[0],));c.execute('RESET ROLE')
   versions={n:c.execute("SELECT sa_domain.version('item',%s)",(n,)).fetchone()[0] for n in order_ids[1:]}
  def dispatch(args):
   id_,key=args
   try:
    with connect() as c,c.transaction():
     session(c,110);barrier.wait(timeout=3)
     return rpc(c,'v1_dispatch_record',(id_,Jsonb([{'quantity_id':str(quantities[id_]),'quantity':7}]),None,versions[id_],key))
   except psycopg.errors.ObjectNotInPrerequisiteState:return 'insufficient'
  try:
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(dispatch,zip(order_ids[1:],keys)))
   self.assertEqual(results.count('insufficient'),1)
   with connect() as c:
    self.assertEqual(c.execute('SELECT quantity,dispatched_quantity FROM sa_snapshot_20261019.sa_stocks WHERE item_id=%s',(order_ids[0],)).fetchone(),(10,7))
    self.assertEqual(c.execute('SELECT sum(dispatched_quantity) FROM sa_snapshot_20261019.sa_quantities WHERE item_id=ANY(%s)',(order_ids[1:],)).fetchone()[0],7)
  finally:
   with connect() as c,c.transaction():
    c.execute('DELETE FROM sa_snapshot_20261019.sa_stock_useds WHERE stock_id IN(SELECT id FROM sa_snapshot_20261019.sa_stocks WHERE item_id=ANY(%s))',(order_ids,))
    c.execute('DELETE FROM sa_snapshot_20261019.sa_stocks WHERE item_id=ANY(%s)',(order_ids,))
    c.execute('DELETE FROM sa_snapshot_20261019.sa_dispatched_quantities WHERE quantity_id=ANY(%s)',(list(quantities.values()),))
    c.execute('DELETE FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE item_id=ANY(%s)',(order_ids,))
    c.execute('DELETE FROM sa_domain.dispatch_receipts WHERE order_id=ANY(%s)',(order_ids,))
    for table,col in [('quantities','item_id'),('items','id'),('orders','id')]:c.execute(f'DELETE FROM sa_snapshot_20261019.sa_{table} WHERE {col}=ANY(%s)',(order_ids,))
    c.execute("DELETE FROM sa_domain.entity_versions WHERE kind IN('item','order') AND entity_id=ANY(%s)",(order_ids,))
    for table in ['outbox','audit']:c.execute(f'DELETE FROM sa_domain.{table} WHERE command_key=ANY(%s)',(keys,))
    c.execute('DELETE FROM sa_domain.commands WHERE key=ANY(%s)',(keys,));c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false');c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s',before)

if __name__=='__main__':unittest.main(verbosity=2)
