import copy,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue
from test_pricing import CONFIG,rmp

class HistoricalPresets(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');self.c.execute("UPDATE sa_snapshot_20261019.sa_addresses SET state='Karnataka'");self.n=101;session(self.c,self.n)
  self.config=copy.deepcopy(CONFIG)
  self.colors=[]
  for kind in ('fabric','part','addon'):
   color=rpc(self.c,'v1_color_save',(kind,1,'Private history','#AA12BB',uuid.uuid4()));self.colors.append(color['id'])
  self.config['fabric_color_id']=self.colors[0];self.config['parts'][0]['color_id']=self.colors[1];self.config['parts'][0]['addons'][0]['color_id']=self.colors[2]
  self.p=rpc(self.c,'v1_product_configure',(Jsonb(self.config),'Historical private preset','',uuid.uuid4()))
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET product_id=%s WHERE id=1004',(int(self.p['id']),));self.actor(103)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.n=n;self.c.execute('RESET ROLE');session(self.c,n)
 def raw(self,query,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(query,args);data=r.fetchall() if r.description else None;session(self.c,self.n);return data
 def quote(self,line=None,customer='103',address='100'):
  return rpc(self.c,'v1_quote',(Jsonb({'customer_id':customer,'address_id':address,'lines':[line or {'kind':'custom','preset_id':self.p['id'],'quantities':[{'size_id':'1','quantity':6}]}]}),))
 def place(self,q):return rpc(self.c,'v1_order_place',(q['quote_id'],q['version'],Jsonb({'due_at':'2026-12-01T00:00:00Z','line_settings':{'1':{'product_id':self.p['id']}}}),uuid.uuid4()))
 def test_customer_reorders_private_fabric_part_and_addon_colors(self):
  q=self.quote();self.assertEqual(q['lines'][0]['configuration']['fabric_color_id'],self.colors[0]);self.assertTrue(self.place(q)['orders']);self.assertNotIn('costs',q['lines'][0])
 def test_dealer_reorders_customer_fulfillment_preset_for_own_purchase(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_addresses(id,user_id,state,created_at,updated_at) VALUES(9999,110,'Karnataka',now(),now())");self.actor(110)
  q=self.quote(customer='110',address='9999');self.assertTrue(self.place(q)['orders'])
 def test_unrelated_customer_cannot_reorder_preset(self):
  self.actor(203)
  with self.assertRaises(psycopg.errors.NoDataFound):self.quote(customer='203',address='200')
 def test_coordinator_can_reorder_visible_preset(self):
  self.actor(101);self.assertTrue(self.place(self.quote())['orders'])
 def test_private_colors_do_not_become_selector_options(self):
  self.quote()
  for kind,color in zip(('fabric_colors','part_colors','addon_colors'),self.colors):
   self.assertNotIn(color,[x['id'] for x in rpc(self.c,'v1_configurator_options',(1,kind,1,1))['data']])
 def test_plain_configuration_cannot_use_historical_private_colors(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote({'kind':'custom','configuration':self.config,'quantities':[{'size_id':'1','quantity':6}]})
 def test_preset_cannot_authorize_different_configuration(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote({'kind':'custom','preset_id':self.p['id'],'configuration':CONFIG,'quantities':[{'size_id':'1','quantity':6}]})
 def test_deleted_private_color_prevents_reorder(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_colors SET is_deleted=true WHERE id=%s',(int(self.colors[0]),))
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote()
 def test_deleted_compatibility_link_prevents_reorder(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_base_product_parts SET is_deleted=true WHERE base_product_id=1')
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote()
 def test_lost_order_relationship_invalidates_cached_quote(self):
  q=self.quote();self.raw('UPDATE sa_snapshot_20261019.sa_items SET product_id=NULL WHERE id=1004')
  with self.assertRaises(psycopg.errors.NoDataFound):self.place(q)
 def test_changed_master_price_invalidates_cached_quote(self):
  q=self.quote();self.raw('UPDATE sa_snapshot_20261019.sa_fabrics SET price=price+1 WHERE id=1')
  with self.assertRaises(psycopg.errors.SerializationFailure):self.place(q)
 def test_ordinary_client_cannot_read_private_color_projection(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT sa_domain.active_preset_colors(ARRAY[1::bigint])')
 def test_ordinary_client_cannot_invoke_preset_validation_helper(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT sa_domain.normalize_configuration(%s,%s)',(Jsonb(self.config),int(self.p['id'])))
 def test_rmp_optional_category_quotes_and_places(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_rmp_skus SET rmp_category_id=NULL WHERE id=1');q=self.quote(rmp())
  r=rpc(self.c,'v1_order_place',(q['quote_id'],q['version'],Jsonb({'due_at':'2026-12-01T00:00:00Z'}),uuid.uuid4()));self.assertTrue(r['orders'])
 def test_deleted_rmp_category_is_not_an_optional_category(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_rmp_categories SET is_deleted=true WHERE id=1')
  with self.assertRaises(psycopg.errors.NoDataFound):self.quote(rmp())

if __name__=='__main__':unittest.main(verbosity=2)
