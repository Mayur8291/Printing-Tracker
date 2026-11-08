from fixtures import claim_test_workers
"""Durable provider-confirmed order changes, with actual shared local publication."""
import datetime,decimal,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import uid,session,rpc
from test_catalogue import seed_catalogue
from test_pricing import rmp,custom,CONFIG
from test_warehouse_receipts import ownership

class WarehouseAmendments(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');ownership(self.c)
  self.c.execute("UPDATE sa_snapshot_20261019.sa_addresses SET state='Karnataka',city='Bengaluru',zip_code='560001' WHERE id=100")
  self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true,phone='9000000000',uc_customer_id='S-103' WHERE id=103")
  self.c.execute("SELECT setval('sa_snapshot_20261019.sa_orders_id_seq',5000),setval('sa_snapshot_20261019.sa_items_id_seq',5000)")
  self.provider='dashboard';self.actor(103)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n,role='sa_app'):self.c.execute('RESET ROLE');session(self.c,n,role)
 def service(self):self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);v=r.fetchall() if r.description else None;self.service();return v
 def claim(self):
  self.service();return claim_test_workers(self.c,'warehouse')
 def prepare(self,j):self.service();return self.c.execute('SELECT canto_api.squad_warehouse_prepare(%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']))).fetchone()[0]
 def finish(self,j,r):self.service();return self.c.execute('SELECT canto_api.squad_warehouse_finish(%s,%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']),Jsonb(r))).fetchone()[0]
 def ack(self,p,status='PENDING'):
  return {'code':'CONFIRMED','external_id':p.get('provider_order_id') or ('ord_'+p['intent_id'].replace('-','') if self.provider=='dashboard' else p['order_code']),'external_code':p['order_code'],'status':status,'proof':{'source':'atomic_mutation_response','request_key':p['request_key']}}
 def use_uniware(self):self.provider='unicommerce';self.raw("UPDATE sa_snapshot_20261019.sa_settings SET value='false' WHERE key='use_dashboard'");self.raw("UPDATE sa_domain.warehouse_config SET provider='unicommerce'")
 def place(self,confirmed=True,qty=3):
  self.actor(103);q=rpc(self.c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[rmp(qty)]}),));result=rpc(self.c,'v1_order_place',(uuid.UUID(q['quote_id']),q['version'],Jsonb({'due_at':'2026-12-01T07:00:00Z'}),uuid.uuid4()));self.order=result['orders'][0];self.oid=int(self.order['id']);self.old_items=self.raw('SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=%s',(self.oid,));job=self.claim()[0]
  if confirmed:
   p=self.prepare(job);ack=self.finish(job,self.ack(p));self.assertEqual(ack['state'],'done',ack)
  else:self.raw("UPDATE sa_domain.outbox SET status='done' WHERE id=%s",(uuid.UUID(job['id']),))
 def version(self):self.actor(101);return rpc(self.c,'v1_order_get',(self.oid,))['version']
 def edit(self,qty=6):
  version=self.version();q=rpc(self.c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[rmp(qty)]}),));result=rpc(self.c,'v1_order_edit',(self.oid,uuid.UUID(q['quote_id']),q['version'],Jsonb({'due_at':'2026-12-02T07:00:00Z'}),'Requested warehouse amendment',version,uuid.uuid4()));self.rid=uuid.UUID(result['request_id']);j=self.claim()[0];return j,self.prepare(j)
 def cancel(self,kind='cancel',actor=101):
  version=self.version();self.actor(actor);result=rpc(self.c,'v1_order_cancel',(self.oid,kind,'Requested warehouse cancellation',version,uuid.uuid4()));self.rid=uuid.UUID(result['request_id']);j=self.claim()[0];return j,self.prepare(j)
 def observed(self,p):
  if self.provider=='dashboard':items=[{'sku_code':'SKU A','quantity':3,'dispatched_quantity':0}]
  else:items=[{'code':f'old-{n}','sku_code':'SKU A','facility_code':'ONE','status':'CREATED','total_price':'105','selling_price':'105'} for n in range(3)]
  return {'code':'OBSERVED','external_id':p['provider_order_id'],'external_code':p['order_code'],'status':'PROCESSING','proof':{'updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat() if self.provider=='dashboard' else 1700000000000,'items':items}}
 def next_phase(self,j,p):
  r=self.finish(j,self.observed(p));self.assertEqual(r['state'],'pending',r);j2=self.claim()[0];p2=self.prepare(j2);self.assertEqual(p2['state'],'prepared',p2);return j2,p2
 def cancel_ack(self,p):
  r=self.ack(p,'CANCELLED')
  if self.provider=='unicommerce':r['proof']={'cancelled_item_codes':p['payload']['saleOrderItemCodes'],'items':[{'code':x,'status':'CANCELLED'} for x in p['payload']['saleOrderItemCodes']]}
  return r
 def test_dashboard_inspect_amend_then_publish_once(self):
  self.place();j,p=self.edit();self.assertEqual(p['operation'],'inspect',p);self.assertEqual(self.raw('SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=%s',(self.oid,)),self.old_items);j,p=self.next_phase(j,p);self.assertEqual(p['operation'],'amend');self.assertIn('expected_updated_at',p['payload']);self.assertNotIn('payment',p['payload']);r=self.finish(j,self.ack(p));self.assertEqual(r['state'],'done',r);self.assertEqual(r['result']['state'],'applied');self.assertTrue(self.finish(j,self.ack(p))['replayed']);self.assertEqual(self.raw('SELECT total_quantity FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.oid,)),[(6,)]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.order_amendments WHERE order_id=%s',(self.oid,)),[(1,)])
 def test_uniware_cancel_and_replacement_are_separate_durable_phases(self):
  self.use_uniware();self.place();j,p=self.edit();j,p=self.next_phase(j,p);self.assertEqual(p['operation'],'cancel');self.assertEqual(self.finish(j,self.cancel_ack(p))['state'],'pending');self.assertEqual(self.raw('SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=%s',(self.oid,)),self.old_items);j=self.claim()[0];p=self.prepare(j);self.assertEqual(p['operation'],'submit',p);self.assertEqual(p['order_code'],f'S-{self.oid}-1');self.assertEqual(len(p['payload']['saleOrder']['saleOrderItems']),6);r=self.finish(j,self.ack(p,'CREATED'));self.assertEqual(r['state'],'done',r);self.assertEqual(self.raw('SELECT uc_order_id,total_quantity FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.oid,)),[(f'S-{self.oid}-1',6)])
 def test_dashboard_cancel_waits_for_actual_confirmation(self):
  self.place();j,p=self.cancel();j,p=self.next_phase(j,p);self.assertEqual(p['operation'],'cancel');r=self.finish(j,self.cancel_ack(p));self.assertEqual(r['state'],'done',r);self.assertEqual(self.raw('SELECT uc_status FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.oid,)),[('CANCELLED',)]);self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='order.provider_cancelled'"),[(1,)])

 def test_unsubmitted_direct_order_submits_replacement_without_cancel(self):
  self.place(confirmed=False);j,p=self.edit();self.assertEqual(p['operation'],'submit',p);self.assertEqual(self.finish(j,self.ack(p))['state'],'done');self.assertEqual(self.raw('SELECT total_quantity FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.oid,)),[(6,)])
 def test_unsubmitted_cancellation_is_local_even_provider_disabled(self):
  self.place(confirmed=False);self.raw('UPDATE sa_domain.warehouse_config SET enabled=false');j,p=self.cancel();self.assertEqual(p['state'],'done',p);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_operations'),[(0,)])
 def test_dealer_linked_amendment_never_calls_external_provider(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=false WHERE id=103');self.place(confirmed=False);self.raw('UPDATE sa_domain.warehouse_config SET enabled=false');j,p=self.edit();self.assertEqual(p['state'],'done',p);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_operations'),[(0,)]);self.assertEqual(self.raw('SELECT total_quantity FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.oid,)),[(6,)])
 def test_dealer_can_cancel_own_linked_fulfillment_locally(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=false WHERE id=103');self.place(confirmed=False);j,p=self.cancel(actor=110);self.assertEqual(p['state'],'done',p)
 def test_dealer_linked_external_reference_is_not_silently_canceled(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=false WHERE id=103');self.place(confirmed=False);self.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id='unexpected' WHERE id=%s",(self.oid,));j,p=self.edit();self.assertEqual(p['state'],'dead');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_operations'),[(0,)])
 def test_wrong_inspect_sku_quantity_never_advances_to_mutation(self):
  self.place();j,p=self.edit();r=self.observed(p);r['proof']['items'][0]['quantity']=4;self.assertEqual(self.finish(j,r)['state'],'dead');self.assertEqual(self.raw('SELECT phase,state FROM sa_domain.warehouse_operations WHERE request_id=%s',(self.rid,)),[('inspect','reconciliation_required')])
 def test_partial_dispatch_denied_without_replacing_local_rows(self):
  self.place();j,p=self.edit();r=self.observed(p);r['proof']['items'][0]['dispatched_quantity']=1;self.assertEqual(self.finish(j,r)['state'],'dead');self.assertEqual(self.raw('SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=%s',(self.oid,)),self.old_items)
 def test_unknown_uniware_item_status_fails_closed(self):
  self.use_uniware();self.place();j,p=self.edit();r=self.observed(p);r['proof']['items'][0]['status']='SHIPPED';self.assertEqual(self.finish(j,r)['state'],'dead')
 def test_missing_dashboard_inspection_version_denied(self):
  self.place();j,p=self.edit();r=self.observed(p);del r['proof']['updated_at'];self.assertEqual(self.finish(j,r)['state'],'dead')
 def test_uniware_partial_cancel_proof_cannot_start_replacement(self):
  self.use_uniware();self.place();j,p=self.edit();j,p=self.next_phase(j,p);r=self.cancel_ack(p);r['proof']['cancelled_item_codes'].pop();self.assertEqual(self.finish(j,r)['state'],'dead');self.assertEqual(self.raw('SELECT total_quantity FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.oid,)),[(3,)])
 def test_wrong_confirmed_identity_preserves_proof_without_local_change(self):
  self.place();j,p=self.edit();j,p=self.next_phase(j,p);r=self.ack(p);r['external_id']='foreign';self.assertEqual(self.finish(j,r)['state'],'dead');self.assertEqual(self.raw("SELECT state,result->>'external_id' FROM sa_domain.warehouse_operations WHERE request_id=%s",(self.rid,)),[('reconciliation_required','foreign')]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.order_amendments WHERE order_id=%s',(self.oid,)),[(0,)])
 def test_actor_revoked_after_provider_ack_retains_proof_and_old_order(self):
  self.place();j,p=self.edit();j,p=self.next_phase(j,p);self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=101');self.assertEqual(self.finish(j,self.ack(p))['state'],'dead');self.assertEqual(self.raw('SELECT total_quantity FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.oid,)),[(3,)]);self.assertEqual(self.raw("SELECT proof->>'request_key' FROM sa_domain.warehouse_operations WHERE request_id=%s",(self.rid,)),[(p['request_key'],)])
 def test_actor_revoked_between_inspect_and_mutation_denies_next_http(self):
  self.place();j,p=self.edit();self.assertEqual(self.finish(j,self.observed(p))['state'],'pending');self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=101');self.assertEqual(self.prepare(self.claim()[0])['state'],'dead')
 def test_tax_drift_after_provider_amendment_does_not_publish_different_money(self):
  self.place();j,p=self.edit();j,p=self.next_phase(j,p);self.raw('UPDATE sa_snapshot_20261019.sa_rmp_skus SET cgst=10 WHERE id=1');self.assertEqual(self.finish(j,self.ack(p))['state'],'dead');self.assertEqual(self.raw('SELECT total_quantity FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.oid,)),[(3,)])
 def test_retry_keeps_frozen_phase_and_stable_key(self):
  self.place();j,p=self.edit();j,p=self.next_phase(j,p);self.assertEqual(self.finish(j,{'code':'RETRY','error_code':'PROVIDER_TIMEOUT'})['state'],'pending');self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s',(uuid.UUID(j['id']),));p2=self.prepare(self.claim()[0]);self.assertTrue(p2['attempted']);self.assertEqual(p2['payload'],p['payload']);self.assertEqual(p2['request_key'],p['request_key'])
 def test_phase_history_survives_later_uncertain_result(self):
  self.use_uniware();self.place();j,p=self.edit();j,p=self.next_phase(j,p);self.assertEqual(self.finish(j,self.cancel_ack(p))['state'],'pending');j=self.claim()[0];p=self.prepare(j);self.assertEqual(self.finish(j,{'code':'RECONCILIATION_REQUIRED','error_code':'PROVIDER_TIMEOUT'})['state'],'dead');history=self.raw("SELECT saga->'history' FROM sa_domain.warehouse_operations WHERE request_id=%s",(self.rid,))[0][0];self.assertEqual(set(history),{'inspect','cancel'});self.assertEqual(history['cancel']['result']['status'],'CANCELLED')
 def test_wrong_lease_cannot_finish_amendment(self):
  self.place();j,p=self.edit();j,p=self.next_phase(j,p);bad=dict(j,lease_token=str(uuid.uuid4()))
  with self.assertRaises(psycopg.errors.SerializationFailure):self.finish(bad,self.ack(p))
 def test_generation_change_denies_provider_result(self):
  self.place();j,p=self.edit();j,p=self.next_phase(j,p);self.raw('UPDATE sa_domain.runtime_state SET generation=1')
  with self.assertRaises(psycopg.errors.SerializationFailure):self.finish(j,self.ack(p))
 def test_browser_cannot_publish_private_change(self):
  self.actor(101)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT sa_domain.warehouse_change_publish(%s)',(uuid.uuid4(),))
 def test_delete_waits_for_provider_cancellation(self):
  self.place();j,p=self.cancel('delete');j,p=self.next_phase(j,p);self.assertEqual(self.raw('SELECT is_deleted FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.oid,)),[(False,)]);self.assertEqual(self.finish(j,self.cancel_ack(p))['state'],'done');self.assertEqual(self.raw('SELECT is_deleted FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.oid,)),[(True,)])
 def test_rmp_to_custom_cancels_provider_then_removes_old_external_reference(self):
  self.place();self.actor(101);preset=rpc(self.c,'v1_product_configure',(Jsonb(CONFIG),'Test custom replacement','',uuid.uuid4()));version=self.version();q=rpc(self.c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[custom()]}),));result=rpc(self.c,'v1_order_edit',(self.oid,uuid.UUID(q['quote_id']),q['version'],Jsonb({'due_at':'2026-12-02T07:00:00Z','line_settings':{'1':{'product_id':preset['id']}}}),'Replace ready made with custom',version,uuid.uuid4()));self.rid=uuid.UUID(result['request_id']);j=self.claim()[0];p=self.prepare(j);j,p=self.next_phase(j,p);self.assertEqual(p['operation'],'cancel');r=self.finish(j,self.cancel_ack(p));self.assertEqual(r['state'],'done',r);self.assertEqual(self.raw('SELECT uc_order_id,uc_status FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.oid,)),[(None,'')]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_links WHERE order_id=%s',(self.oid,)),[(0,)])

 def test_old_provider_status_is_quarantined_while_amendment_pending(self):
  self.place();j,p=self.edit();self.raw("INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload) VALUES(%s,'warehouse.order_reconcile','order',%s,%s,0,%s)",(uid(999),self.oid,uuid.uuid4(),Jsonb({'operation':'reconcile'})));other=self.claim()[0];op=self.prepare(other);self.assertEqual(op['state'],'prepared',op);r=self.finish(other,dict(self.observed(op),status='CANCELLED'));self.assertEqual(r['state'],'dead');self.assertEqual(r['error_code'],'ORDER_CHANGE_PENDING');self.assertEqual(self.raw('SELECT uc_status,total_quantity FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.oid,)),[('PENDING',3)])
 def test_second_uniware_amendment_increments_replacement_identity(self):
  self.use_uniware();self.place();j,p=self.edit();j,p=self.next_phase(j,p);self.finish(j,self.cancel_ack(p));j=self.claim()[0];p=self.prepare(j);self.assertEqual(self.finish(j,self.ack(p,'CREATED'))['state'],'done');j,p=self.edit(9);r=self.observed(p);r['proof']['items']=[dict(r['proof']['items'][0],code=f'replacement-{n}') for n in range(6)];self.assertEqual(self.finish(j,r)['state'],'pending');j=self.claim()[0];p=self.prepare(j);self.finish(j,self.cancel_ack(p));j=self.claim()[0];p=self.prepare(j);self.assertEqual(p['order_code'],f'S-{self.oid}-2');self.assertEqual(self.finish(j,self.ack(p,'CREATED'))['state'],'done')
 def test_first_amendment_waits_for_actual_uniware_customer_mapping(self):
  self.use_uniware();self.place(confirmed=False);self.raw('UPDATE sa_snapshot_20261019.sa_users SET uc_customer_id=NULL WHERE id=103');j,p=self.edit();self.assertEqual(p['state'],'pending');self.assertEqual(p['dependency'],'customer');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_operations'),[(0,)])
 def test_reservation_without_provider_identity_fails_closed(self):
  self.place(confirmed=False);self.raw("UPDATE sa_snapshot_20261019.sa_orders SET dashboard_reservation_id='unmapped-reservation' WHERE id=%s",(self.oid,));j,p=self.edit();self.assertEqual(p['state'],'dead');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_operations'),[(0,)])
 def test_confirmed_provider_change_is_audited_once_with_shared_event(self):
  self.place();j,p=self.edit();j,p=self.next_phase(j,p);self.finish(j,self.ack(p));self.finish(j,self.ack(p));self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.audit WHERE operation='order.amendment_applied' AND entity_id=%s",(self.oid,)),[(1,)]);self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='order.amendment_applied' AND aggregate_id=%s",(self.oid,)),[(1,)])

 def test_tax_drift_before_first_prepare_cannot_change_accepted_total(self):
  self.place();version=self.version();q=rpc(self.c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[rmp(6)]}),));rpc(self.c,'v1_order_edit',(self.oid,uuid.UUID(q['quote_id']),q['version'],Jsonb({'due_at':'2026-12-02T07:00:00Z'}),'Tax drift test',version,uuid.uuid4()));self.raw('UPDATE sa_snapshot_20261019.sa_rmp_skus SET cgst=10 WHERE id=1');self.assertEqual(self.prepare(self.claim()[0])['state'],'dead');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_operations WHERE request_id IS NOT NULL'),[(0,)])
 def test_provider_disabled_after_ack_preserves_confirmation_without_publish(self):
  self.place();j,p=self.edit();j,p=self.next_phase(j,p);self.raw('UPDATE sa_domain.warehouse_config SET enabled=false');self.assertEqual(self.finish(j,self.ack(p))['state'],'dead');self.assertEqual(self.raw('SELECT total_quantity FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.oid,)),[(3,)])
 def test_wrong_current_version_blocks_phase_before_more_http(self):
  self.place();j,p=self.edit();self.finish(j,self.observed(p));self.raw("UPDATE sa_domain.entity_versions SET revision=revision+1 WHERE kind='order' AND entity_id=%s",(self.oid,));self.assertEqual(self.prepare(self.claim()[0])['state'],'dead')
 def test_missing_atomic_amendment_ack_never_publishes(self):
  self.place();j,p=self.edit();j,p=self.next_phase(j,p);r=self.ack(p);r['proof']={};self.assertEqual(self.finish(j,r)['state'],'dead');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.order_amendments WHERE order_id=%s',(self.oid,)),[(0,)])

 def test_missing_quantity_cannot_hide_extra_dashboard_line(self):
  self.place();j,p=self.edit();r=self.observed(p);r['proof']['items'].append({'sku_code':'SKU A','dispatched_quantity':0});self.assertEqual(self.finish(j,r)['state'],'dead')
 def test_cancellation_updates_ready_made_item_status_with_order(self):
  self.place();j,p=self.cancel();j,p=self.next_phase(j,p);self.assertEqual(self.finish(j,self.cancel_ack(p))['state'],'done');self.assertEqual(self.raw('SELECT DISTINCT uc_order_status FROM sa_snapshot_20261019.sa_items WHERE order_id=%s',(self.oid,)),[('CANCELLED',)])
 def test_wrong_environment_customer_code_cannot_enter_new_uniware_order(self):
  self.use_uniware();self.place(confirmed=False);self.raw("UPDATE sa_snapshot_20261019.sa_users SET uc_customer_id='P-103' WHERE id=103");j,p=self.edit();self.assertEqual(p['state'],'dead');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_operations'),[(0,)])

if __name__=='__main__':unittest.main(verbosity=2)
