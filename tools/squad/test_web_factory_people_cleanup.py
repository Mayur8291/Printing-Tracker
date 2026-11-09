"""Exact six-command PC factory/team graph uses unchanged audit-rooted cleanup."""
import json,unittest,uuid
from psycopg.types.json import Jsonb
import test_web_people_cleanup as people

class FactoryPeopleCleanup(unittest.TestCase):
 setUpClass=classmethod(people.PeopleCleanup.setUpClass.__func__)
 setUp=people.PeopleCleanup.setUp
 tearDown=people.PeopleCleanup.tearDown
 prepare=people.PeopleCleanup.prepare
 actor=people.PeopleCleanup.actor
 clean=people.PeopleCleanup.clean
 def test_complete_factory_manager_and_inspector_graph_cleans(self):factory_graph(self)
 def test_interrupted_factory_creation_cleans_without_children(self):factory_graph(self,True)

def factory_graph(self,interrupt=False):
 self.prepare();sid=uuid.uuid4();self.sessions[2]=sid
 self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(sid,self.actors[2]['auth_id']))
 self.actor(2)
 def command(label):
  key=uuid.uuid5(uuid.UUID(self.state['run_id']),label);self.entries.append({'kind':'command','value':{'label':label,'key':str(key)}});return key
 factory=self.c.execute('SELECT canto_api.v1_factory_save(NULL,%s,NULL,%s)',(self.state['label']+' PC factory',command('factory.create'))).fetchone()[0]
 self.entries.append({'kind':'entity','value':{'kind':'factory','id':factory['id']}})
 if interrupt:
  self.assertEqual(self.clean()['owned_commands'],1);return
 factory=self.c.execute('SELECT canto_api.v1_factory_save(%s,%s,%s,%s)',(int(factory['id']),self.state['label']+' revised',factory['version'],command('factory.edit'))).fetchone()[0]
 manager=None
 for role in [4,8]:
  fields={'name':self.state['label']+' role '+str(role),'phone':'9000000000','email':f"squad-factory-{self.state['run_id'].replace('-','')}-{role}@mailinator.com"}
  fields['factory_id' if role==4 else 'manager_id']=factory['id'] if role==4 else manager
  fn='v1_person_save' if role==4 else 'v1_factory_team_save'
  for phase in ['create','edit']:
   id=None if phase=='create' else int(result['id']);version=None if phase=='create' else result['version']
   if phase=='edit':fields.pop('email');fields['name']+=' revised'
   result=self.c.execute('SELECT canto_api.'+fn+'(%s,%s,%s,%s,%s)',(id,role,Jsonb(fields),version,command(f'person.{role}.{phase}'))).fetchone()[0]
   if phase=='create':self.entries.append({'kind':'entity','value':{'kind':'person','id':result['id']}})
  person=self.c.execute('SELECT canto_api.v1_person_get(%s)',(int(result['id']),)).fetchone()[0]
  self.assertEqual(person['role'],role);self.assertEqual(person['name'],fields['name'])
  self.assertEqual(person['factory_id' if role==4 else 'manager_id'],factory['id'] if role==4 else manager)
  if role==4:manager=result['id']
 self.c.execute('RESET ROLE');self.assertEqual(self.clean()['owned_commands'],6)

if __name__=='__main__':unittest.main(verbosity=2)
