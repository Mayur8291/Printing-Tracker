"""Notifications reuse current recipient authority; tokens never leave private worker calls."""
from sqlstate_assertions import assert_app_conflict
import json,unittest,uuid
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb
from fixtures import seed_orders,session,uid,rpc
from local_db import connect

class Notifications(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_sync.environment_state SET cutover=true');self.actor_as(103)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor_as(self,n):self.actor=n;self.c.execute('RESET ROLE');session(self.c,n,'authenticated' if n==999 else 'sa_app')
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);rows=r.fetchall() if r.description else None;self.actor_as(self.actor);return rows
 def worker(self):self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
 def claim(self,handler=None):
  self.worker();rows=self.c.execute('SELECT canto_api.squad_job_claim(10)').fetchone()[0]['jobs'];return [r for r in rows if handler is None or r['handler']==handler]
 def call(self,name,j,*args):self.worker();return self.c.execute('SELECT canto_api.'+name+'('+','.join(['%s']*(len(args)+2))+')',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']))+args).fetchone()[0]
 def save(self,installation=None,token=None,version=None,key=None):
  return rpc(self.c,'v1_device_save',(installation or uuid.uuid4(),'android',token or 'synthetic_'+uuid.uuid4().hex,version,key or uuid.uuid4()))
 def emit(self,event='order.due_changed',kind='order',id=1001,changes=None):
  return self.raw('INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload) VALUES(%s,%s,%s,%s,%s,0,%s) RETURNING id',(uid(101),event,kind,id,uuid.uuid4(),Jsonb(changes or {})))[0][0]
 def fanout(self):
  for j in self.claim('notification_fanout'):self.call('squad_notification_fanout',j)
 def ready(self):self.emit();self.fanout();return self.claim('notification_delivery')
 def mine(self,jobs):return next(j for j in jobs if self.raw('SELECT actor_id FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(j['id']),))[0][0]==uid(103))
 def test_device_same_command_replays_without_rebinding(self):
  i=uuid.uuid4();k=uuid.uuid4();t='synthetic_'+uuid.uuid4().hex;r=self.save(i,t,key=k);self.assertEqual(r,self.save(i,t,key=k));self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.devices'),[(1,)])
 def test_token_never_in_client_result_audit_command_or_outbox(self):
  t='synthetic_'+uuid.uuid4().hex;r=self.save(token=t);self.assertNotIn(t,json.dumps(r))
  for table in ('commands','audit','outbox'):
   self.assertNotIn(t,str(self.raw('SELECT to_jsonb(x) FROM sa_domain.'+table+' x')))
 def test_raw_device_table_not_client_accessible(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT token FROM sa_domain.devices')
 def test_platform_does_not_become_mobile_user(self):
  self.actor_as(999)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save()
 def test_managed_role_cannot_register(self):
  self.actor_as(105)
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.save()
 def test_mirror_registration_remains_fenced(self):
  self.raw('UPDATE sa_sync.environment_state SET cutover=false')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.save()
 def test_ten_device_bound(self):
  for _ in range(10):self.save()
  with self.assertRaises(psycopg.errors.ProgramLimitExceeded):self.save()
 def test_stale_version_cannot_replace_new_token(self):
  r=self.save();self.save(uuid.UUID(r['installation_id']),version=r['version'])
  with assert_app_conflict(self):self.save(uuid.UUID(r['installation_id']),version=r['version'])
 def test_token_switch_retires_old_account_binding(self):
  t='synthetic_'+uuid.uuid4().hex;old=self.save(token=t);self.actor_as(203);new=self.save(token=t)
  self.assertEqual(self.raw('SELECT active FROM sa_domain.devices WHERE id=%s',(uuid.UUID(old['id']),)),[(False,)])
  self.assertEqual(self.raw('SELECT auth_id FROM sa_domain.devices WHERE id=%s',(uuid.UUID(new['id']),)),[(uid(203),)])
 def test_installation_cannot_be_stolen_without_token(self):
  old=self.save();self.actor_as(203)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.save(uuid.UUID(old['installation_id']))
 def test_own_remove_is_versioned_and_foreign_remove_hidden(self):
  old=self.save();self.actor_as(203)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_device_remove',(uuid.UUID(old['id']),old['version'],uuid.uuid4()))
 def test_remove_prevents_future_dispatch(self):
  old=self.save();rpc(self.c,'v1_device_remove',(uuid.UUID(old['id']),old['version'],uuid.uuid4()));j=self.mine(self.ready());self.assertEqual(self.call('squad_notification_prepare',j)['devices'],[])
 def test_complete_registry_and_no_unreviewed_helpers(self):
  v=json.loads((Path(__file__).resolve().parents[2]/'packages/shared/squad-notification-rules.json').read_text())['rules']
  self.assertEqual(len(v),115);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.notification_rules'),[(115,)])
  self.assertEqual([r['legacy_type'] for r in v if 'correction' in r],[92])
 def test_source_history_never_creates_outbound_events(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_notifications(notification_type,status,recipient_id,order_id,title,body,created_at,updated_at) VALUES(26,1,103,1001,'Unsafe title','Old private price 12345',now(),now())")
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.outbox'),[(0,)])
  data=rpc(self.c,'v1_notifications_list')['data'];self.assertEqual(data[0]['title'],'Order due date changed');self.assertNotIn('12345',json.dumps(data))
 def test_history_recipient_scoping_and_cursor_binding(self):
  for actor in [103,103,203]:self.raw('INSERT INTO sa_snapshot_20261019.sa_notifications(notification_type,status,recipient_id,order_id,created_at,updated_at) VALUES(26,1,%s,1001,now(),now())',(actor,))
  first=rpc(self.c,'v1_notifications_list',(None,None,1));second=rpc(self.c,'v1_notifications_list',(None,first['next_cursor'],1));self.assertNotEqual(first['data'][0]['id'],second['data'][0]['id']);self.actor_as(203)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_notifications_list',(None,first['next_cursor'],1))
 def test_fanout_uses_current_scope_and_deduplicates_recipient(self):
  self.emit('orders.placed',changes={'order_ids':['1001']});self.fanout();rows=self.raw("SELECT actor_id,count(*) FROM sa_domain.outbox WHERE event_type='notification.delivery' GROUP BY actor_id")
  self.assertTrue(rows);self.assertTrue(all(n==1 for _,n in rows))
 def test_due_event_routes_customer_sc_and_all_pcs(self):
  jobs=self.ready();self.assertEqual({self.raw('SELECT actor_id FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(j['id']),))[0][0] for j in jobs},{uid(103),uid(101),uid(102),uid(202)})
 def test_prepare_creates_one_inbox_row_and_returns_only_current_devices(self):
  device=self.save();j=self.mine(self.ready());r=self.call('squad_notification_prepare',j);again=self.call('squad_notification_prepare',j)
  self.assertEqual(r['notification_id'],again['notification_id']);self.assertEqual(r['devices'][0]['id'],device['id']);self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_notifications'),[(1,)])
 def test_changed_order_relationship_blocks_queued_customer(self):
  j=self.mine(self.ready());self.raw('UPDATE sa_snapshot_20261019.sa_orders SET customer_id=203 WHERE id=1001');r=self.call('squad_notification_prepare',j);self.assertEqual(r['state'],'dead');self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_notifications'),[(0,)])
 def test_disabled_recipient_is_not_delivered(self):
  j=self.mine(self.ready());self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=103');self.assertEqual(self.call('squad_notification_prepare',j)['state'],'dead')
 def test_banned_auth_recipient_is_not_delivered(self):
  j=self.mine(self.ready());self.raw("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=%s",(uid(103),));self.assertEqual(self.call('squad_notification_prepare',j)['state'],'dead')
 def test_source_refresh_rejects_queued_delivery(self):
  j=self.mine(self.ready());self.raw('UPDATE sa_domain.runtime_state SET generation=1')
  with assert_app_conflict(self):self.call('squad_notification_prepare',j)
 def test_old_device_generation_not_reused(self):
  self.save();self.raw('UPDATE sa_domain.devices SET generation=-1');j=self.mine(self.ready());self.assertEqual(self.call('squad_notification_prepare',j)['devices'],[])
 def test_invalid_token_result_retires_only_exact_binding(self):
  d=self.save();j=self.mine(self.ready());r=self.call('squad_notification_prepare',j);result=[{'id':d['id'],'revision':'1','code':'UNREGISTERED'}]
  self.assertEqual(self.call('squad_notification_finish',j,Jsonb(result))['state'],'done');self.assertEqual(self.raw('SELECT active FROM sa_domain.devices'),[(False,)])
 def test_late_invalid_token_cannot_retire_rotated_binding(self):
  d=self.save();j=self.mine(self.ready());self.call('squad_notification_prepare',j);self.actor_as(103);self.save(uuid.UUID(d['installation_id']),version=d['version'])
  self.call('squad_notification_finish',j,Jsonb([{'id':d['id'],'revision':'1','code':'UNREGISTERED'}]));self.assertEqual(self.raw('SELECT active FROM sa_domain.devices'),[(True,)])
 def test_provider_error_retries_without_duplicate_inbox_or_successful_device(self):
  d=self.save();j=self.mine(self.ready());r=self.call('squad_notification_prepare',j)
  self.assertEqual(self.call('squad_notification_finish',j,Jsonb([{'id':d['id'],'revision':'1','code':'PROVIDER_UNAVAILABLE'}]))['state'],'pending')
  self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s',(uuid.UUID(j['id']),));j=self.claim('notification_delivery')[0];self.assertEqual(self.call('squad_notification_prepare',j)['notification_id'],r['notification_id'])
 def test_failure_page_only_operators_and_sanitized(self):
  j=self.mine(self.ready());self.raw('UPDATE sa_snapshot_20261019.sa_orders SET customer_id=203 WHERE id=1001');self.call('squad_notification_prepare',j);self.actor_as(999);data=rpc(self.c,'v1_delivery_failures')['data'];self.assertTrue(data);self.assertNotIn('payload',data[0]);self.assertNotIn('lease_token',data[0])
 def test_nonadmin_failure_page_denied(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_delivery_failures')
 def test_no_device_notification_finishes_with_inbox_available(self):
  j=self.mine(self.ready());r=self.call('squad_notification_prepare',j);self.assertEqual(r['devices'],[]);self.assertEqual(self.call('squad_notification_finish',j,Jsonb([]))['state'],'done');self.actor_as(103);self.assertEqual(rpc(self.c,'v1_notifications_list')['data'][0]['id'],r['notification_id'])
 def test_resource_revocation_removes_deeplink_from_existing_inbox(self):
  j=self.mine(self.ready());self.call('squad_notification_prepare',j);self.raw('UPDATE sa_snapshot_20261019.sa_orders SET customer_id=203 WHERE id=1001');self.actor_as(103);self.assertIsNone(rpc(self.c,'v1_notifications_list')['data'][0]['target'])
 def plan(self,event,id=1001,kind='order',changes=None,actor=101):
  return [x[0] for x in self.raw('SELECT * FROM sa_domain.notification_plan(%s,%s,%s,%s,%s)',(event,kind,id,uid(actor),Jsonb(changes or {})))]
 def test_placement_actor_and_route_variants(self):
  for family in [0,1]:
   for actor in [101,103,110]:
    for dealer in [None,110]:
     self.raw('UPDATE sa_snapshot_20261019.sa_orders SET order_item_type=%s,customer_dealer_id=%s WHERE id=1001',(family,dealer))
     p=self.plan('orders.placed',changes={'order_ids':['1001']},actor=actor)
     expected={(0,101,False):[9,10],(0,101,True):[11,12],(0,103,False):[3,4],(0,103,True):[3,106],(0,110,False):[5,6],(0,110,True):[5,6],(1,101,False):[109,110,111,112],(1,101,True):[11,12],(1,103,False):[14,15,107,108],(1,103,True):[116,117],(1,110,False):[7,8],(1,110,True):[113,114]}[(family,actor,dealer is not None)]
     self.assertEqual(p[0]['types'],expected)
 def test_cut_and_inspection_use_actual_zero_one_legacy_statuses(self):
  for complete in [0,1]:
   self.raw('UPDATE sa_snapshot_20261019.sa_orders SET cutting_status=%s WHERE id=1001',(complete,));self.raw('UPDATE sa_snapshot_20261019.sa_items SET completed_by_tailor_quantity_status=%s WHERE id=1001',(complete,))
   self.assertEqual(self.plan('item.cut',kind='item')[0]['types'],[41,42,43,44] if complete else [37,38,39,40])
   self.assertEqual(self.plan('item.inspected',kind='item')[0]['types'],[53,54,55,56,57] if complete else [49,50,51,52])
 def test_worker_stages_preserve_source_enum_semantics(self):
  for stage,types in [(0,[67,68]),(1,[69,70]),(2,[]),(3,[71,72,73]),(4,[]),(5,[])]:
   result=self.plan('item.worker_stage_changed',kind='item',changes={'after':stage});self.assertEqual(result[0]['types'] if result else [],types)
 def test_provider_queued_change_never_announces_completion_early(self):
  self.assertEqual(self.plan('order.edited',changes={'request_id':str(uuid.uuid4())}),[])
  self.assertEqual(self.plan('order.cancellation_requested',changes={'provider_confirmation_required':True}),[])
  self.assertTrue(self.plan('order.amendment_applied'))
 def test_inspectors_require_an_assigned_manager(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=NULL WHERE id=1001')
  self.assertFalse(any(x.get('role')==8 for x in self.plan('item.work_assigned',kind='item')[0]['audience']))
 def test_coordinator_batch_captures_each_customer(self):
  self.assertEqual({x['id'] for x in self.plan('customers.coordinator_changed',kind='coordinator',id=101,changes={'people':[{'id':'103'},{'id':'203'}]})},{'103','203'})
 def test_non_notification_changes_have_no_fanout(self):
  for event,kind,id in [('profile.saved','person',103),('device.saved','device',103),('order.priority_changed','order',1001),('order.payment_recorded','order',1001)]:self.assertEqual(self.plan(event,id,kind),[])
 def test_task_assign_remove_and_content_updates_have_distinct_recipients(self):
  self.actor_as(101);created=rpc(self.c,'v1_task_save',(None,'Original task','2030-01-01T00:00:00Z',None,[102,104],None,uuid.uuid4()))
  rows=self.raw("SELECT payload FROM sa_domain.outbox WHERE event_type='notification.fanout'");self.assertEqual(len(rows),1);self.assertEqual(rows[0][0]['topic'],'task.assigned')
  rpc(self.c,'v1_task_save',(int(created['id']),'Updated task','2030-01-01T00:00:00Z',None,[102],created['version'],uuid.uuid4()))
  plans=[x[0] for x in self.raw("SELECT payload FROM sa_domain.outbox WHERE event_type='notification.fanout' ORDER BY sequence_id")];self.assertEqual({p['topic'] for p in plans},{'task.assigned','task.removed','task.changed'})
  self.fanout();jobs=self.claim('notification_delivery');removed=next(j for j in jobs if self.raw('SELECT actor_id,payload->>\'topic\' FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(j['id']),))[0]==(uid(104),'task.removed'))
  r=self.call('squad_notification_prepare',removed);self.assertEqual(r['state'],'prepared');self.actor_as(104);n=rpc(self.c,'v1_notifications_list')['data'][0];self.assertEqual(n['topic'],'task.removed');self.assertIsNone(n['target'])
 def test_account_refresh_invalidates_binding_without_replaying_history(self):
  from domain_sync import after_publication
  self.save();self.c.execute('RESET ROLE');result=after_publication(self.c);self.assertEqual(result['discarded_device_bindings'],1);self.assertFalse(self.c.execute('SELECT active FROM sa_domain.devices').fetchone()[0])
 def test_same_token_can_recover_registration_version_after_local_state_loss(self):
  token='synthetic_'+uuid.uuid4().hex;first=self.save(token=token);second=self.save(uuid.UUID(first['installation_id']),token=token);self.assertEqual(first['id'],second['id'])
 def test_foreign_or_stale_delivery_result_cannot_remove_another_device(self):
  d=self.save();j=self.mine(self.ready());self.call('squad_notification_prepare',j)
  with assert_app_conflict(self):self.call('squad_notification_finish',j,Jsonb([{'id':d['id'],'revision':'2','code':'UNREGISTERED'}]))
 def test_provider_retry_after_is_persisted_in_queue(self):
  d=self.save();j=self.mine(self.ready());self.call('squad_notification_prepare',j);self.call('squad_notification_finish',j,Jsonb([{'id':d['id'],'revision':'1','code':'RATE_LIMITED','retry_after':7200}]))
  self.assertEqual(self.raw('SELECT extract(epoch from available_at-now())::integer FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(j['id']),)),[(7200,)])
 def test_validated_delivery_is_not_reported_as_phone_delivery(self):
  d=self.save();j=self.mine(self.ready());self.call('squad_notification_prepare',j);self.call('squad_notification_finish',j,Jsonb([{'id':d['id'],'revision':'1','code':'VALIDATED'}]));self.actor_as(103)
  self.assertEqual(rpc(self.c,'v1_notifications_list')['data'][0]['push_state'],'validated')
 def test_fanout_resumes_after_one_hundred_without_duplicates(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_users(id,email,name,role,created_at,updated_at) SELECT n,'fanout-'||n||'@squad.invalid','Synthetic admin',0,now(),now() FROM generate_series(3000,3119)n")
  self.raw('INSERT INTO sa_sync.legacy_identity_keys SELECT n FROM generate_series(3000,3119)n')
  self.raw("INSERT INTO sa_identity.sa_auth_identities(auth_user_id,legacy_user_id,canonical_email,import_disposition,enrollment_state,source_was_confirmed,confirmation_basis) SELECT gen_random_uuid(),id,email,'candidate','ready',true,'source_confirmed' FROM sa_snapshot_20261019.sa_users WHERE id BETWEEN 3000 AND 3119")
  self.emit('account.registration_completed','person',103);j=self.claim('notification_fanout')[0]
  self.assertEqual(self.call('squad_notification_fanout',j)['recipients'],100)
  j=self.claim('notification_fanout')[0];self.assertEqual(self.call('squad_notification_fanout',j)['recipients'],22);self.assertTrue(self.call('squad_notification_fanout',j)['replayed'])
  self.assertEqual(self.raw("SELECT count(*),count(DISTINCT actor_id) FROM sa_domain.outbox WHERE event_type='notification.delivery'"),[(122,122)])
 def test_partial_device_retry_does_not_resend_already_accepted_device(self):
  a=self.save();b=self.save();j=self.mine(self.ready());self.call('squad_notification_prepare',j)
  self.call('squad_notification_finish',j,Jsonb([{'id':a['id'],'revision':'1','code':'SENT'},{'id':b['id'],'revision':'1','code':'PROVIDER_UNAVAILABLE'}]))
  self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s',(uuid.UUID(j['id']),));j=self.claim('notification_delivery')[0]
  self.assertEqual([d['id'] for d in self.call('squad_notification_prepare',j)['devices']],[b['id']])
 def test_dynamic_order_edit_dispatch_preserves_all_source_branches(self):
  cases=[(0,3,103,101,None,3,[78,79,80]),(0,10,110,101,None,10,[81,82,83]),(0,3,103,101,110,3,[84,85]),(0,1,101,101,None,3,[86,87]),(0,1,101,101,None,10,[88]),(1,3,103,101,None,3,[89,90,91]),(1,10,110,101,None,10,[89,90,91]),(1,10,110,101,110,3,[92,93]),(1,1,101,101,None,3,[94,95,96]),(2,1,101,101,None,3,[86,87])]
  for *args,expected in cases:
   self.assertEqual(self.raw('SELECT sa_domain.notification_edit_types(%s,%s,%s,%s,%s,%s)',tuple(args))[0][0],expected)
  self.assertEqual(self.plan('order.amendment_applied')[0]['types'],[94,95,96])
 def test_completion_alert_is_emitted_only_when_order_finishes(self):
  self.assertEqual({p['topic'] for p in self.plan('item.dispatched',kind='item')},{'item.dispatched'})
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET status=1 WHERE id=1001')
  self.assertEqual({p['topic'] for p in self.plan('item.dispatched',kind='item')},{'item.dispatched','order.completed'})
  self.assertEqual({p['topic'] for p in self.plan('item.worker_stage_changed',kind='item',changes={'after':5})},{'order.completed'})
 def test_price_override_alert_joins_placement_and_only_applied_edits(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET per_piece_amount=90,calculated_per_piece_amount=100 WHERE id=1001')
  self.assertEqual({p['topic'] for p in self.plan('orders.placed',changes={'order_ids':['1001']})},{'order.placed','order.price_changed'})
  self.assertEqual(self.plan('order.edited',changes={'request_id':str(uuid.uuid4()),'price_changed':True}),[])
  self.assertEqual({p['topic'] for p in self.plan('order.amendment_applied',changes={'price_changed':True})},{'order.edited','order.price_changed'})
 def test_price_comparison_ignores_quantity_only_changes(self):
  row=self.raw('SELECT to_jsonb(i) FROM sa_snapshot_20261019.sa_items i WHERE id=1001')[0][0];row['total_quantity']=1
  before={'items':[row]};self.assertFalse(self.raw('SELECT sa_domain.amendment_prices_changed(%s,1001)',(Jsonb(before),))[0][0])
  row['per_piece_amount']=90;self.assertTrue(self.raw('SELECT sa_domain.amendment_prices_changed(%s,1001)',(Jsonb(before),))[0][0])
 def test_delayed_push_cannot_open_reused_id_after_refresh(self):
  with assert_app_conflict(self):rpc(self.c,'v1_notifications_list',(1001,None,1,99))
 def test_inbox_response_has_current_generation(self):
  self.assertEqual(rpc(self.c,'v1_notifications_list')['generation'],'0')

if __name__=='__main__':unittest.main(verbosity=2)
