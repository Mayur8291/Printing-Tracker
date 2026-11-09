"""Real actor/RLS jobsheet keyset regression, including 100k unrelated rows.
Run only against the isolated SQUAD_TEST_DATABASE synthetic localhost cluster.
"""
import time, unittest
import psycopg
from psycopg import sql
from fixtures import rpc, session
from test_production_execution import Execution

class JobsheetQueue(unittest.TestCase):
 setUpClass=classmethod(Execution.setUpClass.__func__)
 tearDown=Execution.tearDown;actor=Execution.actor;raw=Execution.raw
 def setUp(self):
  Execution.setUp(self);Execution.cut(self);Execution.assign(self,5,105);Execution.assign(self,5,106);self.actor(108)
 iv=Execution.iv
 def queue(self,item=None,tailor=None,cursor=None,limit=25):return rpc(self.c,'v1_jobsheets_list',(item,tailor,cursor,limit))
 def test_factory_roles_and_pc_keep_response_shape(self):
  for actor in [102,104,107,108]:
   self.actor(actor);r=self.queue();self.assertEqual(len(r['data']),2);self.assertIsNone(r['next_cursor']);self.assertEqual({x['tailor_id'] for x in r['data']},{'105','106'})
   self.assertEqual(set(r['data'][0]),{'id','item_id','quantity_id','item_tailor_id','tailor_id','assignment_id','assigned','inspected','picked','occurred_at'})
 def test_foreign_factory_item_and_tailor_filters(self):
  self.assertEqual(self.queue(item=2001)['data'],[]);self.assertEqual(self.queue(tailor=205)['data'],[])
  self.assertEqual(len(self.queue(item=1001,tailor=105)['data']),1)
  self.actor(208);self.assertEqual(self.queue()['data'],[])
 def test_customer_and_admin_roles_remain_denied(self):
  for actor in [100,103,110]:
   self.actor(actor)
   with self.assertRaises(psycopg.errors.InsufficientPrivilege):
    with self.c.transaction():self.queue()
 def test_keyset_no_duplicates_and_filter_bound(self):
  first=self.queue(limit=1);second=self.queue(cursor=first['next_cursor'],limit=1)
  self.assertEqual(len(second['data']),1);self.assertNotEqual(first['data'][0]['id'],second['data'][0]['id']);self.assertIsNone(second['next_cursor'])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.queue(tailor=105,cursor=first['next_cursor'],limit=1)
 def test_cursor_actor_bound(self):
  page=self.queue(limit=1);self.actor(208)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.queue(cursor=page['next_cursor'],limit=1)
 def test_malformed_tailor_parent_hidden_before_limit(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_item_tailors SET item_id=2001 WHERE tailor_id=106 AND item_id=1001')
  r=self.queue(limit=1);self.assertEqual([x['tailor_id'] for x in r['data']],['105']);self.assertIsNone(r['next_cursor'])
 def test_malformed_assignment_date_parent_hidden_before_limit(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_job_sheet_assign_dates SET item_id=2001 WHERE id IN(SELECT job_sheet_assign_date_id FROM sa_snapshot_20261019.sa_job_sheet_assign_quantities q JOIN sa_snapshot_20261019.sa_item_tailors t ON t.id=q.item_tailor_id WHERE t.tailor_id=106)')
  r=self.queue(limit=1);self.assertEqual([x['tailor_id'] for x in r['data']],['105']);self.assertIsNone(r['next_cursor'])
 def test_private_helper_denies_all_client_roles(self):
  for role in ['sa_app','anon','authenticated','service_role']:
   self.c.execute('RESET ROLE')
   with self.assertRaises(psycopg.errors.InsufficientPrivilege):
    with self.c.transaction():
     self.c.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)))
     self.c.execute('SELECT * FROM sa_domain.jobsheet_page_ids(NULL,NULL,9223372036854775807,25)')
 def test_dense_empty_sparse_scale_and_filtered_pagination(self):
  self.c.execute('RESET ROLE')
  for table,updates in [
   ('items',"jsonb_build_object('id',1000000+g,'order_id',1001)"),
   ('item_tailors',"jsonb_build_object('id',1000000+g,'item_id',1000000+g,'tailor_id',105)"),
   ('job_sheet_assign_dates',"jsonb_build_object('id',1000000+g,'item_id',1000000+g)"),
   ('job_sheet_assign_tailors',"jsonb_build_object('id',1000000+g,'item_tailor_id',1000000+g,'job_sheet_assign_date_id',1000000+g)")]:
   self.c.execute(f'''INSERT INTO sa_snapshot_20261019.sa_{table} SELECT (jsonb_populate_record(NULL::sa_snapshot_20261019.sa_{table},to_jsonb(t)||{updates})).* FROM (SELECT * FROM sa_snapshot_20261019.sa_{table} LIMIT 1)t CROSS JOIN generate_series(1,1000) g''')
  self.c.execute('''INSERT INTO sa_snapshot_20261019.sa_job_sheet_assign_quantities SELECT (jsonb_populate_record(NULL::sa_snapshot_20261019.sa_job_sheet_assign_quantities,to_jsonb(t)||jsonb_build_object('id',1000000+(g-1)*100+h,'item_id',1000000+g,'item_tailor_id',1000000+g,'job_sheet_assign_date_id',1000000+g,'job_sheet_assign_tailor_id',1000000+g))).* FROM (SELECT * FROM sa_snapshot_20261019.sa_job_sheet_assign_quantities LIMIT 1)t CROSS JOIN generate_series(1,1000)g CROSS JOIN generate_series(1,100)h''')
  for table in ['items','item_tailors','job_sheet_assign_dates','job_sheet_assign_quantities']:self.c.execute('ANALYZE sa_snapshot_20261019.sa_'+table)
  self.c.execute("SET LOCAL statement_timeout='4s'")
  timings={}
  def timed(name,fn):
   t=time.perf_counter();r=fn();timings[name]=round((time.perf_counter()-t)*1000,1);self.assertLess(timings[name],2000,name);return r
  self.actor(108);first=timed('dense_factory_first',self.queue);self.assertEqual(len(first['data']),25);self.assertTrue(first['next_cursor'])
  second=timed('dense_factory_next',lambda:self.queue(cursor=first['next_cursor']));self.assertFalse({x['id'] for x in first['data']} & {x['id'] for x in second['data']})
  filtered=timed('filtered_single_item',lambda:self.queue(item=1000001,tailor=105));self.assertEqual(len(filtered['data']),25);self.assertEqual({x['item_id'] for x in filtered['data']},{'1000001'})
  self.actor(208);self.assertEqual(timed('empty_factory',self.queue)['data'],[])
  # Original own records are older than 100k foreign rows. Transfer only their
  # parent order into the empty factory, retaining valid source relationships.
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=204 WHERE id=1001')
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET order_id=1003 WHERE id BETWEEN 1000001 AND 1001000')
  sparse=timed('sparse_factory_old_history',self.queue);self.assertEqual(len(sparse['data']),2);self.assertIsNone(sparse['next_cursor'])
  self.actor(102);self.assertEqual(len(timed('pc_broad_queue',self.queue)['data']),25)
  print('queue_scale_ms',timings,flush=True)

if __name__=='__main__':unittest.main(verbosity=2)
