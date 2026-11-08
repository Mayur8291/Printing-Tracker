"""SC amendments reuse accepted quotes, preserve history and fence provider work."""
from sqlstate_assertions import assert_app_conflict, is_app_conflict
import unittest,uuid,decimal,concurrent.futures,threading
import psycopg
from psycopg.types.json import Jsonb
from fixtures import rpc
from fixtures import session
from local_db import connect
import test_order_acceptance as acceptance
from test_pricing import custom,rmp
D=decimal.Decimal
class Amendments(unittest.TestCase):
 setUpClass=classmethod(acceptance.Orders.setUpClass.__func__)
 tearDown=acceptance.Orders.tearDown;actor=acceptance.Orders.actor;raw=acceptance.Orders.raw;preset=acceptance.Orders.preset;quote=acceptance.Orders.quote;place=acceptance.Orders.place;design=acceptance.Orders.design
 def setUp(self):
  acceptance.Orders.setUp(self);self.product=self.preset();q=self.quote([custom()]);self.order=self.place(q,{'line_settings':{'1':{'product_id':self.product['id']}}})['orders'][0]
  self.id=int(self.order['id']);self.item=int(self.order['items'][0]['item_id']);self.actor(101)
 def version(self):return rpc(self.c,'v1_order_get',(self.id,))['version']
 def edit(self,q=None,details=None,key=None,version=None):
  q=q or self.quote([custom(10)]);d={'due_at':'2026-12-02T10:30:00+05:30','line_settings':{'1':{'product_id':self.product['id']}}};d.update(details or {})
  return rpc(self.c,'v1_order_edit',(self.id,uuid.UUID(q['quote_id']),q['version'],Jsonb(d),'Customer requested update',version or self.order['version'],key or uuid.uuid4()))
 def test_custom_edit_preserves_creator_dates_and_order_identity(self):
  before=self.raw('SELECT customer_id,created_by_id,created_on,created_at FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.id,));r=self.edit();self.assertEqual(r['state'],'applied');self.assertEqual(r['id'],str(self.id));self.assertEqual(before,self.raw('SELECT customer_id,created_by_id,created_on,created_at FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.id,)));self.assertNotEqual(r['items'][0]['item_id'],str(self.item))
 def test_original_items_and_receipt_retained_in_amendment(self):
  r=self.edit();record=self.raw('SELECT source_rows FROM sa_domain.order_amendments WHERE id=%s',(uuid.UUID(r['amendment_id']),))[0][0];self.assertEqual(record['items'][0]['id'],self.item);self.assertEqual(record['quantities'][0]['quantity'],6);self.assertEqual(record['receipt']['pricing']['quantity'],6)
 def test_new_quote_totals_are_authoritative(self):
  q=self.quote([custom(10)]);r=self.edit(q);self.assertEqual(D(r['total_amount']),D(q['total']));self.assertEqual(self.raw('SELECT total_quantity FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.id,)),[(10,)])
 def test_existing_partial_payment_preserved(self):
  r=rpc(self.c,'v1_order_payment_record',(self.id,'partial',D('100.25'),'Paid',self.version(),uuid.uuid4()));r=self.edit(version=r['version']);self.assertEqual(D(r['paid_amount']),D('100.25'));self.assertEqual(self.raw('SELECT payment_status FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.id,)),[(2,)])
 def test_payment_above_new_total_requires_explicit_reconciliation(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET paid_amount=10000 WHERE id=%s',(self.id,))
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.edit()
 def test_explicit_payment_change_audited_with_prior_value(self):
  r=self.edit(details={'payment':{'status':'paid'}});self.assertEqual(D(r['paid_amount']),D(r['total_amount']));record=self.raw('SELECT source_rows FROM sa_domain.order_amendments WHERE id=%s',(uuid.UUID(r['amendment_id']),))[0][0];self.assertEqual(D(record['order']['paid_amount']),0)
 def test_same_command_retry_does_not_replace_twice(self):
  q=self.quote([custom(10)]);key=uuid.uuid4();a=self.edit(q,key=key);b=self.edit(q,key=key);self.assertEqual(a,b);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.order_amendments WHERE order_id=%s',(self.id,)),[(1,)])
 def test_exact_order_version_required(self):
  q=self.quote([custom(10)]);self.edit(q)
  with assert_app_conflict(self):self.edit()
 def test_quote_cannot_be_reused_after_amendment(self):
  q=self.quote([custom(10)]);r=self.edit(q)
  with assert_app_conflict(self):self.edit(q,version=r['version'])
 def test_customer_cannot_edit(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.edit()
 def test_admin_cannot_bypass_sc_edit_rule(self):
  q=self.quote([custom(10)]);self.actor(100)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.edit(q)
 def test_other_sc_cannot_edit(self):
  q=self.quote([custom(10)]);self.actor(201)
  with self.assertRaises(psycopg.errors.NoDataFound):self.edit(q)
 def test_factory_assignment_blocks_replacement(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=104 WHERE id=%s',(self.id,))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.edit()
 def test_worker_assignment_blocks_replacement(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_worker_id=111 WHERE id=%s',(self.id,))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.edit()
 def test_quantity_history_blocks_even_stale_zero_parent(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET cutting_done=1 WHERE item_id=%s',(self.item,))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.edit()
 def test_history_event_blocks_even_zero_quantities(self):
  self.raw('INSERT INTO sa_snapshot_20261019.sa_mark_cuttings(item_id,cutting_date,created_at,updated_at) VALUES(%s,now(),now(),now())',(self.item,))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.edit()
 def test_backorder_link_blocks_replacement(self):
  self.raw('INSERT INTO sa_snapshot_20261019.sa_back_order_links(order_id,back_order_id,created_at,updated_at) VALUES(%s,1001,now(),now())',(self.id,))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.edit()
 def test_source_stock_receipt_blocks_replacement(self):
  self.raw('INSERT INTO sa_snapshot_20261019.sa_stocks(order_id,item_id,size_id,user_id,quantity,created_at,updated_at) VALUES(%s,%s,1,110,0,now(),now())',(self.id,self.item))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.edit()
 def test_feedback_history_cannot_be_orphaned(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_ratings(rating,from_id,to_id,rating_on_type,rating_on_id,created_at,updated_at) VALUES(4,103,101,'Item',%s,now(),now())",(self.item,))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.edit()
 def test_provider_change_queued_without_changing_old_lines(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id='staging-only-test' WHERE id=%s",(self.id,));r=self.edit();self.assertEqual(r['state'],'queued');self.assertEqual(self.raw('SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=%s',(self.id,)),[(self.item,)]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.order_amendments WHERE order_id=%s',(self.id,)),[(0,)])
 def test_pending_amendment_blocks_other_writes(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id='staging-only-test' WHERE id=%s",(self.id,));r=self.edit()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):rpc(self.c,'v1_order_priority_save',(self.id,True,'Unsafe overlapping change',r['version'],uuid.uuid4()))
 def test_ready_made_amendment_requires_reconciliation(self):
  q=self.quote([rmp(10)]);r=self.edit(q,details={'line_settings':{}});self.assertEqual(r['state'],'queued');self.assertTrue(r['provider_confirmation_required'])
 def test_provider_completion_cannot_be_replaced(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_status='COMPLETED' WHERE id=%s",(self.id,))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.edit()
 def test_client_cannot_supply_total(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.edit(details={'total_amount':'1'})
 def test_price_change_requires_new_quote(self):
  q=self.quote([custom(10)]);self.raw('UPDATE sa_snapshot_20261019.sa_fabrics SET price=999 WHERE id=1')
  with assert_app_conflict(self):self.edit(q)
 def test_invalid_preset_rolls_back_every_replacement(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.edit(details={'line_settings':{'1':{'product_id':'999999'}}})
  self.assertEqual(self.raw('SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=%s',(self.id,)),[(self.item,)]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.order_amendments WHERE order_id=%s',(self.id,)),[(0,)]);self.assertEqual(self.version(),self.order['version'])
 def test_line_receipts_capture_exact_accepted_skus(self):
  q=self.quote([rmp()]);o=self.place(q)['orders'][0];r=self.raw('SELECT pricing FROM sa_domain.line_receipts WHERE item_id=%s',(int(o['items'][0]['item_id']),))[0][0];self.assertEqual(r['variants'][0]['sku_id'],'1')
 def test_maximum_batch_preserves_each_line_size_checklist_and_receipt(self):
  q=self.quote([custom(10) for _ in range(50)]);r=self.edit(q,details={'line_settings':{str(n):{'product_id':self.product['id']} for n in range(1,51)}});self.assertEqual(r['state'],'queued');r=self.execute(r);ids=[int(x['item_id']) for x in r['items']]
  self.assertEqual(len(set(ids)),50);self.assertEqual(self.raw('SELECT count(*),sum(quantity) FROM sa_snapshot_20261019.sa_quantities WHERE item_id=ANY(%s)',(ids,)),[(50,500)])
  self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_item_criteria WHERE item_id=ANY(%s)',(ids,)),[(100,)]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.line_receipts WHERE item_id=ANY(%s)',(ids,)),[(50,)])
  self.assertEqual(D(r['total_amount']),D(q['total']))
 def queued(self):return self.edit(self.quote([custom(10) for _ in range(6)]),details={'line_settings':{str(n):{'product_id':self.product['id']} for n in range(1,7)}})
 def execute(self,r):
  self.c.execute('SET LOCAL ROLE sa_executor');result=self.c.execute('SELECT sa_domain.execute_local_amendment(%s)',(uuid.UUID(r['request_id']),)).fetchone()[0];self.c.execute('SET LOCAL ROLE sa_app');return result
 def test_large_amendment_keeps_old_rows_until_execution(self):
  r=self.queued();self.assertFalse(r['provider_confirmation_required']);self.assertEqual(r['execution'],'background');self.assertEqual(self.raw('SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=%s',(self.id,)),[(self.item,)])
 def test_queued_execution_retry_and_version(self):
  q=self.queued();r=self.execute(q);self.assertEqual(r,self.execute(q));self.assertNotEqual(r['version'],q['version']);self.assertEqual(self.raw('SELECT state,result FROM sa_domain.order_requests WHERE id=%s',(uuid.UUID(q['request_id']),)),[('succeeded',r)])
 def test_queued_execution_preserves_accepted_cost_after_price_change(self):
  q=self.queued();cost=self.raw('SELECT (spec->\'group\'->\'lines\'->0->\'variants\'->0->>\'unit_price\')::numeric FROM sa_domain.order_requests WHERE id=%s',(uuid.UUID(q['request_id']),))[0][0]
  self.raw('UPDATE sa_snapshot_20261019.sa_fabrics SET price=999 WHERE id=1');r=self.execute(q);self.assertEqual(self.raw('SELECT calculated_per_piece_amount FROM sa_snapshot_20261019.sa_items WHERE id=%s',(int(r['items'][0]['item_id']),)),[(cost,)])
 def test_provider_request_cannot_use_local_executor(self):
  q=self.edit(self.quote([rmp(10)]),details={'line_settings':{}})
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.execute(q)
 def test_foreign_actor_cannot_execute_request(self):
  q=self.queued();self.actor(201)
  with self.assertRaises(psycopg.errors.NoDataFound):self.execute(q)
 def test_refreshed_source_obsoletes_queued_request(self):
  q=self.queued();self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1')
  with self.assertRaises(psycopg.errors.NoDataFound):self.execute(q)
 def test_job_executor_is_not_client_callable(self):
  q=self.queued()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT sa_domain.execute_local_amendment(%s)',(uuid.UUID(q['request_id']),))
 def test_amendment_history_is_append_only_to_executor(self):
  self.edit();self.c.execute('RESET ROLE');self.c.execute('SET LOCAL ROLE sa_executor')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('DELETE FROM sa_domain.order_amendments')
 def test_mirror_mode_blocks_edit(self):
  self.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=false')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.edit()
 def test_executor_insert_policy_cannot_attach_foreign_order(self):
  self.c.execute('SET LOCAL ROLE sa_executor')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('INSERT INTO sa_snapshot_20261019.sa_items(order_id,item_type,created_at,updated_at) VALUES(2001,0,now(),now())')
 def test_executor_insert_policy_cannot_attach_foreign_item(self):
  self.c.execute('SET LOCAL ROLE sa_executor')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,created_at,updated_at) VALUES(2001,1,1,now(),now())')
 def test_internal_apply_is_not_public(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT sa_domain.apply_order_amendment(%s,'{}',%s)",(self.id,uuid.uuid4()))

 def branded_order(self):
  self.actor(103);design=self.design(ready=True);line=custom();line['brandings']=[design];q=self.quote([line]);self.order=self.place(q,{'line_settings':{'1':{'product_id':self.product['id']}}})['orders'][0];self.id=int(self.order['id']);self.item=int(self.order['items'][0]['item_id']);self.actor(101)
  b=self.raw('SELECT id FROM sa_snapshot_20261019.sa_brandings WHERE item_id=%s',(self.item,))[0][0];return dict(design,design_id=str(b),design_version='0:0')
 def test_historical_order_art_survives_amendment_and_keeps_file_links(self):
  design=self.branded_order();line=custom(10);line['brandings']=[design];r=self.edit(self.quote([line]));new_item=int(r['items'][0]['item_id']);b=int(design['design_id']);self.assertEqual(self.raw('SELECT item_id FROM sa_snapshot_20261019.sa_brandings WHERE id=%s',(b,)),[(None,)]);self.assertEqual(self.raw('SELECT parent_id FROM sa_snapshot_20261019.sa_brandings WHERE item_id=%s',(new_item,)),[(b,)]);self.assertEqual(self.raw('SELECT count(*) FROM sa_media.references WHERE record_id IN(SELECT id FROM sa_snapshot_20261019.sa_brandings WHERE item_id=%s)',(new_item,)),[(1,)])
 def test_archived_order_art_cannot_be_edited_in_place(self):
  design=self.branded_order();self.edit()
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_branding_save',(int(design['design_id']),None,Jsonb(acceptance.SPEC),'0:0',uuid.uuid4()))
 def test_invalid_queued_line_does_not_freeze_order(self):
  q=self.quote([rmp(10)])
  with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.edit(q)
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.order_requests WHERE order_id=%s',(self.id,)),[(0,)])

class ConcurrentAmendments(unittest.TestCase):
 def exercise(self,other):
  keys=[uuid.uuid4() for _ in range(5)];quotes=[];order=None;product=None
  with connect() as c,c.transaction():
   acceptance.seed_catalogue(c);before=c.execute('SELECT edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
   direct=c.execute('SELECT is_direct_deal FROM sa_snapshot_20261019.sa_users WHERE id=103').fetchone()[0]
   c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true WHERE id=103')
   c.execute("UPDATE sa_snapshot_20261019.sa_addresses SET state='Karnataka' WHERE id=100");session(c,101)
   product=rpc(c,'v1_product_configure',(Jsonb(acceptance.CONFIG),'Concurrent amendment','',keys[0]))
   def quote(qty):
    r=rpc(c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[custom(qty)]}),));quotes.append(uuid.UUID(r['quote_id']));return r
   q=quote(6);details={'due_at':'2026-12-01T00:00:00Z','line_settings':{'1':{'product_id':product['id']}}}
   order=rpc(c,'v1_order_place',(uuid.UUID(q['quote_id']),q['version'],Jsonb(details),keys[1]))['orders'][0];q=quote(10)
  barrier=threading.Barrier(2);id_=int(order['id'])
  def command(which):
   try:
    with connect() as c,c.transaction():
     session(c,102 if which and other=='assignment' else 101);barrier.wait(timeout=5)
     if which and other=='assignment':return rpc(c,'v1_order_assign_factory',(id_,104,'Concurrent allocation',order['version'],keys[3]))
     if which and other=='cancel':return rpc(c,'v1_order_cancel',(id_,'cancel','Concurrent cancellation',order['version'],keys[3]))
     return rpc(c,'v1_order_edit',(id_,uuid.UUID(q['quote_id']),q['version'],Jsonb(details),'Concurrent amendment',order['version'],keys[2] if not which or other=='retry' else keys[3]))
   except psycopg.DatabaseError as error:
    if not (is_app_conflict(error) or isinstance(error,psycopg.errors.ObjectNotInPrerequisiteState)):raise
    return 'conflict'
  try:
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(command,[0,1]))
   if other=='retry':self.assertEqual(results[0],results[1]);self.assertIsInstance(results[0],dict)
   else:self.assertEqual(results.count('conflict'),1,results)
   with connect() as c:
    count=c.execute('SELECT count(*) FROM sa_domain.order_amendments WHERE order_id=%s',(id_,)).fetchone()[0];self.assertLessEqual(count,1)
  finally:
   with connect() as c,c.transaction():
    items=[r[0] for r in c.execute('SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=%s',(id_,))]
    for table in ['quantities','extra_quantities','item_criteria','brandings']:c.execute(f'DELETE FROM sa_snapshot_20261019.sa_{table} WHERE item_id=ANY(%s)',(items,))
    c.execute('DELETE FROM sa_domain.line_receipts WHERE order_id=%s',(id_,));c.execute('DELETE FROM sa_domain.order_amendments WHERE order_id=%s',(id_,))
    c.execute('DELETE FROM sa_domain.order_receipts WHERE order_id=%s',(id_,));c.execute('DELETE FROM sa_domain.order_requests WHERE order_id=%s',(id_,));c.execute('DELETE FROM sa_snapshot_20261019.sa_items WHERE order_id=%s',(id_,));c.execute('DELETE FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(id_,))
    c.execute("DELETE FROM sa_domain.entity_versions WHERE kind='order' AND entity_id=%s OR kind='item' AND entity_id=ANY(%s)",(id_,items))
    for table in ['outbox','audit']:c.execute(f'DELETE FROM sa_domain.{table} WHERE command_key=ANY(%s)',(keys,))
    c.execute('DELETE FROM sa_domain.commands WHERE key=ANY(%s)',(keys,));c.execute('DELETE FROM sa_domain.quotes WHERE id=ANY(%s)',(quotes,))
    product_id=int(product['id'])
    c.execute('DELETE FROM sa_snapshot_20261019.sa_product_part_add_ons WHERE product_part_id IN(SELECT id FROM sa_snapshot_20261019.sa_product_parts WHERE product_id=%s)',(product_id,))
    c.execute('DELETE FROM sa_snapshot_20261019.sa_product_parts WHERE product_id=%s',(product_id,))
    c.execute('DELETE FROM sa_domain.preset_index WHERE product_id=%s',(product_id,))
    c.execute('DELETE FROM sa_snapshot_20261019.sa_products WHERE id=%s',(product_id,))
    c.execute("DELETE FROM sa_domain.entity_versions WHERE kind='product' AND entity_id=%s",(product_id,))
    self.assertEqual(c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_products WHERE id=%s',(product_id,)).fetchone()[0],0)
    c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=%s WHERE id=103',(direct,))
    c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false');c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s',before)
 def test_concurrent_same_key_returns_same_amendment(self):self.exercise('retry')
 def test_concurrent_distinct_keys_apply_once(self):self.exercise('edit')
 def test_edit_and_cancel_are_serialized(self):self.exercise('cancel')
 def test_edit_and_factory_assignment_are_serialized(self):self.exercise('assignment')
