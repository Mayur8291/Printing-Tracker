"""Exact-owned real closure adds one Auth revision; cleanup cannot excuse other writes."""
import json,time,unittest,uuid
import test_hosted_business_journeys as business
import test_persona_harness as persona

class WebAccountCleanup(unittest.TestCase):
 setUpClass=classmethod(persona.PersonaHarness.setUpClass.__func__)
 setUp=persona.PersonaHarness.setUp
 tearDown=persona.PersonaHarness.tearDown
 def close_fixture(self):
  self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")
  state=business.plan(self.c);credentials=business.prepare(self.c,state)
  actor=next(a for a in credentials if a['role']==3);session=uuid.uuid4()
  self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session,actor['auth_id']))
  self.c.execute('INSERT INTO auth.refresh_tokens(user_id,session_id) VALUES(%s,%s)',(actor['auth_id'],session))
  self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':actor['auth_id'],'session_id':str(session),'amr':[{'method':'password','timestamp':int(time.time())}]}),))
  self.c.execute('SET LOCAL ROLE sa_app');me=self.c.execute('SELECT canto_api.v1_me()').fetchone()[0]
  label='web.account.selfclose';key=uuid.uuid5(uuid.UUID(state['run_id']),label)
  result=self.c.execute('SELECT canto_api.v1_account_close(%s,%s,%s)',(me['version'],key,'DELETE MY ACCOUNT')).fetchone()[0]
  self.assertEqual(result,self.c.execute('SELECT canto_api.v1_account_close(%s,%s,%s)',(me['version'],key,'DELETE MY ACCOUNT')).fetchone()[0])
  self.c.execute('RESET ROLE')
  entries=[{'kind':'command','value':{'label':label,'key':str(key)}}]
  self.assertEqual(self.c.execute('SELECT edit_revision FROM sa_sync.environment_state').fetchone()[0]-state['identity']['edit_revision'],2)
  self.assertEqual(self.c.execute("SELECT count(*) FROM sa_domain.audit WHERE actor_id=%s AND operation='account.closed'",(actor['auth_id'],)).fetchone()[0],1)
  return state,entries,actor
 def test_owned_closure_restores_source_and_accounts_for_exact_auth_revision(self):
  state,entries,actor=self.close_fixture()
  result=business.cleanup(self.c,state,journal_entries=entries)
  self.assertTrue(result['source_content_restored'])
  self.assertEqual(result['edit_revision_after']-result['edit_revision_before'],2)
  self.assertFalse(self.c.execute('SELECT 1 FROM auth.users WHERE id=%s',(actor['auth_id'],)).fetchone())
  self.assertEqual(business.cleanup(self.c,state,journal_entries=entries),result)
 def test_unexplained_extra_revision_is_rejected(self):
  state,entries,actor=self.close_fixture()
  self.c.execute('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1')
  with self.assertRaises(AssertionError),self.c.transaction():business.cleanup(self.c,state,journal_entries=entries)
  self.assertTrue(self.c.execute('SELECT 1 FROM auth.users WHERE id=%s',(actor['auth_id'],)).fetchone())
 def test_mismatched_closure_ban_is_rejected_even_with_no_extra_revision(self):
  state,entries,actor=self.close_fixture()
  self.c.execute("SELECT set_config('squad.source_enrollment','on',true)")
  self.c.execute("UPDATE auth.users SET banned_until='9998-01-01 00:00:00+00' WHERE id=%s",(actor['auth_id'],))
  self.c.execute("SELECT set_config('squad.source_enrollment','off',true)")
  with self.assertRaises(AssertionError),self.c.transaction():business.cleanup(self.c,state,journal_entries=entries)
  self.assertTrue(self.c.execute('SELECT 1 FROM auth.users WHERE id=%s',(actor['auth_id'],)).fetchone())

if __name__=='__main__':unittest.main(verbosity=2)
