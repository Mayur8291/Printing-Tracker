"""Point item details: scope equivalence, private helpers and realistic volume.
Only the isolated localhost SQUAD_TEST_DATABASE; no imported customer records.
"""
import time, unittest
import psycopg
from psycopg import sql
from fixtures import rpc
import test_order_details as base

class PointDetails(unittest.TestCase):
 setUpClass=classmethod(base.Details.setUpClass.__func__)
 setUp=base.Details.setUp;tearDown=base.Details.tearDown;actor=base.Details.actor;raw=base.Details.raw
 preset=base.Details.preset;quote=base.Details.quote;place=base.Details.place;design=base.Details.design
 get=base.Details.get;operational=base.Details.operational
 def test_point_row_matches_existing_rls_all_actor_relationships(self):
  self.operational(102)
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET order_item_type=1,customer_dealer_id=NULL WHERE id=%s',(self.id,))
  for actor in [100,101,102,103,104,107,108,109,110,111,112,200,201,202,203,204,207,208,209,210,211,212]:
   self.actor(actor);self.c.execute('RESET ROLE');self.c.execute('SET LOCAL ROLE sa_executor')
   old=self.c.execute('SELECT id FROM sa_snapshot_20261019.sa_items WHERE id=%s',(self.item,)).fetchall()
   new=self.c.execute('SELECT id FROM sa_domain.work_item_row(%s)',(self.item,)).fetchall()
   self.assertEqual(new,old,actor)
   product=self.c.execute('SELECT id FROM sa_domain.work_item_product(%s)',(self.item,)).fetchall()
   self.assertEqual(product,[(int(self.product['id']),)] if old else [],actor)
 def test_missing_item_does_not_reveal_product(self):
  self.item=999999999;self.actor(100)
  with self.assertRaises(psycopg.errors.NoDataFound):self.get()
 def test_private_readers_have_no_client_execution(self):
  for role in ['sa_app','anon','authenticated','service_role']:
   for name in ['work_item_row','work_item_product']:
    self.c.execute('RESET ROLE')
    with self.assertRaises(psycopg.errors.InsufficientPrivilege):
     with self.c.transaction():
      self.c.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)))
      self.c.execute(sql.SQL('SELECT * FROM sa_domain.{}(%s)').format(sql.Identifier(name)),(self.item,))
 def test_disabled_catalogue_only_retains_assigned_product_media(self):
  self.operational(111);self.raw("UPDATE sa_snapshot_20261019.sa_users SET features='[]' WHERE id=111")
  self.c.execute('RESET ROLE');self.c.execute('SET LOCAL ROLE sa_guard')
  self.assertTrue(self.c.execute('SELECT sa_domain.work_product_visible(%s)',(int(self.product['id']),)).fetchone()[0])
  self.actor(211);self.c.execute('RESET ROLE');self.c.execute('SET LOCAL ROLE sa_guard')
  self.assertFalse(self.c.execute('SELECT sa_domain.work_product_visible(%s)',(int(self.product['id']),)).fetchone()[0])
 def test_dense_sparse_empty_sections_and_related_work_reads(self):
  self.operational(102);self.c.execute('RESET ROLE')
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET order_item_type=1,customer_dealer_id=NULL WHERE id=%s',(self.id,))
  # 45k orders, 90k items, 216k size rows, 1800 shared configurations:
  # close to staging cardinality, with only synthetic records and varied owners.
  for table,n,source,extra in [
   ('orders',45000,self.id,"'id',1000000+g,'assigned_to_id',204,'assigned_worker_id',211,'customer_id',203,'customer_sc_id',201"),
   ('products',1800,int(self.product['id']),"'id',1000000+g,'created_by_id',203"),
   ('items',90000,self.item,"'id',1000000+g,'order_id',1000001+((g-1)%%45000),'product_id',1000001+((g-1)%%1800),'cutting_master_id',209"),
   ('quantities',216000,self.c.execute('SELECT id FROM sa_snapshot_20261019.sa_quantities WHERE item_id=%s LIMIT 1',(self.item,)).fetchone()[0],"'id',1000000+g,'item_id',1000001+((g-1)%%90000)")]:
   self.c.execute(f'''INSERT INTO sa_snapshot_20261019.sa_{table} SELECT y.* FROM(SELECT * FROM sa_snapshot_20261019.sa_{table} WHERE id=%s)x CROSS JOIN generate_series(1,{n})g CROSS JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_{table},to_jsonb(x)||jsonb_build_object({extra}))y''',(source,))
   self.c.execute('ANALYZE sa_snapshot_20261019.sa_'+table)
  self.c.execute("SET LOCAL statement_timeout='4s'")
  timings={}
  def timed(name,fn):
   start=time.perf_counter();r=fn();timings[name]=round((time.perf_counter()-start)*1000,1);self.assertLess(timings[name],1500,name);return r
  for actor,label in [(102,'dense_pc'),(104,'sparse_fm'),(108,'sparse_inspector'),(109,'sparse_cutter'),(111,'sparse_worker')]:
   self.actor(actor);r=timed(label,lambda:self.get(limit=1));self.assertEqual(r['id'],str(self.item));self.assertEqual(len(r['records']['data']),1)
  self.actor(104)
  for section in ['quantities','bulk_plan','brandings','criteria','parts','addons','images','source_images','variants']:
   r=timed('section_'+section,lambda:self.get(section,limit=1));self.assertLessEqual(len(r['records']['data']),1)
  self.actor(109);timed('cutting_detail',lambda:rpc(self.c,'v1_cutting_detail',(self.item,None,None,25)))
  self.actor(107);timed('dispatch_detail',lambda:rpc(self.c,'v1_dispatch_detail',(self.item,None,None,25)))
  self.actor(102);timed('order_detail',lambda:rpc(self.c,'v1_order_get',(self.id,None,25)))
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=104,assigned_worker_id=111 WHERE id BETWEEN 1000001 AND 1045000')
  self.actor(104);timed('dense_factory_detail',lambda:self.get(limit=25));timed('dense_factory_parts',lambda:self.get('parts',limit=25))
  self.actor(111);timed('dense_worker_detail',lambda:self.get(limit=25))
  self.actor(204)
  start=time.perf_counter()
  with self.assertRaises(psycopg.errors.NoDataFound):
   with self.c.transaction():self.get()
  timings['foreign_factory_denied']=round((time.perf_counter()-start)*1000,1)
  self.assertLess(timings['foreign_factory_denied'],1500)
  print('point_detail_scale_ms',timings,flush=True)

if __name__=='__main__':unittest.main(verbosity=2)
