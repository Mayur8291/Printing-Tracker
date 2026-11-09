import decimal,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed_orders,session,rpc
D=decimal.Decimal

class Allocation(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_worker_id=NULL WHERE id=1001')
  self.c.execute('UPDATE sa_snapshot_20261019.sa_items SET worker_per_piece_amount=0,worker_total_amount=0 WHERE id=1001')
  self.n=102;session(self.c,self.n)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.n=n;self.c.execute('RESET ROLE');session(self.c,n)
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);result=r.fetchall() if r.description else None;session(self.c,self.n);return result
 def ov(self,id=1001):return rpc(self.c,'v1_order_get',(id,))['version']
 def iv(self,id=1001):return self.raw("SELECT sa_domain.version('item',%s)",(id,))[0][0]
 def factory(self,manager=204,key=None,version=None):return rpc(self.c,'v1_order_assign_factory',(1001,manager,'Capacity change',version or self.ov(),key or uuid.uuid4()))
 def worker(self,key=None):return rpc(self.c,'v1_order_assign_worker',(1001,111,'2026-12-01T00:00:00Z','External production',self.ov(),key or uuid.uuid4()))
 def stage(self,value,key=None,version=None):return rpc(self.c,'v1_worker_stage_save',(1001,value,'Production progress',version or self.iv(),key or uuid.uuid4()))
 def criteria(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_criteria(id,name,created_at,updated_at) VALUES(900002,'Material',now(),now())")
  self.raw('INSERT INTO sa_snapshot_20261019.sa_item_criteria(id,item_id,criteria_id,is_checked,created_at,updated_at) VALUES(900002,1001,900002,false,now(),now())')
 def test_factory_reassignment_clears_previous_cutter_and_versions_item(self):
  old=self.iv();r=self.factory();self.assertEqual(r['manager_id'],'204');self.assertEqual(r['factory_id'],'2');self.assertNotEqual(self.iv(),old)
  self.assertEqual(self.raw('SELECT assigned_to_id,assigned_worker_id FROM sa_snapshot_20261019.sa_orders WHERE id=1001'),[(204,None)])
  self.assertEqual(self.raw('SELECT cutting_master_id FROM sa_snapshot_20261019.sa_items WHERE id=1001'),[(None,)])
 def test_factory_command_retry(self):
  key=uuid.uuid4();v=self.ov();r=self.factory(key=key,version=v);self.assertEqual(r,self.factory(key=key,version=v))
 def test_factory_wrong_target_role_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.factory(203)
 def test_disabled_manager_rejected(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=204')
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.factory()
 def test_manager_without_factory_rejected(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET factory_id=NULL WHERE id=204')
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.factory()
 def test_active_cutting_blocks_reassignment(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET cutting_done=1 WHERE id=1001')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.factory()
 def test_worker_agreed_cost_blocks_reassignment(self):
  self.worker();rpc(self.c,'v1_worker_cost_save',(1001,D('12.25'),'Agreed rate',self.iv(),uuid.uuid4()))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.factory()
 def test_customer_cannot_assign_factory(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.factory()
 def test_factory_assign_unassign(self):
  self.factory(None);self.assertEqual(self.raw('SELECT assigned_to_id FROM sa_snapshot_20261019.sa_orders WHERE id=1001'),[(None,)])
 def test_worker_assignment_removes_factory_authority(self):
  r=self.worker();self.assertEqual(r['worker_id'],'111');self.assertEqual(self.raw('SELECT assigned_to_id,assigned_worker_id FROM sa_snapshot_20261019.sa_orders WHERE id=1001'),[(None,111)])
  self.actor(104)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_order_get',(1001,))
 def test_cutter_same_factory_validation(self):
  self.actor(104)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_item_assign_cutter',(1001,209,'Reassignment',self.iv(),uuid.uuid4()))
 def test_cutter_assignment_version_and_scope(self):
  self.actor(104);r=rpc(self.c,'v1_item_assign_cutter',(1001,109,'Assign cutter',self.iv(),uuid.uuid4()));self.assertEqual(r['cutter_id'],'109')
  self.actor(204)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_item_assign_cutter',(1001,209,'Foreign factory',r['version'],uuid.uuid4()))
 def test_cutter_cannot_assign_self(self):
  self.actor(109)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_item_assign_cutter',(1001,109,'Self assignment',self.iv(),uuid.uuid4()))
 def test_checklist_false_is_valid_and_audited(self):
  self.criteria();self.actor(104);r=rpc(self.c,'v1_item_criteria_save',(1001,Jsonb([{'id':'900002','checked':True}]),self.iv(),uuid.uuid4()));self.assertTrue(r['criteria_complete'])
  r=rpc(self.c,'v1_item_criteria_save',(1001,Jsonb([{'id':'900002','checked':False}]),r['version'],uuid.uuid4()));self.assertFalse(r['criteria_complete'])
  self.assertEqual(self.raw('SELECT checked_by_id,unchecked_by_id,updated_by_id FROM sa_snapshot_20261019.sa_item_criteria WHERE id=900002'),[(104,104,104)])
 def test_checklist_foreign_item_denied(self):
  self.criteria();self.raw('UPDATE sa_snapshot_20261019.sa_item_criteria SET item_id=2001 WHERE id=900002')
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_item_criteria_save',(1001,Jsonb([{'id':'900002','checked':True}]),self.iv(),uuid.uuid4()))
 def test_checklist_duplicate_id_denied(self):
  self.criteria()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_item_criteria_save',(1001,Jsonb([{'id':'900002','checked':True}]*2),self.iv(),uuid.uuid4()))
 def test_worker_cost_derived_not_client_total(self):
  self.worker();r=rpc(self.c,'v1_worker_cost_save',(1001,D('12.345'),'Rate agreement',self.iv(),uuid.uuid4()));self.assertEqual(D(r['total_cost']),D('123.45'))
 def test_worker_cannot_set_own_cost(self):
  self.worker();self.actor(111)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_worker_cost_save',(1001,D('12'),'Rate',self.iv(),uuid.uuid4()))
 def test_negative_cost_rejected(self):
  self.worker()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_worker_cost_save',(1001,D('-1'),'Rate',self.iv(),uuid.uuid4()))
 def test_six_worker_stages_complete_custom_order_without_fake_quantities(self):
  self.worker();self.actor(111)
  for n in range(1,6):r=self.stage(n)
  self.assertTrue(r['order_completed']);self.assertEqual(self.raw('SELECT status,worker_status,dispatched_quantity FROM sa_snapshot_20261019.sa_orders WHERE id=1001'),[(1,1,0)])
 def test_worker_cannot_skip_stage(self):
  self.worker();self.actor(111)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.stage(3)
 def test_pc_can_correct_open_worker_stage_with_reason(self):
  self.worker();self.stage(3);self.assertEqual(self.stage(1)['stage'],1)
 def test_worker_stage_retry_does_not_repeat_event(self):
  self.worker();self.actor(111);v=self.iv();key=uuid.uuid4();r=self.stage(1,key,v);self.assertEqual(r,self.stage(1,key,v))
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.audit WHERE command_key=%s',(key,)),[(1,)])
 def test_worker_stage_cross_worker_denied(self):
  self.worker();self.actor(211)
  with self.assertRaises(psycopg.errors.NoDataFound):self.stage(1)
 def test_worker_progress_cannot_reassign(self):
  self.worker();self.stage(1)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.factory()
 def test_worker_due_changes_preserve_assignment_baseline(self):
  self.worker();self.actor(111)
  r=rpc(self.c,'v1_worker_due_save',(1001,'2026-12-03T00:00:00Z','Material delay',self.ov(),uuid.uuid4()));self.assertEqual(r['delta_days'],2);self.assertEqual(r['baseline_basis'],'assignment')
  self.actor(102) # Further corrections remain the coordinator's responsibility.
  r2=rpc(self.c,'v1_worker_due_save',(1001,'2026-12-05T00:00:00Z','Further delay',r['version'],uuid.uuid4()));self.assertEqual(r2['delta_days'],4);self.assertEqual(r['original_due_at'],r2['original_due_at'])
 def test_legacy_due_baseline_is_honest_about_missing_assignment_history(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_worker_id=111,assigned_to_id=NULL WHERE id=1001');self.actor(111)
  r=rpc(self.c,'v1_worker_due_save',(1001,'2026-12-03T00:00:00Z','Legacy adjustment',self.ov(),uuid.uuid4()));self.assertEqual(r['baseline_basis'],'first_observed_change')
 def test_factory_queue_scope_filter_and_cursor(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_worker_id=NULL')
  self.actor(104);r=rpc(self.c,'v1_factory_queue',(1,None,None,1));self.assertEqual(len(r['data']),1);self.assertIsNotNone(r['next_cursor'])
  next_=rpc(self.c,'v1_factory_queue',(1,None,r['next_cursor'],1));self.assertNotEqual(next_['data'][0]['id'],r['data'][0]['id'])
  self.assertTrue(all(x['manager_id']=='104' for x in r['data']+next_['data']))
 def test_factory_queue_rejects_cross_factory_filter(self):
  self.actor(104)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_factory_queue',(2,))
 def test_factory_queue_hides_commercial_fields(self):
  self.actor(104);r=rpc(self.c,'v1_factory_queue')['data'];self.assertTrue(r);self.assertNotIn('total_amount',r[0]);self.assertNotIn('worker_unit_cost',r[0])
 def test_cutting_master_progress_contains_other_items_rollup_not_other_item_details(self):
  self.raw('INSERT INTO sa_snapshot_20261019.sa_items(order_id,item_type,cutting_master_id,cutting_done,created_at,updated_at) VALUES(1001,0,209,3,now(),now())')
  self.actor(109);r=rpc(self.c,'v1_production_progress',(1001,));self.assertEqual(r['cut'],3);self.assertEqual(r['item_count'],2)
 def test_progress_cross_order_denied(self):
  self.actor(109)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_production_progress',(2001,))
 def test_legacy_staff_scope_uses_manager_link_not_stale_direct_factory_field(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET factory_id=2 WHERE id=108');self.actor(108)
  self.assertEqual({int(x['id']) for x in rpc(self.c,'v1_people_list')['data']},{104,105,106,107,108,109})
  self.assertEqual(rpc(self.c,'v1_order_get',(1001,))['id'],'1001')
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_order_get',(2001,))
 def test_factory_manager_link_change_immediately_revokes_previous_factory_scope(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET factory_manager_id=204 WHERE id=108');self.actor(108)
  self.assertEqual(rpc(self.c,'v1_order_get',(2001,))['id'],'2001')
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_order_get',(1001,))
 def test_orphaned_staff_cannot_use_direct_factory_field_as_fallback(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET factory_manager_id=NULL,factory_id=1 WHERE id=108');self.actor(108)
  self.assertEqual(rpc(self.c,'v1_orders_list')['data'],[])
 def test_reassigned_worker_receives_own_due_baseline(self):
  self.worker()
  r=rpc(self.c,'v1_order_assign_worker',(1001,211,'2026-12-10T00:00:00Z','Change contractor',self.ov(),uuid.uuid4()))
  self.actor(211);r=rpc(self.c,'v1_worker_due_save',(1001,'2026-12-11T00:00:00Z','Material delay',r['version'],uuid.uuid4()));self.assertEqual(r['delta_days'],1)
 def test_private_factory_read_cannot_be_called_directly(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT sa_domain.factory_queue_rows(NULL,NULL,999999,30)')
 def test_subtailor_parent_must_be_a_tailor(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET parent_tailor_id=109 WHERE id=106');self.actor(104)
  self.assertNotIn('106',{x['id'] for x in rpc(self.c,'v1_people_list')['data']})

if __name__=='__main__':unittest.main(verbosity=2)
