from sqlstate_assertions import assert_app_conflict
from fixtures import claim_test_workers
"""Local provider customer synchronization, custody and dependency tests."""
import unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import uid,session,rpc
from test_catalogue import seed_catalogue
from test_pricing import rmp
from test_warehouse_receipts import ownership

class WarehouseCustomers(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');ownership(self.c)
  self.c.execute("UPDATE sa_snapshot_20261019.sa_settings SET value='false' WHERE key='use_dashboard'")
  self.c.execute("UPDATE sa_domain.warehouse_config SET provider='unicommerce'")
  self.c.execute("UPDATE sa_snapshot_20261019.sa_addresses SET state='Karnataka',city='Bengaluru',zip_code='560001' WHERE id=100")
  self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true,phone='9000000000',uc_customer_id=NULL WHERE id=103")
  self.actor(103)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n,role='sa_app'):self.c.execute('RESET ROLE');session(self.c,n,role)
 def service(self):self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);v=r.fetchall() if r.description else None;self.service();return v
 def event(self,user=103,actor=103,event='profile.saved',kind='person',payload=None):
  return self.raw('INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload) VALUES(%s,%s,%s,%s,%s,0,%s) RETURNING id',(uid(actor),event,kind,user,uuid.uuid4(),Jsonb(payload or {})))[0][0]
 def claim(self):
  self.service();return claim_test_workers(self.c,'warehouse')
 def prepare(self,j):self.service();return self.c.execute('SELECT canto_api.squad_warehouse_prepare(%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']))).fetchone()[0]
 def finish(self,j,r):self.service();return self.c.execute('SELECT canto_api.squad_warehouse_finish(%s,%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']),Jsonb(r))).fetchone()[0]
 def ack(self,p):return {'code':'CONFIRMED','customer_code':p['payload']['customer']['code'],'proof':{'source':'customer_write_response'}}
 def test_create_uses_current_profile_primary_address_and_stable_code(self):
  self.event();j=self.claim()[0];p=self.prepare(j);self.assertEqual(p['state'],'prepared');self.assertEqual(p['customer_action'],'create');self.assertFalse(p['attempted']);u=p['payload']['customer'];self.assertEqual(u['code'],'S-103');self.assertEqual(u['partyContacts'][0]['partyCode'],'S-PC-103');self.assertEqual(u['shippingAddress']['stateCode'],'KA');self.assertTrue(u['enabled']);self.assertEqual(u['billingAddress'],u['shippingAddress'])
 def test_confirmed_write_persists_code_once(self):
  self.event();j=self.claim()[0];p=self.prepare(j);self.assertEqual(self.finish(j,self.ack(p))['state'],'done');self.assertEqual(self.raw('SELECT uc_customer_id FROM sa_snapshot_20261019.sa_users WHERE id=103'),[('S-103',)]);self.assertTrue(self.finish(j,self.ack(p))['replayed']);self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.audit WHERE operation='warehouse.customer_confirmed'"),[(1,)])
 def test_retry_keeps_exact_frozen_body_and_prior_attempt_flag(self):
  self.event();j=self.claim()[0];p=self.prepare(j);self.raw("UPDATE sa_snapshot_20261019.sa_users SET phone='9999999999' WHERE id=103");p2=self.prepare(j);self.assertTrue(p2['attempted']);self.assertEqual(p['payload'],p2['payload']);self.assertEqual(p['request_key'],p2['request_key'])
 def test_existing_code_uses_edit_not_duplicate_create(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_users SET uc_customer_id='S-103' WHERE id=103");self.event();p=self.prepare(self.claim()[0]);self.assertEqual(p['customer_action'],'edit')
 def test_wrong_environment_code_needs_reconciliation(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_users SET uc_customer_id='P-103' WHERE id=103");self.event();self.assertEqual(self.prepare(self.claim()[0])['state'],'dead')
 def test_actor_disabled_before_http_cannot_prepare(self):
  self.event();j=self.claim()[0];self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=103');self.assertEqual(self.prepare(j)['state'],'dead');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_operations'),[(0,)])
 def test_actor_disabled_after_http_does_not_erase_provider_truth(self):
  self.event();j=self.claim()[0];p=self.prepare(j);self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=103');self.assertEqual(self.finish(j,self.ack(p))['state'],'done');self.assertEqual(self.raw('SELECT uc_customer_id,disabled FROM sa_snapshot_20261019.sa_users WHERE id=103'),[('S-103',True)])
 def test_foreign_customer_scope_denied(self):
  self.event(actor=203);self.assertEqual(self.prepare(self.claim()[0])['state'],'dead')
 def test_missing_contact_data_fails_before_provider(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_users SET phone='' WHERE id=103");self.event();self.assertEqual(self.prepare(self.claim()[0])['state'],'dead');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_operations'),[(0,)])
 def test_wrong_result_identity_is_preserved_as_reconciliation(self):
  self.event();j=self.claim()[0];p=self.prepare(j);ack=self.ack(p);ack['customer_code']='S-203';self.assertEqual(self.finish(j,ack)['state'],'dead');self.assertEqual(self.raw('SELECT uc_customer_id FROM sa_snapshot_20261019.sa_users WHERE id=103'),[(None,)]);self.assertEqual(self.raw('SELECT state FROM sa_domain.warehouse_operations'),[('reconciliation_required',)])
 def test_no_mutation_proof_cannot_publish_code(self):
  self.event();j=self.claim()[0];p=self.prepare(j);ack=self.ack(p);ack['proof']={};self.assertEqual(self.finish(j,ack)['state'],'dead')
 def test_unknown_http_result_is_not_recreated(self):
  self.event();j=self.claim()[0];p=self.prepare(j);self.assertEqual(self.finish(j,{'code':'RECONCILIATION_REQUIRED','error_code':'PROVIDER_CUSTOMER_UNCERTAIN'})['state'],'dead');self.event();self.assertEqual(self.prepare(self.claim()[0])['state'],'dead');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_operations'),[(1,)])
 def test_provider_disabled_after_http_keeps_proof_and_does_not_apply(self):
  self.event();j=self.claim()[0];p=self.prepare(j);self.raw('UPDATE sa_domain.warehouse_config SET enabled=false');self.assertEqual(self.finish(j,self.ack(p))['state'],'dead');self.assertEqual(self.raw("SELECT proof->>'source' FROM sa_domain.warehouse_operations"),[('customer_write_response',)])
 def test_unverified_raw_customer_capability_denied(self):
  self.service()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT sa_domain.warehouse_customer_apply(103,%s)',('S-103',))
 def test_client_cannot_call_customer_worker(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.squad_warehouse_prepare(%s,%s)',(uuid.uuid4(),uuid.uuid4()))
 def test_generation_mismatch_rejects_ack(self):
  self.event();j=self.claim()[0];p=self.prepare(j);self.raw('UPDATE sa_domain.runtime_state SET generation=1')
  with assert_app_conflict(self):self.finish(j,self.ack(p))
 def test_dashboard_keeps_customers_inline_without_standalone_job(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_settings SET value='true' WHERE key='use_dashboard'");self.raw("UPDATE sa_domain.warehouse_config SET provider='dashboard'");self.event();self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='warehouse.customer'"),[(0,)])
 def test_staging_mirror_does_not_emit_customer_effects(self):
  self.raw('UPDATE sa_sync.environment_state SET cutover=false');self.event();self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='warehouse.customer'"),[(0,)])
 def test_address_event_resolves_its_customer(self):
  self.event(user=100,event='address.saved',kind='address',payload={'user_id':'103'});p=self.prepare(self.claim()[0]);self.assertEqual(p['payload']['customer']['code'],'S-103')
 def test_customer_disable_sync_uses_current_disabled_flag(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=103');self.event(actor=100,event='account.status_changed');p=self.prepare(self.claim()[0]);self.assertFalse(p['payload']['customer']['enabled'])
 def test_pre_mutation_oauth_retry_can_safely_retry_first_create(self):
  self.event();j=self.claim()[0];p=self.prepare(j);self.assertFalse(p['attempted']);r=self.finish(j,{'code':'RETRY','error_code':'PROVIDER_TOKEN_UNAVAILABLE','proof':{'mutation_attempted':False}});self.assertEqual(r['state'],'pending');self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s',(uuid.UUID(j['id']),));p2=self.prepare(self.claim()[0]);self.assertFalse(p2['attempted']);self.assertEqual(p['request_key'],p2['request_key'])
 def test_prior_uncertain_attempt_cannot_be_cleared_by_later_preflight(self):
  self.event();j=self.claim()[0];self.prepare(j);self.assertTrue(self.prepare(j)['attempted']);self.finish(j,{'code':'RETRY','error_code':'PROVIDER_TOKEN_UNAVAILABLE','proof':{'mutation_attempted':False}});self.assertEqual(self.raw('SELECT attempted FROM sa_domain.warehouse_operations'),[(True,)])
 def test_released_lease_cannot_publish_customer_result(self):
  self.event();j=self.claim()[0];p=self.prepare(j);self.raw('UPDATE sa_domain.outbox SET lease_token=%s WHERE id=%s',(uuid.uuid4(),uuid.UUID(j['id'])))
  with assert_app_conflict(self):self.finish(j,self.ack(p))
 def test_concurrent_profile_events_wait_and_then_edit_current_values(self):
  self.event();first=self.claim()[0];p=self.prepare(first);self.raw("UPDATE sa_snapshot_20261019.sa_users SET phone='9999999999' WHERE id=103");self.event();second=self.claim()[0];wait=self.prepare(second);self.assertEqual(wait['state'],'pending');self.assertEqual(wait['dependency'],'previous_customer_operation');self.assertEqual(self.finish(first,self.ack(p))['state'],'done');self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s',(uuid.UUID(second['id']),));p2=self.prepare(self.claim()[0]);self.assertEqual(p2['customer_action'],'edit');self.assertEqual(p2['payload']['customer']['partyContacts'][0]['phone'],'9999999999')
 def test_first_order_waits_for_customer_confirmation_then_submits(self):
  self.raw('ALTER SEQUENCE sa_snapshot_20261019.sa_orders_id_seq RESTART WITH 4000');self.raw('ALTER SEQUENCE sa_snapshot_20261019.sa_items_id_seq RESTART WITH 4000');self.actor(103)
  q=rpc(self.c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[rmp(3)]}),));rpc(self.c,'v1_order_place',(uuid.UUID(q['quote_id']),q['version'],Jsonb({'due_at':'2026-12-01T07:00:00Z'}),uuid.uuid4()));order_job=self.claim()[0];wait=self.prepare(order_job);self.assertEqual(wait['state'],'pending');self.assertEqual(wait['dependency'],'customer');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_operations'),[(0,)])
  customer_job=self.claim()[0];p=self.prepare(customer_job);self.assertEqual(self.finish(customer_job,self.ack(p))['state'],'done');self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s',(uuid.UUID(order_job['id']),));p=self.prepare(self.claim()[0]);self.assertEqual(p['operation'],'submit');self.assertEqual(p['payload']['saleOrder']['customerCode'],'S-103')

if __name__=='__main__':unittest.main(verbosity=2)
