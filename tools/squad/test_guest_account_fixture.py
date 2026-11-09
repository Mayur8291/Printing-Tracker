"""End-to-end owned guest cleanup, including partial and unconfirmed outcomes."""
import copy,json,unittest,uuid
import psycopg
import guest_account_fixture as guest
import test_persona_harness as persona
from test_account_flows import AccountFlows

class GuestFixture(unittest.TestCase):
 setUpClass=classmethod(persona.PersonaHarness.setUpClass.__func__)
 tearDown=persona.PersonaHarness.tearDown
 service=AccountFlows.service
 constraints=AccountFlows.constraints
 request=AccountFlows.request
 prepare=AccountFlows.prepare
 provider=AccountFlows.provider
 finish=AccountFlows.finish
 raw=AccountFlows.raw
 def setUp(self):
  persona.PersonaHarness.setUp(self)
  self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")
  self.state=guest.plan(self.c);self.credentials=guest.prepare(self.c,self.state);self.flow_purposes={};self.service()
 def start(self,kind):
  f=self.state['flows'][kind];grant=None
  if kind=='invite':
   a=self.state['actors']['admin'];session=uuid.uuid4();self.c.execute('RESET ROLE')
   self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session,a['auth_id']))
   self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':a['auth_id'],'session_id':str(session),'role':'sa_app'}),));self.c.execute('SET LOCAL ROLE sa_app')
   grant=uuid.UUID(self.c.execute('SELECT canto_api.account_invitation_authorize(%s)',(self.state['actors'][kind]['id'],)).fetchone()[0]['grant']);self.service()
  self.request(kind,f['email'],self.state['profile'] if kind=='register' else {},id=uuid.UUID(f['id']),grant=grant)
  return self.prepare(f['id'],email=f['email'])
 def clean(self):self.c.execute('RESET ROLE');return guest.cleanup(self.c,self.state)
 def test_all_purposes_leave_retained_audits_and_monotonic_revision_after_cleanup(self):
  for kind in guest.KINDS:
   ticket=self.start(kind);self.provider(ticket,kind=='register');self.assertTrue(self.finish(ticket)['completed'])
  result=self.clean();self.assertEqual(result['completed_flows'],4);self.assertEqual(result['removed_auth_accounts'],5)
  self.assertEqual(result['edit_revision_after']-result['edit_revision_before'],result['owned_revision_delta'])
  self.assertTrue(result['audit_and_receipts_retained']);self.assertTrue(result['source_content_restored'])
  self.assertEqual(guest.cleanup(self.c,self.state),result)
  self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.account_rehearsal_revocations WHERE flow_id=ANY(%s::uuid[])',([f['id'] for f in self.state['flows'].values()],)).fetchone()[0],4)
 def test_fixture_only_no_requests_cleans_and_expired_caps_cannot_restart(self):
  self.c.execute('RESET ROLE');planned=copy.deepcopy(self.state)
  self.assertNotIn('setup_xid',planned);self.assertNotIn('admin_auth_hash',planned)
  result=guest.cleanup(self.c,planned);self.assertEqual(result['removed_auth_accounts'],4);self.assertEqual(result['owned_revision_delta'],0)
  self.service()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.start('register')
 def test_registration_before_auth_provider_can_be_cleaned_without_guessing_ids(self):
  ticket=self.start('register');self.assertIsNotNone(ticket['legacy_user_id'])
  result=self.clean();self.assertEqual(result['completed_flows'],0);self.assertEqual(result['removed_source_people'],5)
  self.assertEqual(result['owned_revision_delta'],1)
 def test_provider_commit_without_finish_is_owned_and_cleanup_retains_receipt(self):
  ticket=self.start('recovery');self.provider(ticket)
  result=self.clean();self.assertEqual(result['completed_flows'],0);self.assertEqual(result['owned_revision_delta'],1)
 def test_selected_recovery_invitation_cleanup_removes_all_allocated_fixture_accounts(self):
  from guest_flow_selection import checkpoint_selection,completed_selection
  self.state['requested_flows']=['recovery','invite'];results=[]
  for kind in checkpoint_selection(self.state):
   ticket=self.start(kind);self.provider(ticket);self.assertTrue(self.finish(ticket)['completed'])
   results.append({'kind':kind,'requestId':self.state['flows'][kind]['id']})
  self.assertFalse(completed_selection(self.state,results)['all_flows_passed'])
  result=self.clean();self.assertEqual(result['completed_flows'],2)
  self.assertEqual(result['removed_auth_accounts'],4);self.assertEqual(result['removed_source_people'],4)
  self.assertTrue(result['source_content_restored']);self.assertTrue(result['audit_and_receipts_retained'])
  self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.account_rehearsal_revocations WHERE flow_id=ANY(%s::uuid[])',([f['id']for f in self.state['flows'].values()],)).fetchone()[0],4)
  self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.account_flows WHERE id=ANY(%s::uuid[])',([self.state['flows'][k]['id']for k in ['register','confirm']],)).fetchone()[0],0)
 def test_unknown_revision_source_edit_and_credential_change_each_refuse_cleanup(self):
  self.start('recovery');self.c.execute('RESET ROLE')
  for query,args in [('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1',()),("UPDATE sa_snapshot_20261019.sa_users SET name='other writer' WHERE id=%s",(self.state['actors']['recovery']['id'],)),("UPDATE auth.users SET raw_app_meta_data='{}' WHERE id=%s",(self.state['actors']['recovery']['auth_id'],))]:
   with self.assertRaises(AssertionError),self.c.transaction():self.c.execute(query,args);guest.cleanup(self.c,self.state)
 def test_unowned_child_and_public_structure_change_are_not_deleted(self):
  ticket=self.start('register');self.c.execute('RESET ROLE')
  with self.assertRaises(AssertionError),self.c.transaction():
   self.c.execute("INSERT INTO sa_snapshot_20261019.sa_addresses(user_id,address,created_at,updated_at) VALUES(%s,'Unowned child',now(),now())",(ticket['legacy_user_id'],));guest.cleanup(self.c,self.state)
  with self.assertRaises(AssertionError),self.c.transaction():
   self.c.execute('CREATE TABLE public.unrelated_new_table(id integer)');guest.cleanup(self.c,self.state)
 def test_registration_uses_real_pinned_location_with_no_existing_relationships(self):
  address=self.state['profile']['addresses'][0]
  self.assertIn((address['state'],address['city']),guest.canonical_locations())
  self.c.execute('RESET ROLE');guest.assert_unused_location(self.c,address)
  altered=copy.deepcopy(self.state);altered['profile']['addresses'][0]['city']='Made up town'
  with self.assertRaises(AssertionError):guest.validate(altered)
 def test_location_choice_skips_existing_city_spelling_case_insensitively(self):
  self.c.execute('RESET ROLE');first=guest.unused_location(self.c)
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_cities(name,zone_id,created_at,updated_at) VALUES(%s,(SELECT id FROM sa_snapshot_20261019.sa_zones ORDER BY id LIMIT 1),now(),now())",(' '+first['city'].upper()+' ',))
  second=guest.unused_location(self.c);self.assertNotEqual(second['city'].lower(),first['city'].lower())
  with self.assertRaises(AssertionError):guest.assert_unused_location(self.c,first)
 def test_checkpoint_cannot_redirect_run_email_or_owned_range(self):
  for key,value in [('environment','production'),('base',1),('run_id',str(uuid.uuid4()))]:
   altered=copy.deepcopy(self.state);altered[key]=value
   with self.assertRaises(AssertionError):guest.validate(altered)

if __name__=='__main__':unittest.main(verbosity=2)
