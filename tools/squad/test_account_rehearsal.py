"""Exact mirror-account capability, real account SQL, and immutable ownership receipts."""
import json,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed_orders,uid,sid,session
from test_account_flows import AccountFlows

class AccountRehearsal(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 service=AccountFlows.service
 constraints=AccountFlows.constraints
 request=AccountFlows.request
 profile=AccountFlows.profile
 prepare=AccountFlows.prepare
 finish=AccountFlows.finish
 provider=AccountFlows.provider
 raw=AccountFlows.raw
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.flow_purposes={};self.run=uuid.uuid4();self.ids={};self.flows={k:uuid.uuid4() for k in ['register','confirm','recovery','invite']}
  self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,test_write_expires_at=clock_timestamp()+interval '15 minutes'",([uid(n) for n in range(81000,81004)],))
  self.c.execute('UPDATE sa_sync.environment_state SET cutover=false')
  for n,kind in enumerate(['admin','confirm','recovery','invite'],81000):
   email=self.email(kind);self.ids[kind]=n
   self.c.execute("INSERT INTO sa_snapshot_20261019.sa_users(id,name,email,role,approved,onboarded,confirmed_at,created_at,updated_at) VALUES(%s,%s,%s,%s,true,true,CASE WHEN %s THEN NULL ELSE now() END,now(),now())",(n,'SQG '+self.run.hex+' '+kind,email,0 if kind=='admin' else 3,kind in ['confirm','invite']))
   self.c.execute('INSERT INTO sa_sync.legacy_identity_keys VALUES(%s)',(n,))
   self.c.execute("INSERT INTO sa_identity.sa_auth_identities(auth_user_id,legacy_user_id,canonical_email,import_disposition,enrollment_state,source_was_confirmed,confirmation_basis) VALUES(%s,%s,%s,'candidate','ready',%s,%s)",(uid(n),n,email,kind not in ['confirm','invite'],'not_activated' if kind in ['confirm','invite'] else 'source_confirmed'))
   self.c.execute("INSERT INTO auth.users(id,role,email) VALUES(%s,'sa_app',%s)",(uid(n),email))
   self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(sid(n),uid(n)))
  for kind in self.flows:self.register(kind)
  self.service()
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def email(self,kind):return f'squad-guest-{self.run.hex}-{kind}@mailinator.com'
 def register(self,kind,**changes):
  p={'flow_id':self.flows[kind],'run_id':self.run,'purpose':kind,'email':self.email(kind),'actor_id':uid(81000),'legacy_user_id':None if kind=='register' else self.ids[kind],'auth_user_id':None if kind=='register' else uid(self.ids[kind]),'payload':self.profile() if kind=='register' else {}}
  p.update(changes)
  return self.c.execute("""INSERT INTO sa_domain.account_rehearsals(flow_id,run_id,purpose,email,actor_id,legacy_user_id,auth_user_id,generation,payload_hash,expires_at)
   SELECT %s,%s,%s,%s,%s,%s,%s,generation,encode(sha256(convert_to(%s::jsonb::text,'UTF8')),'hex'),test_write_expires_at FROM sa_domain.runtime_state""",tuple(p[x] for x in ['flow_id','run_id','purpose','email','actor_id','legacy_user_id','auth_user_id'])+(Jsonb(p['payload']),))
 def start(self,kind):
  grant=None
  if kind=='invite':
   self.c.execute('RESET ROLE');session(self.c,81000)
   grant=uuid.UUID(self.c.execute('SELECT canto_api.account_invitation_authorize(%s)',(self.ids[kind],)).fetchone()[0]['grant']);self.service()
  return self.request(kind,self.email(kind),self.profile() if kind=='register' else {},id=self.flows[kind],grant=grant)
 def begin(self,kind):
  self.start(kind);return self.prepare(str(self.flows[kind]),email=self.email(kind))
 def test_four_flows_use_existing_logic_and_retain_exact_revision_receipts(self):
  for kind in self.flows:
   with self.subTest(kind=kind):
    ticket=self.begin(kind);self.provider(ticket,create=kind=='register');result=self.finish(ticket)
    self.assertTrue(result['completed']);self.assertEqual(result['next'],'await_approval' if kind=='register' else 'sign_in')
    self.assertEqual(self.prepare(str(self.flows[kind]),email=self.email(kind)),{'replayed':True,'result':result})
  self.c.execute('RESET ROLE')
  delta=self.c.execute('SELECT sum(revision_after-revision_before) FROM sa_domain.account_rehearsal_receipts').fetchone()[0]
  actual=self.c.execute('SELECT edit_revision FROM sa_sync.environment_state').fetchone()[0]
  self.assertEqual(delta,actual)
  self.assertEqual(self.c.execute("SELECT count(*) FROM sa_domain.audit WHERE operation LIKE 'account.%_completed'").fetchone()[0],4)
  self.assertFalse(self.c.execute('SELECT cutover FROM sa_sync.environment_state').fetchone()[0])
 def test_unregistered_foreign_purpose_recipient_profile_and_invitation_are_refused(self):
  for invoke in [lambda:self.request(email='persona-103@squad.invalid'),
   lambda:self.request('recovery',self.email('confirm'),id=self.flows['confirm']),
   lambda:self.request('confirm','persona-103@squad.invalid',id=self.flows['confirm']),
   lambda:self.request('register',self.email('register'),dict(self.profile(),first_name='Altered'),id=self.flows['register']),
   lambda:self.request('invite',self.email('invite'),id=self.flows['invite'],grant=uuid.uuid4())]:
   with self.assertRaises(psycopg.Error),self.c.transaction():invoke()
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.account_flows'),[(0,)])
 def test_capabilities_cannot_be_inserted_or_receipts_changed_by_api_roles(self):
  for role in ['anon','authenticated','sa_app','service_role']:
   self.c.execute('RESET ROLE');self.c.execute('SET LOCAL ROLE '+role)
   for query in ["UPDATE sa_domain.account_rehearsals SET expires_at=now()+interval '1 day'",'DELETE FROM sa_domain.account_rehearsal_receipts',"SELECT sa_domain.account_rehearsal_record('00000000-0000-0000-0000-000000000000','finish',0)"]:
    with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.c.execute(query)
  self.c.execute('RESET ROLE')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.c.execute('UPDATE sa_domain.account_rehearsals SET generation=generation')
 def test_expired_generation_production_and_disabled_rehearsal_fail_closed(self):
  for query in ['UPDATE sa_domain.runtime_state SET generation=generation+1',"UPDATE sa_domain.runtime_state SET test_write_expires_at=now()-interval '1 second'",'UPDATE sa_domain.runtime_state SET allow_test_writes=false',"UPDATE sa_sync.environment_state SET environment='production'"]:
   with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState),self.c.transaction():
    self.c.execute('RESET ROLE');self.c.execute(query);self.service();self.start('recovery')
 def test_unowned_source_mutation_cannot_be_hidden_by_next_flow_receipt(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_users SET name='external' WHERE id=81002")
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.start('recovery')
 def test_exact_mail_claim_does_not_drain_queue_or_retry_uncertain_delivery(self):
  self.start('recovery');job=self.raw("SELECT id FROM sa_domain.outbox WHERE command_key=%s",(self.flows['recovery'],))[0][0]
  result=self.c.execute('SELECT canto_api.squad_account_rehearsal_claim(%s)',(job,)).fetchone()[0]
  self.assertEqual(result['recipient'],self.email('recovery'));self.assertEqual(len(result['jobs']),1)
  lease=uuid.UUID(result['jobs'][0]['lease_token'])
  message=self.c.execute('SELECT canto_api.squad_account_mail_prepare(%s,%s)',(job,lease)).fetchone()[0]
  self.assertEqual(message['flow_id'],str(self.flows['recovery']))
  outcome=self.c.execute("SELECT canto_api.squad_account_mail_finish(%s,%s,false,'PROVIDER_UNAVAILABLE')",(job,lease)).fetchone()[0]
  self.assertEqual(outcome['state'],'pending')
  # Time advance is an independent write and must itself fail provenance.
  self.raw("UPDATE sa_domain.outbox SET available_at=now()-interval '1 minute' WHERE id=%s",(job,))
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.squad_account_rehearsal_claim(%s)',(job,))
 def test_unmarked_ban_cannot_be_blessed_as_provider_receipt(self):
  ticket=self.begin('recovery');self.c.execute('RESET ROLE')
  before=self.c.execute('SELECT count(*) FROM sa_domain.account_rehearsal_receipts').fetchone()[0]
  self.c.execute("UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=%s",(ticket['auth_user_id'],))
  self.c.execute('SET CONSTRAINTS ALL IMMEDIATE');self.c.execute('SET CONSTRAINTS ALL DEFERRED')
  self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.account_rehearsal_receipts').fetchone()[0],before)
  self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.account_rehearsal_auth_pending').fetchone()[0],0)
  self.service()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.finish(ticket)
 def test_foreign_metadata_between_prepare_and_provider_is_not_blessed(self):
  ticket=self.begin('recovery');self.c.execute('RESET ROLE')
  self.c.execute("UPDATE auth.users SET raw_app_meta_data='{\"unowned\":true}' WHERE id=%s",(ticket['auth_user_id'],))
  self.c.execute('SET CONSTRAINTS ALL IMMEDIATE');self.c.execute('SET CONSTRAINTS ALL DEFERRED');self.service()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.provider(ticket)
 def test_unknown_mail_job_and_generic_queue_stay_closed(self):
  self.start('recovery')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState),self.c.transaction():self.c.execute('SELECT canto_api.squad_account_rehearsal_claim(%s)',(uuid.uuid4(),))
  self.assertEqual(self.c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0]['jobs'],[])
 def test_new_registration_auth_exception_is_only_prepared_exact_uuid(self):
  ticket=self.begin('register');self.c.execute('RESET ROLE')
  self.assertTrue(self.c.execute('SELECT sa_domain.account_rehearsal_auth_allowed(%s)',(ticket['auth_user_id'],)).fetchone()[0])
  self.assertFalse(self.c.execute('SELECT sa_domain.account_rehearsal_auth_allowed(%s)',(uid(103),)).fetchone()[0])
  for query in ["UPDATE sa_domain.account_flows SET lease_until=now()-interval '1 second' WHERE id=%s",'UPDATE sa_domain.account_flows SET generation=generation+1 WHERE id=%s']:
   with self.c.transaction():
    self.c.execute(query,(self.flows['register'],));self.assertFalse(self.c.execute('SELECT sa_domain.account_rehearsal_auth_allowed(%s)',(ticket['auth_user_id'],)).fetchone()[0]);raise psycopg.Rollback()
  with self.c.transaction():
   self.c.execute('DELETE FROM sa_domain.credential_states WHERE legacy_user_id=%s',(ticket['legacy_user_id'],))
   self.assertIs(self.c.execute('SELECT sa_domain.account_rehearsal_auth_allowed(%s)',(ticket['auth_user_id'],)).fetchone()[0],False)
   raise psycopg.Rollback()
  self.service();self.provider(ticket,True);self.finish(ticket);self.c.execute('RESET ROLE')
  self.assertFalse(self.c.execute('SELECT sa_domain.account_rehearsal_auth_allowed(%s)',(ticket['auth_user_id'],)).fetchone()[0])

if __name__=='__main__':unittest.main(verbosity=2)
