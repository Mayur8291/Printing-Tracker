"""Actual local SQL contract and cleanup; every test rolls back."""
import copy,unittest,uuid
from psycopg.types.json import Jsonb
from local_db import connect
import tracker_colors_fixture as fixture
class ColorsFixture(unittest.TestCase):
 def setUp(self):
  self.c=connect();self.addCleanup(self.c.close);self.c.execute('BEGIN');self.c.execute("UPDATE sa_sync.environment_state SET environment='staging',cutover=false,active_job=NULL,synced_revision=edit_revision WHERE singleton");self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL WHERE singleton")
  self.state=fixture.plan(self.c);a=self.state['staff']['actors'][0];id=uuid.uuid4()
  self.c.execute("INSERT INTO auth.users(id,role,email,raw_user_meta_data,raw_app_meta_data,created_at)VALUES(%s,'authenticated',%s,%s,%s,clock_timestamp())",(id,a['email'],Jsonb({'tracker_read_run':self.state['run_id'],'full_name':a['name']}),Jsonb({'tracker_read_run':self.state['run_id']})))
  self.c.execute("INSERT INTO public.profiles(id,role)VALUES(%s,'viewer')",(id,));fixture.staff.bind(self.c,self.state['staff'],a,id)
  self.session=uuid.uuid4();self.c.execute('INSERT INTO auth.sessions(id,user_id)VALUES(%s,%s)',(self.session,id));self.actor=id;self.entries=[];self.row=None
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def command(self,action):
  i=['create','update','delete'].index(action)
  if i<2:
   payload={'values':{'name':self.state['name'] if i==0 else self.state['edited_name'],'hex_code':'#2457AA' if i==0 else '#196B45','is_deleted':'false'},'relations':{}}
   if i:payload.update(id=str(self.row['id']),expectedUpdatedAt=self.row['updated_at'])
   body={'p_resource':'colors','p_action':action,'p_payload':payload,'p_upload_ids':[],'p_idempotency_key':str(uuid.uuid4())}
  else:body={'resource':'colors','action':'delete','payload':{'id':str(self.row['id'])}}
  self.entries.append({'action':action,'body':body})
  with self.c.transaction():
   self.c.execute('SET LOCAL ROLE authenticated');self.c.execute("SELECT set_config('request.jwt.claims',%s::jsonb::text,true)",(Jsonb({'sub':str(self.actor),'role':'authenticated','session_id':str(self.session)}),))
   if i<2:self.row=self.c.execute('SELECT canto_api.account_master_save(%s,%s,%s,%s::uuid[],%s)',('colors',action,Jsonb(payload),[],body['p_idempotency_key'])).fetchone()[0]
   else:self.row=self.c.execute('SELECT canto_api.masters(%s,%s,%s)',('colors','delete',Jsonb(body['payload']))).fetchone()[0]
  self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','',true)")
  return self.row
 def test_full_visible_branch_contract_cleans_retains_audits_and_monotonic_revisions(self):
  for action in ['create','update','delete']:self.command(action)
  proof=fixture.cleanup(self.c,self.state,self.entries)
  self.assertEqual((proof['removed_owned_colors'],proof['admin_operations'],proof['domain_commands']),(1,3,2))
  self.assertEqual(proof['edit_revision_after'],self.state['staff']['environment_before'][3]+5)
  self.assertEqual(proof['staff_cleanup']['removed_owned_auth'],1)
  self.assertEqual(self.c.execute('SELECT count(*) FROM sa_admin.audit WHERE actor_id=%s',(self.actor,)).fetchone()[0],3)
  self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.commands WHERE actor_id=%s',(self.actor,)).fetchone()[0],2)
  self.assertEqual(fixture.cleanup(self.c,self.state,self.entries),proof)
 def test_interrupted_create_and_uncertain_unsent_update_clean_exact_owned_prefix(self):
  self.command('create');entry=copy.deepcopy(self.entries[0]);entry['action']='update';entry['body']['p_action']='update';entry['body']['p_idempotency_key']=str(uuid.uuid4());entry['body']['p_payload'].update(id=str(self.row['id']),expectedUpdatedAt=self.row['updated_at']);entry['body']['p_payload']['values']={'name':self.state['edited_name'],'hex_code':'#196B45','is_deleted':'false'};self.entries.append(entry)
  self.assertEqual(fixture.cleanup(self.c,self.state,self.entries)['admin_operations'],1)
 def test_no_business_writes_still_removes_only_admin(self):
  self.assertEqual(fixture.cleanup(self.c,self.state,[])['removed_owned_colors'],0)
 def test_missing_request_journal_refuses_without_removal(self):
  self.command('create')
  with self.assertRaises(AssertionError),self.c.transaction():fixture.cleanup(self.c,self.state,[])
  self.assertTrue(self.c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_colors WHERE id=%s',(self.row['id'],)).fetchone())
 def test_changed_owned_row_refuses(self):
  self.command('create');self.c.execute("UPDATE sa_snapshot_20261019.sa_colors SET name='unexplained' WHERE id=%s",(self.row['id'],))
  with self.assertRaisesRegex(AssertionError,'Owned Colors row changed'),self.c.transaction():fixture.cleanup(self.c,self.state,self.entries)
 def test_unexplained_revision_refuses(self):
  self.command('create');self.c.execute('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1 WHERE singleton')
  with self.assertRaisesRegex(AssertionError,'Unexplained revision'),self.c.transaction():fixture.cleanup(self.c,self.state,self.entries)
 def test_executed_job_refuses(self):
  self.command('create');self.c.execute("UPDATE sa_domain.outbox SET status='done',attempts=1 WHERE actor_id=%s",(self.actor,))
  with self.assertRaisesRegex(AssertionError,'background work'),self.c.transaction():fixture.cleanup(self.c,self.state,self.entries)
 def test_unknown_source_change_rolls_back_all_cleanup(self):
  self.command('create');self.c.execute("INSERT INTO sa_snapshot_20261019.sa_colors(name,hex_code,source,created_at,updated_at)VALUES('foreign unrelated color','#123456',1,now(),now())")
  with self.assertRaisesRegex(AssertionError,'Source net-zero'),self.c.transaction():fixture.cleanup(self.c,self.state,self.entries)
  self.assertTrue(self.c.execute('SELECT 1 FROM auth.users WHERE id=%s',(self.actor,)).fetchone())
if __name__=='__main__':unittest.main(verbosity=2)
