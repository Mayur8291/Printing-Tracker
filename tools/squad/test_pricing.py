import copy,decimal,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue
D=decimal.Decimal
CONFIG={'base_product_id':'1','fabric_id':'1','fabric_color_id':'1','category_id':'1','parts':[{'part_id':'1','color_id':'1','addons':[{'addon_id':'1','color_id':'1'}]}]}
def custom(quantity=6,config=None):return {'kind':'custom','configuration':copy.deepcopy(config or CONFIG),'quantities':[{'size_id':'1','quantity':quantity}]}
def rmp(quantity=6):return {'kind':'rmp','skus':[{'sku_id':'1','quantity':quantity}]}
class Pricing(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute("UPDATE sa_snapshot_20261019.sa_addresses SET state='Karnataka' WHERE id=100");session(self.c,103)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.c.execute('RESET ROLE');session(self.c,n)
 def raw(self,q,args=()):self.c.execute('RESET ROLE');self.c.execute(q,args);session(self.c,103)
 def quote(self,lines=None,customer='103',address='100'):
  return rpc(self.c,'v1_quote',(Jsonb({'customer_id':customer,'address_id':address,'lines':lines or [custom()]}),))
 def unit(self,quantity):return D(self.quote([custom(quantity)])['lines'][0]['variants'][0]['unit_price'])
 def test_sample_bulk_and_band_boundaries(self):
  self.assertEqual(self.unit(5),D('500'));self.assertEqual(self.unit(6),D('191.400'));self.assertEqual(self.unit(9),D('191.400'));self.assertEqual(self.unit(10),D('175.450'))
 def test_sample_order_retains_bulk_plan(self):
  line=custom(10);line['sample']={'size_id':'1','quantity':1}
  r=self.quote([line])['lines'][0];self.assertEqual(D(r['variants'][0]['unit_price']),500);self.assertEqual(r['quantities']['sample']['quantity'],1);self.assertEqual(r['quantity'],10)
 def test_repeated_configuration_keeps_quantity_bands_and_sample_distinct(self):
  sample=custom(10);sample['sample']={'size_id':'1','quantity':1}
  r=self.quote([custom(5),custom(6),custom(10),sample,custom(6)])
  self.assertEqual([D(x['variants'][0]['unit_price']) for x in r['lines']],[D('500'),D('191.4'),D('175.45'),D('500'),D('191.4')])
  self.assertEqual([x['quantity'] for x in r['lines']],[5,6,10,10,6])
 def test_repeated_quantities_keep_configuration_prices_distinct(self):
  kids=custom();kids['configuration']['category_id']='2'
  self.assertEqual([D(x['variants'][0]['unit_price']) for x in self.quote([custom(),kids,custom()])['lines']],[D('191.4'),D('125.4'),D('191.4')])
 def test_price_is_reloaded_on_next_rpc(self):
  self.assertEqual(self.unit(1),D('500'));self.raw('UPDATE sa_snapshot_20261019.sa_base_products SET sample_rate=700 WHERE id=1');self.assertEqual(self.unit(1),D('700'))
 def test_reused_configuration_still_validates_each_line(self):
  invalid=custom();invalid['unit_price']='1'
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([custom(),invalid])
 def test_reused_configuration_still_validates_each_quantity_selection(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([custom(),custom(0)])
 def test_cached_preset_cannot_also_supply_configuration(self):
  self.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
  p=rpc(self.c,'v1_product_configure',(Jsonb(CONFIG),'Pricing validation','',uuid.uuid4()))
  line=custom();del line['configuration'];line['preset_id']=p['id'];invalid=dict(line,configuration=CONFIG)
  with self.assertRaisesRegex(psycopg.errors.InvalidParameterValue,'not both'):self.quote([line,invalid])
 def test_kids_consumption(self):
  line=custom();line['configuration']['category_id']='2';self.assertEqual(D(self.quote([line])['lines'][0]['variants'][0]['unit_price']),D('125.400'))
 def test_kg_formula(self):
  line=custom();line['configuration']['fabric_id']='2';self.assertEqual(D(self.quote([line])['lines'][0]['variants'][0]['unit_price']),D('87.912'))
 def test_branding_in_tax_base(self):
  line=custom();line['brandings']=[{'type':'print','side':'front','width':'2','height':'3','unit':'inch'}]
  r=self.quote([line]);self.assertEqual(D(r['branding_total']),72);self.assertEqual(D(r['cgst']),D('30.54'));self.assertEqual(D(r['total']),D('1281.48'))
 def test_out_of_state_tax(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_addresses SET state='Maharashtra' WHERE id=100")
  r=self.quote();self.assertEqual(D(r['cgst']),0);self.assertEqual(D(r['sgst']),0);self.assertEqual(D(r['igst']),D('57.42'))
 def test_tax_threshold_exact_999(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_base_products SET sample_rate=999 WHERE id=1');r=self.quote([custom(1)]);self.assertEqual(D(r['cgst']),D('59.94'))
 def test_tax_below_999(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_base_products SET sample_rate=998.99 WHERE id=1');r=self.quote([custom(1)]);self.assertEqual(D(r['cgst']),D('24.97'))
 def test_sku_tax_override_including_zero(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_rmp_skus SET cgst=0,sgst=1 WHERE id=1');r=self.quote([rmp()]);self.assertEqual(D(r['cgst']),0);self.assertEqual(D(r['sgst']),D('4.8'))
 def test_mixed_quote_uses_one_engine(self):
  r=self.quote([custom(),rmp()]);self.assertEqual(D(r['subtotal']),D('1628.4'));self.assertEqual(r['quantity'],12);self.assertEqual(len(r['lines']),2)
 def test_customer_costs_redacted(self):self.assertNotIn('costs',self.quote()['lines'][0])
 def test_sc_can_see_costs_for_owned_customer(self):
  self.actor(101);self.assertEqual(D(self.quote()['lines'][0]['costs']['manufacturing']),145)
 def test_other_customer_quote_denied(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.quote(customer='203',address='200')
 def test_other_address_denied(self):
  with self.assertRaises(psycopg.errors.NoDataFound):self.quote(address='200')
 def test_unrelated_fabric_rejected(self):
  line=custom();line['configuration']['fabric_id']='3'
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([line])
 def test_private_color_rejected(self):
  line=custom();line['configuration']['fabric_color_id']='3'
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([line])
 def test_unrelated_addon_rejected(self):
  line=custom();line['configuration']['parts'][0]['addons'][0]={'addon_id':'2'}
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([line])
 def test_mixed_single_multiple_group_rejected(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_add_ons SET select_type=1 WHERE id=2')
  self.raw('INSERT INTO sa_snapshot_20261019.sa_add_on_base_products(add_on_id,base_product_id,created_at,updated_at) VALUES(2,1,now(),now())')
  line=custom();line['configuration']['parts'][0]['addons'].append({'addon_id':'2'})
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([line])
 def test_request_complexity_bounded_before_calculation(self):
  line=custom();line['configuration']['parts']*=11
  with self.assertRaisesRegex(psycopg.errors.InvalidParameterValue,'selection budget'):self.quote([line]*50)
 def test_duplicate_part_rejected(self):
  line=custom();line['configuration']['parts']*=2
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([line])
 def test_duplicate_size_rejected(self):
  line=custom();line['quantities']*=2
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([line])
 def test_zero_quantity_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([custom(0)])
 def test_fractional_quantity_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([custom('1.5')])
 def test_negative_quantity_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([rmp(-1)])
 def test_duplicate_sku_rejected(self):
  line=rmp();line['skus']*=2
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([line])
 def test_mixed_class_same_line_rejected(self):
  line=rmp();line['skus'].append({'sku_id':'2','quantity':1})
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([line])
 def test_client_price_not_accepted(self):
  line=rmp();line['unit_price']='1'
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([line])
 def test_nonfinite_branding_rejected(self):
  line=custom();line['brandings']=[{'type':'print','side':'front','width':'NaN','height':'3','unit':'inch'}]
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([line])
 def test_unknown_units_rejected(self):
  line=custom();line['brandings']=[{'type':'print','side':'front','width':'2','height':'3','unit':'cm'}]
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([line])
 def test_deleted_price_rejected_or_fallback(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_rmp_prices SET is_deleted=true WHERE id IN(1,2)')
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.quote([rmp()])
 def test_quote_preview_does_not_dirty_mirror(self):
  self.c.execute('RESET ROLE');before=self.c.execute('SELECT edit_revision FROM sa_sync.environment_state').fetchone();session(self.c,103)
  r=self.quote();self.assertIn('quote_id',r);self.assertIn('version',r);self.assertIn('expires_at',r)
  self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT edit_revision FROM sa_sync.environment_state').fetchone(),before)
 def test_quote_cache_not_client_readable(self):
  self.quote()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT * FROM sa_domain.quotes')
 def test_document_markup_does_not_change_sale_price(self):
  request={'lines':[rmp(6)]};r=rpc(self.c,'v1_catalogue_quote',(Jsonb(request),Jsonb({'kind':'percentage','value':'25'})))
  v=r['lines'][0]['variants'][0];self.assertEqual(D(v['unit_price']),80);self.assertEqual(D(v['display_unit_price']),100);self.assertFalse(r['tax_included'])
 def test_quantity_validation_returns_separate_sample(self):
  r=rpc(self.c,'v1_item_quantity_validate',(Jsonb([{'size_id':'1','quantity':50}]),Jsonb({'size_id':'1','quantity':1})))
  self.assertEqual(r['total_quantity'],50);self.assertTrue(r['sample_order']);self.assertEqual(r['sample']['quantity'],1)
if __name__=='__main__':unittest.main(verbosity=2)
