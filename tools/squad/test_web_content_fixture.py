"""Actual SQL cleanup/provenance plus bounded fake Storage transport; no hosted IO."""
import copy,hashlib,unittest,uuid
from unittest import mock
from psycopg.types.json import Jsonb
import test_business_harness as existing
import test_hosted_business_journeys as business
import web_content_fixture as media
from fixtures import rpc
from psycopg import sql

class ContentFixture(unittest.TestCase):
 setUpClass=classmethod(existing.BusinessHarness.setUpClass.__func__)
 setUp=existing.BusinessHarness.setUp;tearDown=existing.BusinessHarness.tearDown
 def prepared(self):
  state=business.plan(self.c);state['created_at']=self.c.execute('SELECT transaction_timestamp()').fetchone()[0].isoformat()
  media.plan(self.c,state);business.prepare(self.c,state);media.prepare(self.c,state);return state
 def fake_storage(self,state):
  p=state['web_content_media'];objects={}
  def row(c,p):return copy.deepcopy(objects.get(p['path']))
  def request(key,p,method):
   if method=='POST':
    assert p['path'] not in objects;objects[p['path']]={'id':str(uuid.uuid4()),'name':p['path'],'bucket_id':'canto-media','metadata':{'size':p['bytes'],'mimetype':'image/png'}}
   elif method=='GET':return media.png(p['run_id'],2)
   elif method=='DELETE':del objects[p['path']]
   else:raise AssertionError(method)
  return objects,row,request
 def test_default_plan_unchanged_and_exact_marked_roots(self):
  state=business.plan(self.c);self.assertFalse(any(x['table'].endswith('sa_promotions') for x in state['fixture']['fixture_tables']))
  media.plan(self.c,state);business.validate(state)
  root=next(x for x in state['fixture']['fixture_tables'] if x['table'].endswith('sa_promotions'))
  self.assertEqual(root['ids'],[state['data_base']+300,state['data_base']+301])
  bad=copy.deepcopy(state);bad['web_content_media']['ready_id']=str(state['data_base']+302)
  with self.assertRaises(AssertionError):business.validate(bad)
 def test_ready_customer_reads_and_exact_cleanup_with_shared_png(self):
  state=self.prepared();p=media.bindings(self.c,state);objects,row,request=self.fake_storage(state)
  actor=next(a for a in state['identity']['actors'] if a['role']==3);sid=uuid.uuid4()
  self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(sid,actor['auth_id']))
  owner=self.c.execute('SELECT current_user').fetchone()[0]
  self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(__import__('json').dumps({'sub':actor['auth_id'],'session_id':str(sid),'role':'sa_app'}),));self.c.execute('SET LOCAL ROLE sa_app')
  result=rpc(self.c,'v1_promotions_list',(Jsonb({'category':p['category'],'upload_date':p['upload_date']}),None,12))
  self.assertEqual({x['id'] for x in result['data']},{p['ready_id'],p['missing_id']});self.assertTrue(all(x['content']['kind']=='file' for x in result['data']))
  refs=[{'resource':r,'record_id':str(id),'field':f,'pointer':''} for r,id,f in media.targets(p)]
  resolved=self.c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb(refs),)).fetchone()[0]['references']
  self.assertEqual([r['status'] for r in resolved],['ready','ready','missing'])
  self.assertTrue(all(r['object_path']==p['path'] and r['bytes']==str(p['bytes']) for r in resolved[:2]))
  self.c.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(owner)))
  with mock.patch.object(media,'storage_row',row),mock.patch.object(media,'storage_request',request):
   media.upload(self.c,state,'test',lambda s:None);self.assertEqual(len(objects),1)
   media.cleanup_storage(self.c,state,'test',lambda s:None);self.assertFalse(objects)
   cleaned=business.cleanup(self.c,state,[],media_cleanup=media.cleanup_database)
   self.assertTrue(cleaned['source_content_restored']);self.assertEqual(cleaned['owned_commands'],0)
   self.assertEqual(media.snapshot(self.c),p['before'])
   self.assertEqual(business.cleanup(self.c,state,[],media_cleanup=media.cleanup_database),cleaned)
   import test_web_content_media_hosted as wrapper
   with mock.patch.object(business,'journal',return_value=[]):self.assertEqual(wrapper.cleanup(self.c,state,'test'),cleaned)
 def test_foreign_reference_and_source_change_refuse(self):
  state=self.prepared();p=state['web_content_media']
  with self.c.transaction():
   self.c.execute("INSERT INTO sa_media.references(resource,record_id,field,pointer,source_value,status,sha256) VALUES('users',1,'profile_image','','other','ready',%s)",(p['sha256'],))
   with self.assertRaisesRegex(AssertionError,'Foreign reference'):media.bindings(self.c,state)
   self.c.execute("DELETE FROM sa_media.references WHERE resource='users' AND record_id=1 AND source_value='other'")
  self.c.execute('UPDATE sa_snapshot_20261019.sa_promotions SET name=%s WHERE id=%s',('changed',int(p['ready_id'])))
  with self.assertRaisesRegex(AssertionError,'changed after setup'):media.bindings(self.c,state)
 def test_upload_unknown_outcome_exact_recovery_and_changed_storage_refusal(self):
  state=self.prepared();p=state['web_content_media'];objects,row,request=self.fake_storage(state)
  with mock.patch.object(media,'storage_row',row),mock.patch.object(media,'storage_request',request):
   # POST completed but process ended before its receipt was persisted.
   p['storage_intent']=True;p['upload_started_at']=self.c.execute('SELECT clock_timestamp()').fetchone()[0].isoformat();request('test',p,'POST');self.assertIsNone(p['storage_receipt'])
   with self.assertRaisesRegex(AssertionError,'Unknown upload completion'):media.cleanup_storage(self.c,state,'test',lambda s:None)
   self.assertEqual(len(objects),1)
   p['upload_started_at']=self.c.execute("SELECT clock_timestamp()-interval '2 hours 11 minutes'").fetchone()[0].isoformat()
   media.cleanup_storage(self.c,state,'test',lambda s:None);self.assertFalse(objects)
   p['storage_deleted']=False;request('test',p,'POST')
   with self.assertRaisesRegex(AssertionError,'metadata changed'):media.cleanup_storage(self.c,state,'test',lambda s:None)
   self.assertEqual(len(objects),1)
 def test_generation_and_unexpected_upload_fail_closed(self):
  state=self.prepared();state['identity']['generation']+=1
  with self.assertRaises(AssertionError):media.bindings(self.c,state)
 def test_whole_setup_rollback_recovers_nonempty_durable_receipt(self):
  # Commit only isolated test-catalog DDL, then simulate the real top-level
  # setup transaction failing after checkpoint serialization, before commit.
  self.c.commit();self.c.execute('BEGIN')
  state=self.prepared();self.assertTrue(state['web_content_media']['setup_receipt']['refs'])
  self.c.rollback();self.c.execute('BEGIN')
  self.assertEqual(business.source_state(self.c),state['source_before'])
  media.bindings(self.c,state)
  with mock.patch.object(media,'storage_row',return_value=None),mock.patch.object(media,'storage_request') as request:
   media.cleanup_storage(self.c,state,'test',lambda s:None)
   result=business.cleanup(self.c,state,[],media_cleanup=media.cleanup_database)
   self.assertTrue(result['source_content_restored']);request.assert_not_called()
 def test_bound_report_rejects_wrong_oracle_identity_hash_and_filename(self):
  from test_web_content_media_hosted import bind_report
  state=self.prepared();p=state['web_content_media']
  oracle={'freshCustomerGrantVerified':True,'customerId':str(state['base']+3),'promotionId':p['ready_id'],'promotionName':p['ready_name'],'category':p['category'],'uploadDate':p['upload_date'],'productId':p['class_id'],'productName':p['product_name'],'filename':p['sha256'],'bytes':p['bytes'],'sha256':p['sha256']}
  r={'completeRequiredMedia':True,'productId':p['class_id'],'promotionId':p['ready_id'],'coverage':{'productZip':{'imageBytes':p['bytes'],'imageSha256':p['sha256']},'promotionDownload':{'downloaded':True,'bytes':p['bytes'],'sha256':p['sha256']},'promotionMissing':True},'nativeOracle':oracle}
  report={'environment':'staging','run_id':state['run_id'],'browser_errors':0,'network_violations':0,'journeys':{'content-media':r}}
  self.assertEqual(bind_report(state,report),oracle)
  for field,value in [('filename','incorrect.png'),('sha256','0'*64),('customerId','999')]:
   changed=copy.deepcopy(report);changed['journeys']['content-media']['nativeOracle'][field]=value
   with self.assertRaises(AssertionError):bind_report(state,changed)
 def test_wrapper_requires_shutdown_before_any_delete(self):
  import test_web_content_media_hosted as wrapper
  state=self.prepared();state['web_content_media']['browser_state']='shutdown_unconfirmed'
  with self.assertRaisesRegex(AssertionError,'browser shutdown'),mock.patch.object(media,'cleanup_storage') as deleted:wrapper.cleanup(self.c,state,'test')
  deleted.assert_not_called()
  state['web_content_media']['browser_state']='closed';state['native_safari_handoff']={'format':'squad-native-safari-handoff/v1','state':'active'}
  with self.assertRaisesRegex(AssertionError,'Safari shutdown'):wrapper.cleanup(self.c,state,'test')
if __name__=='__main__':unittest.main(verbosity=2)
