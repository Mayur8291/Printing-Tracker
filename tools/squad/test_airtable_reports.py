"""Airtable report projections, private scopes and durable HTTP intent boundaries."""
from sqlstate_assertions import assert_app_conflict
import json,unittest,uuid
from decimal import Decimal
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import uid,rpc,claim_test_workers
from test_catalogue import seed_catalogue
import test_notifications as notifications
class Reports(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 actor_as=notifications.Notifications.actor_as;raw=notifications.Notifications.raw;worker=notifications.Notifications.worker;claim=notifications.Notifications.claim;call=notifications.Notifications.call
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_sync.environment_state SET cutover=true');self.actor_as(100)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def enable(self):self.actor_as(100);return rpc(self.c,'v1_airtable_reports_configure',(True,'0:0',uuid.uuid4()))
 def request(self,kind='item',ids=None):self.actor_as(100);return rpc(self.c,'v1_airtable_reports_request',(kind,ids or [1001],uuid.uuid4()))
 def jobs(self):self.worker();return claim_test_workers(self.c,'airtable_report')
 def prepare(self,j):return self.call('squad_airtable_report_prepare',j)
 def finish(self,j,p):return self.call('squad_airtable_report_finish',j,Jsonb(p))
 def ready(self,kind='item',ids=None):self.enable();self.request(kind,ids);j=self.jobs()[0];return j,self.prepare(j)
 def ack(self,p):return {'code':'CONFIRMED','key':p['key'],'revision':p['revision'],'record_id':'rec'+'A'*14,'fields':p['fields'],**({'parent_record_id':'rec'+'B'*14} if p.get('parent') else {})}
 def emit(self,event,entity=1001,kind='order',payload=None,actor=101):return self.raw('INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload) VALUES(%s,%s,%s,%s,%s,0,%s) RETURNING id',(uid(actor),event,kind,entity,uuid.uuid4(),Jsonb(payload or {})))[0][0]
 def test_default_disabled_is_visible_and_never_dispatches(self):
  self.assertFalse(rpc(self.c,'v1_airtable_reports_status')['enabled']);self.emit('orders.placed',payload={'order_ids':['1001']});self.assertEqual(self.jobs(),[])
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.request()
 def test_configuration_and_requests_require_current_admin(self):
  self.actor_as(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_airtable_reports_configure',(True,'0:0',uuid.uuid4()))
 def test_public_cannot_access_worker_intents(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.c.execute('SELECT * FROM sa_domain.airtable_report_operations')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.c.execute('SELECT canto_api.squad_airtable_report_prepare(%s,%s)',(uuid.uuid4(),uuid.uuid4()))
 def test_customer_projection_all_source_fields_without_credentials_or_legacy_id(self):
  j,p=self.ready('customer',[103]);spec=json.loads((Path(__file__).parents[2]/'supabase/functions/squad-jobs/airtable-reports-contracts.json').read_text());self.assertEqual(p['state'],'prepared');self.assertEqual(set(p['fields']),set(spec['customer']['fields']));self.assertEqual(p['key'],'staging:customer:103');self.assertNotIn('password',str(p));self.assertNotIn('airtable_id',str(p));self.assertEqual(self.finish(j,self.ack(p))['state'],'done')
 def test_custom_report_full_source_field_coverage(self):
  j,p=self.ready();spec=json.loads((Path(__file__).parents[2]/'supabase/functions/squad-jobs/airtable-reports-contracts.json').read_text());self.assertEqual(p['kind'],'custom_order');self.assertEqual(set(p['fields']),set(spec[p['kind']]['fields']));self.assertEqual(p['fields']['Jobsheet Number'],'JS-S-1001')
 def test_ready_made_money_keeps_decimal_cents(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=1,total_amount=105.55,total_quantity=10,cgst_amount=1.25,sgst_amount=1.25,igst_amount=0 WHERE id=1001');j,p=self.ready();spec=json.loads((Path(__file__).parents[2]/'supabase/functions/squad-jobs/airtable-reports-contracts.json').read_text());self.assertEqual(p['kind'],'rmp_order');self.assertEqual(set(p['fields']),set(spec[p['kind']]['fields']));self.assertEqual(Decimal(str(p['fields']['Amount'])),Decimal('105.55'));self.assertEqual(Decimal(str(p['fields']['Total Amount'])),Decimal('108.05'))
 def test_retry_preserves_frozen_fields_and_exact_proof(self):
  j,p=self.ready();self.finish(j,{'code':'RETRY','error_code':'AIRTABLE_UNAVAILABLE'});self.raw('UPDATE sa_snapshot_20261019.sa_items SET total_quantity=99 WHERE id=1001');self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s',(uuid.UUID(j['id']),));again=self.jobs()[0];self.assertEqual(self.prepare(again)['fields'],p['fields']);self.assertEqual(self.finish(again,self.ack(p))['state'],'done');self.assertTrue(self.finish(again,self.ack(p))['replayed'])
 def test_mismatching_proof_requires_reconciliation(self):
  j,p=self.ready();ack=self.ack(p);ack['key']='staging:custom_order:999';self.assertEqual(self.finish(j,ack)['state'],'dead');self.assertEqual(self.raw('SELECT state FROM sa_domain.airtable_report_operations'),[('reconciliation_required',)])
 def test_current_actor_revocation_is_checked_before_projection(self):
  self.enable();self.emit('item.cut',1001,'item',actor=104);j=self.jobs()[0];self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=204 WHERE id=1001');self.assertEqual(self.prepare(j)['state'],'dead')
 def test_disabled_after_queue_is_explicit_and_never_prepared(self):
  self.enable();self.request();self.raw('UPDATE sa_domain.airtable_report_config SET enabled=false');j=self.jobs()[0];self.assertEqual(self.prepare(j)['error_code'],'AIRTABLE_REPORT_DISABLED')
 def test_global_provider_slot_prevents_parallel_rate_bursts(self):
  self.enable();self.request('customer',[103,203]);jobs=self.jobs();self.assertEqual(len(jobs),2);a=self.prepare(jobs[0]);self.assertEqual(a['state'],'prepared');self.assertEqual(self.prepare(jobs[1])['error_code'],'AIRTABLE_REPORT_BUSY');self.finish(jobs[0],self.ack(a));self.assertEqual(self.raw('SELECT active_job FROM sa_domain.airtable_report_config'),[(None,)])
 def test_order_enumeration_routes_items_without_http_payload(self):
  self.enable();self.request('order',[1001]);j=self.jobs()[0];self.assertEqual(self.prepare(j)['state'],'done');p=self.prepare(self.jobs()[0]);self.assertEqual(p['kind'],'custom_order')
 def test_backorder_parent_with_placement_key_is_not_duplicated(self):
  self.enable();self.emit('backorder.placed',payload={'placement_command_key':str(uuid.uuid4())});self.assertEqual(self.jobs(),[])
 def test_old_generation_and_expired_leases_cannot_finish(self):
  j,p=self.ready();self.raw('UPDATE sa_domain.runtime_state SET generation=1')
  with assert_app_conflict(self):self.finish(j,self.ack(p))
 def test_abandoned_http_intent_fences_later_entity_updates(self):
  j,p=self.ready();self.raw("UPDATE sa_domain.outbox SET attempts=5,lease_until=now()-interval '1 second' WHERE id=%s",(uuid.UUID(j['id']),));self.jobs();self.assertEqual(self.raw('SELECT state FROM sa_domain.airtable_report_operations'),[('reconciliation_required',)]);self.request();next_=self.jobs()[0];self.assertEqual(self.prepare(next_)['error_code'],'AIRTABLE_REPORT_PREVIOUS_PENDING')
 def test_tailor_pick_projection_keeps_selected_quantity_and_parent_key(self):
  q=self.raw('SELECT id FROM sa_snapshot_20261019.sa_quantities WHERE item_id=1001 LIMIT 1')[0][0]
  it=self.raw('INSERT INTO sa_snapshot_20261019.sa_item_tailors(item_id,tailor_id,created_at,updated_at) VALUES(1001,105,now(),now()) RETURNING id')[0][0]
  tq=self.raw('INSERT INTO sa_snapshot_20261019.sa_item_tailor_quantities(item_tailor_id,quantity_id,assigned_quantity,created_at,updated_at) VALUES(%s,%s,10,now(),now()) RETURNING id',(it,q))[0][0]
  mark=self.raw("INSERT INTO sa_snapshot_20261019.sa_job_sheet_tailor_mark_dates(item_id,marked_at,created_at,updated_at) VALUES(1001,'2026-11-01 07:30:00',now(),now()) RETURNING id")[0][0]
  pick=self.raw('INSERT INTO sa_snapshot_20261019.sa_job_sheet_mark_tailors(item_tailor_id,job_sheet_tailor_mark_date_id,created_at,updated_at) VALUES(%s,%s,now(),now()) RETURNING id',(it,mark))[0][0]
  self.raw('INSERT INTO sa_snapshot_20261019.sa_mark_tailor_quantities(job_sheet_mark_tailor_id,item_tailor_quantity_id,completed_quantity,qty,created_at,updated_at) VALUES(%s,%s,3,10,now(),now())',(pick,tq))
  j,p=self.ready('tailor_pick',[pick]);spec=json.loads((Path(__file__).parents[2]/'supabase/functions/squad-jobs/airtable-reports-contracts.json').read_text());self.assertEqual(set(p['fields']),set(spec['tailor_pick']['fields']));self.assertEqual(p['fields']['Total Quantity'],3);self.assertEqual(p['fields']['Picking Date/Time'],'2026-11-01 07:30:00');self.assertEqual(p['parent']['key'],'staging:custom_order:1001');self.assertEqual(self.finish(j,self.ack(p))['state'],'done')
 def test_system_callback_exports_only_its_source_order_without_actor_impersonation(self):
  from test_warehouse_receipts import ownership
  self.c.execute('RESET ROLE');ownership(self.c);self.enable();self.emit('warehouse.status_changed',1001,actor=990001);parent=self.jobs()[0];self.assertEqual(self.prepare(parent)['state'],'done');child=self.jobs()[0];p=self.prepare(child);self.assertEqual(p['state'],'prepared');self.assertEqual(p['entity_id'],'1001');self.finish(child,self.ack(p));self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.worker_context'),[(0,)])
 def test_system_callback_capability_cannot_cross_to_another_order(self):
  from test_warehouse_receipts import ownership
  self.c.execute('RESET ROLE');ownership(self.c);self.enable();self.emit('warehouse.status_changed',1001,actor=990001);parent=self.jobs()[0];self.prepare(parent);child=self.jobs()[0];self.raw('UPDATE sa_domain.outbox SET aggregate_id=2001 WHERE id=%s',(uuid.UUID(child['id']),));self.assertEqual(self.prepare(child)['state'],'dead')
 def test_coordinator_and_address_events_derive_actual_customer_ids(self):
  self.enable();self.emit('customers.coordinator_changed',101,'coordinator',{'people':[{'id':'103'},{'id':'203'}]},100);self.emit('customer.coordinator_decided',900,'coordinator_request',{'customer_id':'103'},100);self.emit('address.saved',800,'address',{'user_id':'103'},100);self.assertEqual(self.raw("SELECT aggregate_id FROM sa_domain.outbox WHERE event_type='airtable.report_customer' ORDER BY sequence_id"),[(103,),(203,),(103,),(103,)])
 def test_order_enumeration_is_bounded_and_fixes_its_initial_ceiling(self):
  self.raw('INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,item_type,created_at,updated_at) SELECT 10000+x,1001,0,now(),now() FROM generate_series(1,101) x');self.enable();self.request('order',[1001]);parent=self.jobs()[0];self.assertEqual(self.prepare(parent)['state'],'pending');self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='airtable.report_item'"),[(50,)])
  self.raw('INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,item_type,created_at,updated_at) VALUES(999999,1001,0,now(),now())')
  for expected in [100,102]:
   self.raw("UPDATE sa_domain.outbox SET available_at=CASE WHEN event_type='airtable.report_order' THEN now() ELSE now()+interval '1 day' END WHERE event_type LIKE 'airtable.report_%%'");parent=self.jobs()[0];self.prepare(parent);self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='airtable.report_item'"),[(expected,)])
  self.assertEqual(self.raw("SELECT status FROM sa_domain.outbox WHERE event_type='airtable.report_order'"),[('done',)])

 def test_report_request_idempotency_and_settings_compare_and_swap(self):
  self.enable();self.actor_as(100);key=uuid.uuid4();a=rpc(self.c,'v1_airtable_reports_request',('customer',[103],key));self.assertEqual(a,rpc(self.c,'v1_airtable_reports_request',('customer',[103],key)));self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='airtable.report_customer'"),[(1,)])
  with assert_app_conflict(self),self.c.transaction():rpc(self.c,'v1_airtable_reports_configure',(False,'0:0',uuid.uuid4()))
 def test_non_customer_staff_events_do_not_create_failed_customer_reports(self):
  self.enable();self.emit('person.saved.notify',104,'person',{'created':True});self.emit('profile.saved',101,'person');self.assertEqual(self.jobs(),[])
 def test_config_disable_does_not_erase_confirmed_remote_truth(self):
  j,p=self.ready();self.raw('UPDATE sa_domain.airtable_report_config SET enabled=false');self.assertEqual(self.finish(j,self.ack(p))['state'],'done');self.assertEqual(self.raw('SELECT state,record_id FROM sa_domain.airtable_report_operations'),[('confirmed','rec'+'A'*14)])
 def test_exhausted_provider_retries_require_reconciliation_before_later_write(self):
  j,p=self.ready();self.raw('UPDATE sa_domain.outbox SET attempts=5 WHERE id=%s',(uuid.UUID(j['id']),));self.assertEqual(self.finish(j,{'code':'RETRY','error_code':'AIRTABLE_AUTH_UNAVAILABLE'})['state'],'dead');self.assertEqual(self.raw('SELECT state FROM sa_domain.airtable_report_operations'),[('reconciliation_required',)])

if __name__=='__main__':unittest.main()
