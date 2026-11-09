"""Completed priority parity retains exact existing command authority and locks."""
import unittest,uuid
import psycopg
from local_db import connect
from fixtures import seed_orders,session,rpc
from sqlstate_assertions import assert_app_conflict

class CompletedPriority(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');self.n=101;session(self.c,self.n)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.c.execute('RESET ROLE');self.n=n;session(self.c,n)
 def version(self,id=1005):return rpc(self.c,'v1_order_get',(id,))['version']
 def priority(self,id=1005,prime=True,key=None,version=None):return rpc(self.c,'v1_order_priority_save',(id,prime,'Reviewed priority tag',version or self.version(id),key or uuid.uuid4()))
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);result=r.fetchall() if r.description else None;session(self.c,self.n);return result
 def test_completed_tag_exact_retry_preserves_completion_and_history(self):
  before=self.raw('SELECT status,uc_status,total_amount,dispatched_quantity,delivered_on FROM sa_snapshot_20261019.sa_orders WHERE id=1005')
  key=uuid.uuid4();version=self.version();result=self.priority(key=key,version=version)
  self.assertTrue(result['is_prime']);self.assertEqual(result,self.priority(key=key,version=version))
  self.assertEqual(before,self.raw('SELECT status,uc_status,total_amount,dispatched_quantity,delivered_on FROM sa_snapshot_20261019.sa_orders WHERE id=1005'))
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.audit WHERE command_key=%s',(key,)),[(1,)])
 def test_completed_allowed_admin_and_pc(self):
  for actor in [100,102]:
   self.actor(actor);self.assertTrue(self.priority()['is_prime'])
 def test_completed_toggle_off(self):
  self.priority();self.assertFalse(self.priority(prime=False)['is_prime'])
 def test_stale_version_and_changed_replay_rejected(self):
  key=uuid.uuid4();old=self.version();self.priority(key=key,version=old)
  with assert_app_conflict(self),self.c.transaction():self.priority(version=old)
  with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.priority(prime=False,key=key,version=old)
 def test_foreign_and_customer_denied(self):
  for actor,error in [(201,psycopg.errors.NoDataFound),(103,psycopg.errors.InsufficientPrivilege)]:
   self.actor(actor)
   with self.assertRaises(error),self.c.transaction():self.priority(version='1:0')
 def test_cancelled_and_deleted_denied(self):
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState),self.c.transaction():self.priority(id=1006)
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET deleted_at=now() WHERE id=1005')
  with self.assertRaises(psycopg.errors.NoDataFound),self.c.transaction():self.priority(version='1:0')
 def test_completed_does_not_widen_due_or_cancel(self):
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState),self.c.transaction():rpc(self.c,'v1_order_due_save',(1005,'2026-12-01T00:00:00Z','Reason',self.version(),uuid.uuid4()))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState),self.c.transaction():rpc(self.c,'v1_order_cancel',(1005,'cancel','Reason',self.version(),uuid.uuid4()))
 def test_pending_provider_command_preserved(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=1 WHERE order_id=1002')
  queued=rpc(self.c,'v1_order_cancel',(1002,'cancel','Provider cancellation',self.version(1002),uuid.uuid4()))
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET status=1 WHERE id=1002')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.priority(id=1002,version=queued['version'])
 def test_attempted_uncertain_warehouse_operation_preserved(self):
  self.priority()
  self.raw("INSERT INTO sa_domain.warehouse_operations(job_id,generation,provider,operation,order_id,request_key,facility_code,payload,attempted,state) SELECT id,generation,'uniware','amend',1005,'fixture-priority-uncertain','test','{}',true,'reconciliation_required' FROM sa_domain.outbox LIMIT 1")
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.priority(prime=False)
 def test_mirror_write_fence_preserved(self):
  self.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=false')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.priority()
if __name__=='__main__':unittest.main()
