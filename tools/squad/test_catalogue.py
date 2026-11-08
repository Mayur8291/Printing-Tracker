import unittest,json
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed_orders,session,rpc,advance_fixture_sequences

FEATURES=[{'key':'3','checked':'true','children':[{'key':'3.3','checked':'true'}]}]
def seed_catalogue(c):
 seed_orders(c)
 if c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_base_products WHERE id=1').fetchone():return
 with c.transaction():
  c.execute("""
   INSERT INTO sa_snapshot_20261019.sa_categories(id,name,created_at,updated_at) VALUES(1,'Men',now(),now()),(2,'Kids',now(),now());
   INSERT INTO sa_snapshot_20261019.sa_base_product_types(id,name,created_at,updated_at) VALUES(1,'Shirts',now(),now());
   INSERT INTO sa_snapshot_20261019.sa_base_products(id,name,base_of,base_sn,tims_cost,adult_consumption,kids_consumption,over_header_percentage,sample_rate,calculator,base_product_type_id,created_at,updated_at)
    VALUES(1,'Oxford',20,10,5,2,1,10,500,1000,1,now(),now()),(2,'Unavailable',20,10,5,2,1,10,500,1000,1,now(),now());
   UPDATE sa_snapshot_20261019.sa_base_products SET is_deleted=true WHERE id=2;
   INSERT INTO sa_snapshot_20261019.sa_base_product_categories(base_product_id,category_id,created_at,updated_at) VALUES(1,1,now(),now()),(1,2,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_fabrics(id,name,price,uom,gsm,created_at,updated_at) VALUES(1,'Cotton',50,'METER',200,now(),now()),(2,'Knit',600,'KG',180,now(),now()),(3,'Unrelated',80,'METER',200,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_base_product_fabrics(base_product_id,fabric_id,created_at,updated_at) VALUES(1,1,now(),now()),(1,2,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_colors(id,name,created_by_id,created_at,updated_at) VALUES(1,'White',NULL,now(),now()),(2,'Private',103,now(),now()),(3,'Other private',203,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_fabric_colors(fabric_id,color_id,created_at,updated_at) VALUES(1,1,now(),now()),(1,2,now(),now()),(1,3,now(),now()),(2,1,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_parts(id,name,created_at,updated_at) VALUES(1,'Collar',now(),now()),(2,'Unrelated part',now(),now());
   INSERT INTO sa_snapshot_20261019.sa_base_product_parts(base_product_id,part_id,created_at,updated_at) VALUES(1,1,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_part_colors(part_id,color_id,created_at,updated_at) VALUES(1,1,now(),now()),(2,1,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_add_ons(id,add_on,add_on_price,add_on_of,add_on_sn,has_color,select_type,group_name,created_at,updated_at)
    VALUES(1,'Contrast',5,3,2,true,0,'collar',now(),now()),(2,'Other addon',5,3,2,false,0,'collar',now(),now());
   INSERT INTO sa_snapshot_20261019.sa_add_on_parts(add_on_id,part_id,created_at,updated_at) VALUES(1,1,now(),now()),(2,1,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_add_on_base_products(add_on_id,base_product_id,created_at,updated_at) VALUES(1,1,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_add_on_colors(add_on_id,color_id,created_at,updated_at) VALUES(1,1,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_profit_margins(id,name,min_range,max_range,margin_percentage,branding_embroidery,branding_print,created_at,updated_at)
    VALUES(1,'Small',1,9,20,3,2,now(),now()),(2,'Bulk',10,1000000,10,2,1,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_authorized_brands(id,name,created_at,updated_at) VALUES(1,'A',now(),now()),(2,'B',now(),now());
   INSERT INTO sa_snapshot_20261019.sa_rmp_brands(id,name,authorized_brand_id,created_at,updated_at) VALUES(1,'Brand A',1,now(),now()),(2,'Brand B',2,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_assigned_brands(user_id,authorized_brand_id,created_at,updated_at) VALUES(110,1,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_rmp_categories(id,name,created_at,updated_at) VALUES(1,'Polo',now(),now());
   INSERT INTO sa_snapshot_20261019.sa_rmp_colors(id,name,created_at,updated_at) VALUES(1,'White',now(),now());
   INSERT INTO sa_snapshot_20261019.sa_rmp_classes(id,name,rmp_color_id,created_at,updated_at) VALUES(1,'Classic A',1,now(),now()),(2,'Classic B',1,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_rmp_sizes(id,name,size_type,created_at,updated_at) VALUES(1,'M',0,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_rmp_skus(id,name,rmp_class_id,rmp_brand_id,rmp_category_id,rmp_size_id,created_at,updated_at)
    VALUES(1,'SKU A',1,1,1,1,now(),now()),(2,'SKU B',2,2,1,1,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_zones(id,name,created_at,updated_at) VALUES(1,'South',now(),now());
   INSERT INTO sa_snapshot_20261019.sa_rmp_price_types(id,name,price_for,zone_id,created_at,updated_at) VALUES(1,'Regular',0,NULL,now(),now()),(2,'South',1,1,now(),now()),(3,'Special',0,NULL,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_rmp_prices(id,name,price,mrp,rmp_sku_id,rmp_price_type_id,created_at,updated_at)
    VALUES(1,'A regular',100,150,2,1,now(),now()),(2,'A south',80,150,2,2,now(),now()),(3,'B regular',200,250,2,1,now(),now()),(4,'Special',70,150,2,3,now(),now());
   INSERT INTO sa_snapshot_20261019.sa_rmp_sku_prices(rmp_sku_id,rmp_price_id,created_at,updated_at) VALUES(1,1,now(),now()),(1,2,now(),now()),(2,3,now(),now()),(1,4,now(),now());
   SELECT setval('sa_snapshot_20261019.sa_colors_id_seq',3);
   UPDATE sa_snapshot_20261019.sa_rmp_skus SET cgst=2.5,sgst=2.5,igst=5;
   UPDATE sa_snapshot_20261019.sa_users SET zone_id=1 WHERE id=103;
   UPDATE sa_snapshot_20261019.sa_users SET rmp_price_type_id=3 WHERE id=203;
  """)
  advance_fixture_sequences(c)
