from sqlstate_assertions import assert_app_conflict, is_app_conflict
import unittest,uuid,json
import psycopg
from psycopg.types.json import Jsonb
from fixtures import seed_orders,session,uid,sid,claims
from local_db import connect
class Accounts(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_sync.environment_state SET cutover=true');self.actor=100;session(self.c,100)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor_as(self,n):self.actor=n;self.c.execute('RESET ROLE');session(self.c,n,'authenticated' if n==999 else 'sa_app')
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);rows=r.fetchall() if r.description else None;self.actor_as(self.actor);return rows
 def version(self,id):return self.raw("SELECT sa_domain.version('person',%s)",(id,))[0][0]
 def status(self,id=103,action='disable',version=None,key=None):return self.c.execute('SELECT canto_api.account_user_status(%s,%s,%s,%s,%s)',(id,action,'Controlled access review',version or self.version(id),key or uuid.uuid4())).fetchone()[0]
 def worker(self):self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
 def claim(self):self.worker();return self.c.execute('SELECT canto_api.squad_job_claim(5)').fetchone()[0]['jobs']
 def prepare(self,j):return self.c.execute('SELECT canto_api.squad_account_prepare(%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']))).fetchone()[0]
 def finish(self,j,target,exists=True,error=None):
  payload={'auth_user_id':target.get('auth_user_id'),'exists':exists,'confirmed':True} if not target.get('superseded') else {'superseded':True}
  return self.c.execute('SELECT canto_api.squad_account_finish(%s,%s,%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']),Jsonb(payload),error)).fetchone()[0]
 def create(self,role=12):return self.c.execute('SELECT canto_api.v1_person_save(NULL,%s,%s,NULL,%s)',(role,Jsonb({'name':'New account','email':uuid.uuid4().hex+'@squad.invalid'}),uuid.uuid4())).fetchone()[0]
 def test_disable_revokes_sessions_and_refresh_tokens_atomically(self):
  self.raw('INSERT INTO auth.refresh_tokens(user_id,session_id) VALUES(%s,%s)',(str(uid(103)),sid(103)));self.status();self.assertEqual(self.raw('SELECT count(*) FROM auth.sessions WHERE user_id=%s',(uid(103),)),[(0,)]);self.assertEqual(self.raw('SELECT count(*) FROM auth.refresh_tokens WHERE user_id=%s',(str(uid(103)),)),[(0,)]);self.actor_as(103)
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.c.execute('SELECT canto_api.v1_me()')
 def test_reenable_does_not_revive_an_old_session(self):
  self.status();self.status(action='enable');self.actor_as(103)
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.c.execute('SELECT canto_api.v1_me()')
 def test_status_idempotency_replays_without_extra_revocation_or_version(self):
  key=uuid.uuid4();v=self.version(103);first=self.status(version=v,key=key);self.assertEqual(first,self.status(version=v,key=key));self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='account.status_changed'"),[(1,)])
 def test_old_version_cannot_revoke_current_sessions(self):
  with self.c.transaction():
   try:self.status(version='0:99')
   except psycopg.DatabaseError as error:
    if not is_app_conflict(error):raise
    raise psycopg.Rollback()
   else:self.fail('Stale version allowed')
  self.assertEqual(self.raw('SELECT count(*) FROM auth.sessions WHERE user_id=%s',(uid(103),)),[(1,)])
 def test_customer_and_unrelated_coordinator_cannot_change_login_status(self):
  for actor in (201,103,104,110,112):
   with self.subTest(actor=actor),self.c.transaction():
    self.actor_as(actor)
    try:self.status()
    except psycopg.errors.InsufficientPrivilege:raise psycopg.Rollback()
    else:self.fail('Nonadmin status allowed')
 def test_platform_staff_use_their_existing_identity(self):
  self.actor_as(999);self.assertEqual(self.status()['state'],'disabled');self.assertEqual(self.raw("SELECT actor_id,legacy_user_id FROM sa_domain.audit WHERE operation='account.status_changed'"),[(uid(999),None)])
 def test_platform_account_changes_remain_mirror_fenced(self):
  self.raw('UPDATE sa_sync.environment_state SET cutover=false');self.actor_as(999)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.status()
 def test_admin_accounts_are_protected(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.status(200)
 def test_archive_checks_active_work_dependencies(self):
  self.actor_as(999)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.status(action='archive')
 def test_client_cannot_call_auth_revocation_bridge(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT sa_domain.revoke_account_sessions(103)')
 def test_forged_user_claim_cannot_call_account_worker(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.squad_account_prepare(%s,%s)',(uuid.uuid4(),uuid.uuid4()))
 def test_worker_reconciles_existing_reserved_identity(self):
  self.status();j=self.claim()[0];self.assertEqual(j['handler'],'account_reconciliation');t=self.prepare(j);self.assertEqual(t['auth_user_id'],str(uid(103)));self.assertFalse(t['allowed']);r=self.finish(j,t);self.assertEqual(r['state'],'done');self.assertEqual(self.raw('SELECT state FROM sa_domain.account_requests WHERE legacy_user_id=103'),[('blocked',)]);self.worker();self.assertEqual(self.finish(j,t)['state'],'done')
 def test_new_account_uuid_is_reserved_before_provider_creation(self):
  r=self.create();j=self.claim()[0];t=self.prepare(j);self.assertTrue(t['allowed']);self.assertEqual(t['legacy_user_id'],r['id']);self.assertFalse(t['source_confirmed']);self.assertIsNone(t['password_hash']);self.assertEqual(self.prepare(j)['auth_user_id'],t['auth_user_id']);self.assertEqual(self.raw('SELECT count(*) FROM auth.users WHERE id=%s',(uuid.UUID(t['auth_user_id']),)),[(0,)])
 def test_new_unapproved_customer_is_blocked_without_creating_auth(self):
  self.create(3);j=self.claim()[0];t=self.prepare(j);self.assertFalse(t['allowed']);self.assertEqual(self.finish(j,t,False)['state'],'done')
 def test_provider_failure_is_bounded_retry_not_false_success(self):
  self.create();j=self.claim()[0];t=self.prepare(j);self.assertEqual(self.finish(j,t,False,'PROVIDER_UNAVAILABLE')['state'],'pending');self.assertEqual(self.raw('SELECT state,error_code FROM sa_domain.account_requests'),[('queued','PROVIDER_UNAVAILABLE')])
 def test_identity_conflict_is_permanent_not_retried(self):
  self.create();j=self.claim()[0];t=self.prepare(j);self.assertEqual(self.finish(j,t,False,'IDENTITY_CONFLICT')['state'],'dead')
 def test_expired_lease_cannot_prepare(self):
  self.create();j=self.claim()[0];self.raw("UPDATE sa_domain.outbox SET lease_until=now()-interval '1 second'");self.worker()
  with assert_app_conflict(self):self.prepare(j)
 def test_refresh_generation_invalidates_lease(self):
  self.create();j=self.claim()[0];self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1');self.worker()
  with assert_app_conflict(self):self.prepare(j)
 def test_newer_command_supersedes_an_older_pending_account_job(self):
  self.status();self.status(action='enable');jobs=self.claim();t=self.prepare(jobs[0]);self.assertTrue(t['superseded']);self.assertEqual(self.finish(jobs[0],t)['state'],'done');latest=self.prepare(jobs[1]);self.assertTrue(latest['allowed'])
 def test_source_change_during_provider_call_requires_reconciliation(self):
  self.create();j=self.claim()[0];t=self.prepare(j);self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=%s',(int(t['legacy_user_id']),));self.worker();self.assertEqual(self.finish(j,t)['state'],'pending');self.assertEqual(self.raw('SELECT error_code FROM sa_domain.account_requests'),[('ACCOUNT_SOURCE_CHANGED',)])
 def test_session_revoke_cannot_be_rolled_back_to_a_live_session_by_unapproval(self):
  self.c.execute('SELECT canto_api.v1_customer_review(103,%s,%s,%s,%s)',(Jsonb({'approved':False}),'Review approval',self.version(103),uuid.uuid4()));self.assertEqual(self.raw('SELECT count(*) FROM auth.sessions WHERE user_id=%s',(uid(103),)),[(0,)])
 def test_older_provider_response_requeues_a_newer_completed_intent(self):
  self.status();old=self.claim()[0];oldtarget=self.prepare(old);self.actor_as(100);self.status(action='enable');new=self.claim()[0];newtarget=self.prepare(new);self.finish(new,newtarget);self.finish(old,oldtarget)
  self.assertEqual(self.raw('SELECT state,desired FROM sa_domain.account_requests WHERE legacy_user_id=103'),[('queued',None)])
  self.assertEqual(self.raw('SELECT status FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(new['id']),)),[('pending',)])
 def test_older_provider_response_invalidates_newer_inflight_attestation(self):
  self.status();old=self.claim()[0];oldtarget=self.prepare(old);self.actor_as(100);self.status(action='enable');new=self.claim()[0];newtarget=self.prepare(new);self.finish(old,oldtarget)
  self.assertEqual(self.finish(new,newtarget)['state'],'pending')
  self.assertEqual(self.raw('SELECT error_code FROM sa_domain.account_requests WHERE legacy_user_id=103'),[('ACCOUNT_SOURCE_CHANGED',)])
 def test_platform_staff_can_read_account_jobs_but_not_customer_order_jobs(self):
  self.status();j=self.claim()[0];self.actor_as(999);self.assertEqual(self.c.execute('SELECT canto_api.v1_job_get(%s)',(uuid.UUID(j['id']),)).fetchone()[0]['handler'],'account_reconciliation')
 def test_account_writer_has_no_raw_auth_or_password_write_privileges(self):
  self.c.execute('RESET ROLE')
  for table in ['auth.users','auth.sessions','auth.refresh_tokens']:
   for privilege in ['SELECT','INSERT','UPDATE','DELETE']:self.assertFalse(self.c.execute('SELECT has_table_privilege(%s,%s,%s)',('sa_account_writer',table,privilege)).fetchone()[0])
  self.assertFalse(self.c.execute("SELECT has_column_privilege('sa_account_writer','sa_snapshot_20261019.sa_users','encrypted_password','UPDATE')").fetchone()[0])
 def test_revocation_bridge_requires_queued_intent_even_for_internal_writer(self):
  self.c.execute('RESET ROLE');self.c.execute('SET LOCAL ROLE sa_account_writer')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT sa_domain.revoke_account_sessions(103)')
 def test_worker_cannot_read_source_hash_without_live_matching_lease(self):
  self.worker()
  with assert_app_conflict(self):self.prepare({'id':str(uuid.uuid4()),'lease_token':str(uuid.uuid4())})
 def test_prepare_resets_full_provider_lease_budget(self):
  self.create();j=self.claim()[0];self.raw("UPDATE sa_domain.outbox SET lease_until=statement_timestamp()+interval '3 seconds' WHERE id=%s",(uuid.UUID(j['id']),));self.worker();self.prepare(j);self.assertGreater(self.raw('SELECT extract(epoch from lease_until-statement_timestamp()) FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(j['id']),))[0][0],80)

 def test_exhausted_account_lease_reports_failure_on_person(self):
  self.create();j=self.claim()[0];self.prepare(j);self.raw("UPDATE sa_domain.outbox SET attempts=5,lease_until=now()-interval '1 second' WHERE id=%s",(uuid.UUID(j['id']),));self.claim()
  self.assertEqual(self.raw('SELECT state,error_code FROM sa_domain.account_requests'),[('failed','LEASE_EXHAUSTED')])
 def test_unmapped_managed_subject_never_gets_an_auth_reservation(self):
  r=self.c.execute("SELECT canto_api.v1_tailor_save(NULL,%s,NULL,%s)",(Jsonb({'name':'Managed subject','manager_id':'104'}),uuid.uuid4())).fetchone()[0]
  self.status(int(r['id']),action='archive');j=self.claim()[0];t=self.prepare(j);self.assertTrue(t['managed_subject']);self.assertFalse(t['allowed']);self.assertIsNone(t['auth_user_id']);self.finish(j,t,False)
  self.assertEqual(self.raw('SELECT count(*) FROM sa_identity.sa_auth_identities WHERE legacy_user_id=%s',(int(r['id']),)),[(0,)])

if __name__=='__main__':unittest.main(verbosity=2)
