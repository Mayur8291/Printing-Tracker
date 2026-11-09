"""Real pg-safeupdate regression; no worker/provider HTTP or hosted connection.
Set SQUAD_SAFEUPDATE_LIBRARY to a locally compiled upstream module path when the
module is not installed. LOAD is connection-local; no global setting is changed.
"""
import os,unittest,uuid
from psycopg import errors,sql
from local_db import connect
from fixtures import rpc
from test_catalogue import seed_catalogue
import test_weekly_tailor_schedule as weekly
import test_warehouse_schedule as warehouse
from test_warehouse_receipts import ownership
from sqlstate_assertions import assert_app_conflict
LIBRARY=os.environ.get('SQUAD_SAFEUPDATE_LIBRARY','safeupdate')
class SafeScheduleBase(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:
   seed_catalogue(c)
   try:c.execute(sql.SQL('LOAD {}').format(sql.Literal(LIBRARY)))
   except (errors.UndefinedFile,errors.UndefinedObject):raise unittest.SkipTest('Actual pg-safeupdate module unavailable; set SQUAD_SAFEUPDATE_LIBRARY')
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def guard(self):
  self.c.execute('RESET ROLE');self.c.execute(sql.SQL('LOAD {}').format(sql.Literal(LIBRARY)))
  self.assertEqual(self.c.execute('SHOW safeupdate.enabled').fetchone(),('on',))
  with self.assertRaises(errors.CardinalityViolation),self.c.transaction():self.c.execute('UPDATE sa_domain.weekly_tailor_schedule SET updated_at=now()')
 def original_body(self,signature):
  self.c.execute('RESET ROLE');definition=self.c.execute('SELECT pg_get_functiondef(%s::regprocedure)',(signature,)).fetchone()[0]
  self.assertIn('updated_at=now() WHERE singleton;',definition)
  self.c.execute(definition.replace('updated_at=now() WHERE singleton;','updated_at=now();'))

class WeeklySafeUpdate(SafeScheduleBase):
 actor_as=weekly.Weekly.actor_as;raw=weekly.Weekly.raw;worker=weekly.Weekly.worker;configure=weekly.Weekly.configure;enable=weekly.Weekly.enable;beat=weekly.Weekly.beat
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_sync.environment_state SET cutover=true WHERE singleton');self.guard();self.actor_as(100)
 def test_enable_disable_replay_versions_keep_guard_active(self):
  self.raw("UPDATE sa_domain.business_mail_settings SET recipient_ids=ARRAY[100] WHERE kind='tailor_weekly'")
  key=uuid.uuid4();enabled=self.configure(key=key);self.assertEqual(enabled,self.configure(key=key));self.assertTrue(enabled['enabled'])
  with assert_app_conflict(self),self.c.transaction():self.configure(False)
  key=uuid.uuid4();disabled=self.configure(False,enabled['version'],key);self.assertFalse(disabled['enabled']);self.assertEqual(disabled,self.configure(False,enabled['version'],key));self.guard()
 def test_old_configure_reproduces_21000_fixed_call_succeeds(self):
  self.raw("UPDATE sa_domain.business_mail_settings SET recipient_ids=ARRAY[100] WHERE kind='tailor_weekly'")
  with self.assertRaises(errors.CardinalityViolation),self.c.transaction():
   self.original_body('sa_domain.v1_weekly_tailor_schedule_configure(boolean,text,uuid)');self.configure()
  self.assertTrue(self.configure()['enabled'])
 def test_old_error_and_success_heartbeat_branches_reproduce_then_pass(self):
  self.enable();self.raw("UPDATE sa_domain.business_mail_settings SET recipient_ids='{}' WHERE kind='tailor_weekly'")
  with self.assertRaises(errors.CardinalityViolation),self.c.transaction():
   self.original_body('sa_domain.squad_weekly_tailor_heartbeat(integer)');self.beat()
  self.assertEqual(self.beat()['error_code'],'MAIL_RECIPIENTS_NOT_CONFIGURED')
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.documents'),[(0,)])
  self.raw("UPDATE sa_domain.business_mail_settings SET recipient_ids=ARRAY[100] WHERE kind='tailor_weekly'")
  with self.assertRaises(errors.CardinalityViolation),self.c.transaction():
   self.original_body('sa_domain.squad_weekly_tailor_heartbeat(integer)');self.beat()
  result=self.beat(1);self.assertEqual(result['queued'],1);self.assertEqual(self.raw('SELECT last_error_code FROM sa_domain.weekly_tailor_schedule'),[(None,)])
  self.assertLessEqual(self.beat(1)['queued'],1);self.guard()
 def test_empty_completion_advances_week_once(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET deleted_at=now() WHERE role=5');self.enable()
  self.assertEqual(self.beat()['state'],'queued');self.assertEqual(self.beat()['state'],'waiting');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.documents'),[(0,)])
 def test_role_and_worker_boundaries_unchanged(self):
  self.actor_as(103)
  with self.assertRaises(errors.InsufficientPrivilege),self.c.transaction():rpc(self.c,'v1_weekly_tailor_schedule_configure',(False,'0:0',uuid.uuid4()))
  with self.assertRaises(errors.InsufficientPrivilege),self.c.transaction():self.c.execute('SELECT canto_api.squad_weekly_tailor_heartbeat(1)')

class WarehouseSafeUpdate(SafeScheduleBase):
 actor=warehouse.Schedule.actor;raw=warehouse.Schedule.raw;worker=warehouse.Schedule.worker;configure=warehouse.Schedule.configure;beat=warehouse.Schedule.beat
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');ownership(self.c);self.guard();self.actor()
 def test_enable_disable_replay_versions(self):
  key=uuid.uuid4();enabled=self.configure(key=key);self.assertEqual(enabled,self.configure(key=key));self.assertTrue(enabled['enabled'])
  with assert_app_conflict(self),self.c.transaction():self.configure(False)
  key=uuid.uuid4();disabled=self.configure(False,enabled['version'],key);self.assertFalse(disabled['enabled']);self.assertEqual(disabled,self.configure(False,enabled['version'],key));self.guard()
 def test_old_configure_reproduces_21000_fixed_call_succeeds(self):
  with self.assertRaises(errors.CardinalityViolation),self.c.transaction():
   self.original_body('sa_domain.v1_warehouse_schedule_configure(boolean,text,uuid)');self.configure()
  self.assertTrue(self.configure()['enabled'])
 def test_old_heartbeat_error_and_success_reproduce_then_pass(self):
  self.configure();self.raw('UPDATE sa_domain.warehouse_config SET enabled=false WHERE singleton')
  with self.assertRaises(errors.CardinalityViolation),self.c.transaction():
   self.original_body('sa_domain.squad_warehouse_heartbeat()');self.beat()
  self.assertEqual(self.beat()['error_code'],'WAREHOUSE_OWNERSHIP_UNAVAILABLE');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_reconciliations'),[(0,)])
  self.raw('UPDATE sa_domain.warehouse_config SET enabled=true WHERE singleton')
  with self.assertRaises(errors.CardinalityViolation),self.c.transaction():
   self.original_body('sa_domain.squad_warehouse_heartbeat()');self.beat()
  result=self.beat();self.assertEqual(result['state'],'queued');self.assertEqual(self.raw('SELECT last_error_code FROM sa_domain.warehouse_schedule'),[(None,)])
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_scheduled_runs'),[(1,)]);self.guard()
 def test_provider_ownership_and_browser_worker_denial_remain(self):
  self.raw('DELETE FROM sa_domain.cutover_commits WHERE true')
  with self.assertRaises(errors.ObjectNotInPrerequisiteState),self.c.transaction():self.configure()
  with self.assertRaises(errors.InsufficientPrivilege),self.c.transaction():self.c.execute('SELECT canto_api.squad_warehouse_heartbeat()')
if __name__=='__main__':unittest.main(verbosity=2)
