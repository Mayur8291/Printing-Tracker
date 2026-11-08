"""Source-backed stock review and derived-counter repair, on synthetic data only."""
from sqlstate_assertions import assert_app_conflict
import json,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc,uid
from test_catalogue import seed_catalogue
from test_presets import CONFIG

class StockReconciliation(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.actor_id=100
  self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET customer_id=110,customer_dealer_id=NULL,assigned_worker_id=NULL WHERE id IN(1001,1002)')
  self.c.execute('UPDATE sa_snapshot_20261019.sa_orders SET assigned_worker_id=NULL,assigned_to_id=NULL WHERE id=1004')
  self.c.execute("UPDATE sa_snapshot_20261019.sa_items SET item_type=1,rmp_class_id=1,rmp_brand_id=1,rmp_category_id=1,uc_order_status='COMPLETE' WHERE id IN(1001,1002,1004)")
  self.stock_id=self.c.execute('INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,dispatched_quantity,rmp_class_id,rmp_brand_id,rmp_category_id,created_at,updated_at) VALUES(110,1001,1001,1,0,10,0,1,1,1,now()-interval \'1 day\',now()) RETURNING id').fetchone()[0]
  self.actor(100)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.actor_id=n;self.c.execute('RESET ROLE');session(self.c,n,'authenticated' if n==999 else 'sa_app')
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);out=r.fetchall() if r.description else None;self.actor(self.actor_id);return out
 def call(self,action='review',request=None,dealer=110,cursor=None,limit=25):return rpc(self.c,'v1_stock_reconciliation',(dealer,action,Jsonb(request or {}),cursor,limit))
 def row(self,id=None):return self.call(request={'receipt_id':str(id or self.stock_id)})['data'][0]
 def stale(self):self.raw('UPDATE sa_snapshot_20261019.sa_stocks SET dispatched_quantity=1 WHERE id=%s',(self.stock_id,));return self.row()
 def payload(self,row=None,key=None):
  row=row or self.row();return {'receipts':[{'id':row['id'],'expected_version':row['version']}],'reason':'Rebuild verified ledger projection','idempotency_key':str(key or uuid.uuid4())}
 def consume(self,amount=3):
  self.actor(110);q=self.raw('SELECT id FROM sa_snapshot_20261019.sa_quantities WHERE item_id=1004')[0][0];v=self.raw("SELECT sa_domain.version('item',1004)")[0][0]
  out=rpc(self.c,'v1_dispatch_record',(1004,Jsonb([{'quantity_id':str(q),'quantity':amount}]),None,v,uuid.uuid4()));self.actor(100);return out
 def test_admin_reads_source_and_authoritative_consumption(self):
  self.consume();r=self.row();self.assertEqual(r['received'],10);self.assertEqual(r['source_quantity'],10);self.assertEqual(r['consumed'],3);self.assertEqual(r['available'],7);self.assertEqual(r['issues'],[])
 def test_platform_admin_has_same_operational_view(self):self.actor(999);self.assertEqual(self.row()['status'],'ready')
 def test_non_admin_personas_denied(self):
  for n in [101,102,103,104,107,108,109,110,111,112]:
   with self.subTest(n=n),self.c.transaction():
    self.actor(n)
    with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.call()
    raise psycopg.Rollback()
  self.actor(100)
 def test_staff_demoted_denied(self):
  self.actor(999);self.raw("UPDATE public.profiles SET role='user' WHERE id=%s",(uid(999),))
  with self.assertRaises(psycopg.Error):self.call()
 def test_revoked_session_denied(self):
  self.raw('DELETE FROM auth.sessions WHERE user_id=%s',(uid(100),))
  with self.assertRaises(psycopg.Error):self.call()
 def test_banned_admin_denied(self):
  self.raw("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=%s",(uid(100),))
  with self.assertRaises(psycopg.Error):self.call()
 def test_no_raw_stock_or_private_helper_access(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT * FROM sa_domain.stock_reconciliation_rows(110,ARRAY[%s::bigint])',(self.stock_id,))
 def test_counter_rebuild_preserves_receipt_and_usage_history(self):
  self.consume();self.stale();before=self.raw('SELECT id,stock_id,dispatched_quantity_id,qty FROM sa_snapshot_20261019.sa_stock_useds ORDER BY id')
  r=self.call('rebuild',self.payload());self.assertEqual(r['state'],'completed');self.assertEqual(self.row()['consumed'],3);self.assertEqual(self.row()['counter'],3);self.assertEqual(self.row()['issues'],[])
  self.assertEqual(before,self.raw('SELECT id,stock_id,dispatched_quantity_id,qty FROM sa_snapshot_20261019.sa_stock_useds ORDER BY id'))
  self.assertEqual(self.raw('SELECT quantity FROM sa_snapshot_20261019.sa_stocks WHERE id=%s',(self.stock_id,)),[(10,)])
  self.assertEqual(self.raw('SELECT before_counter,after_counter FROM sa_domain.stock_reconciliations'),[(1,3)])
 def test_platform_repairs_without_fabricated_legacy_actor(self):
  self.stale();self.actor(999);self.call('rebuild',self.payload());self.assertEqual(self.raw('SELECT legacy_user_id FROM sa_domain.stock_reconciliations'),[(None,)])
 def test_retry_does_not_duplicate_audit_or_correction(self):
  self.stale();p=self.payload();r=self.call('rebuild',p);self.assertEqual(r,self.call('rebuild',p));self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.stock_reconciliations'),[(1,)]);self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.audit WHERE operation='stock.counter_rebuilt'"),[(1,)])
 def test_repair_advances_refresh_revision_once_and_emits_no_events(self):
  self.stale();rev=self.raw('SELECT edit_revision FROM sa_sync.environment_state')[0][0];before=self.raw('SELECT count(*) FROM sa_domain.outbox');self.call('rebuild',self.payload());self.assertEqual(self.raw('SELECT edit_revision FROM sa_sync.environment_state'),[(rev+1,)]);self.assertEqual(before,self.raw('SELECT count(*) FROM sa_domain.outbox'))
 def test_idempotency_payload_conflict(self):
  self.stale();p=self.payload();self.call('rebuild',p);p['reason']='Different reason'
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.call('rebuild',p)
 def test_stale_fingerprint_rejected(self):
  self.stale();p=self.payload();self.raw("UPDATE sa_snapshot_20261019.sa_stocks SET updated_at=now()+interval '1 second' WHERE id=%s",(self.stock_id,))
  with assert_app_conflict(self):self.call('rebuild',p)
 def test_source_quantity_change_invalidates_review(self):
  self.stale();p=self.payload();self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET quantity=11 WHERE item_id=1001')
  with assert_app_conflict(self):self.call('rebuild',p)
 def test_source_generation_change_invalidates_review(self):
  self.stale();p=self.payload();self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1')
  with assert_app_conflict(self):self.call('rebuild',p)
 def test_mirror_denies_repair_but_allows_review(self):
  self.stale();p=self.payload();self.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=false');self.assertEqual(self.row()['safe_action'],'rebuild_counter')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.call('rebuild',p)
 def test_active_refresh_denies_repair(self):
  self.stale();p=self.payload();self.raw('UPDATE sa_sync.environment_state SET active_job=%s',(uuid.uuid4(),))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.call('rebuild',p)
 def test_foreign_dealer_receipt_cannot_be_repaired(self):
  self.stale();p=self.payload()
  with self.assertRaises(psycopg.errors.NoDataFound):self.call('rebuild',p,dealer=210)
 def test_duplicate_origin_is_reported_and_never_merged(self):
  self.stale();self.raw('INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,dispatched_quantity,rmp_class_id,rmp_brand_id,rmp_category_id,created_at,updated_at) SELECT user_id,order_id,item_id,size_id,stock_type,quantity,0,rmp_class_id,rmp_brand_id,rmp_category_id,created_at,updated_at FROM sa_snapshot_20261019.sa_stocks WHERE id=%s',(self.stock_id,));r=self.row();self.assertIn('duplicate_origin',r['issues']);self.assertIsNone(r['safe_action']);self.assertIsNone(r['available'])
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.call('rebuild',self.payload(r))
 def test_receipt_owner_mismatch_is_blocked(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET customer_id=210 WHERE id=1001');self.assertIn('invalid_origin',self.row()['issues'])
 def test_source_variant_mismatch_is_blocked(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET rmp_class_id=2 WHERE id=1001');self.assertIn('source_variant_mismatch',self.row()['issues']);self.assertIsNone(self.row()['safe_action'])
 def test_source_incomplete_is_blocked(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_items SET uc_order_status='CREATED' WHERE id=1001");self.assertIn('source_not_completed',self.row()['issues'])
 def test_missing_size_is_blocked(self):
  self.raw('DELETE FROM sa_snapshot_20261019.sa_quantities WHERE item_id=1001');self.assertIn('missing_source_size',self.row()['issues'])
 def test_negative_receipt_is_blocked(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_stocks SET quantity=-1 WHERE id=%s',(self.stock_id,));self.assertIn('invalid_receipt_quantity',self.row()['issues'])
 def test_bad_consumption_dispatch_ownership_is_blocked(self):
  self.consume();self.raw('UPDATE sa_snapshot_20261019.sa_orders SET customer_dealer_id=210 WHERE id=1004');r=self.row();self.assertIn('invalid_consumption_ledger',r['issues']);self.assertIsNone(r['safe_action'])
 def test_partial_or_overallocated_dispatch_is_blocked(self):
  self.consume();self.raw('UPDATE sa_snapshot_20261019.sa_stock_useds SET qty=2 WHERE stock_id=%s',(self.stock_id,));r=self.row();self.assertIn('invalid_consumption_ledger',r['issues']);self.assertIsNone(r['safe_action'])
 def test_negative_usage_and_overconsumption_are_blocked(self):
  self.consume();self.raw('UPDATE sa_snapshot_20261019.sa_stock_useds SET qty=20 WHERE stock_id=%s',(self.stock_id,));self.assertIn('overconsumed',self.row()['issues']);self.assertIsNone(self.row()['safe_action'])
 def test_usage_before_receipt_time_is_blocked(self):
  self.consume();self.raw("UPDATE sa_snapshot_20261019.sa_stocks SET created_at=now()+interval '1 day' WHERE id=%s",(self.stock_id,));self.assertIn('invalid_consumption_ledger',self.row()['issues'])
 def test_cursor_bound_to_generation_and_dealer(self):
  self.raw('INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,dispatched_quantity,rmp_class_id,rmp_brand_id,rmp_category_id,created_at,updated_at) VALUES(110,1002,1002,1,0,10,0,1,1,1,now(),now())');p=self.call(limit=1);self.assertIsNotNone(p['next_cursor']);q=self.call(cursor=p['next_cursor'],limit=1);self.assertNotEqual(p['data'][0]['id'],q['data'][0]['id'])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.call(dealer=210,cursor=p['next_cursor'])
 def test_duplicate_request_receipts_rejected(self):
  self.stale();p=self.payload();p['receipts']*=2
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.call('rebuild',p)
 def test_reason_required(self):
  self.stale();p=self.payload();p['reason']=' '
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.call('rebuild',p)
 def test_unknown_fields_and_actions_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.call(request={'user_id':'110'})
 def test_limit_is_bounded(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.call(limit=101)
 def test_history_is_bounded_and_environment_history_survives_refresh(self):
  self.stale();self.call('rebuild',self.payload());r=self.call('history');self.assertEqual(r['data'][0]['receipt_id'],str(self.stock_id));self.assertEqual(r['data'][0]['after'],0)
  self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1');self.assertEqual(self.call('history')['data'][0]['generation'],'0')
  self.assertEqual(self.call('history',dealer=210)['data'],[])
 def test_platform_can_read_stock_audit(self):
  self.stale();self.actor(999);self.call('rebuild',self.payload());self.assertEqual(len(rpc(self.c,'v1_audit_list',('stock',110))['data']),1)
 def test_append_only_corrections_cannot_be_deleted(self):
  self.stale();self.call('rebuild',self.payload());self.c.execute('SET LOCAL ROLE sa_media_writer')
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('DELETE FROM sa_domain.stock_reconciliations')
 def test_one_unsafe_receipt_rolls_back_entire_batch(self):
  self.stale();p=self.payload();id2=self.raw('INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,dispatched_quantity,rmp_class_id,rmp_brand_id,rmp_category_id,created_at,updated_at) VALUES(110,1002,1002,1,0,11,1,1,1,1,now(),now()) RETURNING id')[0][0]
  p=self.payload();p['receipts'].append({'id':str(id2),'expected_version':self.row(id2)['version']})
  with self.c.transaction():
   with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.call('rebuild',p)
   raise psycopg.Rollback()
  self.assertEqual(self.raw('SELECT dispatched_quantity FROM sa_snapshot_20261019.sa_stocks WHERE id=%s',(self.stock_id,)),[(1,)]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.stock_reconciliations'),[(0,)])
 def test_repair_serializes_with_dealer_stock_writers(self):
  self.stale();p=self.payload()
  with connect() as other,other.transaction():
   other.execute("SELECT pg_advisory_xact_lock(hashtextextended('dealer-stock:110',784139))")
   self.c.execute("SET LOCAL lock_timeout='100ms'")
   with self.assertRaises(psycopg.errors.LockNotAvailable):self.call('rebuild',p)
 def test_refresh_lock_denies_repair(self):
  p={'receipts':[{'id':str(self.stock_id),'expected_version':'0:'+'a'*64}],'reason':'Refresh conflict','idempotency_key':str(uuid.uuid4())}
  with connect() as other,other.transaction():
   other.execute('SELECT pg_advisory_xact_lock(20261107,1)')
   with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.call('rebuild',p)
 def test_cutover_allows_repair_without_test_write_override(self):
  self.stale();p=self.payload();self.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=false');self.raw('UPDATE sa_sync.environment_state SET cutover=true');self.assertEqual(self.call('rebuild',p)['state'],'completed')
 def test_duplicate_consumption_pair_requires_source_review(self):
  self.consume();self.raw('UPDATE sa_snapshot_20261019.sa_stock_useds SET qty=1 WHERE stock_id=%s',(self.stock_id,));self.raw('INSERT INTO sa_snapshot_20261019.sa_stock_useds(stock_id,dispatched_quantity_id,qty,created_at,updated_at) SELECT stock_id,dispatched_quantity_id,2,created_at,updated_at FROM sa_snapshot_20261019.sa_stock_useds WHERE stock_id=%s',(self.stock_id,));self.assertIn('invalid_consumption_ledger',self.row()['issues'])
 def test_null_source_quantity_is_not_ignored_by_sum(self):
  self.raw('INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,created_at,updated_at) VALUES(1001,1,NULL,now(),now())');self.assertIn('source_quantity_mismatch',self.row()['issues'])
 def test_source_non_dealer_owner_is_invalid(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET role=3 WHERE id=110');self.assertIn('invalid_origin',self.row()['issues'])
 def test_unknown_action_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.call('delete')
 def test_canonical_custom_receipt_and_consumption_reuse_product_identity(self):
  self.actor(110);p=rpc(self.c,'v1_product_configure',(Jsonb(CONFIG),'Receipt','',uuid.uuid4()));self.actor(103);d=rpc(self.c,'v1_product_configure',(Jsonb(CONFIG),'Dispatch','',uuid.uuid4()));self.actor(100)
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=0,product_id=%s,rmp_class_id=NULL,rmp_brand_id=NULL,rmp_category_id=NULL WHERE id=1001',(int(p['id']),))
  self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=0,product_id=%s,rmp_class_id=NULL,rmp_brand_id=NULL,rmp_category_id=NULL WHERE id=1004',(int(d['id']),))
  self.raw('UPDATE sa_snapshot_20261019.sa_quantities SET dispatched_quantity=quantity WHERE item_id=1001')
  self.raw('UPDATE sa_snapshot_20261019.sa_stocks SET stock_type=1,product_id=%s,rmp_class_id=NULL,rmp_brand_id=NULL,rmp_category_id=NULL WHERE id=%s',(int(p['id']),self.stock_id))
  self.consume();self.assertEqual(self.row()['issues'],[]);self.stale();self.call('rebuild',self.payload());self.assertEqual(self.row()['available'],7)
 def test_healthy_stock_has_no_repair(self):
  self.assertIsNone(self.row()['safe_action'])
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.call('rebuild',self.payload())

if __name__=='__main__':unittest.main(verbosity=2)