class Catalogue(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):self.c=connect();self.c.execute('BEGIN');session(self.c,103)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.c.execute('RESET ROLE');session(self.c,n)
 def raw(self,q,args=()):self.c.execute('RESET ROLE');self.c.execute(q,args);session(self.c,103)
 def opts(self,kind,parent=None,part=None):return rpc(self.c,'v1_configurator_options',(1,kind,parent,part))['data']
 def test_custom_catalogue_projects_no_customer_costs(self):
  r=rpc(self.c,'v1_catalog_tree')['data'];self.assertEqual([x['id'] for x in r],['1']);self.assertNotIn('costs',r[0])
 def test_coordinator_costs_visible(self):
  self.actor(101);self.assertEqual(float(rpc(self.c,'v1_base_product_get',(1,))['costs']['sample_rate']),500)
 def test_customer_fabric_price_redacted(self):self.assertNotIn('price',self.opts('fabrics')[0])
 def test_valid_fabrics_only(self):self.assertEqual({x['id'] for x in self.opts('fabrics')},{'1','2'})
 def test_colors_are_public_or_owned(self):self.assertEqual({x['id'] for x in self.opts('fabric_colors',1)},{'1','2'})
 def test_unrelated_parent_gives_no_options(self):self.assertEqual(self.opts('part_colors',2),[])
 def test_addon_requires_both_base_and_part(self):self.assertEqual([x['id'] for x in self.opts('addons',1)],['1'])
 def test_deleted_link_removed(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_add_on_base_products SET is_deleted=true WHERE add_on_id=1');self.assertEqual(self.opts('addons',1),[])
 def test_catalogue_feature_gate(self):
  self.actor(112)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_catalog_tree')
 def test_configure_requires_child_feature(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_users SET features=%s WHERE id=112",(Jsonb([{'key':'3','checked':'true'}]),));self.actor(112)
  self.assertTrue(rpc(self.c,'v1_catalog_tree')['data'])
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.opts('fabrics')
 def test_enabled_worker_can_configure(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET features=%s WHERE id=112',(Jsonb(FEATURES),));self.actor(112)
  self.assertIn('price',self.opts('fabrics')[0])
 def test_deleted_base_not_found(self):
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_base_product_get',(2,))
 def test_no_arbitrary_customer_price_context(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_catalog_options',(203,))
 def test_coordinator_scope_checked(self):
  self.actor(101);self.assertEqual(rpc(self.c,'v1_catalog_options',(103,))['context']['price_type_id'],'2')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_catalog_options',(203,))
 def test_zone_price_uses_link_table(self):
  p=rpc(self.c,'v1_rmp_variants',(1,))['data'][0]['price'];self.assertEqual(float(p['unit_price']),80);self.assertFalse(p['fallback'])
 def test_missing_selected_price_falls_back_regular(self):
  p=rpc(self.c,'v1_rmp_variants',(2,))['data'][0]['price'];self.assertEqual(float(p['unit_price']),200);self.assertTrue(p['fallback'])
 def test_direct_customer_uses_assigned_price(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true,rmp_price_type_id=3 WHERE id=103')
  self.assertEqual(float(rpc(self.c,'v1_rmp_variants',(1,))['data'][0]['price']['unit_price']),70)
 def test_deleted_price_link_not_used(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_rmp_sku_prices SET is_deleted=true WHERE rmp_price_id=2')
  self.assertEqual(float(rpc(self.c,'v1_rmp_variants',(1,))['data'][0]['price']['unit_price']),100)
 def test_stock_unknown_is_not_zero(self):
  r=rpc(self.c,'v1_rmp_variants',(1,))['data'][0]['availability'];self.assertEqual(r['status'],'not_loaded');self.assertIsNone(r['one_day'])
 def test_dealer_brand_scope_before_page(self):
  self.actor(110);r=rpc(self.c,'v1_rmp_search',(Jsonb({}),None,None,1));self.assertEqual([x['id'] for x in r['data']],['1']);self.assertIsNone(r['next_cursor'])
 def test_dealer_cannot_get_unassigned_brand(self):
  self.actor(110)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_rmp_detail',(2,))
 def test_catalog_cursor_does_not_cross_filter(self):
  r=rpc(self.c,'v1_rmp_search',(Jsonb({}),None,None,1));self.assertIsNotNone(r['next_cursor'])
  next_=rpc(self.c,'v1_rmp_search',(Jsonb({}),None,r['next_cursor'],1));self.assertNotEqual(r['data'][0]['id'],next_['data'][0]['id'])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_rmp_search',(Jsonb({'brand_id':1}),None,r['next_cursor'],1))
 def test_media_no_source_url_or_storage_path(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_base_products SET image='private.png' WHERE id=1")
  r=rpc(self.c,'v1_base_product_get',(1,))['image'];self.assertEqual(r['status'],'pending');self.assertNotIn('private.png',json.dumps(r))
 def test_media_batch_matches_current_source_value(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_rmp_classes SET image_1='current.png',image_2='new.png' WHERE id=1")
  self.raw("INSERT INTO sa_media.references(resource,record_id,field,source_value,status) VALUES('rmp_classes',1,'image_1','current.png','ready'),('rmp_classes',1,'image_2','old.png','ready')")
  images=rpc(self.c,'v1_rmp_detail',(1,))['images'];self.assertEqual([x['status'] for x in images],['ready','pending','empty','empty','empty'])
 def test_position_order_and_stable_cursor_ties(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_rmp_classes SET position=10')
  first=rpc(self.c,'v1_rmp_search',(Jsonb({}),None,None,1));second=rpc(self.c,'v1_rmp_search',(Jsonb({}),None,first['next_cursor'],1))
  self.assertEqual([first['data'][0]['id'],second['data'][0]['id']],['1','2'])
  self.raw('UPDATE sa_snapshot_20261019.sa_rmp_classes SET position=1 WHERE id=2')
  self.assertEqual(rpc(self.c,'v1_rmp_search')['data'][0]['id'],'2')
 def test_search_is_literal_and_applies_to_variants(self):
  self.assertEqual(rpc(self.c,'v1_rmp_search',(Jsonb({'search':'%'}),))['data'],[])
  self.assertEqual(rpc(self.c,'v1_rmp_variants',(1,None,Jsonb({'search':'absent'})))['data'],[])
 def test_raw_prices_and_helpers_denied(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT sa_domain.sku_price(1,3)')
if __name__=='__main__':unittest.main(verbosity=2)
