"""Local synthetic exact staff lifecycle; no Auth HTTP or hosted calls."""
import copy,unittest,uuid
from psycopg.types.json import Jsonb
from local_db import connect
import tracker_read_fixture as fixture
class TrackerReadFixture(unittest.TestCase):
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute("UPDATE sa_sync.environment_state SET environment='staging',cutover=false,active_job=NULL,synced_revision=edit_revision");self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def create(self,bind=True):
  state=fixture.plan(self.c)
  for a in state['actors']:
   id=uuid.uuid4();self.c.execute("INSERT INTO auth.users(id,role,email,encrypted_password,raw_user_meta_data,raw_app_meta_data,created_at) VALUES(%s,'authenticated',%s,'fixture-hash',%s,%s,clock_timestamp())",(id,a['email'],Jsonb({'tracker_read_run':state['run_id'],'full_name':a['name']}),Jsonb({'tracker_read_run':state['run_id']})));self.c.execute("INSERT INTO public.profiles(id,role) VALUES(%s,'viewer')",(id,))
   if bind:fixture.bind(self.c,state,a,id)
  return state
 def test_two_exact_identities_normal_sessions_cleanup_idempotent(self):
  foreign=uuid.uuid4();self.c.execute("INSERT INTO auth.users(id,role,email)VALUES(%s,'authenticated','foreign-tracker@example.invalid')",(foreign,));self.c.execute("INSERT INTO public.profiles(id,role)VALUES(%s,'admin')",(foreign,));before=fixture.unrelated(self.c,[]);state=self.create()
  for a in state['actors']:
   session=uuid.uuid4();self.c.execute('INSERT INTO auth.sessions(id,user_id)VALUES(%s,%s)',(session,a['id']));self.c.execute('INSERT INTO auth.refresh_tokens(user_id,session_id)VALUES(%s,%s)',(a['id'],session))
  result=fixture.cleanup(self.c,state);self.assertEqual(result['removed_owned_auth'],2);self.assertEqual(fixture.unrelated(self.c,[]),before);self.assertEqual(fixture.cleanup(self.c,state)['removed_owned_auth'],0)
 def test_unknown_create_response_recovers_exact_run_metadata_only(self):
  state=self.create(False);self.assertEqual(fixture.cleanup(self.c,state)['removed_owned_auth'],2)
 def test_credential_or_profile_change_refuses_cleanup(self):
  state=self.create();self.c.execute("UPDATE public.profiles SET role='viewer' WHERE id=%s",(state['actors'][0]['id'],))
  with self.assertRaisesRegex(AssertionError,'profile changed'),self.c.transaction():fixture.cleanup(self.c,state)
  self.assertEqual(self.c.execute('SELECT count(*) FROM auth.users WHERE id=ANY(%s::uuid[])',([a['id'] for a in state['actors']],)).fetchone()[0],2)
 def test_unrelated_dependent_row_refuses_even_with_cascade(self):
  state=self.create();self.c.execute('CREATE TABLE public.tracker_fixture_foreign_reference(id uuid PRIMARY KEY,owner_id uuid REFERENCES auth.users ON DELETE CASCADE)');self.c.execute('INSERT INTO public.tracker_fixture_foreign_reference VALUES(%s,%s)',(uuid.uuid4(),state['actors'][0]['id']))
  with self.assertRaisesRegex(AssertionError,'Unexpected row references'),self.c.transaction():fixture.cleanup(self.c,state)
 def test_changed_uuid_or_run_marker_rejected(self):
  state=self.create();wrong=copy.deepcopy(state);wrong['actors'][0]['id']=str(uuid.uuid4())
  with self.assertRaisesRegex(AssertionError,'UUID changed'),self.c.transaction():fixture.cleanup(self.c,wrong)
  self.c.execute("UPDATE auth.users SET raw_user_meta_data='{}' WHERE id=%s",(state['actors'][0]['id'],))
  with self.assertRaisesRegex(AssertionError,'metadata changed'),self.c.transaction():fixture.cleanup(self.c,state)
 def test_foreign_account_changes_are_preserved_not_reverted(self):
  foreign=uuid.uuid4();self.c.execute("INSERT INTO auth.users(id,role,email)VALUES(%s,'authenticated','foreign-live@example.invalid')",(foreign,));state=self.create();self.c.execute("UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=%s",(foreign,));before=self.c.execute('SELECT to_jsonb(u) FROM auth.users u WHERE id=%s',(foreign,)).fetchone()[0];fixture.cleanup(self.c,state);self.assertEqual(self.c.execute('SELECT to_jsonb(u) FROM auth.users u WHERE id=%s',(foreign,)).fetchone()[0],before)
 def test_own_password_change_refuses_cleanup(self):
  state=self.create();self.c.execute("UPDATE auth.users SET encrypted_password='foreign-change' WHERE id=%s",(state['actors'][0]['id'],))
  with self.assertRaisesRegex(AssertionError,'credential'),self.c.transaction():fixture.cleanup(self.c,state)
 def test_binding_transaction_rollback_recovery(self):
  state=self.create(False)
  try:
   with self.c.transaction():
    a=state['actors'][0];id=self.c.execute('SELECT id FROM auth.users WHERE email=%s',(a['email'],)).fetchone()[0];fixture.bind(self.c,state,a,id)
    raise ValueError('simulated lost commit')
  except ValueError:pass
  self.assertEqual(fixture.cleanup(self.c,state)['removed_owned_auth'],2)
 def test_foreign_allowlist_preserved_and_owned_change_denied(self):
  state=self.create();self.c.execute("INSERT INTO public.admin_emails(email)VALUES('unrelated-admin@example.invalid')")
  self.c.execute('DELETE FROM public.admin_emails WHERE email=%s',(state['actors'][0]['email'],))
  with self.assertRaisesRegex(AssertionError,'allowlist changed'),self.c.transaction():fixture.cleanup(self.c,state)
  self.assertTrue(self.c.execute("SELECT 1 FROM public.admin_emails WHERE email='unrelated-admin@example.invalid'").fetchone())
 def test_foreign_refresh_token_session_reference_refuses(self):
  state=self.create();foreign=uuid.uuid4();self.c.execute("INSERT INTO auth.users(id,role,email)VALUES(%s,'authenticated','foreign-session@example.invalid')",(foreign,));session=uuid.uuid4();self.c.execute('INSERT INTO auth.sessions(id,user_id)VALUES(%s,%s)',(session,state['actors'][0]['id']));self.c.execute('INSERT INTO auth.refresh_tokens(user_id,session_id)VALUES(%s,%s)',(str(foreign),session))
  with self.assertRaisesRegex(AssertionError,'Foreign refresh token'),self.c.transaction():fixture.cleanup(self.c,state)
 def test_source_revision_change_is_not_restored(self):
  state=self.create();self.c.execute('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1');result=fixture.cleanup(self.c,state)
  self.assertFalse(result['business_revision_unchanged']);self.assertEqual(fixture.environment(self.c)[3],state['environment_before'][3]+1)
 def test_trusted_marker_missing_refuses_user_metadata_claim(self):
  state=self.create(False);self.c.execute("UPDATE auth.users SET raw_app_meta_data='{}' WHERE email=%s",(state['actors'][0]['email'],))
  with self.assertRaisesRegex(AssertionError,'trusted run marker'),self.c.transaction():fixture.cleanup(self.c,state)
if __name__=='__main__':unittest.main(verbosity=2)
