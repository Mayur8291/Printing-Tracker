"""Assignment filters exercise actual actor/RLS and cursor contracts on local fixtures."""
import unittest
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed_orders,session,rpc

class AssignmentFilters(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN')
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_worker_id=NULL WHERE id=1001')
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=NULL WHERE id=1002')
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=NULL,assigned_worker_id=NULL WHERE id=1003')
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def ids(self,kind):return {r['id'] for r in rpc(self.c,'v1_orders_list',(Jsonb({'assignment_kind':kind}),None,100))['data']}
 def test_partition_and_legacy_ambiguity(self):
  session(self.c,100)
  factory=self.ids('factory');worker=self.ids('job_worker');ambiguous=self.ids('ambiguous');free=self.ids('unassigned')
  self.assertIn('1001',factory);self.assertNotIn('1001',worker)
  self.assertIn('1002',worker);self.assertNotIn('1002',factory)
  self.assertIn('1003',free);self.assertNotIn('1003',factory|worker)
  self.assertIn('1004',ambiguous);self.assertTrue(ambiguous<=factory & worker)
 def test_worker_cannot_broaden_scope(self):
  session(self.c,111)
  self.assertNotIn('2001',self.ids('job_worker'));self.assertIn('1002',self.ids('job_worker'))
 def test_customer_filter_does_not_bypass_relationship(self):
  session(self.c,103)
  self.assertTrue(all(int(i)<2000 for i in self.ids('factory')))
 def test_filter_is_cursor_bound(self):
  session(self.c,100)
  page=rpc(self.c,'v1_orders_list',(Jsonb({'assignment_kind':'factory'}),None,1))
  self.assertIsNotNone(page['next_cursor'])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):
   rpc(self.c,'v1_orders_list',(Jsonb({'assignment_kind':'job_worker'}),page['next_cursor'],1))
 def test_invalid_value_rejected(self):
  session(self.c,100)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.ids('everything')

if __name__=='__main__':unittest.main(verbosity=2)
