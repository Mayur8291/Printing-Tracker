"""Selected worker predicates narrow original actor-visible order scope."""
import unittest
import psycopg
from psycopg.types.json import Jsonb
from fixtures import seed_orders,session,rpc
from local_db import connect
class WorkerOrderContext(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_worker_id=NULL WHERE id BETWEEN 1001 AND 1006');self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_worker_id=111,assigned_to_id=NULL WHERE id IN(1001,1003)');session(self.c,111)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.c.execute('RESET ROLE');session(self.c,n)
 def page(self,filters,cursor=None,limit=1):return rpc(self.c,'v1_orders_list',(Jsonb(filters),cursor,limit))
 def test_worker_context_exact_and_paged(self):
  first=self.page({'worker_id':'111'});second=self.page({'worker_id':'111'},first['next_cursor'])
  self.assertEqual([first['data'][0]['id'],second['data'][0]['id']],['1003','1001']);self.assertIsNone(second['next_cursor'])
 def test_foreign_worker_does_not_gain_other_workers_scope(self):
  self.assertEqual(self.page({'worker_id':'211'})['data'],[])
  self.actor(211);self.assertEqual(self.page({'worker_id':'111'})['data'],[])
  self.actor(201);self.assertEqual(self.page({'worker_id':'111'})['data'],[])
 def test_admin_context_and_customer_intersection(self):
  self.actor(100);self.assertEqual(self.page({'worker_id':'111'})['data'][0]['id'],'1003')
  self.actor(103);self.assertEqual(self.page({'worker_id':'111','customer_id':'103'})['data'][0]['id'],'1003')
  self.assertEqual(self.page({'worker_id':'111','customer_id':'203'})['data'],[])
 def test_other_assignment_filters_still_intersect(self):
  self.assertEqual(self.page({'worker_id':'111','manager_id':'104'})['data'],[])
  self.assertEqual(self.page({'worker_id':'111','coordinator_id':'201'})['data'],[])
 def test_cursor_cannot_switch_worker_or_drop_context(self):
  cursor=self.page({'worker_id':'111'})['next_cursor']
  for filters in [{'worker_id':'211'},{}]:
   with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.page(filters,cursor)
 def test_invalid_worker_ids_are_rejected(self):
  for value in [None,0,-1,'x',[],{},'9223372036854775808']:
   with self.subTest(value=value),self.assertRaises(psycopg.Error),self.c.transaction():self.page({'worker_id':value})
if __name__=='__main__':unittest.main()
