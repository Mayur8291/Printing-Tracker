"""Source-authorized selling projections and one complete multi-persona journey."""
import datetime,decimal,json,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from fixtures import rpc,session
from local_db import connect
from test_catalogue import seed_catalogue
from test_pricing import CONFIG,custom,rmp

D=decimal.Decimal
class PersonaFinance(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true WHERE id=103');self.c.execute("UPDATE sa_snapshot_20261019.sa_addresses SET state='Karnataka' WHERE id=100");self.c.execute("SELECT setval('sa_snapshot_20261019.sa_orders_id_seq',8000),setval('sa_snapshot_20261019.sa_items_id_seq',8000)");self.actor(103)
  self.preset=rpc(self.c,'v1_product_configure',(Jsonb(CONFIG),'Persona journey preset','',uuid.uuid4()));self.quote=rpc(self.c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[custom(6)]}),));o=rpc(self.c,'v1_order_place',(uuid.UUID(self.quote['quote_id']),self.quote['version'],Jsonb({'due_at':'2026-12-10T07:00:00Z','line_settings':{'1':{'product_id':self.preset['id']}}}),uuid.uuid4()))['orders'][0];self.oid=int(o['id']);self.iid=int(o['items'][0]['item_id'])
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.n=n;self.c.execute('RESET ROLE');session(self.c,n)
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);result=r.fetchall() if r.description else None;session(self.c,self.n);return result
 def order(self):return rpc(self.c,'v1_order_get',(self.oid,))
 def item(self,section='quantities'):return rpc(self.c,'v1_order_item_get',(self.iid,section))
 def iv(self):return self.item()['version']
 def assign(self):
  self.actor(102);rpc(self.c,'v1_order_assign_factory',(self.oid,104,'Factory assignment',self.order()['version'],uuid.uuid4()));self.actor(104);rpc(self.c,'v1_item_assign_cutter',(self.iid,109,'Cutter assignment',self.iv(),uuid.uuid4()))
 def test_pc_gets_existing_selling_amounts_without_payment_fields(self):
  self.actor(102);r=self.order();self.assertEqual(D(r['total_amount']),D(self.quote['total']));self.assertNotIn('payment_status',r);self.assertNotIn('paid_amount',r);self.assertIn('unit_amount',r['items']['data'][0]);self.assertIn('worker_unit_cost',r['items']['data'][0])
 def test_pc_list_and_dashboard_use_same_selling_projection(self):
  self.actor(102);page=rpc(self.c,'v1_orders_list',(Jsonb({'search':str(self.oid)}),));self.assertEqual(len(page['data']),1);self.assertIn('total_amount',page['data'][0]);summary=rpc(self.c,'v1_dashboard',(Jsonb({'search':str(self.oid)}),));self.assertEqual(D(summary['total_amount']),D(self.quote['total']))
 def test_pc_item_variant_price_matches_order_and_accepted_quote(self):
  self.actor(102);r=self.item('variants');self.assertEqual(D(r['unit_amount']),D(self.quote['lines'][0]['variants'][0]['unit_price']));self.assertEqual(D(r['records']['data'][0]['unit_amount']),D(r['unit_amount']));self.assertEqual(D(r['records']['data'][0]['subtotal']),D(r['unit_amount'])*6)
 def test_payment_remains_visible_to_customer_and_sc(self):
  for n in (103,101):self.actor(n);r=self.order();self.assertIn('paid_amount',r);self.assertIn('payment_status',r)
 def test_pc_still_cannot_change_customer_payment(self):
  self.actor(102)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_order_payment_record',(self.oid,'partial',D('10'),'Forbidden PC payment',self.order()['version'],uuid.uuid4()))
 def test_pc_still_cannot_create_commercial_quote(self):
  self.actor(102)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[custom()]}),))
 def test_pc_row_scope_does_not_expand_to_pure_ready_made(self):
  self.actor(103);q=rpc(self.c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[rmp(3)]}),));o=rpc(self.c,'v1_order_place',(uuid.UUID(q['quote_id']),q['version'],Jsonb({'due_at':'2026-12-01T07:00:00Z'}),uuid.uuid4()))['orders'][0];self.actor(102)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_order_get',(int(o['id']),))
 def test_factory_roles_do_not_gain_selling_or_worker_amounts(self):
  self.assign()
  for n in (104,107,108,109):
   self.actor(n);r=self.item();self.assertNotIn('unit_amount',r);self.assertNotIn('worker_unit_cost',r);self.assertNotIn('total_amount',self.order());self.assertNotIn('unit_amount',self.item('variants')['records']['data'][0])
 def test_worker_sees_only_agreed_cost_not_selling_price(self):
  self.actor(102);rpc(self.c,'v1_order_assign_worker',(self.oid,111,'2026-12-01T07:00:00Z','Outsource work',self.order()['version'],uuid.uuid4()));rpc(self.c,'v1_worker_cost_save',(self.iid,D('12.345'),'Agreed unit rate',self.iv(),uuid.uuid4()));self.actor(111);r=self.item();self.assertEqual(D(r['worker_unit_cost']),D('12.345'));self.assertEqual(D(r['worker_total_cost']),D('74.07'));self.assertNotIn('unit_amount',r);self.assertNotIn('total_amount',self.order())
 def test_assigned_worker_cost_does_not_change_customer_selling_total(self):
  self.actor(102);rpc(self.c,'v1_order_assign_worker',(self.oid,111,'2026-12-01T07:00:00Z','Outsource work',self.order()['version'],uuid.uuid4()));rpc(self.c,'v1_worker_cost_save',(self.iid,D('12.345'),'Agreed unit rate',self.iv(),uuid.uuid4()));self.assertEqual(D(self.order()['total_amount']),D(self.quote['total']))
 def test_private_visibility_helper_is_not_a_client_endpoint(self):
  self.actor(102)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT sa_domain.selling_price_visible(2)')
 def test_foreign_customer_cannot_get_the_price_through_item_endpoint(self):
  self.actor(203)
  with self.assertRaises(psycopg.errors.NoDataFound):self.item()
 def test_team_does_not_gain_order_projection(self):
  self.actor(112)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.order()
 def test_full_custom_order_money_quantity_and_rating_journey(self):
  gross=D(self.quote['total']);self.actor(101);rpc(self.c,'v1_order_payment_record',(self.oid,'partial',D('100'),'Deposit received',self.order()['version'],uuid.uuid4()));self.assign();self.actor(102);criteria=self.item('criteria')['records']['data'];rpc(self.c,'v1_item_criteria_save',(self.iid,Jsonb([{'id':x['id'],'checked':True} for x in criteria]),self.iv(),uuid.uuid4()));self.assertEqual(D(self.order()['total_amount']),gross);self.assertNotIn('paid_amount',self.order())
  self.actor(109);qid=self.item()['records']['data'][0]['id']
  for n in (2,4):rpc(self.c,'v1_cutting_record',(self.iid,Jsonb([{'quantity_id':qid,'quantity':n}]),None,self.iv(),uuid.uuid4()))
  self.actor(104);rpc(self.c,'v1_jobsheet_assign',(self.iid,Jsonb([{'quantity_id':qid,'tailor_id':str(t),'quantity':3} for t in (105,106)]),'2026-12-10T00:00:00Z','2026-12-09T00:00:00Z',self.iv(),uuid.uuid4()));assignments=self.raw('SELECT q.id FROM sa_snapshot_20261019.sa_item_tailor_quantities q JOIN sa_snapshot_20261019.sa_item_tailors t ON t.id=q.item_tailor_id WHERE t.item_id=%s ORDER BY q.id',(self.iid,));self.actor(108);rpc(self.c,'v1_jobsheet_inspect',(self.iid,Jsonb([{'item_tailor_quantity_id':str(row[0]),'quantity':3} for row in assignments]),None,self.iv(),uuid.uuid4()));self.actor(107)
  first=rpc(self.c,'v1_dispatch_record',(self.iid,Jsonb([{'quantity_id':qid,'quantity':2}]),None,self.iv(),uuid.uuid4()));self.assertFalse(first['progress']['order_completed']);self.assertEqual(first['progress']['dispatched'],2)
  last=rpc(self.c,'v1_dispatch_record',(self.iid,Jsonb([{'quantity_id':qid,'quantity':4}]),None,self.iv(),uuid.uuid4()));self.assertTrue(last['progress']['order_completed']);self.assertEqual(last['progress']['dispatched'],6)
  for actor,target in ((103,101),(101,102),(102,104)):
   self.actor(actor);r=rpc(self.c,'v1_rating_save',(None,'Order',self.oid,None,Jsonb({'score':'4.5','positive_comments':'Journey complete'}),None,uuid.uuid4()));self.assertEqual(r['to_id'],str(target));self.assertEqual(D(self.order()['total_amount']),gross)
  self.actor(103);r=self.order();self.assertEqual(D(r['paid_amount']),D('100'));self.assertEqual(r['status'],1);self.assertEqual(r['dispatched_quantity'],6)
  self.assertEqual(self.raw('SELECT quantity,cutting_done,assigned_to_tailor_quantity,completed_by_tailor_quantity,dispatched_quantity FROM sa_snapshot_20261019.sa_quantities WHERE id=%s',(int(qid),)),[(6,6,6,6,6)])

if __name__=='__main__':unittest.main(verbosity=2)
