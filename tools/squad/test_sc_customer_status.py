"""The reachable SC customer login control never grants staff or foreign access."""
import unittest,uuid
import psycopg
from local_db import connect
from fixtures import seed_orders,session,uid,sid
from sqlstate_assertions import assert_app_conflict

class ScCustomerStatus(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_sync.environment_state SET cutover=true');self.actor_id=101;session(self.c,101)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.c.execute('RESET ROLE');self.actor_id=n;session(self.c,n)
 def raw(self,sql,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(sql,args);result=r.fetchall() if r.description else None;session(self.c,self.actor_id);return result
 def version(self):return self.raw("SELECT sa_domain.version('person',103)")[0][0]
 def status(self,target=103,action='disable',version=None,key=None):return self.c.execute('SELECT canto_api.account_user_status(%s,%s,%s,%s,%s)',(target,action,'SC customer review',version or self.version(),key or uuid.uuid4())).fetchone()[0]
 def test_sc_disable_revokes_all_sessions_and_refresh_immediately(self):
  self.raw('INSERT INTO auth.refresh_tokens(user_id,session_id) VALUES(%s,%s)',(str(uid(103)),sid(103)));r=self.status();self.assertEqual(r['state'],'disabled')
  self.assertEqual(self.raw('SELECT count(*) FROM auth.sessions WHERE user_id=%s',(uid(103),)),[(0,)]);self.assertEqual(self.raw('SELECT count(*) FROM auth.refresh_tokens WHERE user_id=%s',(str(uid(103)),)),[(0,)])
  self.actor(103)
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.c.execute('SELECT canto_api.v1_me()')
 def test_reenable_does_not_revive_old_sessions(self):
  r=self.status();r=self.status(action='enable',version=r['version']);self.assertEqual(r['state'],'enabled');self.assertEqual(self.raw('SELECT count(*) FROM auth.sessions WHERE user_id=%s',(uid(103),)),[(0,)])
 def test_no_foreign_dealer_staff_self_or_archive_authority(self):
  for target,action in [(203,'disable'),(110,'disable'),(102,'disable'),(101,'disable'),(100,'disable'),(103,'archive')]:
   with self.subTest(target=target,action=action),self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.status(target,action)
 def test_stale_version_does_not_revoke_sessions(self):
  with assert_app_conflict(self),self.c.transaction():self.status(version='0:999')
  self.assertEqual(self.raw('SELECT count(*) FROM auth.sessions WHERE user_id=%s',(uid(103),)),[(1,)])
 def test_retry_is_exact_and_records_sc_actor(self):
  version=self.version();key=uuid.uuid4();r=self.status(version=version,key=key);self.assertEqual(self.status(version=version,key=key),r)
  self.assertEqual(self.raw("SELECT legacy_user_id,count(*) FROM sa_domain.audit WHERE command_key=%s GROUP BY legacy_user_id",(key,)),[(101,1)])
 def test_changed_relationship_revokes_authority_even_for_retry(self):
  version=self.version();key=uuid.uuid4();self.status(version=version,key=key);self.raw('UPDATE sa_snapshot_20261019.sa_users SET created_by_id=201 WHERE id=103')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.status(version=version,key=key)
 def test_mirror_remains_fenced(self):
  self.raw('UPDATE sa_sync.environment_state SET cutover=false')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.status()
 def test_reconciliation_worker_receives_exact_disabled_customer(self):
  self.status();self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
  jobs=self.c.execute('SELECT canto_api.squad_job_claim(5)').fetchone()[0]['jobs'];j=next(x for x in jobs if x['handler']=='account_reconciliation')
  result=self.c.execute('SELECT canto_api.squad_account_prepare(%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']))).fetchone()[0]
  self.assertEqual(result['auth_user_id'],str(uid(103)));self.assertFalse(result['allowed'])

if __name__=='__main__':unittest.main(verbosity=2)
