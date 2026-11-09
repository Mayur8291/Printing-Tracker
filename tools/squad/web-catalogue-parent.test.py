"""Bounded source main-category selector preserves existing brand RLS."""
import unittest,psycopg,time
from fixtures import rpc,session
import test_catalogue as base
class Parents(unittest.TestCase):
 setUpClass=classmethod(base.Catalogue.setUpClass.__func__)
 setUp=base.Catalogue.setUp;tearDown=base.Catalogue.tearDown;actor=base.Catalogue.actor;raw=base.Catalogue.raw
 def options(self,cursor=None,limit=25,customer=None,kind='main_categories'):return rpc(self.c,'v1_catalog_options',(customer,kind,cursor,limit))
 def seed(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_rmp_brands SET main_category=CASE id WHEN 1 THEN 'Apparel' ELSE 'Foreign only' END")
  self.raw("INSERT INTO sa_snapshot_20261019.sa_rmp_brands(id,name,authorized_brand_id,main_category,is_deleted,created_at,updated_at) VALUES(10,'same',1,'Apparel',false,now(),now()),(11,'second',1,'Uniforms',false,now(),now()),(12,'deleted',1,'Deleted',true,now(),now()),(13,'empty',1,'',false,now(),now())")
 def test_distinct_authorized_source_values_and_deleted_omitted(self):
  self.seed();self.actor(110);r=self.options();self.assertEqual([x['name'] for x in r['data']],['Apparel','Uniforms'])
  self.assertIsNone(r['next_cursor'])
 def test_string_seek_and_actor_kind_generation_binding(self):
  self.seed();self.actor(110);first=self.options(limit=1);self.assertEqual(first['data'][0]['name'],'Apparel');cur=first['next_cursor'];self.assertEqual(self.options(cursor=cur,limit=1)['data'][0]['name'],'Uniforms')
  with self.assertRaises(psycopg.errors.InvalidParameterValue):
   with self.c.transaction():self.options(cursor=cur,kind='brands')
  self.actor(103)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):
   with self.c.transaction():self.options(cursor=cur)
  self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1');self.actor(110)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.options(cursor=cur)
 def test_empty_and_unauthorized_persona(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_rmp_brands SET main_category=NULL');self.assertEqual(self.options()['data'],[])
  self.actor(111)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.options()
 def test_large_distinct_dataset_bounded_page(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_rmp_brands(id,name,authorized_brand_id,main_category,created_at,updated_at) SELECT 20000+g,'Brand',1,'Category '||lpad(g::text,6,'0'),now(),now() FROM generate_series(1,10000)g")
  self.actor(110);start=time.perf_counter();r=self.options();ms=(time.perf_counter()-start)*1000;self.assertEqual(len(r['data']),25);self.assertTrue(r['next_cursor']);self.assertLess(ms,1000);print('main_categories_10k_ms',round(ms,2),flush=True)
if __name__=='__main__':unittest.main(verbosity=2)
