import unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue
from test_presets import CONFIG

class StockRead(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');self.n=110;session(self.c,self.n)
  self.s=self.receipt()
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.n=n;self.c.execute('RESET ROLE');session(self.c,n)
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);result=r.fetchall() if r.description else None;session(self.c,self.n);return result
 def receipt(self,user=110,item=1001,quantity=10,kind=0,product=None,cls=1,brand=1,size=1):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET customer_id=%s WHERE id=%s',(user,item))
  return self.raw('INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,product_id,rmp_class_id,rmp_brand_id,rmp_category_id,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now(),now()) RETURNING id',(user,item,item,size,kind,quantity,product,cls if kind==0 else None,brand if kind==0 else None,1 if kind==0 else None))[0][0]
 def view(self,dealer=None,customer=None,filters=None,cursor=None,limit=30):return rpc(self.c,'v1_dealer_stock',(dealer,customer,Jsonb(filters or {}),cursor,limit))
 def test_own_stock_uses_receipts_and_consumption(self):
  r=self.view()['data'][0];self.assertEqual(r['available'],10);self.assertEqual(r['received'],10);self.assertEqual(r['status'],'ready')
 def test_duplicate_origin_not_reported_as_twice_available(self):
  self.receipt();r=self.view()['data'][0];self.assertEqual(r['status'],'needs_reconciliation');self.assertIsNone(r['available']);self.assertEqual(r['receipt_count'],2)
 def test_distinct_origins_same_variant_aggregate(self):
  self.receipt(item=1002,quantity=7);r=self.view()['data'][0];self.assertEqual(r['available'],17);self.assertEqual(r['receipt_count'],2)
 def test_other_dealer_cannot_browse_foreign_stock(self):
  self.actor(210)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.view(dealer=110)
 def test_linked_customer_requires_product_selection(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.view(110)
 def test_linked_customer_receives_display_count_not_physical_ledger(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET stock_visibility_percentage=33 WHERE id=103');self.actor(103)
  r=self.view(110,filters={'rmp_class_id':'1'})['data'][0];self.assertEqual(r['available'],3);self.assertNotIn('received',r);self.assertNotIn('consumed',r);self.assertNotIn('receipt_count',r)
 def test_unrelated_customer_denied(self):
  self.actor(203)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.view(110,filters={'rmp_class_id':'1'})
 def test_customer_cannot_impersonate_linked_customer(self):
  self.actor(203)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.view(110,103,{'rmp_class_id':'1'})
 def test_sc_uses_only_assigned_customer_relationship(self):
  self.actor(101);self.assertEqual(self.view(110,103,{'rmp_class_id':'1'})['data'][0]['available'],10)
  self.actor(201)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.view(110,103,{'rmp_class_id':'1'})
 def test_removed_link_immediately_denies(self):
  self.raw('DELETE FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=103');self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.view(110,filters={'rmp_class_id':'1'})
 def test_direct_customer_cannot_browse_dealer_inventory(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true WHERE id=103');self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.view(110,filters={'rmp_class_id':'1'})
 def test_disabled_dealer_denied(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=110');self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.view(110,filters={'rmp_class_id':'1'})
 def test_workforce_cannot_view_dealer_stock(self):
  self.actor(104)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.view(110)
 def test_unknown_filter_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.view(filters={'user_id':'210'})
 def test_invalid_kind_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.view(filters={'kind':'other'})
 def test_cursor_filters_bound_and_no_duplicate_pages(self):
  self.receipt(item=1002,cls=2,brand=2);r=self.view(limit=1);self.assertIsNotNone(r['next_cursor']);n=self.view(cursor=r['next_cursor'],limit=1);self.assertNotEqual(r['data'][0]['id'],n['data'][0]['id'])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.view(filters={'kind':'rmp'},cursor=r['next_cursor'])
 def test_missing_custom_product_is_reconciliation_not_ready(self):
  self.receipt(item=1002,kind=1);r=self.view(filters={'kind':'custom'})['data'][0];self.assertIsNone(r['available']);self.assertEqual(r['status'],'needs_reconciliation')
 def test_canonical_custom_clones_aggregate_across_owners(self):
  p1=rpc(self.c,'v1_product_configure',(Jsonb(CONFIG),'Dealer preset','',uuid.uuid4()))
  self.actor(103);p2=rpc(self.c,'v1_product_configure',(Jsonb(CONFIG),'Customer preset','Different note',uuid.uuid4()))
  self.receipt(item=1002,kind=1,product=int(p1['id']),quantity=3);self.receipt(item=1003,kind=1,product=int(p2['id']),quantity=4);self.actor(110)
  r=self.view(filters={'kind':'custom','product_id':p2['id']})['data'];self.assertEqual(len(r),1);self.assertEqual(r[0]['available'],7)
 def test_wrong_receipt_owner_requires_reconciliation(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET customer_id=210 WHERE id=1001')
  self.assertEqual(self.view()['data'][0]['status'],'needs_reconciliation')
 def test_stock_without_original_size_requires_reconciliation(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_sizes(id,name,created_at,updated_at) VALUES(999,'Not ordered',now(),now())")
  self.raw('UPDATE sa_snapshot_20261019.sa_stocks SET size_id=999 WHERE id=%s',(self.s,))
  self.assertEqual(self.view()['data'][0]['status'],'needs_reconciliation')
 def test_private_balance_helper_denied(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT * FROM sa_domain.stock_balances(210)')
 def test_raw_stock_table_denied(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT * FROM sa_snapshot_20261019.sa_stocks')
 def test_negative_receipt_requires_reconciliation(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_stocks SET quantity=-1 WHERE id=%s',(self.s,));r=self.view()['data'][0];self.assertIsNone(r['available'])
 def test_stale_consumption_counter_requires_reconciliation(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_stocks SET dispatched_quantity=1 WHERE id=%s',(self.s,));self.assertEqual(self.view()['data'][0]['status'],'needs_reconciliation')

if __name__=='__main__':unittest.main(verbosity=2)
