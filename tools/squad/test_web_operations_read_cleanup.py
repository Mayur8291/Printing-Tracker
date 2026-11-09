"""Read-only Ops adapter boundaries on synthetic exact-owned records; no hosted calls."""
import uuid,unittest
import psycopg
import test_web_people_cleanup as people

class OperationsReadCleanup(unittest.TestCase):
 setUpClass=classmethod(people.PeopleCleanup.setUpClass.__func__)
 setUp=people.PeopleCleanup.setUp;tearDown=people.PeopleCleanup.tearDown
 prepare=people.PeopleCleanup.prepare;actor=people.PeopleCleanup.actor;clean=people.PeopleCleanup.clean
 def create_task(self,role=0):
  self.actor(role);key=uuid.uuid5(uuid.UUID(self.state['run_id']),'web.ops.read.task')
  self.entries.append({'kind':'command','value':{'label':'web.ops.read.task','key':str(key)}})
  value=self.c.execute("SELECT canto_api.v1_task_save(NULL,%s,now()+interval '1 day',NULL,'{}'::bigint[],NULL,%s)",(self.state['label']+' read only task',key)).fetchone()[0]
  self.entries.append({'kind':'entity','value':{'kind':'task','id':value['id']}})
  self.c.execute('RESET ROLE');return int(value['id'])
 def test_own_pending_job_read_foreign_denial_and_ineligible_retry_do_not_change_cleanup(self):
  self.prepare();self.sessions[12]=uuid.uuid4();self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(self.sessions[12],self.actors[12]['auth_id']));task=self.create_task(12);self.actor(12)
  jobs=self.c.execute("SELECT canto_api.v1_jobs_list('pending',NULL,100)").fetchone()[0]['data'];job=next(j for j in jobs if j['kind']=='task' and j['entity_id']==str(task))
  self.assertEqual(self.c.execute('SELECT canto_api.v1_job_get(%s)',(job['id'],)).fetchone()[0]['state'],'pending')
  self.actor(0);self.assertEqual(self.c.execute('SELECT canto_api.v1_job_get(%s)',(job['id'],)).fetchone()[0]['version'],job['version'])
  self.actor(1)
  with self.assertRaises(psycopg.errors.NoDataFound),self.c.transaction():self.c.execute('SELECT canto_api.v1_job_get(%s)',(job['id'],))
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.c.execute('SELECT canto_api.v1_audit_list(%s,%s,NULL,1)',('task',task))
  self.actor(0)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState),self.c.transaction():self.c.execute('SELECT canto_api.v1_job_retry(%s,%s,%s,%s)',(job['id'],'Pending job must not retry',job['version'],uuid.uuid4()))
  self.assertEqual(self.c.execute('SELECT canto_api.v1_job_get(%s)',(job['id'],)).fetchone()[0]['version'],job['version'])
  self.c.execute('RESET ROLE');result=self.clean();self.assertEqual(result['owned_commands'],1)
 def test_audit_filter_cursor_binding_and_empty_notification_reads_preserve_cleanup(self):
  self.prepare();task=self.create_task();self.actor(0)
  for phase in ['edit-one','edit-two']:
   version=self.c.execute('SELECT canto_api.v1_task_get(%s)',(task,)).fetchone()[0]['version'];key=uuid.uuid5(uuid.UUID(self.state['run_id']),phase)
   self.entries.append({'kind':'command','value':{'label':phase,'key':str(key)}})
   self.c.execute("SELECT canto_api.v1_task_save(%s,%s,now()+interval '1 day',NULL,'{}'::bigint[],%s,%s)",(task,self.state['label']+phase,version,key))
  first=self.c.execute('SELECT canto_api.v1_audit_list(%s,%s,NULL,1)',('task',task)).fetchone()[0]
  second=self.c.execute('SELECT canto_api.v1_audit_list(%s,%s,%s,1)',('task',task,first['next_cursor'])).fetchone()[0]
  self.assertNotEqual(first['data'][0]['id'],second['data'][0]['id'])
  with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.c.execute('SELECT canto_api.v1_audit_list(%s,%s,%s,1)',('order',task,first['next_cursor']))
  for role in [0,1,3]:
   self.actor(role);self.assertEqual(self.c.execute('SELECT canto_api.v1_notifications_list(NULL,NULL,1)').fetchone()[0]['data'],[])
  self.c.execute('RESET ROLE');self.assertEqual(self.clean()['owned_commands'],3)
if __name__=='__main__':unittest.main(verbosity=2)
