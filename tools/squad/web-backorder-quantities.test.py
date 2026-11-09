"""Dealer procurement choices reuse quote, ownership, version and stock fences."""
import unittest,uuid,copy,psycopg
from psycopg.types.json import Jsonb
from fixtures import rpc
from sqlstate_assertions import assert_app_conflict
import test_backorders as base
class Quantities(unittest.TestCase):
 setUpClass=classmethod(base.Backorders.setUpClass.__func__)
 setUp=base.Backorders.setUp;tearDown=base.Backorders.tearDown
 actor=base.Backorders.actor;raw=base.Backorders.raw;supply=base.Backorders.supply
 preview=base.Backorders.preview;place=base.Backorders.place
 def choices(self,p,quantity):return [{'key':x['key'],'size_id':x['size_id'],'quantity':quantity} for x in p['requirements']]
 def edited(self,choices,ids=None,address=9999):return rpc(self.c,'v1_backorder_preview',(ids or [1004,1005],address,Jsonb(choices)))
 def test_more_or_less_than_shortage_is_explicit_purchase_not_changed_demand(self):
  self.supply();p=self.preview();e=self.edited(self.choices(p,20));self.assertEqual(e['requirements'][0]['shortage'],11);self.assertEqual(e['requirements'][0]['purchase_quantity'],20);self.assertEqual(e['quote']['quantity'],20)
  smaller=self.edited(self.choices(p,2));self.assertEqual(smaller['quote']['quantity'],2);r=self.place(smaller);self.assertEqual(self.raw('SELECT total_quantity FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(int(r['orders'][0]['id']),)),[(2,)])
  self.assertEqual(self.raw('SELECT quantity FROM sa_snapshot_20261019.sa_quantities WHERE item_id IN(1004,1005) ORDER BY item_id'),[(7,),(7,)])
 def test_zero_size_omitted_and_positive_size_quoted(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_sizes(id,name,created_at,updated_at) VALUES(2,'L',now(),now())")
  self.raw('INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,created_at,updated_at) VALUES(1004,2,5,now(),now())')
  self.raw("INSERT INTO sa_snapshot_20261019.sa_rmp_sizes(id,name,size_type,created_at,updated_at) VALUES(2,'L',0,now(),now())")
  self.raw("INSERT INTO sa_snapshot_20261019.sa_rmp_skus(id,name,rmp_class_id,rmp_brand_id,rmp_category_id,rmp_size_id,created_at,updated_at) VALUES(3,'L',1,1,1,2,now(),now())")
  choices=[{'key':'r:1:1:1','size_id':'1','quantity':3},{'key':'r:1:1:1','size_id':'2','quantity':0}]
  default=self.edited([choices[1]]);self.assertEqual(default['quote']['quantity'],14)
  e=self.edited(choices);self.assertEqual(e['quote']['quantity'],3);self.assertEqual(e['requirements'][1]['purchase_quantity'],0)
 def test_custom_preset_choice_keeps_canonical_product_and_demand(self):
  self.actor(101);config=copy.deepcopy(base.CONFIG);col=rpc(self.c,'v1_color_save',('fabric',1,'Chosen','#AB12CD',uuid.uuid4()));config['fabric_color_id']=col['id']
  product=rpc(self.c,'v1_product_configure',(Jsonb(config),'Chosen product','',uuid.uuid4()))
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=0,product_id=%s,rmp_class_id=NULL,rmp_brand_id=NULL,rmp_category_id=NULL WHERE id IN(1004,1005)',(int(product['id']),));self.actor(110)
  p=self.preview();edited=self.edited(self.choices(p,5));self.assertEqual(edited['quote']['quantity'],5);self.assertEqual(edited['requirements'][0]['product_id'],product['id']);self.assertTrue(self.place(edited)['orders'])
 def test_invalid_quantity_shape_duplicate_foreign_and_all_zero_rejected(self):
  p=self.preview();valid=self.choices(p,3)
  for choices in [[],{},[dict(valid[0],quantity=-1)],[dict(valid[0],quantity=1.5)],[dict(valid[0],quantity='3')],[dict(valid[0],quantity=1000001)],[dict(valid[0],quantity=0)],valid+valid,[dict(valid[0],key='r:999:1:1')],[dict(valid[0],size_id='999')],[dict(valid[0],extra='bad')]]:
   with self.assertRaises(psycopg.errors.InvalidParameterValue):
    with self.c.transaction():self.edited(choices)
 def test_stock_price_source_change_invalidates_edited_preview(self):
  p=self.edited(self.choices(self.preview(),20));self.supply()
  with assert_app_conflict(self):
   with self.c.transaction():self.place(p)
  fresh=self.edited(self.choices(self.preview(),20));self.raw('UPDATE sa_snapshot_20261019.sa_rmp_prices SET price=price+1')
  with assert_app_conflict(self):self.place(fresh)
 def test_ownership_generation_expiry_and_private_helper(self):
  p=self.edited(self.choices(self.preview(),20));self.actor(210)
  with self.assertRaises(psycopg.errors.NoDataFound):
   with self.c.transaction():self.place(p)
  self.actor(110)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):
   with self.c.transaction():self.c.execute('SELECT sa_domain.backorder_purchase_calculation(ARRAY[1004]::bigint[],NULL)')
  self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1')
  with assert_app_conflict(self):self.place(p)
 def test_replay_and_old_two_argument_preview_unchanged(self):
  p=self.edited(self.choices(self.preview(),20));key=uuid.uuid4();r=self.place(p,key);self.assertEqual(r,self.place(p,key));self.assertEqual(len(r['linked_order_versions']),2)
 def test_no_shortage_can_explicitly_purchase_extra_stock(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET quantity=20 WHERE item_id=1001');self.supply();p=self.preview();self.assertEqual(p['status'],'no_shortage')
  edited=self.edited(self.choices(p,2));self.assertEqual(edited['status'],'ready');self.assertEqual(edited['quote']['quantity'],2)
 def test_mirror_and_reconciliation_remain_blocked(self):
  p=self.edited(self.choices(self.preview(),20));self.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=false')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):
   with self.c.transaction():self.place(p)
  self.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=true');self.supply();self.raw('UPDATE sa_snapshot_20261019.sa_stocks SET dispatched_quantity=-1')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.edited(self.choices(p,20))
if __name__=='__main__':unittest.main(verbosity=2)
