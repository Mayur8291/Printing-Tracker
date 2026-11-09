"""Finite web extension graphs through actual SQL plus exact existing cleanup.
No hosted actions; source request/rejection/archive history reused from SDK graph.
"""
import json,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from fixtures import rpc
import test_business_harness as existing
from test_business_journey_composition import run_sdk
import test_hosted_business_journeys as harness
class WorkflowExtensionsCleanup(unittest.TestCase):
 setUpClass=classmethod(existing.BusinessHarness.setUpClass.__func__)
 setUp=existing.BusinessHarness.setUp;tearDown=existing.BusinessHarness.tearDown;prepared=existing.BusinessHarness.prepared
 def test_bulk_isolated_customers_assigned_order_task_and_archived_work_exact_cleanup(self):
  state=self.prepared();actors={}
  for a in state['identity']['actors']:
   sid=uuid.uuid4();self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(sid,a['auth_id']));actors[a['role']]={**a,'session_id':str(sid)}
  result=run_sdk(self.c,state['fixture'],actors,state['run_id']);entries=result['journal'];order=int(result['report']['commercial']['entities']['factoryOrderId'])
  def actor(role):
   self.c.execute('RESET ROLE');a=actors[role];self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':a['auth_id'],'session_id':a['session_id'],'role':'sa_app'}),));self.c.execute('SET LOCAL ROLE sa_app')
  def command(role,name,args,label):
   actor(role);key=uuid.uuid5(uuid.UUID(state['run_id']),label);entries.append({'kind':'command','value':{'label':label,'key':str(key)}});return rpc(self.c,name,(*args,key))
  customers=[]
  for index in range(2):
   r=command(1,'v1_person_save',(None,3,Jsonb({'name':state['label']+' bulk '+str(index),'email':'squad-bulk-'+state['run_id'].replace('-','')+'-'+str(index)+'@mailinator.com'}),None),'web.extensions.create'+str(index))
   customers.append(int(r['id']));entries.append({'kind':'entity','value':{'kind':'person','id':r['id']}})
  for label,target in [('transfer',state['data_base']+120),('restore',state['base']+1)]:
   actor(0);selection=[{'id':str(id),'version':rpc(self.c,'v1_person_get',(id,))['version']} for id in customers]
   command(0,'v1_customers_reassign',(Jsonb(selection),target,state['label']+' bulk'),'web.extensions.'+label)
   for id in customers:
    actor(0);self.assertEqual(rpc(self.c,'v1_person_get',(id,))['coordinator_id'],str(target))
    if label=='transfer':
     actor(1)
     with self.assertRaises(psycopg.Error),self.c.transaction():rpc(self.c,'v1_person_get',(id,))
  actor(0);subject=rpc(self.c,'v1_person_get',(state['base']+12,));features=subject['features'];features=[f for f in features if f['key']!='1']+[{'key':'1','checked':True}];command(0,'v1_person_capabilities_save',(state['base']+12,Jsonb(features),state['label']+' task scope',subject['version']),'web.extensions.notes-grant')
  note=state['label']+' assigned context';task=command(0,'v1_task_save',(None,note,state['fixture']['dueAt'],order,[state['base']+12],None),'web.extensions.task')
  entries.append({'kind':'entity','value':{'kind':'task','id':task['id']}});actor(12);view=rpc(self.c,'v1_task_get',(int(task['id']),));self.assertEqual(view['order_id'],str(order));self.assertEqual(view['assignee_ids'],[str(state['base']+12)])
  rows=rpc(self.c,'v1_tasks_list',(0,order,None,30,note,'to_me'));self.assertEqual([r['id'] for r in rows['data']],[task['id']])
  command(12,'v1_task_transition',(int(task['id']),1,view['version']),'web.extensions.complete');actor(0);rows=rpc(self.c,'v1_tasks_list',(1,order,None,30,note,'by_me'));self.assertEqual([r['id'] for r in rows['data']],[task['id']])
  # Rename only the already journal-owned historical custom preset. This is
  # the actual CONFIG.04 contract; all dependent order configuration survives.
  actor(1);order_view=rpc(self.c,'v1_order_get',(order,None,50));product=int(order_view['items']['data'][0]['product_id'])
  prior=rpc(self.c,'v1_presets_list',(Jsonb({'id':str(product)}),None,1))['data'][0]
  name=state['label']+' saved design revised'
  renamed=command(1,'v1_preset_rename',(product,name,prior['version']),'web.extensions.preset-rename')
  actor(1);current=rpc(self.c,'v1_presets_list',(Jsonb({'id':str(product)}),None,1))['data'][0]
  self.assertEqual(current['name'],name);self.assertEqual(current['configuration'],prior['configuration']);self.assertEqual(current['style_number'],prior['style_number']);self.assertNotEqual(renamed['version'],prior['version'])
  self.assertEqual(rpc(self.c,'v1_order_get',(order,None,50))['items']['data'][0]['product_id'],str(product))
  # The same SDK graph includes exact requested-coordinator rejection and
  # partial-work archive denial, completed SubTailor/parent archive, retained history.
  self.assertIn('completed_managed_subject_rename_and_archive_preserve_work_ids_quantities_and_history',result['report']['workforceExtras']['checks'])
  self.assertIn('customer_coordinator_request_list_admin_rejection_retry_preserves_original_owner',result['report']['commercialExtras']['checks'])
  self.c.execute('RESET ROLE');count=self.c.execute('SELECT count(*) FROM sa_domain.audit WHERE id>%s',(state['audit_start'],)).fetchone()[0]
  cleaned=harness.cleanup(self.c,state,entries);self.assertTrue(cleaned['source_content_restored']);self.assertEqual(cleaned['owned_commands'],count);self.assertEqual(harness.cleanup(self.c,state,entries),cleaned)
if __name__=='__main__':unittest.main(verbosity=2)
