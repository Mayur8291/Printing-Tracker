"""Document snapshots, current-authority checks and durable worker boundaries."""
from sqlstate_assertions import assert_app_conflict
import unittest,uuid
from decimal import Decimal
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc,uid
from test_catalogue import seed_catalogue
import test_notifications as notifications
import test_production_execution as work
import test_tailor_earnings as earnings

class Documents(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 actor_as=notifications.Notifications.actor_as;raw=notifications.Notifications.raw;worker=notifications.Notifications.worker;claim=notifications.Notifications.claim;call=notifications.Notifications.call
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_sync.environment_state SET cutover=true');self.actor_as(103)
  self.raw('INSERT INTO sa_snapshot_20261019.sa_rmp_category_brands(rmp_category_id,rmp_brand_id,created_at,updated_at) VALUES(1,1,now(),now()),(1,2,now(),now())')
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def request(self,kind='catalogue',spec=None,key=None):return rpc(self.c,'v1_document_request',(kind,Jsonb(spec or {}),key or uuid.uuid4()))
 def prepare(self,r=None):
  r=r or self.request();j=self.claim('document_render')[0];return j,self.call('squad_document_prepare',j)
 def finish(self,j,code='READY'):
  value={'code':code}
  if code=='READY':value.update(bytes=1000,sha256='a'*64,pages=2)
  return self.call('squad_document_finish',j,Jsonb(value))
 def test_request_queues_exactly_one_job_and_retry_is_stable(self):
  k=uuid.uuid4();a=self.request(key=k);self.assertEqual(a,self.request(key=k));self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.documents'),[(1,)]);self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='document.requested'"),[(1,)])
 def test_changed_payload_rejects_idempotency_reuse(self):
  k=uuid.uuid4();self.request(key=k)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.request(spec={'company_name':'changed'},key=k)
 def test_mirror_request_and_worker_are_fenced(self):
  self.raw('UPDATE sa_sync.environment_state SET cutover=false');self.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=false')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.request()
 def test_unknown_request_field_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.request(spec={'object_path':'arbitrary'})
 def test_document_does_not_enable_disabled_worker_capability(self):
  self.actor_as(112)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.request()
 def test_explicit_document_capability_permits_team(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET features=%s WHERE id=112',(Jsonb([{'key':'3','checked':'true','children':[{'key':'3.2','checked':'true'}]}]),));self.actor_as(112)
  self.assertEqual(self.prepare()[1]['state'],'prepared')
 def test_price_group_and_percentage_share_sku_engine(self):
  j,r=self.prepare(self.request(spec={'markup':{'kind':'percentage','value':'10'}}));self.assertEqual(r['state'],'prepared');rows=r['snapshot']['rows'];self.assertEqual(Decimal(rows[0]['display_price']),88);self.assertEqual(Decimal(rows[1]['display_price']),220)
 def test_fixed_markup_and_exclusions(self):
  j,r=self.prepare(self.request(spec={'markup':{'kind':'fixed','value':'12.34'},'selection':{'exclude_class_ids':['2']}}));self.assertEqual(len(r['snapshot']['rows']),1);self.assertEqual(Decimal(r['snapshot']['rows'][0]['display_price']),Decimal('92.34'))
 def test_dealer_assigned_brands_are_enforced(self):
  self.actor_as(110);j,r=self.prepare();self.assertEqual({x['brand_id'] for x in r['snapshot']['rows']},{'1'})
 def test_snapshot_never_silently_reprices_on_retry(self):
  j,r=self.prepare();self.raw('UPDATE sa_snapshot_20261019.sa_rmp_prices SET price=999 WHERE id=2');again=self.call('squad_document_prepare',j);self.assertEqual(r['snapshot_hash'],again['snapshot_hash']);self.assertEqual(r['snapshot'],again['snapshot'])
 def test_missing_media_is_explicit_without_fetching_old_source(self):
  j,r=self.prepare();self.assertIsNone(r['snapshot']['rows'][0]['image']);self.assertNotIn('http',str(r['snapshot']))
 def test_stock_is_unknown_until_provider_snapshot_exists(self):
  j,r=self.prepare(self.request(spec={'display_stock':True}));self.assertEqual(r['snapshot']['rows'][0]['stock_status'],'provider_snapshot_unavailable');self.assertIsNone(r['snapshot']['rows'][0]['variants'][0]['stock'])
 def test_worker_payload_is_private(self):
  r=self.request();self.actor_as(203)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_document_get',(r['id'],))
 def test_raw_document_table_is_not_exposed(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT snapshot FROM sa_domain.documents')
 def test_ready_grant_is_bound_to_owner_and_generation(self):
  request=self.request();j,r=self.prepare(request);self.finish(j);self.actor_as(103);g=self.c.execute('SELECT canto_api.account_document_grant(%s)',(uuid.UUID(request['id']),)).fetchone()[0];self.assertEqual(g['bucket'],'squad-documents');self.assertIn(str(uid(103)),g['path']);self.raw('UPDATE sa_domain.runtime_state SET generation=1')
  with self.assertRaises(psycopg.errors.NoDataFound):self.c.execute('SELECT canto_api.account_document_grant(%s)',(uuid.UUID(request['id']),)).fetchone()[0]
 def test_grant_before_ready_rejected(self):
  r=self.request()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.c.execute('SELECT canto_api.account_document_grant(%s)',(uuid.UUID(r['id']),)).fetchone()[0]
 def test_ready_history_has_no_snapshot_or_bank_data(self):
  r=self.request(spec={'account_no':'SENSITIVE','bank_details':True});j,p=self.prepare(r);self.finish(j);self.actor_as(103);value=rpc(self.c,'v1_document_get',(r['id'],));self.assertEqual(value['state'],'ready');self.assertNotIn('SENSITIVE',str(value));self.assertNotIn('snapshot',value)
 def test_changed_brand_scope_revokes_existing_document(self):
  self.actor_as(110);r=self.request();j,p=self.prepare(r);self.finish(j);self.raw('UPDATE sa_snapshot_20261019.sa_assigned_brands SET authorized_brand_id=2 WHERE user_id=110');self.actor_as(110)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_document_get',(r['id'],))
 def test_changed_role_blocks_publish(self):
  j,r=self.prepare();self.raw('UPDATE sa_snapshot_20261019.sa_users SET role=10 WHERE id=103');self.assertEqual(self.finish(j)['state'],'dead')
 def test_banned_auth_blocks_prepare(self):
  r=self.request();self.raw("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=%s",(uid(103),));j,p=self.prepare(r);self.assertEqual(p['state'],'dead');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.worker_context'),[(0,)])
 def test_changed_generation_rejects_old_lease(self):
  j,r=self.prepare();self.raw('UPDATE sa_domain.runtime_state SET generation=1')
  with assert_app_conflict(self):self.finish(j)
 def test_wrong_lease_cannot_publish(self):
  j,r=self.prepare();j['lease_token']=str(uuid.uuid4())
  with assert_app_conflict(self):self.finish(j)
 def test_storage_retry_preserves_captured_snapshot(self):
  j,r=self.prepare();self.assertEqual(self.finish(j,'STORAGE_UNAVAILABLE')['state'],'pending');self.raw('UPDATE sa_domain.outbox SET available_at=now()');j=self.claim('document_render')[0];self.assertEqual(self.call('squad_document_prepare',j)['snapshot_hash'],r['snapshot_hash'])
 def test_duplicate_finish_is_idempotent(self):
  j,r=self.prepare();self.finish(j);self.assertTrue(self.finish(j)['replayed'])
 def test_expired_catalogue_grant_rejected(self):
  r=self.request();j,p=self.prepare(r);self.finish(j);self.raw("UPDATE sa_domain.documents SET expires_at=now()-interval '1 second'");self.actor_as(103)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.c.execute('SELECT canto_api.account_document_grant(%s)',(uuid.UUID(r['id']),)).fetchone()[0]
 def test_list_keyset_and_cursor_binding(self):
  self.request();self.request();p=rpc(self.c,'v1_documents_list',(None,None,None,1,False));q=rpc(self.c,'v1_documents_list',(None,None,p['next_cursor'],1,False));self.assertNotEqual(p['data'][0]['id'],q['data'][0]['id'])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_documents_list',('catalogue',None,p['next_cursor'],1,False))
 def test_legacy_catalogues_keep_owner_and_status(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_catalogues(id,user_id,status,is_expired,created_at,updated_at) VALUES(9001,103,1,false,now(),now()),(9002,203,1,false,now(),now())")
  data=rpc(self.c,'v1_documents_list',(None,None,None,30,True))['data'];self.assertEqual([r['id'] for r in data],['legacy:9001']);self.assertEqual(data[0]['media_reference']['record_id'],'9001')
 def test_legacy_foreign_catalogue_hidden(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_catalogues(id,user_id,status,created_at,updated_at) VALUES(9002,203,1,now(),now())")
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_document_get',('legacy:9002',))
 def test_bad_terms_reference_cannot_fetch_arbitrary_url(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.request(spec={'terms_reference':{'url':'https://example.com/secret'}})
 def test_preparation_cannot_be_called_by_application_user(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.squad_document_prepare(%s,%s)',(uuid.uuid4(),uuid.uuid4()))
 def large(self):
  r=self.request();j,p=self.prepare(r)
  self.raw("UPDATE sa_domain.documents SET snapshot=jsonb_set(snapshot,'{rows}',(SELECT jsonb_agg((snapshot->'rows'->0)||jsonb_build_object('synthetic_index',n)) FROM generate_series(1,205) n)) WHERE id=%s",(uuid.UUID(r['id']),))
  return r,j,self.call('squad_document_prepare',j)
 def part(self,j,index=0):return self.call('squad_document_finish',j,Jsonb({'code':'PART_READY','part_index':index,'bytes':1000,'pages':2,'sha256':'a'*64}))
 def cleanup(self,paths=None):
  self.worker();return self.c.execute('SELECT canto_api.squad_document_cleanup(%s)',(paths or [],)).fetchone()[0]
 def mail(self):
  r=self.request(spec={'delivery':'email'});j,p=self.prepare(r);self.finish(j);fanout=self.claim('document_mail')[0];self.assertEqual(self.call('squad_document_mail_prepare',fanout)['state'],'done');mail=self.claim('business_mail')[0];return r,mail,self.call('squad_business_mail_prepare',mail)
 def test_large_document_has_bounded_parts_then_merge(self):
  r,j,p=self.large();self.assertEqual((p['phase'],p['part_index'],len(p['snapshot']['rows'])),('part',0,100))
  for index in range(3):
   self.assertEqual(self.part(j,index)['completed_parts'],index+1);j=self.claim('document_render')[0];p=self.call('squad_document_prepare',j)
   if index<2:self.assertEqual(len(p['snapshot']['rows']),100 if index==0 else 5)
  self.assertEqual(p['phase'],'merge');self.assertNotIn('rows',p['snapshot']);self.assertEqual(len(p['parts']),3);self.assertEqual(self.finish(j)['state'],'done')
 def test_incomplete_parts_cannot_publish(self):
  r,j,p=self.large()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.finish(j)
 def test_part_replay_matches_all_metadata_and_retains_progress(self):
  r,j,p=self.large();self.part(j);self.assertTrue(self.part(j)['replayed']);self.assertEqual(self.raw('SELECT next_part FROM sa_domain.documents'),[(1,)])
  with assert_app_conflict(self):self.call('squad_document_finish',j,Jsonb({'code':'PART_READY','part_index':0,'bytes':1001,'pages':2,'sha256':'a'*64}))
 def test_part_preparation_rechecks_current_authority(self):
  r,j,p=self.large();self.part(j);self.raw('UPDATE sa_snapshot_20261019.sa_users SET role=10 WHERE id=103');j=self.claim('document_render')[0];self.assertEqual(self.call('squad_document_prepare',j)['state'],'dead')
 def test_parts_cleanup_keeps_ready_final_and_acknowledges_only_known_paths(self):
  r,j,p=self.large()
  for index in range(3):self.part(j,index);j=self.claim('document_render')[0];self.call('squad_document_prepare',j)
  self.finish(j);paths=self.cleanup()['paths'];self.assertEqual(len(paths),3);self.assertTrue(all('/part-' in p for p in paths));self.assertEqual(self.cleanup(paths)['paths'],[])
  self.raw("UPDATE sa_domain.documents SET expires_at=now()-interval '1 second'");expired=self.cleanup()['paths'];self.assertEqual(len(expired),1);self.assertTrue(expired[0].endswith('/document.pdf'));self.assertEqual(self.cleanup(expired)['paths'],[])
 def test_cleanup_does_not_starve_newer_records(self):
  for _ in range(2):
   self.actor_as(103);r=self.request();j,p=self.prepare(r);self.finish(j);self.raw("UPDATE sa_domain.documents SET expires_at=now()-interval '1 second'");paths=self.cleanup()['paths'];self.assertEqual(len(paths),1);self.cleanup(paths)
 def test_cleanup_leased_job_is_not_deleted(self):
  r,j,p=self.large();self.raw("UPDATE sa_domain.documents SET state='failed',created_at=now()-interval '2 days'");self.assertEqual(self.cleanup()['paths'],[])
 def test_cleanup_pauses_during_refresh(self):
  self.raw("UPDATE sa_sync.environment_state SET active_job='00000000-0000-4000-8000-000000000001'")
  self.assertTrue(self.cleanup()['paused'])
 def test_generated_cleanup_is_service_only(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.squad_document_cleanup()')
 def test_email_uses_current_auth_recipient_and_fixed_output(self):
  r,j,p=self.mail();self.assertEqual(p['email'],'persona-103@squad.invalid');self.assertEqual(p['data']['document_id'],r['id']);self.assertTrue(p['attachment']['path'].endswith('/document.pdf'));self.assertEqual(self.call('squad_business_mail_finish',j,'SENT')['state'],'done');self.actor_as(103);self.assertEqual(rpc(self.c,'v1_document_get',(r['id'],))['delivery_state'],'sent')
 def test_document_email_not_queued_for_download(self):
  j,p=self.prepare();self.finish(j);self.assertEqual(self.claim('document_mail'),[])
 def test_email_finish_replay_does_not_duplicate(self):
  r,j,p=self.mail();self.call('squad_business_mail_finish',j,'SENT');self.assertTrue(self.call('squad_business_mail_finish',j,'SENT')['replayed']);self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='document.mail'"),[(1,)])
 def test_failed_email_preserves_downloadable_document(self):
  r,j,p=self.mail();self.call('squad_business_mail_finish',j,'MAIL_NOT_ENABLED');self.actor_as(103);value=rpc(self.c,'v1_document_get',(r['id'],));self.assertEqual((value['state'],value['delivery_state']),('ready','failed'))
 def test_email_transient_failure_is_retried(self):
  r,j,p=self.mail();self.assertEqual(self.call('squad_business_mail_finish',j,'PROVIDER_UNAVAILABLE')['state'],'pending');self.assertEqual(self.raw('SELECT delivery_state FROM sa_domain.documents'),[('pending',)])
 def test_email_role_revocation_checked_before_send(self):
  r=self.request(spec={'delivery':'email'});j,p=self.prepare(r);self.finish(j);self.raw('UPDATE sa_snapshot_20261019.sa_users SET role=10 WHERE id=103');j=self.claim('document_mail')[0];self.assertEqual(self.call('squad_document_mail_prepare',j)['state'],'dead')
 def test_request_hourly_quota(self):
  for _ in range(20):self.request()
  with self.assertRaises(psycopg.errors.ProgramLimitExceeded):self.request()
 def test_queue_claims_at_most_one_render_per_edge_invocation(self):
  self.request();self.request();self.assertEqual(len(self.claim('document_render')),1)
 def test_verified_image_inventory_is_captured_with_small_render_budget(self):
  path='sha256/aa/'+'a'*64
  self.raw("INSERT INTO sa_media.objects(sha256,object_path,bytes,content_type) VALUES(%s,%s,100,'image/png')",('a'*64,path))
  self.raw("UPDATE sa_snapshot_20261019.sa_rmp_classes SET image_1_thumb='synthetic.png' WHERE id=1")
  self.raw("INSERT INTO sa_media.references(resource,record_id,field,pointer,source_value,status,sha256) VALUES('rmp_classes',1,'image_1_thumb','','synthetic.png','ready',%s)",('a'*64,))
  j,p=self.prepare();self.assertEqual(p['snapshot']['rows'][0]['image']['path'],path);self.assertEqual(self.raw('SELECT part_size FROM sa_domain.documents'),[(10,)])
 def test_stale_inventory_does_not_reuse_a_replaced_image(self):
  self.raw("INSERT INTO sa_media.objects(sha256,object_path,bytes,content_type) VALUES(%s,%s,100,'image/png')",('a'*64,'sha256/aa/'+'a'*64))
  self.raw("UPDATE sa_snapshot_20261019.sa_rmp_classes SET image_1_thumb='current.png' WHERE id=1")
  self.raw("INSERT INTO sa_media.references(resource,record_id,field,pointer,source_value,status,sha256) VALUES('rmp_classes',1,'image_1_thumb','','old.png','ready',%s)",('a'*64,))
  j,p=self.prepare();self.assertIsNone(p['snapshot']['rows'][0]['image'])
 def test_source_publication_expires_outputs_and_discards_pending_mail(self):
  from domain_sync import after_publication
  r,j,p=self.mail();self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_sync.environment_state SET cutover=false');result=after_publication(self.c);self.assertEqual(result['discarded_documents'],1)
  self.assertEqual(self.c.execute('SELECT state,delivery_state,error_code FROM sa_domain.documents').fetchone(),('expired','failed','SOURCE_REFRESH_DISCARDED'))
  self.assertEqual(self.c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()[0],0);self.assertEqual(len(self.cleanup()['paths']),1)
 def retry_failed(self,j):
  self.actor_as(100);value=rpc(self.c,'v1_job_get',(uuid.UUID(j['id']),));return rpc(self.c,'v1_job_retry',(uuid.UUID(j['id']),'Document retry after service recovery',value['version'],uuid.uuid4()))
 def test_operator_can_retry_exhausted_storage_failure_with_snapshot_retained(self):
  j,p=self.prepare();self.raw('UPDATE sa_domain.outbox SET attempts=5 WHERE id=%s',(uuid.UUID(j['id']),));self.finish(j,'STORAGE_UNAVAILABLE');self.assertEqual(self.retry_failed(j)['state'],'pending');self.assertEqual(self.raw('SELECT state,snapshot_hash IS NOT NULL FROM sa_domain.documents'),[('queued',True)])
 def test_operator_cannot_retry_after_retention_window(self):
  j,p=self.prepare();self.raw('UPDATE sa_domain.outbox SET attempts=5 WHERE id=%s',(uuid.UUID(j['id']),));self.finish(j,'STORAGE_UNAVAILABLE');self.raw("UPDATE sa_domain.documents SET created_at=now()-interval '23 hours'")
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.retry_failed(j)
 def test_operator_mail_retry_restores_pending_delivery_without_re_render(self):
  r,j,p=self.mail();self.raw('UPDATE sa_domain.outbox SET attempts=5 WHERE id=%s',(uuid.UUID(j['id']),));self.call('squad_business_mail_finish',j,'PROVIDER_UNAVAILABLE');self.assertEqual(self.retry_failed(j)['state'],'pending');self.assertEqual(self.raw('SELECT state,delivery_state FROM sa_domain.documents'),[('ready','pending')])

class Challans(unittest.TestCase):
 setUpClass=work.Execution.__dict__['setUpClass'];setUp=work.Execution.setUp;tearDown=work.Execution.tearDown
 actor=work.Execution.actor;raw=work.Execution.raw;iv=work.Execution.iv;cut=work.Execution.cut;assign=work.Execution.assign;inspect=work.Execution.inspect;dispatch=work.Execution.dispatch;prepare_work=work.Execution.prepare
 def snapshot(self,dispatch_id):
  self.raw('UPDATE sa_sync.environment_state SET cutover=true');r=rpc(self.c,'v1_document_request',('delivery_challan',Jsonb({'item_id':'1001','dispatch_id':str(dispatch_id)}),uuid.uuid4()));self.c.execute('SET LOCAL ROLE sa_executor');return self.c.execute('SELECT sa_domain.document_capture(%s)',(uuid.UUID(r['id']),)).fetchone()[0]['snapshot']
 def test_selected_dispatch_quantity_not_later_cumulative_total(self):
  self.prepare_work();a=self.dispatch(3);self.dispatch(7);self.raw('UPDATE sa_snapshot_20261019.sa_items SET per_piece_amount=100,cgst_amount=25,sgst_amount=25,igst_amount=0 WHERE id=1001');s=self.snapshot(a['history_id']);self.assertEqual(s['quantity'],3);self.assertEqual(Decimal(s['total']),315)
 def test_other_factory_cannot_request_challan(self):
  self.prepare_work();r=self.dispatch(3);self.actor(207)
  with self.assertRaises(psycopg.errors.NoDataFound):self.snapshot(r['history_id'])

class TailorDocuments(unittest.TestCase):
 setUpClass=earnings.Earnings.__dict__['setUpClass'];setUp=earnings.Earnings.setUp;tearDown=earnings.Earnings.tearDown
 actor=earnings.Earnings.actor;raw=earnings.Earnings.raw;iv=earnings.Earnings.iv;cut=earnings.Earnings.cut;assign=earnings.Earnings.assign;inspect=earnings.Earnings.inspect
 def test_report_reuses_formula_and_explicit_week(self):
  self.raw('UPDATE sa_sync.environment_state SET cutover=true');r=rpc(self.c,'v1_document_request',('tailor_weekly',Jsonb({'tailor_id':'105','week_start':'2026-10-24','include_team':True}),uuid.uuid4()));self.c.execute('SET LOCAL ROLE sa_executor');s=self.c.execute('SELECT sa_domain.document_capture(%s)',(uuid.UUID(r['id']),)).fetchone()[0]['snapshot'];self.assertEqual(Decimal(s['summary']['amount']),245);self.assertEqual(s['period']['timezone'],'Asia/Kolkata');self.assertEqual(len(s['rows']),2)

if __name__=='__main__':unittest.main(verbosity=2)
