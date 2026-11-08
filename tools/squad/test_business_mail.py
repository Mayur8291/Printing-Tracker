"""Synthetic mail identities, recipient scope, durable fanout and retry contract."""
from sqlstate_assertions import assert_app_conflict
import unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed_orders,session,uid,rpc
import test_notifications as notifications

class BusinessMail(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 actor_as=notifications.Notifications.actor_as;raw=notifications.Notifications.raw;worker=notifications.Notifications.worker;call=notifications.Notifications.call
 def claim(self,handler):
  # A consumer leases at most one slow delivery per batch. Collect consecutive
  # consumer claims here so recipient-set assertions still cover the full fanout.
  result=[]
  for _ in range(100):
   batch=notifications.Notifications.claim(self,handler)
   if not batch:return result
   result.extend(batch)
  self.fail('Unbounded mail fixture queue')
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_sync.environment_state SET cutover=true');self.actor_as(101)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def emit(self,event='orders.placed',entity=1004,kind='order',payload=None,actor=101):
  return self.raw('INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload) VALUES(%s,%s,%s,%s,%s,0,%s) RETURNING id',(uid(actor),event,kind,entity,uuid.uuid4(),Jsonb(payload if payload is not None else {'order_ids':[str(entity)]})))[0][0]
 def fanout(self):
  jobs=self.claim('business_mail');return [(j,self.call('squad_business_mail_prepare',j)) for j in jobs]
 def deliveries(self):return [j for j in self.claim('business_mail') if self.raw('SELECT event_type FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(j['id']),))[0][0]=='business.mail_delivery']
 def configure(self,kind='price_alert',ids=None):
  self.actor_as(100);version=self.raw('SELECT sa_domain.version(%s,sa_domain.mail_setting_id(%s))',('mail_settings',kind))[0][0]
  return rpc(self.c,'v1_mail_settings_save',(kind,ids or [100],version,uuid.uuid4()))
 def ready(self):self.emit();self.fanout();j=self.deliveries()[0];return j,self.call('squad_business_mail_prepare',j)
 def test_dealer_order_routes_only_current_dealer_and_preserves_totals(self):
  j,m=self.ready();self.assertEqual(m['kind'],'dealer_order');self.assertEqual(m['email'],'persona-110@squad.invalid');self.assertEqual(m['data']['total_quantity'],'10');self.assertEqual(len(m['data']['items']),1)
 def test_non_dealer_order_is_explicitly_ignored(self):
  self.emit(entity=1001);results=self.fanout();self.assertEqual(results[0][1]['state'],'done');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.business_mail_deliveries'),[(0,)])
 def test_reassignment_after_fanout_blocks_delivery(self):
  self.emit();self.fanout();j=self.deliveries()[0];self.raw('UPDATE sa_snapshot_20261019.sa_orders SET customer_dealer_id=210 WHERE id=1004');self.assertEqual(self.call('squad_business_mail_prepare',j)['error_code'],'MAIL_RECIPIENT_UNAVAILABLE')
 def test_banned_and_demoted_recipients_are_rechecked(self):
  for mutation,args in [('UPDATE auth.users SET banned_until=now()+interval \'1 day\' WHERE id=%s',(uid(110),)),('UPDATE sa_snapshot_20261019.sa_users SET role=3 WHERE id=110',())]:
   with self.c.transaction():
    j,m=self.ready();self.raw(mutation,args);self.assertEqual(self.call('squad_business_mail_prepare',j)['state'],'dead');raise psycopg.Rollback()
 def test_email_binding_change_does_not_resend_to_new_address(self):
  j,m=self.ready();self.call('squad_business_mail_finish',j,'PROVIDER_UNAVAILABLE');self.raw('UPDATE sa_snapshot_20261019.sa_users SET email=%s WHERE id=110',('changed@squad.invalid',));self.raw('UPDATE auth.users SET email=%s WHERE id=%s',('changed@squad.invalid',uid(110)));self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s',(uuid.UUID(j['id']),));again=self.deliveries()[0];self.assertEqual(self.call('squad_business_mail_prepare',again)['state'],'dead')
 def test_sent_finish_is_idempotent_and_does_not_requeue(self):
  j,m=self.ready();self.assertEqual(self.call('squad_business_mail_finish',j,'SENT')['state'],'done');self.assertTrue(self.call('squad_business_mail_finish',j,'SENT')['replayed']);self.assertEqual(self.call('squad_business_mail_prepare',j)['state'],'done')
 def test_provider_failure_reuses_bound_message_and_frozen_content(self):
  j,m=self.ready();self.assertEqual(self.call('squad_business_mail_finish',j,'PROVIDER_UNAVAILABLE')['state'],'pending');self.raw('UPDATE sa_snapshot_20261019.sa_orders SET total_amount=9999 WHERE id=1004');self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s',(uuid.UUID(j['id']),));again=self.deliveries()[0];current=self.call('squad_business_mail_prepare',again);self.assertEqual(current['message_id'],m['message_id']);self.assertEqual(current['data'],m['data'])
 def test_unconfigured_price_alert_is_durable_failure(self):
  self.emit('order.price_changed',1001,payload={});self.assertEqual(self.fanout()[0][1]['error_code'],'MAIL_NOT_CONFIGURED')
 def test_price_alert_uses_configured_current_admin_and_source_comparison(self):
  self.configure();self.raw('UPDATE sa_snapshot_20261019.sa_items SET per_piece_amount=90,calculated_per_piece_amount=100 WHERE id=1001');self.emit('order.price_changed',1001,payload={});self.fanout();j=self.deliveries()[0];m=self.call('squad_business_mail_prepare',j);self.assertEqual(m['email'],'persona-100@squad.invalid');self.assertEqual((m['data']['original_price'],m['data']['changed_price']),('100','90'))
 def test_removed_configured_recipient_loses_queued_mail(self):
  self.configure();self.emit('order.price_changed',1001,payload={});self.fanout();j=self.deliveries()[0];self.raw("UPDATE sa_domain.business_mail_settings SET recipient_ids='{}' WHERE kind='price_alert'");self.assertEqual(self.call('squad_business_mail_prepare',j)['state'],'dead')
 def test_config_rejects_non_admin_duplicate_and_unscoped_users(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():rpc(self.c,'v1_mail_settings_read')
  self.actor_as(100)
  for ids in [[103],[100,100],[None]]:
   with self.assertRaises((psycopg.errors.InsufficientPrivilege,psycopg.errors.InvalidParameterValue)),self.c.transaction():rpc(self.c,'v1_mail_settings_save',('price_alert',ids,'0:0',uuid.uuid4()))
 def document(self,kind,actor=104,request=None):
  self.actor_as(actor);doc=uuid.uuid4();role=actor%100;spec={'delivery':'email',**(request or {})};path=f'g0/{uid(actor)}/{doc}/document.pdf'
  seq=self.raw("INSERT INTO sa_domain.documents(id,actor_id,legacy_user_id,role_id,generation,kind,request,authority_scope,state,delivery_state,object_path,bytes,sha256,page_count,expires_at) VALUES(%s,%s,%s,%s,0,%s,%s,%s,'ready','pending',%s,1000,%s,2,now()+interval '3 days') RETURNING sequence_id",(doc,uid(actor),actor,role,kind,Jsonb(spec),Jsonb({'items':['1001']} if kind=='tailor_weekly' else {}),path,'a'*64))[0][0]
  self.emit('document.mail',seq,'document',{'document_id':str(doc)},actor);jobs=self.claim('document_mail');self.assertEqual(len(jobs),1);result=self.call('squad_document_mail_prepare',jobs[0]);return doc,result
 def test_challan_targets_order_customer_instead_of_requesting_dispatch_staff(self):
  doc,fanout=self.document('delivery_challan',107,{'item_id':'1001'});self.assertEqual(fanout['state'],'done');j=self.deliveries()[0];m=self.call('squad_business_mail_prepare',j);self.assertEqual(m['email'],'persona-103@squad.invalid');self.assertEqual(m['data']['document_id'],str(doc));self.assertTrue(m['attachment']['path'].endswith('/document.pdf'))
 def test_challan_customer_reassignment_revokes_queued_attachment(self):
  self.document('delivery_challan',107,{'item_id':'1001'});j=self.deliveries()[0];self.raw('UPDATE sa_snapshot_20261019.sa_orders SET customer_id=203 WHERE id=1001');self.assertEqual(self.call('squad_business_mail_prepare',j)['state'],'dead')
 def test_weekly_report_fans_out_only_configured_users_with_current_factory_scope(self):
  self.configure('tailor_weekly',[100,104,204]);doc,f=self.document('tailor_weekly',104,{'tailor_id':'105'});self.assertEqual(f['state'],'done');jobs=self.deliveries();results=[self.call('squad_business_mail_prepare',j) for j in jobs];self.assertEqual(sum(x['state']=='prepared' for x in results),2);self.assertEqual(sum(x['state']=='dead' for x in results),1)
 def test_document_delivery_finishes_only_after_every_recipient(self):
  self.configure('tailor_weekly',[100,104]);doc,f=self.document('tailor_weekly',104,{'tailor_id':'105'});jobs=self.deliveries()
  for index,j in enumerate(jobs):self.call('squad_business_mail_prepare',j);self.call('squad_business_mail_finish',j,'SENT');self.assertEqual(self.raw('SELECT delivery_state FROM sa_domain.documents WHERE id=%s',(doc,))[0][0],'pending' if index==0 else 'sent')
 def test_catalogue_keeps_original_owner_and_role_check(self):
  doc,f=self.document('catalogue',103);self.assertEqual(f['state'],'done');j=self.deliveries()[0];self.assertEqual(self.call('squad_business_mail_prepare',j)['email'],'persona-103@squad.invalid')
 def test_welcome_follows_successful_account_notify_and_never_contains_password(self):
  self.emit('person.saved.notify',103,'person',{'created':True});self.fanout();j=self.deliveries()[0];m=self.call('squad_business_mail_prepare',j);self.assertEqual(m['kind'],'welcome');self.assertEqual(m['data']['role'],3);self.assertNotIn('password',str(m['data']))
 def test_bulk_price_terminal_state_captures_once_and_preserves_counts(self):
  self.configure('bulk_price_result');source=self.emit('transfer.requested',1,'import',{},999)
  transfer=self.raw("INSERT INTO sa_domain.transfers(actor_id,principal,generation,direction,kind,job_id,total_rows,valid_rows,invalid_rows,applied_rows) VALUES(%s,'platform',0,'import','prices',%s,10,9,1,9) RETURNING id",(uid(999),source))[0][0]
  self.raw("UPDATE sa_domain.transfers SET state='completed' WHERE id=%s",(transfer,));self.raw("UPDATE sa_domain.transfers SET state='completed' WHERE id=%s",(transfer,));self.fanout();j=self.deliveries()[0];m=self.call('squad_business_mail_prepare',j);self.assertEqual((m['data']['total'],m['data']['applied']),('10','9'));self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.business_mail_deliveries WHERE kind='bulk_price_result'"),[(1,)])
 def retry(self,j):
  self.actor_as(100);v=rpc(self.c,'v1_job_get',(uuid.UUID(j['id']),));return rpc(self.c,'v1_job_retry',(uuid.UUID(j['id']),'Retry mail after service recovery',v['version'],uuid.uuid4()))
 def test_initial_order_override_queues_independent_dealer_and_price_mail(self):
  self.configure();self.raw('UPDATE sa_snapshot_20261019.sa_items SET per_piece_amount=90,calculated_per_piece_amount=100,item_type=0 WHERE order_id=1004');self.emit();self.fanout();jobs=self.deliveries();messages=[self.call('squad_business_mail_prepare',j) for j in jobs];self.assertEqual({m['kind'] for m in messages},{'dealer_order','price_alert'});self.assertEqual({m['email'] for m in messages},{'persona-110@squad.invalid','persona-100@squad.invalid'})
 def test_pending_provider_amendment_cannot_email_before_confirmation(self):
  self.emit('order.edited',1004,payload={'price_changed':True,'request_id':str(uuid.uuid4())});self.assertEqual(self.fanout(),[]);self.emit('order.amendment_applied',1004,payload={'price_changed':True});self.assertEqual(self.fanout()[0][1]['error_code'],'MAIL_NOT_CONFIGURED')
 def test_unapproved_registration_waits_for_successful_approval_reconciliation(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET approved=false WHERE id=103');self.emit('account.registration_completed',103,'person',{});self.assertEqual(self.fanout(),[]);self.raw('UPDATE sa_snapshot_20261019.sa_users SET approved=true WHERE id=103');self.emit('customer.reviewed.notify',103,'person',{'before':{'approved':False},'after':{'approved':True}});self.fanout();j=self.deliveries()[0];self.assertEqual(self.call('squad_business_mail_prepare',j)['kind'],'welcome')
 def test_config_idempotency_cas_and_string_identifiers(self):
  self.actor_as(100);key=uuid.uuid4();a=rpc(self.c,'v1_mail_settings_save',('price_alert',[100],'0:0',key));self.assertEqual(a,rpc(self.c,'v1_mail_settings_save',('price_alert',[100],'0:0',key)));self.assertEqual(a['recipient_ids'],['100']);self.assertEqual(next(x for x in rpc(self.c,'v1_mail_settings_read')['data'] if x['kind']=='price_alert')['recipient_ids'],['100'])
  with assert_app_conflict(self),self.c.transaction():rpc(self.c,'v1_mail_settings_save',('price_alert',[],'0:0',uuid.uuid4()))
 def test_operator_retries_configuration_failure_only_after_fix(self):
  self.emit('order.price_changed',1001,payload={});j,m=self.fanout()[0];self.assertEqual(m['state'],'dead');self.configure();self.assertEqual(self.retry(j)['state'],'pending');self.assertEqual(self.fanout()[0][1]['state'],'done');self.assertEqual(len(self.deliveries()),1)
 def test_exhausted_mail_lease_has_visible_failure_and_operator_retry(self):
  j,m=self.ready();self.raw("UPDATE sa_domain.outbox SET attempts=5,lease_until=now()-interval '1 second' WHERE id=%s",(uuid.UUID(j['id']),));self.claim('business_mail');self.assertEqual(self.raw('SELECT state,error_code FROM sa_domain.business_mail_deliveries'),[('failed','LEASE_EXHAUSTED')]);self.assertEqual(self.retry(j)['state'],'pending');again=self.deliveries()[0];self.assertEqual(self.call('squad_business_mail_prepare',again)['message_id'],m['message_id'])
 def test_exhausted_document_delivery_marks_document_failed(self):
  doc,f=self.document('catalogue',103);j=self.deliveries()[0];self.call('squad_business_mail_prepare',j);self.raw("UPDATE sa_domain.outbox SET attempts=5,lease_until=now()-interval '1 second' WHERE id=%s",(uuid.UUID(j['id']),));self.claim('business_mail');self.assertEqual(self.raw('SELECT delivery_state FROM sa_domain.documents WHERE id=%s',(doc,)),[('failed',)])
 def test_expired_lease_cannot_finish_or_read_private_content(self):
  j,m=self.ready();self.raw("UPDATE sa_domain.outbox SET lease_until=now()-interval '1 second' WHERE id=%s",(uuid.UUID(j['id']),))
  for operation,args in [('squad_business_mail_prepare',()),('squad_business_mail_finish',('SENT',))]:
   with assert_app_conflict(self),self.c.transaction():self.call(operation,j,*args)
 def test_refresh_discards_private_delivery_intent(self):
  from domain_sync import after_publication
  j,m=self.ready();self.c.execute('RESET ROLE');self.c.execute('UPDATE sa_sync.environment_state SET cutover=false');after_publication(self.c);self.assertEqual(self.c.execute('SELECT state,error_code FROM sa_domain.business_mail_deliveries').fetchall(),[('failed','SOURCE_REFRESH_DISCARDED')])
 def test_expired_document_cannot_be_retried(self):
  doc,f=self.document('catalogue',103);j=self.deliveries()[0];self.call('squad_business_mail_prepare',j);self.call('squad_business_mail_finish',j,'MAIL_NOT_ENABLED');self.raw("UPDATE sa_domain.documents SET expires_at=now()-interval '1 second' WHERE id=%s",(doc,))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.retry(j)
 def test_raw_mail_tables_and_worker_rpcs_are_private(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.c.execute('SELECT * FROM sa_domain.business_mail_deliveries')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.c.execute('SELECT canto_api.squad_business_mail_prepare(%s,%s)',(uuid.uuid4(),uuid.uuid4()))
 def test_generation_and_expired_lease_are_fenced(self):
  j,m=self.ready();self.raw('UPDATE sa_domain.runtime_state SET generation=1')
  with assert_app_conflict(self):self.call('squad_business_mail_finish',j,'SENT')

if __name__=='__main__':unittest.main()
