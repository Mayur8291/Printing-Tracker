"""SC status UI uses source intent+session revocation, never Auth-user writes.
Local synthetic rollback tests prove existing exact cleanup is sufficient.
"""
import json,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
import test_hosted_business_journeys as business
import test_persona_harness as persona

class PeopleCleanup(unittest.TestCase):
 setUpClass=classmethod(persona.PersonaHarness.setUpClass.__func__)
 setUp=persona.PersonaHarness.setUp
 tearDown=persona.PersonaHarness.tearDown
 def prepare(self):
  self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")
  self.state=business.plan(self.c);credentials=business.prepare(self.c,self.state)
  self.actors={a['role']:a for a in credentials};self.sessions={};self.entries=[]
  for role in [0,1,3,4]:
   actor=self.actors[role];sid=uuid.uuid4();self.sessions[role]=sid
   self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(sid,actor['auth_id']))
   self.c.execute('INSERT INTO auth.refresh_tokens(user_id,session_id) VALUES(%s,%s)',(actor['auth_id'],sid))
  self.auth_before=self.c.execute('SELECT md5(row_to_json(u)::text) FROM auth.users u WHERE id=%s',(self.actors[3]['auth_id'],)).fetchone()[0]
 def actor(self,role):
  self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':self.actors[role]['auth_id'],'session_id':str(self.sessions[role])}),));self.c.execute('SET LOCAL ROLE sa_app')
 def status(self,action):
  self.actor(1);id=self.state['base']+3;v=self.c.execute('SELECT canto_api.v1_person_get(%s)',(id,)).fetchone()[0]['version']
  label='web.people.'+action;key=uuid.uuid5(uuid.UUID(self.state['run_id']),label)
  self.entries.append({'kind':'command','value':{'label':label,'key':str(key)}})
  args=(id,action,self.state['label']+' status acceptance',v,key)
  result=self.c.execute('SELECT canto_api.account_user_status(%s,%s,%s,%s,%s)',args).fetchone()[0]
  self.assertEqual(self.c.execute('SELECT canto_api.account_user_status(%s,%s,%s,%s,%s)',args).fetchone()[0],result)
  self.c.execute('RESET ROLE');return result
 def assert_auth_preserved(self):
  self.assertEqual(self.c.execute('SELECT md5(row_to_json(u)::text) FROM auth.users u WHERE id=%s',(self.actors[3]['auth_id'],)).fetchone()[0],self.auth_before)
 def clean(self):
  self.c.execute('RESET ROLE');r=business.cleanup(self.c,self.state,journal_entries=self.entries)
  self.assertTrue(r['source_content_restored']);self.assertEqual(r['owned_auth_revisions'],0);return r
 def test_four_created_business_profiles_relationships_and_cleanup_without_workers(self):
  self.prepare();parent=None
  for actor,role,fn in [(4,5,'v1_tailor_save'),(4,6,'v1_subtailor_save'),(0,12,'v1_person_save'),(0,1,'v1_person_save')]:
   self.actor(actor);fields={'name':self.state['label']+' managed '+str(role),'phone':'9000000000'}
   if role==6:fields['parent_tailor_id']=parent
   if role in [1,12]:fields['email']='squad-people-'+self.state['run_id'].replace('-','')+'-'+str(role)+'@mailinator.com'
   if role==12:fields['designation']='Test team'
   for phase in ['create','edit']:
    label='web.people.'+str(role)+'.'+phase;key=uuid.uuid5(uuid.UUID(self.state['run_id']),label)
    self.entries.append({'kind':'command','value':{'label':label,'key':str(key)}})
    id=None if phase=='create' else int(created['id']);v=None if phase=='create' else created['version']
    if phase=='edit':fields.pop('email',None);fields['name']+=' revised'
    args=(id,role,Jsonb(fields),v,key) if fn=='v1_person_save' else (id,Jsonb(fields),v,key)
    created=self.c.execute('SELECT canto_api.'+fn+'('+','.join(['%s']*len(args))+')',args).fetchone()[0]
    if phase=='create':self.entries.append({'kind':'entity','value':{'kind':'person','id':created['id']}})
   person=self.c.execute('SELECT canto_api.v1_person_get(%s)',(int(created['id']),)).fetchone()[0]
   self.assertEqual(person['role'],role)
   if role in [5,6]:self.assertEqual(person['manager_id'],str(self.state['base']+4))
   if role==5:parent=created['id']
   if role==6:self.assertEqual(person['parent_tailor_id'],parent)
   self.c.execute('RESET ROLE')
  self.assertEqual(self.clean()['owned_commands'],8)
 def test_disable_revokes_sessions_preserves_auth_and_cleanup_after_interruption(self):
  self.prepare();self.assertEqual(self.status('disable')['state'],'disabled');self.assert_auth_preserved()
  self.assertFalse(self.c.execute('SELECT 1 FROM auth.sessions WHERE user_id=%s',(self.actors[3]['auth_id'],)).fetchone())
  self.actor(3)
  with self.assertRaises(psycopg.Error),self.c.transaction():self.c.execute('SELECT canto_api.v1_me()')
  self.c.execute('RESET ROLE');r=self.clean();self.assertEqual(r['owned_commands'],1)
 def test_enable_retains_revoked_old_session_new_session_works_and_cleans(self):
  self.prepare();self.status('disable');self.assertEqual(self.status('enable')['state'],'enabled');self.assert_auth_preserved();self.actor(3)
  with self.assertRaises(psycopg.Error),self.c.transaction():self.c.execute('SELECT canto_api.v1_me()')
  self.c.execute('RESET ROLE');self.sessions[3]=uuid.uuid4();self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(self.sessions[3],self.actors[3]['auth_id']))
  self.actor(3);self.assertEqual(self.c.execute('SELECT canto_api.v1_me()').fetchone()[0]['id'],str(self.state['base']+3));self.c.execute('RESET ROLE')
  self.assertEqual(self.clean()['owned_commands'],2)
 def test_unexplained_auth_revision_is_not_excused_by_status_audits(self):
  self.prepare();self.status('disable');self.status('enable')
  self.c.execute('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1')
  with self.assertRaises(AssertionError),self.c.transaction():self.clean()
  self.assertTrue(self.c.execute('SELECT 1 FROM auth.users WHERE id=%s',(self.actors[3]['auth_id'],)).fetchone())
 def test_wrong_customer_relationship_denies_without_audit_or_revision(self):
  self.prepare();self.actor(1)
  with self.assertRaises(psycopg.Error),self.c.transaction():self.c.execute('SELECT canto_api.account_user_status(%s,%s,%s,%s,%s)',(self.state['base']+10,'disable','Not an SC managed Customer','1:0',uuid.uuid4()))
  self.c.execute('RESET ROLE');self.assertEqual(self.clean()['owned_commands'],0)
if __name__=='__main__':unittest.main(verbosity=2)
