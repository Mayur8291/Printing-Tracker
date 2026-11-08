"""Complete item projections, bounded children and persona-specific information."""
import json,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from fixtures import rpc
import test_order_amendments as amendments
from test_pricing import custom,rmp

class Details(unittest.TestCase):
 setUpClass=classmethod(amendments.Amendments.setUpClass.__func__)
 setUp=amendments.Amendments.setUp;tearDown=amendments.Amendments.tearDown;actor=amendments.Amendments.actor;raw=amendments.Amendments.raw
 preset=amendments.Amendments.preset;quote=amendments.Amendments.quote;place=amendments.Amendments.place;design=amendments.Amendments.design
 branded_order=amendments.Amendments.branded_order
 def get(self,section='quantities',cursor=None,limit=30,id=None):return rpc(self.c,'v1_order_item_get',(id or self.item,section,cursor,limit))
 def operational(self,actor):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=104,assigned_worker_id=111,assigned_by_id=102 WHERE id=%s',(self.id,))
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET cutting_master_id=109,worker_per_piece_amount=12.50,worker_total_amount=75 WHERE id=%s',(self.item,));self.actor(actor)
 def test_customer_has_commercial_amounts_not_worker_or_consumption(self):
  self.actor(103);r=self.get();self.assertIn('unit_amount',r);self.assertNotIn('worker_unit_cost',r);self.assertNotIn('fabric_consumption',r);self.assertEqual(r['product']['fabric']['id'],'1');self.assertEqual(r['records']['data'][0]['size_name'],'M')
 def test_job_worker_sees_own_cost_without_optional_catalogue_permission(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_users SET features='[]' WHERE id=111");self.operational(111);r=self.get();self.assertEqual(r['worker_unit_cost'],'12.50');self.assertNotIn('unit_amount',r);self.assertIsNotNone(r['product']['fabric']['name']);self.assertIn('fabric_consumption',r)
 def test_foreign_job_worker_denied(self):
  self.operational(211)
  with self.assertRaises(psycopg.errors.NoDataFound):self.get()
 def test_factory_sees_materials_but_no_money(self):
  self.operational(104);r=self.get();self.assertIsNotNone(r['product']['fabric']['name']);self.assertNotIn('unit_amount',r);self.assertNotIn('worker_unit_cost',r);self.assertIn('fabric_consumption',r)
 def test_dispatch_materials_without_consumption(self):
  self.operational(107);r=self.get();self.assertIsNotNone(r['product']['fabric']['name']);self.assertNotIn('fabric_consumption',r)
 def test_cutting_master_no_consumption(self):
  self.operational(109);r=self.get();self.assertIsNotNone(r['product']['fabric']['name']);self.assertNotIn('fabric_consumption',r)
 def test_customer_cannot_read_checklist(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.get('criteria')
 def test_inspector_cannot_read_checklist(self):
  self.operational(108)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.get('criteria')
 def test_manager_reads_checklist(self):
  self.operational(104);r=self.get('criteria');self.assertEqual({x['name'] for x in r['records']['data']},{'Fabric','Trims'})
 def test_parts_and_addons_have_labels_not_costs(self):
  self.operational(104);p=self.get('parts')['records']['data'];a=self.get('addons')['records']['data'];self.assertTrue(p);self.assertTrue(a);self.assertIsNotNone(p[0]['name']);self.assertIsNotNone(a[0]['name']);self.assertIn(a[0]['product_part_id'],[x['id'] for x in p]);self.assertNotIn('price',json.dumps(a))
 def test_item_children_are_bounded_and_cursor_continues_order_preview(self):
  self.raw('INSERT INTO sa_snapshot_20261019.sa_quantities(size_id,item_id,quantity,created_at,updated_at) SELECT 1,%s,1,now(),now() FROM generate_series(1,24)',(self.item,))
  first=rpc(self.c,'v1_order_get',(self.id,))['items']['data'][0];self.assertEqual(len(first['quantities']),20);self.assertIsNotNone(first['quantities_next_cursor'])
  more=self.get(cursor=first['quantities_next_cursor']);self.assertEqual(len(more['records']['data']),5);self.assertFalse({x['id'] for x in more['records']['data']}&{x['id'] for x in first['quantities']})
 def test_cursor_bound_to_section(self):
  r=self.get('criteria',limit=1)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.get('parts',r['records']['next_cursor'])
 def test_cursor_bound_to_actor(self):
  r=self.get('criteria',limit=1);self.operational(104)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.get('criteria',r['records']['next_cursor'])
 def test_cursor_bound_to_item_version(self):
  r=self.get('criteria',limit=1);self.raw("INSERT INTO sa_domain.entity_versions(kind,entity_id,revision) VALUES('item',%s,9) ON CONFLICT(kind,entity_id) DO UPDATE SET revision=9",(self.item,))
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.get('criteria',r['records']['next_cursor'])
 def test_branding_returns_private_descriptors_never_source_urls(self):
  self.branded_order();self.operational(111);r=self.get('brandings')['records']['data'][0];self.assertEqual(r['side'],'front');self.assertIn('version',r);self.assertEqual(r['image']['status'],'ready');self.assertEqual(r['image']['resource'],'brandings');self.assertNotIn('design.png',json.dumps(r))
 def test_deleted_master_still_describes_existing_work(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_fabrics SET is_deleted=true WHERE id=1');self.operational(104);self.assertIsNotNone(self.get()['product']['fabric']['name'])
 def test_product_photos_are_scoped(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_product_images(product_id,image,comment,created_at,updated_at) VALUES(%s,'private.jpg','Photo',now(),now())",(int(self.product['id']),));self.operational(104);r=self.get('images')['records']['data'];self.assertEqual(len(r),1);self.assertEqual(r[0]['image']['status'],'pending');self.assertNotIn('private.jpg',json.dumps(r))
 def test_sample_bulk_plan_is_separate(self):
  line=custom(10);line['sample']={'size_id':'1','quantity':1};o=self.place(self.quote([line]),{'line_settings':{'1':{'product_id':self.product['id']}}})['orders'][0];item=int(o['items'][0]['item_id'])
  self.assertEqual(self.get(id=item)['records']['data'][0]['quantity'],1);self.assertEqual(self.get('bulk_plan',id=item)['records']['data'][0]['quantity'],10)
 def test_exact_accepted_variant_and_unknown_import_are_distinct(self):
  o=self.place(self.quote([rmp()]))['orders'][0];item=int(o['items'][0]['item_id']);r=self.get('variants',id=item)['records'];self.assertEqual(r['basis'],'accepted_quote');self.assertEqual(r['data'][0]['sku_id'],'1')
  self.raw('DELETE FROM sa_domain.line_receipts WHERE item_id=%s',(item,));r=self.get('variants',id=item)['records'];self.assertEqual(r['basis'],'not_recorded_in_source');self.assertEqual(r['data'],[])
 def test_foreign_customer_denied(self):
  self.actor(203)
  with self.assertRaises(psycopg.errors.NoDataFound):self.get()
 def test_team_has_no_order_detail(self):
  self.actor(112)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.get()
 def test_invalid_section_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.get('passwords')
 def test_comment_is_bounded(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET comment=%s WHERE id=%s',('x'*5000,self.item));r=self.get();self.assertEqual(len(r['comment']),4000);self.assertTrue(r['comment_truncated'])
 def test_private_children_not_callable(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT sa_domain.item_children(%s,'quantities',NULL,30)",(self.item,))
 def test_private_master_labels_not_callable(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT sa_domain.work_master('fabrics',1)")
 def test_private_product_image_array_has_pointer_and_no_source(self):
  self.raw("INSERT INTO sa_media.references(resource,record_id,field,pointer,source_value,status) VALUES('products',%s,'images','/0','secret/path.jpg','missing')",(int(self.product['id']),));self.operational(104)
  r=self.get('source_images')['records']['data'][0];self.assertEqual(r['image']['pointer'],'/0');self.assertEqual(r['image']['status'],'missing');self.assertNotIn('secret/path',json.dumps(r))
 def test_variant_subtotal_is_accepted_unit_times_quantity(self):
  o=self.place(self.quote([rmp()]))['orders'][0];r=self.get('variants',id=int(o['items'][0]['item_id']))['records']['data'][0]
  self.assertEqual(amendments.D(r['subtotal']),amendments.D(r['unit_amount'])*r['quantity'])
