from sqlstate_assertions import assert_app_conflict
from fixtures import claim_test_workers
"""Synthetic warehouse preparation, frozen money, reconciliation and custody."""
import datetime,decimal,json,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import uid,session,rpc
from test_catalogue import seed_catalogue
from test_pricing import rmp
from test_warehouse_receipts import ownership

class WarehouseOutbound(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');ownership(self.c)
  self.c.execute("UPDATE sa_snapshot_20261019.sa_addresses SET state='Karnataka',city='Bengaluru',zip_code='560001' WHERE id=100")
  self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true,phone='9000000000',uc_customer_id='S-103' WHERE id=103")
  self.c.execute("SELECT setval('sa_snapshot_20261019.sa_orders_id_seq',3000),setval('sa_snapshot_20261019.sa_items_id_seq',3000)")
  self.actor(103)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n,role='sa_app'):self.c.execute('RESET ROLE');session(self.c,n,role)
 def service(self):self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);v=r.fetchall() if r.description else None;self.service();return v
 def place(self,qty=6):
  self.actor(103);q=rpc(self.c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[rmp(qty)]}),));r=rpc(self.c,'v1_order_place',(uuid.UUID(q['quote_id']),q['version'],Jsonb({'due_at':'2026-12-01T07:00:00Z'}),uuid.uuid4()));return r,q
 def claim(self,event=None):
  self.service();jobs=claim_test_workers(self.c,'warehouse');self.assertTrue(jobs);return jobs
 def prepare(self,j):self.service();return self.c.execute('SELECT canto_api.squad_warehouse_prepare(%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']))).fetchone()[0]
 def finish(self,j,r):self.service();return self.c.execute('SELECT canto_api.squad_warehouse_finish(%s,%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']),Jsonb(r))).fetchone()[0]
 def ack(self,p,status='PENDING'):
  return {'code':'CONFIRMED','external_id':'ord_'+p['intent_id'].replace('-',''),'external_code':p['order_code'],'status':status,'proof':{'source':'atomic_mutation_response','request_key':p['request_key']}}
 def test_submit_uses_accepted_money_and_stable_identity(self):
  order,q=self.place();j=self.claim()[0];p=self.prepare(j);self.assertEqual(p['state'],'prepared');self.assertFalse(p['attempted']);self.assertEqual(p['operation'],'submit');self.assertEqual(p['payload']['items'][0]['quantity'],6);self.assertEqual(decimal.Decimal(str(p['payload']['items'][0]['unit_price']))*6,decimal.Decimal(q['total']));self.assertEqual(p['payload']['shipping_address']['state'],'KA');self.assertEqual(p['payload']['customer']['code'],'S-103')
  self.raw('UPDATE sa_snapshot_20261019.sa_rmp_prices SET price=99999');p2=self.prepare(j);self.assertTrue(p2['attempted']);self.assertEqual(p['payload'],p2['payload']);self.assertEqual(p['request_key'],p2['request_key'])
 def test_provider_confirmation_persists_reference_once(self):
  order,q=self.place();j=self.claim()[0];p=self.prepare(j);r=self.finish(j,self.ack(p));self.assertEqual(r['state'],'done');self.assertEqual(r['result']['state'],'applied');self.assertTrue(self.finish(j,self.ack(p))['replayed']);self.assertEqual(self.raw('SELECT uc_status FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(int(order['orders'][0]['id']),)),[('PENDING',)])
 def test_actor_disabled_before_http_denies_and_settles(self):
  self.place();j=self.claim()[0];self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=103');r=self.prepare(j);self.assertEqual(r['state'],'dead');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_operations'),[(0,)])
 def test_actor_disabled_after_http_preserves_external_truth(self):
  self.place();j=self.claim()[0];p=self.prepare(j);self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=103');r=self.finish(j,self.ack(p));self.assertEqual(r['state'],'done');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_links'),[(1,)])
 def test_wrong_response_identity_is_durable_reconciliation(self):
  self.place();j=self.claim()[0];p=self.prepare(j);ack=self.ack(p);ack['external_code']='S-other';r=self.finish(j,ack);self.assertEqual(r['state'],'dead');self.assertEqual(self.raw('SELECT state FROM sa_domain.warehouse_operations'),[('reconciliation_required',)]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_links'),[(0,)])
 def test_missing_atomic_proof_cannot_apply(self):
  self.place();j=self.claim()[0];p=self.prepare(j);ack=self.ack(p);ack['proof']={};r=self.finish(j,ack);self.assertEqual(r['state'],'dead')
 def test_uncertain_retry_preserves_intent_and_marks_prior_attempt(self):
  self.place();j=self.claim()[0];p=self.prepare(j);r=self.finish(j,{'code':'RETRY','error_code':'PROVIDER_TIMEOUT'});self.assertEqual(r['state'],'pending');self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s',(uuid.UUID(j['id']),));j2=self.claim()[0];p2=self.prepare(j2);self.assertTrue(p2['attempted']);self.assertEqual(p['request_key'],p2['request_key']);self.assertEqual(p['payload'],p2['payload'])
 def test_no_browser_worker_access(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.squad_warehouse_prepare(%s,%s)',(uuid.uuid4(),uuid.uuid4()))
 def test_provider_retry_after_is_a_minimum_delay(self):
  self.place();j=self.claim()[0];self.prepare(j);self.assertEqual(self.finish(j,{'code':'RETRY','error_code':'PROVIDER_UNAVAILABLE','retry_after_seconds':180})['state'],'pending')
  seconds=self.raw('SELECT extract(epoch FROM available_at-clock_timestamp()) FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(j['id']),))[0][0];self.assertGreater(seconds,179);self.assertLessEqual(seconds,180)
 def test_provider_short_delay_does_not_reduce_queue_backoff(self):
  self.place();j=self.claim()[0];self.prepare(j);self.finish(j,{'code':'RETRY','error_code':'PROVIDER_UNAVAILABLE','retry_after_seconds':1})
  self.assertGreater(self.raw('SELECT extract(epoch FROM available_at-clock_timestamp()) FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(j['id']),))[0][0],9)
 def test_invalid_provider_delays_do_not_settle_job(self):
  self.place();j=self.claim()[0];self.prepare(j)
  for delay in [True,'60',0,-1,3601,1.5,None]:
   with self.assertRaises(psycopg.errors.InvalidParameterValue):
    with self.c.transaction():self.finish(j,{'code':'RETRY','retry_after_seconds':delay})
  self.assertEqual(self.raw('SELECT status FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(j['id']),)),[('leased',)])
 def test_stale_lease_cannot_extend_provider_cooldown(self):
  self.place();j=self.claim()[0];self.prepare(j);stale=dict(j,lease_token=str(uuid.uuid4()))
  with assert_app_conflict(self):
   with self.c.transaction():self.finish(stale,{'code':'RETRY','retry_after_seconds':300})
  self.assertEqual(self.raw('SELECT status FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(j['id']),)),[('leased',)])
 def test_fanout_keeps_notification_event_independent(self):
  self.place();rows=self.raw("SELECT event_type FROM sa_domain.outbox ORDER BY sequence_id");self.assertCountEqual([x[0] for x in rows],['orders.placed','business.mail_fanout','notification.fanout','warehouse.order'])
 def test_no_cutover_no_warehouse_side_effect_enqueued(self):
  self.raw('UPDATE sa_domain.warehouse_config SET enabled=false');self.place();self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='warehouse.order'"),[(0,)])
 def reconcile(self,scope='inventory'):
  self.actor(999,'authenticated');return rpc(self.c,'v1_integration_reconcile',('dashboard',scope,None,uuid.uuid4()))
 def test_inventory_enumeration_and_finish_are_bounded_and_facility_scoped(self):
  rec=self.reconcile();scheduler=self.claim()[0];self.assertEqual(self.prepare(scheduler)['state'],'done');jobs=self.claim();self.assertEqual(len(jobs),2)
  for j in jobs:
   p=self.prepare(j);self.assertEqual(p['operation'],'inventory');self.assertEqual(p['payload']['skus'],['SKU A','SKU B']);result={'code':'CONFIRMED','inventory':[{'sku_code':'SKU A','known':True,'available':12},{'sku_code':'SKU B','known':False,'available':None}],'proof':{'facility_code':p['facility_code']}};self.assertEqual(self.finish(j,result)['state'],'done')
  self.assertEqual(self.raw('SELECT facility_code,available FROM sa_domain.warehouse_inventory ORDER BY facility_code'),[('ONE',12),('THREE',12)]);self.assertEqual(self.raw('SELECT state,processed,errors FROM sa_domain.warehouse_reconciliations'),[('completed',2,0)])
 def test_unexpected_inventory_sku_rolls_back_whole_batch(self):
  self.reconcile();self.prepare(self.claim()[0]);j=self.claim()[0];p=self.prepare(j);r=self.finish(j,{'code':'CONFIRMED','inventory':[{'sku_code':'SKU A','known':True,'available':12},{'sku_code':'WRONG','known':True,'available':15}],'proof':{'facility_code':p['facility_code']}});self.assertEqual(r['state'],'dead');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_inventory'),[(0,)])
 def test_inventory_facility_mismatch_rejected(self):
  self.reconcile();self.prepare(self.claim()[0]);j=self.claim()[0];p=self.prepare(j);r=self.finish(j,{'code':'CONFIRMED','inventory':[{'sku_code':'SKU A','known':True,'available':12},{'sku_code':'SKU B','known':True,'available':15}],'proof':{'facility_code':'WRONG'}});self.assertEqual(r['state'],'dead')
 def test_order_reconcile_reads_only_matching_reference(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET order_source='dashboard',uc_order_id='ord_original' WHERE id=1001");self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=1 WHERE order_id=1001');self.reconcile('orders');self.prepare(self.claim()[0]);j=self.claim()[0];p=self.prepare(j);self.assertEqual(p['operation'],'reconcile');self.assertEqual(p['provider_order_id'],'ord_original');r=self.finish(j,{'code':'OBSERVED','external_id':'ord_original','external_code':'S-1001','status':'PROCESSING','proof':{'updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'items':[]}});self.assertEqual(r['state'],'done')
 def test_unicommerce_per_piece_accepted_price_and_codes(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_settings SET value='false' WHERE key='use_dashboard'");self.raw("UPDATE sa_domain.warehouse_config SET provider='unicommerce'");r,q=self.place(3);p=self.prepare(self.claim()[0]);self.assertEqual(p['provider'],'unicommerce');lines=p['payload']['saleOrder']['saleOrderItems'];self.assertEqual(len(lines),3);self.assertEqual(len({x['code'] for x in lines}),3);self.assertEqual(sum(decimal.Decimal(str(x['sellingPrice'])) for x in lines),decimal.Decimal(q['total']));self.assertTrue(all(x['facilityCode']=='ONE' for x in lines))
 def test_stale_generation_cannot_prepare(self):
  self.place();j=self.claim()[0];self.raw('UPDATE sa_domain.runtime_state SET generation=1')
  with assert_app_conflict(self):self.prepare(j)

 def test_current_provider_change_after_http_keeps_receipt_evidence(self):
  self.place();j=self.claim()[0];p=self.prepare(j);self.raw("UPDATE sa_domain.warehouse_config SET enabled=false");r=self.finish(j,self.ack(p));self.assertEqual(r['state'],'dead');self.assertEqual(self.raw("SELECT state,result->>'external_id' FROM sa_domain.warehouse_operations"),[('reconciliation_required',self.ack(p)['external_id'])])
 def test_key_without_atomic_proof_source_is_rejected(self):
  self.place();j=self.claim()[0];p=self.prepare(j);ack=self.ack(p);ack['proof'].pop('source');self.assertEqual(self.finish(j,ack)['state'],'dead')
 def test_pending_external_submit_blocks_due_change(self):
  order,q=self.place();j=self.claim()[0];p=self.prepare(j);self.actor(101)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):rpc(self.c,'v1_order_due_save',(int(order['orders'][0]['id']),'2026-12-02T07:00:00Z','Concurrent change',order['orders'][0]['version'],uuid.uuid4()))
 def test_pending_external_submit_blocks_cancellation(self):
  order,q=self.place();self.prepare(self.claim()[0]);self.actor(101)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):rpc(self.c,'v1_order_cancel',(int(order['orders'][0]['id']),'cancel','Concurrent cancellation',order['orders'][0]['version'],uuid.uuid4()))
 def test_bounded_inventory_over_100_skus_resumes_and_finishes(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_rmp_skus(id,name,rmp_class_id,rmp_brand_id,rmp_category_id,rmp_size_id,created_at,updated_at) SELECT x,'SKU '||x,1,1,1,1,now(),now() FROM generate_series(3,202)x")
  rec=self.reconcile();first=self.claim()[0];self.assertEqual(self.prepare(first)['state'],'pending');sizes=[]
  for batch in range(10):
   jobs=self.claim()
   for j in jobs:
    p=self.prepare(j)
    if p['state']!='prepared':continue
    sizes.append(len(p['payload']['skus']));self.finish(j,{'code':'CONFIRMED','inventory':[{'sku_code':x,'known':True,'available':1} for x in p['payload']['skus']],'proof':{'facility_code':p['facility_code']}})
   if self.raw("SELECT count(*) FROM sa_domain.outbox WHERE status='pending' AND event_type LIKE 'warehouse.%%'")[0][0]==0:break
  self.assertEqual(sorted(sizes),[2,2,100,100,100,100]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_inventory'),[(404,)]);self.actor(999,'authenticated');status=rpc(self.c,'v1_integration_get',(uuid.UUID(rec['id']),));self.assertEqual(status['state'],'completed');self.assertEqual(status['processed'],6)
 def test_prepare_authority_failure_is_visible_in_reconciliation_progress(self):
  rec=self.reconcile();self.prepare(self.claim()[0]);jobs=self.claim();self.raw('DELETE FROM public.profiles WHERE id=%s',(uid(999),))
  for j in jobs:self.assertEqual(self.prepare(j)['state'],'dead')
  self.assertEqual(self.raw('SELECT state,processed,errors FROM sa_domain.warehouse_reconciliations'),[('failed',2,2)])
 def test_catalogue_availability_marks_stale_unknown_instead_of_zero(self):
  self.raw("INSERT INTO sa_domain.warehouse_inventory VALUES(0,'dashboard','ONE',1,12,now(),NULL),(0,'dashboard','THREE',1,25,now(),NULL)");self.actor(103);v=rpc(self.c,'v1_rmp_variants',(1,))['data'][0]['availability'];self.assertEqual(v['status'],'ready');self.assertEqual(v['one_day'],12)
  self.raw("UPDATE sa_domain.warehouse_inventory SET invalidated_at=now() WHERE facility_code='ONE'");self.actor(103);v=rpc(self.c,'v1_rmp_variants',(1,))['data'][0]['availability'];self.assertEqual(v['status'],'partial');self.assertIsNone(v['one_day']);self.assertEqual(v['three_day'],25)
  self.raw("UPDATE sa_domain.warehouse_inventory SET as_of=now()-interval '10 minutes'");self.actor(103);v=rpc(self.c,'v1_rmp_variants',(1,))['data'][0]['availability'];self.assertEqual(v['status'],'stale');self.assertIsNone(v['three_day'])
 def test_inventory_result_allows_only_two_decimal_places(self):
  self.reconcile();self.prepare(self.claim()[0]);j=self.claim()[0];p=self.prepare(j);self.assertEqual(self.finish(j,{'code':'CONFIRMED','inventory':[{'sku_code':'SKU A','known':True,'available':1.001},{'sku_code':'SKU B','known':False,'available':None}],'proof':{'facility_code':p['facility_code']}})['state'],'dead')
 def test_status_event_emitted_once_only_for_actual_transition(self):
  self.place();j=self.claim()[0];p=self.prepare(j);self.finish(j,self.ack(p));self.finish(j,self.ack(p));self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='warehouse.status_changed'"),[(1,)])

 def test_reconciliation_lease_exhaustion_is_settled_and_visible(self):
  rec=self.reconcile();self.prepare(self.claim()[0]);jobs=self.claim();self.raw("UPDATE sa_domain.outbox SET attempts=5,lease_until=now()-interval '1 minute' WHERE event_type='warehouse.inventory'");self.service();self.c.execute('SELECT canto_api.squad_job_claim(1)');self.actor(999,'authenticated');status=rpc(self.c,'v1_integration_get',(uuid.UUID(rec['id']),));self.assertEqual(status['state'],'failed');self.assertEqual(status['errors'],2);self.assertEqual(status['pending'],0);self.assertEqual(self.raw('SELECT state FROM sa_domain.warehouse_reconciliations'),[('failed',)])
 def test_inventory_all_scope_finishes_when_no_orders_exist(self):
  rec=self.reconcile('all');self.assertEqual(self.prepare(self.claim()[0])['state'],'pending');self.assertEqual(self.prepare(self.claim()[0])['state'],'done');jobs=self.claim()
  for j in jobs:
   p=self.prepare(j);self.finish(j,{'code':'CONFIRMED','inventory':[{'sku_code':x,'known':True,'available':3} for x in p['payload']['skus']],'proof':{'facility_code':p['facility_code']}})
  self.actor(999,'authenticated');status=rpc(self.c,'v1_integration_get',(uuid.UUID(rec['id']),));self.assertEqual(status['state'],'completed');self.assertEqual(status['total'],2)
 def test_uniware_piece_limit_is_durable_before_any_http(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_settings SET value='false' WHERE key='use_dashboard'");self.raw("UPDATE sa_domain.warehouse_config SET provider='unicommerce'");self.place(2001);result=self.prepare(self.claim()[0]);self.assertEqual(result['state'],'dead');self.assertEqual(result['error_code'],'54000');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_operations'),[(0,)])
 def test_only_admin_owner_can_read_reconciliation(self):
  rec=self.reconcile();self.actor(100)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_integration_get',(uuid.UUID(rec['id']),))
 def test_multi_page_order_reconcile_has_stable_upper_bound(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_orders(id,customer_id,address_id,order_source,uc_order_id,status,created_at,updated_at) SELECT n,103,100,'dashboard','ord_'||n,0,now(),now() FROM generate_series(4001,4055)n")
  self.raw("INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,item_type,total_quantity,created_at,updated_at) SELECT n,n,1,0,now(),now() FROM generate_series(4001,4055)n")
  rec=self.reconcile('orders');self.assertEqual(self.prepare(self.claim()[0])['state'],'pending')
  self.raw("INSERT INTO sa_snapshot_20261019.sa_orders(id,customer_id,address_id,order_source,uc_order_id,status,created_at,updated_at) VALUES(4056,103,100,'dashboard','ord_4056',0,now(),now())")
  self.raw("INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,item_type,total_quantity,created_at,updated_at) VALUES(4056,4056,1,0,now(),now())")
  seen=[]
  for batch in range(15):
   jobs=self.claim()
   for j in jobs:
    p=self.prepare(j)
    if p['state']!='prepared':continue
    seen.append(p['provider_order_id']);self.assertEqual(self.finish(j,{'code':'OBSERVED','external_id':p['provider_order_id'],'external_code':p['order_code'],'status':'PENDING','proof':{'updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'items':[]}})['state'],'done')
   if self.raw("SELECT count(*) FROM sa_domain.outbox WHERE status='pending' AND event_type IN('warehouse.order_reconcile','warehouse.reconcile')")[0][0]==0:break
  self.assertEqual(len(seen),55);self.assertNotIn('ord_4056',seen);self.actor(999,'authenticated');status=rpc(self.c,'v1_integration_get',(uuid.UUID(rec['id']),));self.assertEqual(status['state'],'completed');self.assertEqual(status['processed'],55)

 def test_uniware_proven_preflight_failure_can_retry_first_mutation(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_settings SET value='false' WHERE key='use_dashboard'");self.raw("UPDATE sa_domain.warehouse_config SET provider='unicommerce'");self.place();j=self.claim()[0];p=self.prepare(j);self.assertFalse(p['attempted']);self.finish(j,{'code':'RETRY','error_code':'PROVIDER_AUTH_UNAVAILABLE','proof':{'mutation_attempted':False}});self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s',(uuid.UUID(j['id']),));j2=self.claim()[0];self.assertFalse(self.prepare(j2)['attempted'])
 def test_uniware_prior_attempt_cannot_be_erased_by_later_preflight(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_settings SET value='false' WHERE key='use_dashboard'");self.raw("UPDATE sa_domain.warehouse_config SET provider='unicommerce'");self.place();j=self.claim()[0];p=self.prepare(j);self.finish(j,{'code':'RETRY','error_code':'PROVIDER_TIMEOUT'});self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s',(uuid.UUID(j['id']),));j2=self.claim()[0];self.assertTrue(self.prepare(j2)['attempted']);self.finish(j2,{'code':'RETRY','error_code':'PROVIDER_AUTH_UNAVAILABLE','proof':{'mutation_attempted':False}});self.assertEqual(self.raw('SELECT attempted FROM sa_domain.warehouse_operations'),[(True,)])

if __name__=='__main__':unittest.main(verbosity=2)
