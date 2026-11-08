"""Point work policies preserve the original whole-set authority, including revocation."""
import unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from fixtures import seed_orders,session,rpc
from local_db import connect

KINDS={'quantity':'sa_quantities','cut':'sa_mark_cuttings','assignment':'sa_job_sheet_assign_dates','tailor':'sa_item_tailors','inspection':'sa_job_sheet_tailor_mark_dates','dispatch':'sa_job_sheet_dispatched_dates','tailor_quantity':'sa_item_tailor_quantities','mark_tailor':'sa_job_sheet_mark_tailors'}
ROLES=(0,1,2,3,4,7,8,9,10,11,12)

class WorkPointScope(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_worker_id=NULL WHERE id IN(1001,2001)')
  for group in (100,200):self.build(group)
  self.c.execute('RESET ROLE');self.ids={k:[x[0] for x in self.c.execute('SELECT id FROM sa_snapshot_20261019.'+table).fetchall()]+[999999999] for k,table in KINDS.items()}
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n,executor=True):
  self.c.execute('RESET ROLE');session(self.c,n)
  if executor:self.c.execute('SET LOCAL ROLE sa_executor')
 def version(self,item):
  self.c.execute('RESET ROLE');return self.c.execute("SELECT sa_domain.version('item',%s)",(item,)).fetchone()[0]
 def build(self,g):
  item=g*10+1;self.c.execute('RESET ROLE');q=self.c.execute('SELECT id FROM sa_snapshot_20261019.sa_quantities WHERE item_id=%s',(item,)).fetchone()[0]
  v=self.version(item);self.actor(g+9,False);rpc(self.c,'v1_cutting_record',(item,Jsonb([{'quantity_id':str(q),'quantity':2}]),None,v,uuid.uuid4()))
  v=self.version(item);self.actor(g+4,False);rpc(self.c,'v1_jobsheet_assign',(item,Jsonb([{'quantity_id':str(q),'tailor_id':str(g+5),'quantity':2}]),'2026-12-10T00:00:00Z','2026-12-09T00:00:00Z',v,uuid.uuid4()))
  self.c.execute('RESET ROLE');assignment=self.c.execute('SELECT tq.id FROM sa_snapshot_20261019.sa_item_tailor_quantities tq JOIN sa_snapshot_20261019.sa_item_tailors t ON t.id=tq.item_tailor_id WHERE t.item_id=%s',(item,)).fetchone()[0]
  v=self.version(item);self.actor(g+8,False);rpc(self.c,'v1_jobsheet_inspect',(item,Jsonb([{'item_tailor_quantity_id':str(assignment),'quantity':1}]),None,v,uuid.uuid4()))
  v=self.version(item);self.actor(g+7,False);rpc(self.c,'v1_dispatch_record',(item,Jsonb([{'quantity_id':str(q),'quantity':1}]),None,v,uuid.uuid4()))
 def test_item_point_matches_original_set_for_all_login_roles_and_scopes(self):
  for group in (100,200):
   for role in ROLES:
    with self.subTest(group=group,role=role):
     self.actor(group+role);original={x[0] for x in self.c.execute('SELECT * FROM sa_domain.scope_item_ids()')}
     actual={n for n in range(1001,1007) if self.c.execute('SELECT sa_domain.can_item(%s)',(n,)).fetchone()[0]}|{n for n in range(2001,2007) if self.c.execute('SELECT sa_domain.can_item(%s)',(n,)).fetchone()[0]}
     self.assertEqual(actual,original);self.assertFalse(self.c.execute('SELECT sa_domain.can_item(999999999)').fetchone()[0])
 def test_each_child_point_matches_original_set_for_all_login_roles(self):
  for group in (100,200):
   for role in ROLES:
    self.actor(group+role)
    for kind,ids in self.ids.items():
     with self.subTest(group=group,role=role,kind=kind):
      original={x[0] for x in self.c.execute('SELECT * FROM sa_domain.work_scope_ids(%s)',(kind,))}
      actual={n for n in ids if self.c.execute('SELECT sa_domain.work_parent_visible(%s,%s)',(kind,n)).fetchone()[0]}
      self.assertEqual(actual,original)
 def test_existing_cutter_can_read_only_assigned_sibling_item(self):
  self.c.execute('RESET ROLE');self.c.execute('INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,cutting_master_id,total_quantity,created_at,updated_at) VALUES(999900,1001,209,1,now(),now())');self.actor(109)
  self.assertTrue(self.c.execute('SELECT sa_domain.can_item(1001)').fetchone()[0]);self.assertFalse(self.c.execute('SELECT sa_domain.can_item(999900)').fetchone()[0])
 def test_factory_movement_takes_effect_without_cached_authority(self):
  self.actor(108);self.assertTrue(self.c.execute('SELECT sa_domain.can_item(1001)').fetchone()[0]);self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET factory_manager_id=204 WHERE id=108');self.actor(108);self.assertFalse(self.c.execute('SELECT sa_domain.can_item(1001)').fetchone()[0]);self.assertTrue(self.c.execute('SELECT sa_domain.can_item(2001)').fetchone()[0])
 def test_disabled_actor_cannot_reuse_a_work_context(self):
  self.actor(108);self.assertTrue(self.c.execute('SELECT sa_domain.can_item(1001)').fetchone()[0]);self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=108');self.actor(108)
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.c.execute('SELECT sa_domain.can_item(1001)')
 def test_role_change_does_not_retain_factory_scope(self):
  self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET role=12 WHERE id=108');self.actor(108);self.assertFalse(self.c.execute('SELECT sa_domain.can_item(1001)').fetchone()[0])
 def test_foreign_work_child_is_invisible_through_executor_rls(self):
  self.actor(108);self.assertEqual(self.c.execute('SELECT DISTINCT item_id FROM sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates').fetchall(),[(1001,)])
 def test_foreign_work_insert_stays_denied(self):
  self.actor(108)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('INSERT INTO sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates(item_id,marked_at,created_at,updated_at) VALUES(2001,now(),now(),now())')
 def test_foreign_child_insert_stays_denied(self):
  self.c.execute('RESET ROLE');local=self.c.execute('SELECT id FROM sa_snapshot_20261019.sa_mark_cuttings WHERE item_id=1001').fetchone()[0];foreign=self.c.execute('SELECT id FROM sa_snapshot_20261019.sa_quantities WHERE item_id=2001').fetchone()[0];self.actor(109)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('INSERT INTO sa_snapshot_20261019.sa_mark_cutting_quantities(mark_cutting_id,quantity_id,qty,cutting_done,created_at,updated_at) VALUES(%s,%s,1,1,now(),now())',(local,foreign))
 def test_ordinary_client_cannot_call_private_helper(self):
  self.actor(108,False)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT sa_domain.work_parent_visible('quantity',1)")
 def test_service_role_has_no_private_helper_capability(self):
  self.c.execute('RESET ROLE');self.c.execute('SET LOCAL ROLE service_role')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT sa_domain.work_parent_visible('quantity',1)")
 def test_unsupported_kind_and_null_record(self):
  self.actor(108);self.assertFalse(self.c.execute("SELECT sa_domain.work_parent_visible('quantity',NULL)").fetchone()[0])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.c.execute("SELECT sa_domain.work_parent_visible('password',1)")

if __name__=='__main__':unittest.main(verbosity=2)
