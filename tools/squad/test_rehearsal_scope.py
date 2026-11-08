"""The staging write switch is expiring and exact-principal scoped."""
import unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed,session,rpc,uid

class RehearsalScope(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN')
  self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,test_write_expires_at=now()+interval '15 minutes'",([uid(103)],))
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def write(self,n=103):
  session(self.c,n);return rpc(self.c,'v1_profile_save',(Jsonb({'name':'Scoped rehearsal'}),'0:0',uuid.uuid4()))
 def rejected(self,n=103):
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.write(n)
 def test_exact_actor_command_succeeds(self):self.assertEqual(self.write()['name'],'Scoped rehearsal')
 def test_other_real_principal_remains_mirror(self):self.rejected(203)
 def test_empty_list_fails_closed(self):
  self.c.execute("UPDATE sa_domain.runtime_state SET test_actor_ids='{}'");self.rejected()
 def test_missing_deadline_fails_closed(self):
  self.c.execute('UPDATE sa_domain.runtime_state SET test_write_expires_at=NULL');self.rejected()
 def test_expired_deadline_fails_closed(self):
  self.c.execute("UPDATE sa_domain.runtime_state SET test_write_expires_at=now()-interval '1 second'");self.rejected()
 def test_switch_off_still_denies_listed_actor(self):
  self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false');self.rejected()
 def test_production_mirror_never_accepts_rehearsal(self):
  self.c.execute("UPDATE sa_sync.environment_state SET environment='production'");self.rejected()
 def test_actual_cutover_ignores_rehearsal_list(self):
  self.c.execute("UPDATE sa_sync.environment_state SET cutover=true,environment='production'");self.assertEqual(self.write(203)['name'],'Scoped rehearsal')
 def test_refresh_job_still_denies_listed_actor(self):
  self.c.execute('UPDATE sa_sync.environment_state SET active_job=%s',(uuid.uuid4(),));self.rejected()
 def test_client_cannot_configure_allowlist(self):
  session(self.c,103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("UPDATE sa_domain.runtime_state SET test_actor_ids=ARRAY[auth.uid()]")
 def test_helper_private_for_all_api_roles(self):
  for role in ['anon','authenticated','sa_app','service_role']:
   self.assertFalse(self.c.execute("SELECT has_function_privilege(%s,'sa_domain.rehearsal_actor_allowed(uuid)','execute')",(role,)).fetchone()[0])
 def test_user_metadata_cannot_enroll_actor(self):
  self.c.execute("UPDATE auth.users SET raw_user_meta_data=%s WHERE id=%s",(Jsonb({'allow_test_writes':True,'test_actor_ids':[str(uid(203))]}),uid(203)));self.rejected(203)
 def test_allowlist_rejects_null_members(self):
  with self.assertRaises(psycopg.errors.CheckViolation):self.c.execute('UPDATE sa_domain.runtime_state SET test_actor_ids=ARRAY[NULL]::uuid[]')
 def test_allowlist_is_bounded(self):
  with self.assertRaises(psycopg.errors.CheckViolation):self.c.execute('UPDATE sa_domain.runtime_state SET test_actor_ids=%s',([uuid.uuid4() for _ in range(33)],))
 def test_auth_fence_uses_target_identity(self):
  self.c.execute("UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=%s",(uid(103),))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.c.execute("UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=%s",(uid(203),))
 def test_regular_auth_timestamp_does_not_require_rehearsal(self):
  self.c.execute('UPDATE auth.users SET updated_at=clock_timestamp() WHERE id=%s',(uid(203),))
 def test_media_reservation_scoped_to_actor(self):
  session(self.c,103);target={'resource':'users','record_id':'103','field':'profile_image'}
  version=self.c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb([target]),)).fetchone()[0]['references'][0]['version']
  result=self.c.execute('SELECT canto_api.account_upload_reserve(%s,%s,%s,%s)',(Jsonb(target),Jsonb({'filename':'test.png','bytes':'10','content_type':'image/png'}),version,uuid.uuid4())).fetchone()[0]
  self.assertIn('upload_id',result)
  self.c.execute('RESET ROLE');session(self.c,203);target['record_id']='203'
  version=self.c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb([target]),)).fetchone()[0]['references'][0]['version']
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.c.execute('SELECT canto_api.account_upload_reserve(%s,%s,%s,%s)',(Jsonb(target),Jsonb({'filename':'test.png','bytes':'10','content_type':'image/png'}),version,uuid.uuid4()))
 def test_job_consumer_remains_paused(self):
  self.write();self.c.execute('RESET ROLE');self.c.execute("SET LOCAL ROLE service_role");self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
  result=self.c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0];self.assertEqual(result['jobs'],[]);self.assertTrue(result['paused'])

if __name__=='__main__':unittest.main(verbosity=2)
