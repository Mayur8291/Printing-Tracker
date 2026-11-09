"""Real RLS and keyset tests for the retained Flutter task search controls."""
import unittest,uuid,datetime
import psycopg
from fixtures import seed_orders,session,rpc
from local_db import connect

class WorkSearch(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
  self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET name='Searchable coordinator' WHERE id=102")
  self.actor(101)
  self.first=self.create('Amber stitching request',102,1001)
  self.second=self.create('Needle replacement',None)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.c.execute('RESET ROLE');session(self.c,n)
 def create(self,note,assignee,order=None):
  return rpc(self.c,'v1_task_save',(None,note,datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=2),order,[assignee] if assignee else [],None,uuid.uuid4()))['id']
 def search(self,q=None,assignment='all',cursor=None,limit=20):
  return rpc(self.c,'v1_tasks_list',(None,None,cursor,limit,q,assignment))
 def ids(self,result):return [r['id'] for r in result['data']]
 def test_text_order_member_and_literal_wildcard_search(self):
  for query in ['AMBER','1001','searchable coordinator']:
   self.assertEqual(self.ids(self.search(query)),[self.first])
  self.assertEqual(self.ids(self.search('%')),[])
 def test_assignment_filters_remain_scoped(self):
  self.assertEqual(set(self.ids(self.search(assignment='by_me'))),{self.first,self.second})
  self.assertEqual(self.ids(self.search(assignment='to_me')),[])
  self.actor(102);self.assertEqual(self.ids(self.search(assignment='to_me')),[self.first]);self.assertEqual(self.ids(self.search(assignment='by_me')),[])
  self.actor(201);self.assertEqual(self.ids(self.search('coordinator')),[])
 def test_labels_include_former_disabled_assignee_without_new_authority(self):
  self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=102');self.actor(101)
  result=self.search('coordinator')['data'][0]
  self.assertEqual(result['assignees'],[{'id':'102','name':'Searchable coordinator'}])
  self.assertNotIn('102',self.ids(rpc(self.c,'v1_task_assignees',(None,30,'coordinator',None))))
 def test_query_and_assignment_are_bound_into_cursor(self):
  first=self.search(limit=1);self.assertIsNotNone(first['next_cursor'])
  second=self.search(cursor=first['next_cursor'],limit=1)
  self.assertEqual(set(self.ids(first)+self.ids(second)),{self.first,self.second})
  for query,assignment in [('different','all'),(None,'to_me')]:
   with self.subTest(query=query,assignment=assignment),self.assertRaises(psycopg.Error),self.c.transaction():
    self.search(query,assignment,first['next_cursor'])
 def test_assignee_search_role_and_cursor_scope(self):
  result=rpc(self.c,'v1_task_assignees',(None,30,'coordinator',2))
  self.assertEqual(self.ids(result),['102'])
  self.assertEqual(self.ids(rpc(self.c,'v1_task_assignees',(None,30,'coordinator',4))),[])
 def test_invalid_filters_and_private_member_lookup_denied(self):
  for query,assignment in [('x'*201,'all'),(None,'arbitrary')]:
   with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():
    self.search(query,assignment)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():
   self.c.execute('SELECT * FROM sa_domain.task_members(%s)',([int(self.first)],))
 def test_old_contract_calls_and_timezone_remain_valid(self):
  self.assertEqual(len(rpc(self.c,'v1_tasks_list')['data']),2)
  task=rpc(self.c,'v1_task_get',(int(self.first),));self.assertTrue(task['deadline'].endswith('+00:00'))
  self.assertEqual(task['assignee_ids'],['102'])
 def test_revoked_notes_capability_refuses_search(self):
  self.actor(111)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.search('Amber')

if __name__=='__main__':unittest.main(verbosity=2)
