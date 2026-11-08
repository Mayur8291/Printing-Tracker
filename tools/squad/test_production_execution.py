from sqlstate_assertions import assert_app_conflict, is_app_conflict
import concurrent.futures,datetime,threading,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from fixtures import seed_orders,session,rpc
from local_db import connect

class Execution(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_worker_id=NULL WHERE id=1001')
  self.q=self.c.execute('SELECT id FROM sa_snapshot_20261019.sa_quantities WHERE item_id=1001').fetchone()[0]
  self.n=109;session(self.c,self.n)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.n=n;self.c.execute('RESET ROLE');session(self.c,n)
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);result=r.fetchall() if r.description else None;session(self.c,self.n);return result
 def iv(self,id=1001):return self.raw("SELECT sa_domain.version('item',%s)",(id,))[0][0]
 def cut(self,n=10,key=None,version=None,at=None,rows=None):return rpc(self.c,'v1_cutting_record',(1001,Jsonb(rows or [{'quantity_id':str(self.q),'quantity':n}]),at,version or self.iv(),key or uuid.uuid4()))
 def assign(self,n=10,tailor=105,key=None,version=None,rows=None):
  self.actor(104);return rpc(self.c,'v1_jobsheet_assign',(1001,Jsonb(rows or [{'quantity_id':str(self.q),'tailor_id':str(tailor),'quantity':n}]),'2026-12-10T00:00:00Z','2026-12-09T00:00:00Z',version or self.iv(),key or uuid.uuid4()))
 def inspect(self,n=10,key=None,version=None,rows=None):
  self.actor(108)
  if rows is None:
   itq=self.raw('SELECT tq.id FROM sa_snapshot_20261019.sa_item_tailor_quantities tq JOIN sa_snapshot_20261019.sa_item_tailors it ON it.id=tq.item_tailor_id WHERE it.item_id=1001 ORDER BY tq.id')[0][0]
   rows=[{'item_tailor_quantity_id':str(itq),'quantity':n}]
  return rpc(self.c,'v1_jobsheet_inspect',(1001,Jsonb(rows),None,version or self.iv(),key or uuid.uuid4()))
 def dispatch(self,n=10,key=None,version=None):
  self.actor(107);return rpc(self.c,'v1_dispatch_record',(1001,Jsonb([{'quantity_id':str(self.q),'quantity':n}]),None,version or self.iv(),key or uuid.uuid4()))
 def prepare(self):self.cut();self.assign();self.inspect()
 def test_partial_to_complete_journey_preserves_all_histories(self):
  self.cut(4);self.cut(6);self.assign(6);self.assign(4);self.inspect(3);self.inspect(7);r=self.dispatch(2);self.assertFalse(r['progress']['order_completed']);r=self.dispatch(8);self.assertTrue(r['progress']['order_completed'])
  self.assertEqual(r['progress'],{'required':10,'cut':10,'assigned':10,'sewn':10,'dispatched':10,'order_completed':True})
  for t in ['mark_cuttings','job_sheet_assign_dates','job_sheet_tailor_mark_dates','job_sheet_dispatched_dates']:
   self.assertEqual(self.raw(f'SELECT count(*) FROM sa_snapshot_20261019.sa_{t} WHERE item_id=1001'),[(2,)])
 def test_cut_retry_returns_exact_record_once(self):
  v=self.iv();key=uuid.uuid4();r=self.cut(3,key,v);self.assertEqual(r,self.cut(3,key,v));self.assertEqual(self.raw('SELECT cutting_done FROM sa_snapshot_20261019.sa_quantities WHERE id=%s',(self.q,)),[(3,)])
 def test_stale_version_rejects_second_cut(self):
  v=self.iv();self.cut(3)
  with assert_app_conflict(self):self.cut(3,version=v)
 def test_cut_negative_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.cut(-1)
 def test_cut_zero_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.cut(0)
 def test_cut_fraction_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.cut(1.5)
 def test_cut_over_remaining_denied(self):
  self.cut(6)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.cut(5)
 def test_future_work_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.cut(1,at='2026-12-01T00:00:00Z')
 def test_foreign_quantity_denied(self):
  foreign=self.raw('SELECT id FROM sa_snapshot_20261019.sa_quantities WHERE item_id=2001')[0][0]
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.cut(rows=[{'quantity_id':str(foreign),'quantity':1}])
 def test_duplicate_size_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.cut(rows=[{'quantity_id':str(self.q),'quantity':1}]*2)
 def test_cut_manager_cannot_impersonate_cutter(self):
  self.actor(104)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.cut(1)
 def test_cut_cutter_moved_factory_loses_write_authority(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET factory_manager_id=204 WHERE id=109')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.cut(1)
 def test_sample_uses_actual_quantity_not_bulk_plan(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET sample_order=true,total_quantity=1000 WHERE id=1001')
  self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET quantity=2 WHERE id=%s',(self.q,));r=self.cut(2)
  self.assertEqual(r['progress']['required'],2);self.assertEqual(self.raw('SELECT sample_cutting_done,sample_cutting_status,cutting_status,total_quantity FROM sa_snapshot_20261019.sa_items WHERE id=1001'),[(2,1,1,1000)])
  self.assign(2);self.inspect(2);self.assertTrue(self.dispatch(2)['progress']['order_completed'])
 def test_assign_requires_cut_capacity(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.assign(1)
 def test_assign_foreign_factory_denied(self):
  self.cut()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.assign(1,205)
 def test_assign_subtailor_same_factory_supported(self):
  self.cut();self.assign(10,106);self.inspect();self.assertTrue(self.dispatch()['progress']['order_completed'])
 def test_assign_multiple_tailors_same_size_cannot_overallocate(self):
  self.cut()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.assign(rows=[{'quantity_id':str(self.q),'tailor_id':str(t),'quantity':6} for t in [105,106]])
 def test_assign_exact_retry(self):
  self.cut();v=self.iv();key=uuid.uuid4();r=self.assign(4,key=key,version=v);self.assertEqual(r,self.assign(4,key=key,version=v))
 def test_assignment_history_stays_original_after_inspection(self):
  self.cut();self.assign(4);self.assign(6);self.inspect(7)
  self.assertEqual(self.raw('SELECT assigned_quantity,completed_quantity FROM sa_snapshot_20261019.sa_job_sheet_assign_quantities WHERE item_id=1001 ORDER BY id'),[(4,4),(6,3)])
 def test_inspect_over_assignment_denied(self):
  self.cut();self.assign(4)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.inspect(5)
 def test_inspect_exact_retry(self):
  self.cut();self.assign();v=self.iv();key=uuid.uuid4();r=self.inspect(4,key,v);self.assertEqual(r,self.inspect(4,key,v))
 def test_inspection_missing_history_fails_without_fabricating_assignments(self):
  self.cut();self.assign();self.raw('DELETE FROM sa_snapshot_20261019.sa_job_sheet_assign_quantities WHERE item_id=1001')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.inspect(1)
 def test_inspection_wrong_factory_denied(self):
  self.cut();self.assign();self.actor(208)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_jobsheet_inspect',(1001,Jsonb([{'item_tailor_quantity_id':'1','quantity':1}]),None,self.iv(),uuid.uuid4()))
 def test_dispatch_requires_inspection(self):
  self.cut();self.assign()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.dispatch(1)
 def test_dispatch_over_inspected_denied(self):
  self.cut();self.assign();self.inspect(4)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.dispatch(5)
 def test_dispatch_exact_retry_after_order_completed(self):
  self.prepare();v=self.iv();key=uuid.uuid4();r=self.dispatch(10,key,v);self.assertEqual(r,self.dispatch(10,key,v));self.assertTrue(r['progress']['order_completed'])
 def test_cancelled_order_cannot_cut(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_status='CANCELLED' WHERE id=1001")
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.cut(1)
 def test_job_worker_order_cannot_receive_factory_work(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_worker_id=111 WHERE id=1001')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.cut(1)
 def test_work_read_has_no_commercial_fields(self):
  self.cut(1);r=rpc(self.c,'v1_cutting_detail',(1001,));self.assertNotIn('per_piece_amount',r);self.assertNotIn('worker_per_piece_amount',r);self.assertEqual(r['quantities']['data'][0]['remaining'],9)
 def test_history_pagination_does_not_duplicate(self):
  self.cut(1);self.cut(1);self.cut(1);r=rpc(self.c,'v1_cutting_detail',(1001,None,None,2));next_=rpc(self.c,'v1_cutting_detail',(1001,None,r['history']['next_cursor'],2))
  self.assertEqual(len(r['history']['data']),2);self.assertEqual(len(next_['history']['data']),1);self.assertFalse(set(x['id'] for x in r['history']['data'])&set(x['id'] for x in next_['history']['data']))
 def test_cursor_bound_to_kind_and_item(self):
  self.cut(1);self.cut(1);r=rpc(self.c,'v1_cutting_detail',(1001,None,None,1));self.actor(104)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_dispatch_detail',(1001,None,r['history']['next_cursor'],1))
 def test_dispatch_queue_only_available_inspected_work(self):
  self.actor(107);self.assertEqual(rpc(self.c,'v1_dispatch_queue',(False,1001))['data'],[]);self.actor(109);self.cut();self.assign();self.inspect(2);self.actor(107)
  self.assertEqual(rpc(self.c,'v1_dispatch_queue',(False,1001))['data'][0]['id'],'1001')
 def test_tailor_work_history_uses_one_completed_picked_measure(self):
  self.cut();self.assign();self.inspect(4);r=rpc(self.c,'v1_tailor_work',(1001,105,True));self.assertEqual(r['data'][0]['inspected'],4);self.assertEqual(r['data'][0]['picked'],4)
  balances=rpc(self.c,'v1_tailor_work',(1001,105));self.assertEqual(balances['data'][0]['assigned'],10);self.assertEqual(balances['data'][0]['inspected'],4)
 def test_jobsheets_scope_and_flat_paging(self):
  self.cut();self.assign(4);self.assign(6);r=rpc(self.c,'v1_jobsheets_list',(1001,105,None,1));self.assertIsNotNone(r['next_cursor']);self.assertEqual(len(r['data']),1)
  self.actor(204);self.assertEqual(rpc(self.c,'v1_jobsheets_list',(1001,))['data'],[])
 def test_clients_cannot_read_or_edit_history_directly(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT * FROM sa_snapshot_20261019.sa_mark_cuttings')
 def test_history_executor_cannot_rewrite_cut_rows(self):
  self.cut(1);self.c.execute('SET LOCAL ROLE sa_executor')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('UPDATE sa_snapshot_20261019.sa_mark_cutting_quantities SET cutting_done=9')
 def test_assignment_coverage_is_distinct_from_sewing_completion(self):
  self.cut();self.assign();self.actor(104);r=rpc(self.c,'v1_production_progress',(1001,))
  self.assertTrue(r['assigned_complete']);self.assertFalse(r['job_complete']);self.assertFalse(r['sewn_complete'])
  self.assertEqual(self.raw('SELECT tailor_job_status FROM sa_snapshot_20261019.sa_orders WHERE id=1001'),[(0,)])
  self.inspect();self.actor(104);r=rpc(self.c,'v1_production_progress',(1001,));self.assertTrue(r['job_complete']);self.assertTrue(r['sewn_complete'])
 def test_completion_requires_full_order_quantity_not_partial_assignment(self):
  self.cut();self.assign(4);self.inspect(4)
  self.assertEqual(self.raw('SELECT completed_by_tailor_quantity_status,tailor_job_status FROM sa_snapshot_20261019.sa_items WHERE id=1001'),[(0,0)])
 def test_payload_unknown_keys_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.cut(rows=[{'quantity_id':str(self.q),'quantity':1,'qty':999}])

 def test_stale_imported_cut_balance_requires_reconciliation(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET cutting_done=2 WHERE id=%s',(self.q,))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.cut(1)
 def test_rejected_second_size_rolls_back_first_size_and_history(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):
   with self.c.transaction():self.cut(rows=[{'quantity_id':str(self.q),'quantity':1},{'quantity_id':'999999999','quantity':1}])
  self.assertEqual(self.raw('SELECT cutting_done FROM sa_snapshot_20261019.sa_quantities WHERE id=%s',(self.q,)),[(0,)])
  self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_mark_cuttings WHERE item_id=1001'),[(0,)])
 def test_quantity_request_bound_is_enforced(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.cut(rows=[{'quantity_id':str(n),'quantity':1} for n in range(1,102)])
 def test_private_scope_helpers_are_not_client_endpoints(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT sa_domain.work_scope_ids('quantity')")

class ConcurrentWork(unittest.TestCase):
 def test_competing_cut_commands_cannot_double_record(self):
  barrier=threading.Barrier(2);keys=[uuid.uuid4(),uuid.uuid4()];item=9000001
  with connect() as c,c.transaction():
   seed_orders(c);original=c.execute('SELECT edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
   c.execute("INSERT INTO sa_snapshot_20261019.sa_orders(id,customer_id,address_id,assigned_to_id,customer_sc_id,order_item_type,status,created_at,updated_at) VALUES(%s,103,100,104,101,1,0,now(),now())",(item,))
   c.execute('INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,cutting_master_id,total_quantity,created_at,updated_at) VALUES(%s,%s,109,10,now(),now())',(item,item))
   q=c.execute('INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,created_at,updated_at) VALUES(%s,1,10,now(),now()) RETURNING id',(item,)).fetchone()[0]
   v=c.execute("SELECT sa_domain.version('item',%s)",(item,)).fetchone()[0]
  def cut(key):
   try:
    with connect() as c,c.transaction():
     session(c,109);barrier.wait(timeout=3)
     return rpc(c,'v1_cutting_record',(item,Jsonb([{'quantity_id':str(q),'quantity':6}]),None,v,key))
   except psycopg.DatabaseError as error:
    if not is_app_conflict(error):raise
    return 'conflict'
  try:
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(cut,keys))
   self.assertEqual(results.count('conflict'),1)
   with connect() as c:
    self.assertEqual(c.execute('SELECT cutting_done FROM sa_snapshot_20261019.sa_quantities WHERE id=%s',(q,)).fetchone()[0],6)
    self.assertEqual(c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_mark_cuttings WHERE item_id=%s',(item,)).fetchone()[0],1)
  finally:
   with connect() as c,c.transaction():
    c.execute('DELETE FROM sa_snapshot_20261019.sa_mark_cutting_quantities WHERE quantity_id=%s',(q,));c.execute('DELETE FROM sa_snapshot_20261019.sa_mark_cuttings WHERE item_id=%s',(item,))
    c.execute('DELETE FROM sa_snapshot_20261019.sa_quantities WHERE id=%s',(q,));c.execute('DELETE FROM sa_snapshot_20261019.sa_items WHERE id=%s',(item,));c.execute('DELETE FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(item,))
    c.execute("DELETE FROM sa_domain.entity_versions WHERE kind IN('item','order') AND entity_id=%s",(item,))
    for table in ['outbox','audit']:c.execute(f'DELETE FROM sa_domain.{table} WHERE command_key=ANY(%s)',(keys,))
    c.execute('DELETE FROM sa_domain.commands WHERE key=ANY(%s)',(keys,));c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false');c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s',original)

if __name__=='__main__':unittest.main(verbosity=2)
