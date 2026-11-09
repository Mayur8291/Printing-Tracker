"""Current operational queues preserve source item/tailor status without paging event history."""
import time,unittest,psycopg
from psycopg import sql
from fixtures import rpc,session
import test_production_execution as base

class OperationalItems(unittest.TestCase):
 setUpClass=classmethod(base.Execution.setUpClass.__func__)
 setUp=base.Execution.setUp;tearDown=base.Execution.tearDown
 actor=base.Execution.actor;raw=base.Execution.raw;iv=base.Execution.iv
 cut=base.Execution.cut;assign=base.Execution.assign;inspect=base.Execution.inspect
 def queue(self,tailor=None,completed=False,item=None,order=None,cursor=None,limit=25):
  return rpc(self.c,'v1_operational_items',(tailor,completed,item,order,cursor,limit))
 def prepare(self):self.cut();self.assign();self.actor(108)
 def test_current_queue_is_unique_not_assignment_events(self):
  self.cut();self.assign(4);self.assign(6);self.actor(108)
  r=self.queue();self.assertEqual([v['id'] for v in r['data']],['1001']);self.assertEqual(r['data'][0]['assigned'],10)
  self.assertEqual(self.queue(item=2001)['data'],[]);self.assertEqual(self.queue(order=2001)['data'],[])
 def test_tailor_completion_independent_of_item_completion(self):
  self.cut();self.assign(4,105);self.assign(6,106)
  self.inspect(4);self.actor(104)
  self.assertEqual(self.queue(tailor=105)['data'],[])
  r=self.queue(tailor=105,completed=True);self.assertEqual(r['data'][0]['inspected'],4)
  self.assertEqual(r['status_basis'],'selected_tailor_assignment')
  self.assertEqual(self.queue(tailor=106)['data'][0]['assigned'],6)
  self.actor(108);self.assertEqual(self.queue()['data'][0]['completed'],False)
  qid=self.raw('SELECT tq.id FROM sa_snapshot_20261019.sa_item_tailor_quantities tq JOIN sa_snapshot_20261019.sa_item_tailors t ON t.id=tq.item_tailor_id WHERE t.item_id=1001 AND t.tailor_id=106')[0][0]
  self.inspect(rows=[{'item_tailor_quantity_id':str(qid),'quantity':6}]);self.assertEqual(self.queue()['data'],[]);self.assertEqual(self.queue(completed=True)['data'][0]['id'],'1001')
 def test_scopes_match_current_item_authority(self):
  self.prepare()
  for actor in [100,102,104,107,108,200,202,204,207,208]:
   self.actor(actor);self.c.execute('RESET ROLE');self.c.execute('SET LOCAL ROLE sa_executor')
   expected=self.c.execute('SELECT sa_domain.can_item(1001)').fetchone()[0]
   self.actor(actor);self.assertEqual(bool(self.queue()['data']),expected,actor)
  self.actor(108);self.assertEqual(self.queue(tailor=205)['data'],[])
  for actor in [101,103,105,106,109,110,111]:
   self.actor(actor)
   with self.assertRaises((psycopg.errors.InsufficientPrivilege,psycopg.errors.InvalidAuthorizationSpecification)):
    with self.c.transaction():self.queue()
 def test_bad_filters_and_helper_execution_denied(self):
  self.prepare()
  for kw in [{'tailor':0},{'item':-1},{'order':0}]:
   with self.assertRaises(psycopg.errors.InvalidParameterValue):
    with self.c.transaction():self.queue(**kw)
  for role in ['sa_app','anon','authenticated','service_role']:
   self.c.execute('RESET ROLE')
   with self.assertRaises(psycopg.errors.InsufficientPrivilege):
    with self.c.transaction():
     self.c.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)))
     self.c.execute('SELECT * FROM sa_domain.operational_item_rows(NULL,false,NULL,NULL,99999,31)')
 def clone(self,n=3):
  self.c.execute('RESET ROLE')
  self.c.execute('''INSERT INTO sa_snapshot_20261019.sa_items SELECT y.* FROM(SELECT * FROM sa_snapshot_20261019.sa_items WHERE id=1001)x CROSS JOIN generate_series(1,%s)g CROSS JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_items,to_jsonb(x)||jsonb_build_object('id',100000+g))y''',(n,))
  self.c.execute('''INSERT INTO sa_snapshot_20261019.sa_item_tailors SELECT y.* FROM(SELECT * FROM sa_snapshot_20261019.sa_item_tailors WHERE item_id=1001)x CROSS JOIN generate_series(1,%s)g CROSS JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_item_tailors,to_jsonb(x)||jsonb_build_object('id',100000+g,'item_id',100000+g))y''',(n,))
  session(self.c,self.n)
 def test_seek_cursor_bound_to_actor_generation_and_all_filters(self):
  self.prepare();self.clone();first=self.queue(limit=1);cursor=first['next_cursor'];self.assertTrue(cursor)
  self.assertNotEqual(self.queue(cursor=cursor,limit=1)['data'][0]['id'],first['data'][0]['id'])
  for kw in [{'tailor':105},{'completed':True},{'item':1001},{'order':1001}]:
   with self.assertRaises(psycopg.errors.InvalidParameterValue):
    with self.c.transaction():self.queue(cursor=cursor,**kw)
  self.actor(104)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):
   with self.c.transaction():self.queue(cursor=cursor)
  self.actor(108);self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1')
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.queue(cursor=cursor)
 def test_foreign_parent_and_duplicate_tailor_links_do_not_expand_scope(self):
  self.prepare();self.clone(2)
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET order_id=2001 WHERE id=100001')
  with self.assertRaises(psycopg.errors.ForeignKeyViolation):
   with self.c.transaction():self.raw('UPDATE sa_snapshot_20261019.sa_items SET order_id=999999 WHERE id=100002')
  self.actor(108);self.assertEqual([r['id'] for r in self.queue()['data']],['100002','1001'])
  self.raw("INSERT INTO sa_snapshot_20261019.sa_item_tailors SELECT y.* FROM(SELECT * FROM sa_snapshot_20261019.sa_item_tailors WHERE item_id=1001)x CROSS JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_item_tailors,to_jsonb(x)||jsonb_build_object('id',800001))y")
  self.actor(104);self.assertTrue(self.queue(tailor=105,item=1001)['data'][0]['needs_reconciliation'])
  self.assertEqual(len(self.queue(tailor=105,item=1001)['data']),1)
 def test_all_status_retains_pending_and_completed(self):
  self.prepare();self.clone(2)
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET completed_by_tailor_quantity_status=1 WHERE id=100001')
  self.assertEqual([r['id'] for r in self.queue(completed=None)['data']],['100002','100001','1001'])
  self.assertEqual([r['id'] for r in self.queue(completed=True)['data']],['100001'])
 def test_realistic_dense_sparse_and_empty_current_item_pages(self):
  self.prepare();self.clone(50000);self.c.execute('RESET ROLE')
  self.c.execute("""INSERT INTO sa_snapshot_20261019.sa_orders SELECT y.* FROM(SELECT * FROM sa_snapshot_20261019.sa_orders WHERE id=1001)x CROSS JOIN generate_series(1,25000)g CROSS JOIN LATERAL jsonb_populate_record(NULL::sa_snapshot_20261019.sa_orders,to_jsonb(x)||jsonb_build_object('id',200000+g))y""")
  self.c.execute('UPDATE sa_snapshot_20261019.sa_items SET order_id=200001+((id-100001)%25000) WHERE id BETWEEN 100001 AND 150000')
  self.c.execute('ANALYZE sa_snapshot_20261019.sa_orders')
  self.c.execute('ANALYZE sa_snapshot_20261019.sa_items');self.c.execute('ANALYZE sa_snapshot_20261019.sa_item_tailors')
  self.c.execute("SET LOCAL statement_timeout='4s'");session(self.c,self.n);timings={}
  for label,actor,kwargs in [('dense_inspector',108,{}),('dense_tailor',104,{'tailor':105}),('sparse_id',108,{'item':1001}),('foreign_empty',208,{})]:
   self.actor(actor);start=time.perf_counter();r=self.queue(**kwargs);timings[label]=round((time.perf_counter()-start)*1000,1)
   self.assertLess(timings[label],1500,label);self.assertLessEqual(len(r['data']),25)
  self.actor(108);self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=204 WHERE id BETWEEN 200001 AND 225000')
  start=time.perf_counter();self.assertEqual([r['id'] for r in self.queue()['data']],['1001']);timings['sparse_factory']=round((time.perf_counter()-start)*1000,1)
  self.assertLess(timings['sparse_factory'],1500)
  print('operational_items_ms',timings,flush=True)

if __name__=='__main__':unittest.main(verbosity=2)
