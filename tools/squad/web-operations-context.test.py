"""Scoped linked purchases and current-assignment due history; local only."""
import unittest,uuid,psycopg,time
from psycopg import sql
from psycopg.types.json import Jsonb
from fixtures import rpc,session
import test_production_allocation as base

class Context(unittest.TestCase):
 setUpClass=classmethod(base.Allocation.setUpClass.__func__)
 setUp=base.Allocation.setUp;tearDown=base.Allocation.tearDown
 actor=base.Allocation.actor;raw=base.Allocation.raw;ov=base.Allocation.ov
 worker=base.Allocation.worker
 def section(self,id=1001,section='backorders',cursor=None,limit=25):return rpc(self.c,'v1_order_get',(id,cursor,limit,section))
 def link(self,a,b):self.raw('INSERT INTO sa_snapshot_20261019.sa_back_order_links(order_id,back_order_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(a,b))
 def change(self,reason='Capacity change',due='2026-12-03T00:00:00Z'):return rpc(self.c,'v1_worker_due_save',(1001,due,reason,self.ov(),uuid.uuid4()))
 def test_link_both_directions_deduplicates_legacy_and_multiple_rows(self):
  self.link(1001,1002);self.link(1001,1002);self.raw('UPDATE sa_snapshot_20261019.sa_orders SET back_order_for_id=1001 WHERE id=1002')
  self.actor(103);r=self.section();self.assertEqual([(x['id'],x['direction']) for x in r['data']],[('1002','purchase')])
  self.assertEqual(self.section(1002)['data'][0]['direction'],'demand')
  self.link(1002,1001);self.assertEqual(self.section()['data'][0]['direction'],'ambiguous')
 def test_foreign_related_order_and_unreadable_source_never_leak(self):
  self.link(1001,2001);self.link(2001,1001);self.actor(103)
  self.assertEqual(self.section()['data'],[])
  with self.assertRaises(psycopg.errors.NoDataFound):self.section(2001)
 def test_deleted_self_and_foreign_links_are_omitted(self):
  self.link(1001,1001);self.link(1001,1002);self.raw('UPDATE sa_snapshot_20261019.sa_orders SET is_deleted=true WHERE id=1002')
  self.actor(103);self.assertEqual(self.section()['data'],[])
 def test_cursor_bound_to_actor_source_version_generation_and_section(self):
  self.link(1001,1002);self.link(1001,1003);self.actor(103);first=self.section(limit=1);cur=first['next_cursor'];self.assertTrue(cur)
  self.assertEqual(self.section(cursor=cur,limit=1)['data'][0]['id'],'1002')
  for kwargs in [{'id':1002},{'section':'worker_history'}]:
   with self.assertRaises(psycopg.errors.InvalidParameterValue):
    with self.c.transaction():self.section(cursor=cur,**kwargs)
  self.actor(101)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):
   with self.c.transaction():self.section(cursor=cur)
  self.actor(103);self.raw("INSERT INTO sa_domain.entity_versions(kind,entity_id,revision) VALUES('order',1001,1) ON CONFLICT(kind,entity_id) DO UPDATE SET revision=excluded.revision")
  with self.assertRaises(psycopg.errors.InvalidParameterValue):
   with self.c.transaction():self.section(cursor=cur)
  fresh=self.section(limit=1)['next_cursor'];self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1')
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.section(cursor=fresh)
 def test_worker_history_exact_current_assignment_baseline_and_truncation(self):
  self.worker();self.actor(111);self.change();r=self.section(section='worker_history');self.assertEqual(len(r['data']),1)
  self.assertEqual(r['commitment']['worker_id'],'111');self.assertEqual(r['commitment']['reason'],'Capacity change');self.assertEqual(r['commitment']['reason_basis'],'recorded_change')
  self.assertTrue(r['commitment']['original_due_at'].startswith('2026-12-01'))
  self.assertEqual(set(r['data'][0]),{'id','occurred_at','before','after','original_due_at','baseline_basis','reason','reason_truncated'})
  self.raw("UPDATE sa_domain.audit SET changes=changes||jsonb_build_object('reason',repeat('x',5000),'private','secret') WHERE kind='order' AND entity_id=1001 AND operation='order.worker_due_changed'")
  r=self.section(section='worker_history');self.assertEqual(len(r['data'][0]['reason']),4000);self.assertTrue(r['data'][0]['reason_truncated']);self.assertNotIn('private',r['data'][0])
 def test_worker_history_roles_private_helper_and_no_generic_audit_grant(self):
  self.worker();self.change()
  for who in [100,102,111]:self.actor(who);self.assertEqual(len(self.section(section='worker_history')['data']),1)
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):
   with self.c.transaction():self.section(section='worker_history')
  for role in ['sa_app','anon','authenticated','service_role']:
   self.c.execute('RESET ROLE')
   with self.assertRaises(psycopg.errors.InsufficientPrivilege):
    with self.c.transaction():
     self.c.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)));self.c.execute('SELECT sa_domain.worker_order_context(1001,999999,10)')
  self.actor(111)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):
   with self.c.transaction():self.c.execute('SELECT * FROM sa_domain.audit')
 def test_assignment_boundary_and_current_worker_scope(self):
  self.worker();self.change();self.worker();self.actor(111)
  r=self.section(section='worker_history');self.assertEqual(r['data'],[]);self.assertIsNone(r['commitment']['reason'])
  self.actor(102);rpc(self.c,'v1_order_assign_worker',(1001,211,'2026-12-05T00:00:00Z','Other worker',self.ov(),uuid.uuid4()))
  self.actor(111)
  with self.assertRaises(psycopg.errors.NoDataFound):
   with self.c.transaction():self.section(section='worker_history')
  self.actor(211);self.assertEqual(self.section(section='worker_history')['data'],[])
 def test_reassign_away_and_back_uses_latest_due_baseline(self):
  self.worker();self.change();rpc(self.c,'v1_order_assign_worker',(1001,211,'2026-12-07T00:00:00Z','New provider',self.ov(),uuid.uuid4()))
  rpc(self.c,'v1_order_assign_worker',(1001,111,'2026-12-09T00:00:00Z','Original provider again',self.ov(),uuid.uuid4()))
  self.actor(111);r=self.section(section='worker_history');self.assertTrue(r['commitment']['original_due_at'].startswith('2026-12-09'));self.assertEqual(r['data'],[])
 def test_dense_due_history_and_sparse_relationship_page_remain_bounded(self):
  self.worker();self.change();self.c.execute('RESET ROLE')
  self.c.execute("""INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes,created_at,generation)
   SELECT actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes,created_at,generation FROM sa_domain.audit CROSS JOIN generate_series(1,20000) g
   WHERE kind='order' AND entity_id=1001 AND operation='order.worker_due_changed'""")
  self.c.execute('ANALYZE sa_domain.audit');session(self.c,self.n)
  start=time.perf_counter();r=self.section(section='worker_history');elapsed=(time.perf_counter()-start)*1000
  self.assertEqual(len(r['data']),25);self.assertTrue(r['next_cursor']);self.assertLess(elapsed,1000)
  print('worker_context_dense_ms',round(elapsed,2),flush=True)
 def test_legacy_reason_is_labeled_and_no_invented_original_date(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=NULL,assigned_worker_id=111,job_worker_reason='Imported reason' WHERE id=1001")
  self.actor(111);r=self.section(section='worker_history');self.assertEqual(r['commitment']['reason_basis'],'legacy_current_value');self.assertIsNone(r['commitment']['original_due_at']);self.assertEqual(r['commitment']['baseline_basis'],'not_recorded_in_source')
 def test_unknown_sections_and_existing_detail_finance_preserved(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):
   with self.c.transaction():self.section(section='audit')
  self.raw("UPDATE sa_snapshot_20261019.sa_items SET status_change_time='2026-12-01 12:00:00' WHERE id=1001")
  detail=rpc(self.c,'v1_order_get',(1001,));self.assertEqual(detail['items']['data'][0]['unit_amount'],'100');self.assertEqual(detail['items']['data'][0]['worker_stage_changed_at'],'2026-12-01T12:00:00Z');self.assertNotIn('paid_amount',detail)
  self.actor(103);self.assertIsNone(rpc(self.c,'v1_order_get',(1001,))['items']['data'][0]['worker_stage_changed_at'])

if __name__=='__main__':unittest.main(verbosity=2)
