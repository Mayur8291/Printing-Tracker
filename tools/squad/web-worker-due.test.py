"""First JobWorker commitment change mirrors the pinned source UI."""
import unittest,uuid,psycopg
from fixtures import rpc
import test_production_allocation as base
class WorkerDue(unittest.TestCase):
 setUpClass=classmethod(base.Allocation.setUpClass.__func__)
 setUp=base.Allocation.setUp;tearDown=base.Allocation.tearDown
 actor=base.Allocation.actor;raw=base.Allocation.raw;ov=base.Allocation.ov;worker=base.Allocation.worker
 def change(self,key=None,version=None):return rpc(self.c,'v1_worker_due_save',(1001,'2026-12-03T00:00:00Z','Material delay',version or self.ov(),key or uuid.uuid4()))
 def allowed(self):return rpc(self.c,'v1_order_get',(1001,))['worker_due_change_allowed']
 def test_worker_first_change_and_exact_retry_but_new_command_denied(self):
  self.worker();self.actor(111);self.assertTrue(self.allowed());key=uuid.uuid4();v=self.ov();r=self.change(key,v)
  self.assertFalse(self.allowed());self.assertEqual(self.change(key,v),r)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.change()
 def test_pc_can_correct_repeatedly_without_resetting_baseline(self):
  self.worker();self.actor(111);r=self.change();self.actor(102);self.assertTrue(self.allowed());self.change();r2=self.change();self.assertEqual(r['original_due_at'],r2['original_due_at'])
 def test_imported_empty_or_nonempty_reason_still_blocks_worker(self):
  self.worker();self.actor(111)
  for reason in ['', 'Imported reason']:
   self.raw('UPDATE sa_snapshot_20261019.sa_orders SET job_worker_reason=%s WHERE id=1001',(reason,));self.assertFalse(self.allowed())
   with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):
    with self.c.transaction():self.change()
 def test_worker_completed_but_order_pending_cannot_change(self):
  self.worker();self.raw('UPDATE sa_snapshot_20261019.sa_orders SET worker_status=1,status=0 WHERE id=1001');self.actor(111);self.assertFalse(self.allowed())
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.change()
 def test_reassignment_does_not_erase_original_reason(self):
  self.worker();self.actor(111);self.change();self.actor(102);self.worker();self.actor(111);self.assertFalse(self.allowed())
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.change()
 def test_cancelled_pending_order_does_not_advertise_due_change(self):
  self.worker();self.actor(111);self.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_status='CANCELLED',status=0 WHERE id=1001");self.assertFalse(self.allowed())
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.change()
 def test_foreign_worker_and_completed_order_unchanged(self):
  self.worker();self.actor(211)
  with self.assertRaises(psycopg.errors.NoDataFound):
   with self.c.transaction():self.change(version='1:0')
  self.actor(111);self.raw('UPDATE sa_snapshot_20261019.sa_orders SET status=1 WHERE id=1001');self.assertFalse(self.allowed())
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.change()
if __name__=='__main__':unittest.main(verbosity=2)
