from sqlstate_assertions import assert_app_conflict, is_app_conflict
import concurrent.futures,copy,threading,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue
from test_pricing import CONFIG

class Backorders(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');self.n=110
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_addresses(id,user_id,state,created_at,updated_at) VALUES(9999,110,'Karnataka',now(),now())")
  self.c.execute("UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=NULL,assigned_worker_id=NULL,status=0,uc_status='',customer_dealer_id=110 WHERE id IN(1004,1005)")
  self.c.execute("UPDATE sa_snapshot_20261019.sa_items SET item_type=1,rmp_class_id=1,rmp_brand_id=1,rmp_category_id=1 WHERE id IN(1001,1004,1005)")
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET customer_id=110 WHERE id=1001');self.c.execute("UPDATE sa_snapshot_20261019.sa_items SET uc_order_status='COMPLETE' WHERE id=1001")
  self.c.execute('UPDATE sa_snapshot_20261019.sa_quantities SET quantity=CASE item_id WHEN 1001 THEN 3 ELSE 7 END WHERE item_id IN(1001,1004,1005)');session(self.c,self.n)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.n=n;self.c.execute('RESET ROLE');session(self.c,n)
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);data=r.fetchall() if r.description else None;session(self.c,self.n);return data
 def supply(self):
  self.c.execute('SET LOCAL ROLE sa_executor');self.c.execute('SELECT sa_domain.receive_dealer_stock(1001)');self.c.execute('SET LOCAL ROLE sa_app')
 def preview(self,ids=None,address=9999):return rpc(self.c,'v1_backorder_preview',(ids if ids is not None else [1004,1005],address))
 def place(self,p,key=None):return rpc(self.c,'v1_backorder_place',(p['preview_id'],'2026-12-01T00:00:00Z',p['version'],key or uuid.uuid4()))
 def test_aggregate_two_orders_before_subtracting_shared_stock(self):
  self.supply();p=self.preview();self.assertEqual(p['requirements'][0]['required'],14);self.assertEqual(p['requirements'][0]['available'],3);self.assertEqual(p['requirements'][0]['shortage'],11);self.assertEqual(p['quote']['quantity'],11)
 def test_no_stock_orders_full_combined_shortage(self):self.assertEqual(self.preview()['quote']['quantity'],14)
 def test_atomic_purchase_links_both_originals(self):
  p=self.preview();r=self.place(p);self.assertEqual(len(r['orders']),1);self.assertEqual(set(r['linked_order_versions']),{'1004','1005'})
  back=int(r['orders'][0]['id']);self.assertEqual(self.raw('SELECT order_id,back_order_id FROM sa_snapshot_20261019.sa_back_order_links ORDER BY order_id'),[(1004,back),(1005,back)])
  self.assertEqual(self.raw('SELECT customer_id,customer_dealer_id,address_id FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(back,)),[(110,None,9999)])
 def test_retry_same_command_returns_original_links(self):
  p=self.preview();key=uuid.uuid4();r=self.place(p,key);self.assertEqual(r,self.place(p,key));self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_back_order_links'),[(2,)])
 def test_nested_purchase_has_one_notification_and_mail_source(self):
  p=self.preview();result=self.place(p);back=int(result['orders'][0]['id'])
  placed=self.raw("SELECT id,command_key FROM sa_domain.outbox WHERE event_type='orders.placed' AND payload->'order_ids' ? %s",(str(back),))[0]
  parent=self.raw("SELECT id,payload FROM sa_domain.outbox WHERE event_type='backorder.placed' AND aggregate_id=%s",(back,))[0]
  self.assertEqual(parent[1]['placement_command_key'],str(placed[1]))
  self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE parent_id=%s AND event_type IN('notification.fanout','business.mail_fanout')",(parent[0],)),[(0,)])
  self.assertGreater(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE parent_id=%s AND event_type='notification.fanout'",(placed[0],))[0][0],0)
  self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='business.mail_fanout' AND aggregate_id=%s",(back,)),[(1,)])
 def test_new_key_cannot_reuse_accepted_preview(self):
  p=self.preview();self.place(p)
  with assert_app_conflict(self):self.place(p)
 def test_already_linked_order_is_excluded(self):
  self.place(self.preview([1004]));p=self.preview();self.assertEqual(p['eligible_order_ids'],['1005']);self.assertEqual(p['excluded'],[{'order_id':'1004','reason':'already_linked'}]);self.assertEqual(p['quote']['quantity'],7)
 def test_competing_previews_revalidate_original_links(self):
  p=self.preview();other=self.preview();self.place(p)
  with assert_app_conflict(self):self.place(other)
 def test_changed_stock_invalidates_preview(self):
  p=self.preview();self.supply()
  with assert_app_conflict(self):self.place(p)
 def test_changed_quantity_invalidates_preview(self):
  p=self.preview();self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET quantity=8 WHERE item_id=1004')
  with assert_app_conflict(self):self.place(p)
 def test_changed_price_invalidates_purchase(self):
  p=self.preview();self.raw('UPDATE sa_snapshot_20261019.sa_rmp_prices SET price=price+1')
  with assert_app_conflict(self):self.place(p)
 def test_reconciliation_problem_is_explicit_and_not_quotable(self):
  self.supply();self.raw('UPDATE sa_snapshot_20261019.sa_stocks SET dispatched_quantity=-1');p=self.preview();self.assertEqual(p['status'],'needs_reconciliation');self.assertIsNone(p['quote']);self.assertIsNone(p['requirements'][0]['available'])
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.place(p)
 def test_fully_available_stock_has_no_backorder(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET quantity=20 WHERE item_id=1001');self.supply();p=self.preview();self.assertEqual(p['status'],'no_shortage');self.assertIsNone(p['quote'])
 def test_dispatched_quantity_reduces_demand(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET dispatched_quantity=2 WHERE item_id=1004');self.assertEqual(self.preview()['quote']['quantity'],12)
 def test_closed_order_excluded(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET status=1 WHERE id=1004');self.assertEqual(self.preview()['quote']['quantity'],7)
 def test_foreign_order_rejected(self):
  with self.assertRaises(psycopg.errors.NoDataFound):self.preview([2004])
 def test_self_purchase_not_customer_demand(self):
  with self.assertRaises(psycopg.errors.NoDataFound):self.preview([1001])
 def test_customer_cannot_generate_backorder(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.preview()
 def test_foreign_address_rejected(self):
  with self.assertRaises(psycopg.errors.NoDataFound):self.preview(address=100)
 def test_duplicates_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.preview([1004,1004])
 def test_empty_selection_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.preview([])
 def test_expired_preview_rejected(self):
  p=self.preview();self.raw("UPDATE sa_domain.backorder_previews SET expires_at=now()-interval '1 second'")
  with assert_app_conflict(self):self.place(p)
 def test_refresh_generation_invalidates_preview(self):
  p=self.preview();self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1')
  with assert_app_conflict(self):self.place(p)
 def test_mirror_blocks_purchase(self):
  p=self.preview();self.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=false')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.place(p)
 def test_custom_equivalent_presets_group_once(self):
  self.actor(101);config=copy.deepcopy(CONFIG);col=rpc(self.c,'v1_color_save',('fabric',1,'Private','#AB12CD',uuid.uuid4()));config['fabric_color_id']=col['id']
  p=rpc(self.c,'v1_product_configure',(Jsonb(config),'Old product','',uuid.uuid4()));self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=0,product_id=%s,rmp_class_id=NULL,rmp_brand_id=NULL,rmp_category_id=NULL WHERE id IN(1004,1005)',(int(p['id']),));self.actor(110)
  preview=self.preview();self.assertEqual(len(preview['quote']['lines']),1);self.assertEqual(preview['quote']['quantity'],14);self.assertTrue(self.place(preview)['orders'])
 def test_failed_purchase_leaves_no_original_link(self):
  p=self.preview()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):
   with self.c.transaction():rpc(self.c,'v1_backorder_place',(p['preview_id'],'bad',p['version'],uuid.uuid4()))
  self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_back_order_links'),[(0,)])

class ConcurrentBackorders(unittest.TestCase):
 def test_competing_transactions_create_one_purchase(self):
  ids=[9100001,9100002];keys=[uuid.uuid4(),uuid.uuid4()];barrier=threading.Barrier(2);previews=[]
  with connect() as c,c.transaction():
   seed_catalogue(c);before=c.execute('SELECT edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
   c.execute("INSERT INTO sa_snapshot_20261019.sa_addresses(id,user_id,state,created_at,updated_at) VALUES(9999,110,'Karnataka',now(),now())")
   for id_ in ids:
    c.execute('INSERT INTO sa_snapshot_20261019.sa_orders(id,customer_id,address_id,customer_dealer_id,customer_sc_id,order_item_type,created_at,updated_at) VALUES(%s,103,100,110,101,0,now(),now())',(id_,))
    c.execute('INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,item_type,rmp_class_id,rmp_brand_id,rmp_category_id,total_quantity,created_at,updated_at) VALUES(%s,%s,1,1,1,1,7,now(),now())',(id_,id_))
    c.execute('INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,created_at,updated_at) VALUES(%s,1,7,now(),now())',(id_,))
   session(c,110)
   previews=[rpc(c,'v1_backorder_preview',(ids,9999)) for _ in range(2)]
  def place(args):
   p,key=args
   try:
    with connect() as c,c.transaction():
     session(c,110);barrier.wait(timeout=3)
     return rpc(c,'v1_backorder_place',(p['preview_id'],'2026-12-01T00:00:00Z',p['version'],key))
   except psycopg.DatabaseError as error:
    if not is_app_conflict(error):raise
    return 'conflict'
  try:
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(place,zip(previews,keys)))
   self.assertEqual(results.count('conflict'),1)
   with connect() as c:self.assertEqual(c.execute('SELECT count(DISTINCT back_order_id),count(*) FROM sa_snapshot_20261019.sa_back_order_links WHERE order_id=ANY(%s)',(ids,)).fetchone(),(1,2))
  finally:
   with connect() as c,c.transaction():
    back=[x[0] for x in c.execute('SELECT DISTINCT back_order_id FROM sa_snapshot_20261019.sa_back_order_links WHERE order_id=ANY(%s)',(ids,))];all_orders=ids+back
    item_ids=[x[0] for x in c.execute('SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=ANY(%s)',(all_orders,))]
    keys += [x[0] for x in c.execute("SELECT command_key FROM sa_domain.audit WHERE kind IN('order','order_batch') AND entity_id=ANY(%s)",(back,))]
    c.execute('DELETE FROM sa_snapshot_20261019.sa_back_order_links WHERE order_id=ANY(%s)',(ids,))
    c.execute('DELETE FROM sa_domain.order_receipts WHERE order_id=ANY(%s)',(back,))
    c.execute('DELETE FROM sa_domain.line_receipts WHERE order_id=ANY(%s)',(back,))
    for table in ['extra_quantities','quantities','item_criteria']:c.execute(f'DELETE FROM sa_snapshot_20261019.sa_{table} WHERE item_id=ANY(%s)',(item_ids,))
    c.execute('DELETE FROM sa_snapshot_20261019.sa_items WHERE id=ANY(%s)',(item_ids,));c.execute('DELETE FROM sa_snapshot_20261019.sa_orders WHERE id=ANY(%s)',(all_orders,));c.execute('DELETE FROM sa_snapshot_20261019.sa_addresses WHERE id=9999')
    c.execute("DELETE FROM sa_domain.entity_versions WHERE (kind='order' AND entity_id=ANY(%s)) OR (kind='item' AND entity_id=ANY(%s))",(all_orders,item_ids))
    for table in ['outbox','audit']:c.execute(f'DELETE FROM sa_domain.{table} WHERE command_key=ANY(%s)',(keys,))
    c.execute('DELETE FROM sa_domain.commands WHERE key=ANY(%s)',(keys,))
    c.execute('DELETE FROM sa_domain.backorder_previews WHERE id=ANY(%s)',([uuid.UUID(p['preview_id']) for p in previews],));c.execute('DELETE FROM sa_domain.quotes WHERE id=ANY(%s)',([uuid.UUID(p['quote']['quote_id']) for p in previews],))
    c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false');c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s',before)
    self.assertEqual(c.execute('SELECT count(*) FROM sa_domain.line_receipts WHERE order_id=ANY(%s)',(back,)).fetchone()[0],0)

if __name__=='__main__':unittest.main(verbosity=2)
