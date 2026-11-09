"""Multi-target atomicity and server-side achievement filtering."""
import datetime,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed_orders,session,rpc

class TargetControls(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');session(self.c,100)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.c.execute('RESET ROLE');session(self.c,n)
 def rows(self):return [{'name':'November','start':'2026-11-01','end':'2026-11-30','amount':'500'},{'name':'December','start':'2026-12-01','end':'2026-12-31','amount':'500'}]
 def create(self,rows=None,key=None,subject=101):return rpc(self.c,'v1_milestones_create',(subject,Jsonb(self.rows() if rows is None else rows),key or uuid.uuid4()))
 def page(self,state='all',cursor=None,limit=25,subject=101):return rpc(self.c,'v1_milestones_list',(subject,cursor,limit,state))
 def test_two_targets_use_same_commands_and_idempotent_parent(self):
  key=uuid.uuid4();a=self.create(key=key);self.assertEqual(a['created'],2);self.assertEqual(self.create(key=key),a)
  self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_milestones').fetchone(),(2,));self.assertEqual(self.c.execute("SELECT count(*) FROM sa_domain.audit WHERE operation='milestone.saved'").fetchone(),(2,))
 def test_invalid_second_target_rolls_back_first_and_parent(self):
  bad=self.rows();bad[1]['amount']='-1'
  with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.create(bad)
  self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_milestones').fetchone(),(0,));self.assertEqual(self.c.execute("SELECT count(*) FROM sa_domain.commands WHERE operation IN('milestones.created','milestone.saved')").fetchone(),(0,))
 def test_overlap_within_batch_rolls_back(self):
  rows=self.rows();rows[1]['start']='2026-11-30'
  with self.assertRaises(psycopg.errors.ExclusionViolation),self.c.transaction():self.create(rows)
  self.assertEqual(self.page()['data'],[])
 def test_replay_with_changed_batch_is_rejected(self):
  key=uuid.uuid4();self.create(key=key)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.create(self.rows()[:1],key)
 def test_invalid_shapes_and_bounds_rejected(self):
  for rows in [[],{},[{}],self.rows()*13,[dict(self.rows()[0],name=' ')],[dict(self.rows()[0],hidden=True)]]:
   with self.subTest(rows=rows),self.assertRaises(psycopg.Error),self.c.transaction():self.create(rows)
 def test_coordinator_cannot_create_and_cannot_read_foreign(self):
  self.create();self.actor(101)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.create()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.page(subject=201)
  self.assertEqual(len(self.page()['data']),2)
 def test_achievement_matches_live_order_totals_not_calendar_expiry(self):
  self.create();self.assertEqual([r['name'] for r in self.page('achieved')['data']],['November']);self.assertEqual([r['name'] for r in self.page('pending')['data']],['December'])
 def test_current_uses_kolkata_calendar(self):
  today=self.c.execute("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date").fetchone()[0]
  self.create([{'name':'Current','start':str(today),'end':str(today),'amount':'500'},{'name':'Tomorrow','start':str(today+datetime.timedelta(days=1)),'end':str(today+datetime.timedelta(days=1)),'amount':'500'}])
  self.assertEqual([r['name'] for r in self.page('current')['data']],['Current'])
 def test_state_cursor_is_bound_and_pages_do_not_repeat(self):
  self.create();first=self.page(limit=1);second=self.page(cursor=first['next_cursor'],limit=1);self.assertNotEqual(first['data'][0]['id'],second['data'][0]['id']);self.assertIsNone(second['next_cursor'])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.page('pending',first['next_cursor'],1)
 def test_invalid_state_fails(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.page('past')

if __name__=='__main__':unittest.main()
