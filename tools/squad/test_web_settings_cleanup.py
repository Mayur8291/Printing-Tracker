"""Prove new settings roots are audit-owned and removed by the existing fence."""
import json,unittest,uuid
from psycopg.types.json import Jsonb
import test_hosted_business_journeys as business
import test_persona_harness as persona

class WebSettingsCleanup(unittest.TestCase):
 setUpClass=classmethod(persona.PersonaHarness.setUpClass.__func__)
 setUp=persona.PersonaHarness.setUp
 tearDown=persona.PersonaHarness.tearDown
 def test_owned_settings_roots_restore_exact_source_content(self):
  self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")
  state=business.plan(self.c);credentials=business.prepare(self.c,state)
  actor=next(a for a in credentials if a['role']==0);session=uuid.uuid4()
  self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session,actor['auth_id']))
  self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':actor['auth_id'],'session_id':str(session)}),))
  self.c.execute('SET LOCAL ROLE sa_app');entries=[]
  def save(group,fields):
   label='web.settings.'+group;key=uuid.uuid5(uuid.UUID(state['run_id']),label)
   entries.append({'kind':'command','value':{'label':label,'key':str(key)}})
   return self.c.execute('SELECT canto_api.v1_settings_save(%s,NULL,%s,%s,NULL,%s)',(group,Jsonb(fields),state['label']+' test settings cleanup',key)).fetchone()[0]
  zone=save('zones',{'name':state['label']+' new zone'})
  save('cities',{'name':state['label']+' new city','zone_id':zone['id']})
  save('criteria',{'name':state['label']+' new criterion'})
  self.c.execute('RESET ROLE')
  result=business.cleanup(self.c,state,journal_entries=entries)
  self.assertTrue(result['source_content_restored'])
  self.assertEqual(result['owned_commands'],3)
  for table in ['sa_zones','sa_cities','sa_criteria']:self.assertGreaterEqual(result['tables'][table],1)

if __name__=='__main__':unittest.main(verbosity=2)
