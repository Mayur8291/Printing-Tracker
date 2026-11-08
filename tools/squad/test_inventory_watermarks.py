"""Inventory snapshots cannot erase concurrent or cold-cache invalidations."""
from sqlstate_assertions import assert_app_conflict
import concurrent.futures
import datetime
import threading
import unittest
import uuid

import psycopg
from psycopg.types.json import Jsonb
from fixtures import rpc
from local_db import connect
import test_warehouse_schedule as schedule_helpers


class InventoryWatermarks(unittest.TestCase):
 setUpClass = schedule_helpers.Schedule.__dict__['setUpClass']
 setUp = schedule_helpers.Schedule.setUp
 tearDown = schedule_helpers.Schedule.tearDown
 actor = schedule_helpers.Schedule.actor
 raw = schedule_helpers.Schedule.raw
 worker = schedule_helpers.Schedule.worker
 prepare = schedule_helpers.Schedule.prepare
 finish = schedule_helpers.Schedule.finish

 def claim(self, handler='warehouse'):
  self.worker();jobs=self.c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0]['jobs'];self.assertEqual(len(jobs),1);self.assertEqual(jobs[0]['handler'],handler);return jobs[0]
 def start(self):
  self.actor();rpc(self.c,'v1_integration_reconcile',('dashboard','inventory',None,uuid.uuid4()));self.assertEqual(self.prepare(self.claim())['state'],'done');j=self.claim();p=self.prepare(j);self.assertEqual(p['facility_code'],'ONE');return j,p
 def ack(self,p,known=True,available=12):
  return {'code':'CONFIRMED','inventory':[{'sku_code':s,'known':known,'available':available if known else None} for s in reversed(p['payload']['skus'])],'proof':{'facility_code':p['facility_code']}}
 def event(self,at=None,facility='ONE',sku='SKU A',kind='stock.level_changed'):
  p={'event':kind,'event_id':'evt_'+uuid.uuid4().hex,'occurred_at':(at or datetime.datetime.now(datetime.timezone.utc)).isoformat(),'facility_code':facility}
  if kind=='stock.level_changed':p.update(trigger='RESERVATION',changed_skus=[{'sku_code':sku,'previous_stock':20,'current_stock':10}])
  else:p['low_stock_items']=[{'sku_code':sku,'available':10,'threshold':15}]
  self.worker();r=self.c.execute('SELECT canto_api.squad_webhook_accept(%s,%s,%s,%s,%s,%s,%s)',('dashboard',p['event_id'],p['event'],p['occurred_at'],Jsonb(p),'a'*64,'scvojtvgnkmbupvyslmb')).fetchone()[0];return r,p
 def as_of(self,j):return self.raw('SELECT request_started_at FROM sa_domain.warehouse_operations WHERE job_id=%s',(uuid.UUID(j['id']),))[0][0]
 def set_start_before_event(self,j):self.raw("UPDATE sa_domain.warehouse_operations SET request_started_at=clock_timestamp()-interval '1 minute' WHERE job_id=%s",(uuid.UUID(j['id']),))
 def state(self):return self.raw("SELECT available,as_of,invalidated_at FROM sa_domain.warehouse_inventory WHERE generation=0 AND provider='dashboard' AND facility_code='ONE' AND sku_id=1")
 def finish_other(self):
  j=self.claim();p=self.prepare(j);self.assertEqual(p['facility_code'],'THREE');self.assertEqual(self.finish(j,self.ack(p))['state'],'done')
 def process_event(self):
  j=self.claim('warehouse_webhook');self.worker();return self.c.execute('SELECT canto_api.squad_warehouse_webhook(%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']))).fetchone()[0]

 def test_cold_cache_callback_is_preserved_when_snapshot_arrives(self):
  j,p=self.start();self.set_start_before_event(j);started=self.as_of(j);receipt,event=self.event();self.assertEqual(receipt['state'],'accepted');self.assertEqual(self.state(),[])
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_inventory_watermarks'),[(1,)])
  self.assertEqual(self.finish(j,self.ack(p))['state'],'done');available,as_of,invalidated=self.state()[0];self.assertEqual(available,12);self.assertEqual(as_of,started);self.assertEqual(invalidated,self.raw('SELECT received_at FROM sa_domain.warehouse_receipts')[0][0])
 def test_warm_cache_invalidates_at_acceptance_before_worker(self):
  self.raw("INSERT INTO sa_domain.warehouse_inventory VALUES(0,'dashboard','ONE',1,20,now()-interval '2 minutes',NULL)")
  j,p=self.start();self.set_start_before_event(j);receipt,event=self.event();self.assertEqual(self.state()[0][0],20);self.assertIsNotNone(self.state()[0][2]);self.finish(j,self.ack(p));self.assertIsNotNone(self.state()[0][2]);self.assertEqual(self.raw('SELECT state FROM sa_domain.warehouse_receipts'),[('accepted',)])
 def test_next_poll_clears_only_after_event_watermark(self):
  j,p=self.start();self.set_start_before_event(j);self.event();self.finish(j,self.ack(p));self.finish_other();self.process_event();self.assertIsNotNone(self.state()[0][2]);j,p=self.start();self.finish(j,self.ack(p,available=10));self.assertEqual(self.state()[0][0],10);self.assertIsNone(self.state()[0][2])
 def test_first_seen_old_provider_clock_invalidates_even_after_newer_snapshot(self):
  j,p=self.start();started=self.as_of(j);self.finish(j,self.ack(p));self.finish_other();receipt,event=self.event(at=started-datetime.timedelta(minutes=20));self.assertEqual(receipt['state'],'accepted');self.assertIsNotNone(self.state()[0][2]);self.process_event();self.assertIsNotNone(self.state()[0][2])
 def test_old_provider_clock_during_http_cannot_be_erased_by_snapshot(self):
  j,p=self.start();receipt,event=self.event(at=self.as_of(j)-datetime.timedelta(minutes=20));self.assertEqual(receipt['state'],'accepted');self.finish(j,self.ack(p));self.assertIsNotNone(self.state()[0][2])
 def test_same_lease_prepare_preserves_earliest_request_start(self):
  j,p=self.start();started=self.as_of(j);self.event();self.prepare(j);self.assertEqual(self.as_of(j),started);self.finish(j,self.ack(p));self.assertIsNotNone(self.state()[0][2])
 def test_delayed_processing_after_new_poll_does_not_restore_stale_flag(self):
  j,p=self.start();self.set_start_before_event(j);self.event();self.finish(j,self.ack(p));self.finish_other()
  # Delay only the callback job; its durable watermark is already recorded.
  self.raw("UPDATE sa_domain.outbox SET available_at=now()+interval '1 hour' WHERE event_type='warehouse.webhook'")
  j,p=self.start();self.finish(j,self.ack(p));self.finish_other();self.assertIsNone(self.state()[0][2]);self.raw("UPDATE sa_domain.outbox SET available_at=now() WHERE event_type='warehouse.webhook'");self.process_event();self.assertIsNone(self.state()[0][2])
 def test_each_first_seen_event_advances_receipt_watermark_regardless_of_provider_time(self):
  now=datetime.datetime.now(datetime.timezone.utc);self.event(at=now);first=self.raw('SELECT received_at FROM sa_domain.warehouse_inventory_watermarks')[0][0];self.event(at=now-datetime.timedelta(minutes=1));self.assertGreater(self.raw('SELECT received_at FROM sa_domain.warehouse_inventory_watermarks')[0][0],first)
 def test_duplicate_delivery_after_new_poll_does_not_invalidate_again(self):
  j,p=self.start();receipt,event=self.event();self.finish(j,self.ack(p));self.finish_other();self.process_event();j,p=self.start();self.finish(j,self.ack(p));self.assertIsNone(self.state()[0][2]);before=self.raw("SELECT received_at FROM sa_domain.warehouse_inventory_watermarks WHERE sku_id=1 AND facility_code='ONE'")[0][0]
  self.worker();duplicate=self.c.execute('SELECT canto_api.squad_webhook_accept(%s,%s,%s,%s,%s,%s,%s)',('dashboard',event['event_id'],event['event'],event['occurred_at'],Jsonb(event),'a'*64,'scvojtvgnkmbupvyslmb')).fetchone()[0];self.assertEqual(duplicate['state'],'duplicate');self.assertIsNone(self.state()[0][2]);self.assertEqual(self.raw("SELECT received_at FROM sa_domain.warehouse_inventory_watermarks WHERE sku_id=1 AND facility_code='ONE'")[0][0],before)
 def test_equal_database_timestamps_conservatively_keep_stale(self):
  j,p=self.start();self.event();self.raw('UPDATE sa_domain.warehouse_inventory_watermarks SET received_at=%s',(self.as_of(j),));self.finish(j,self.ack(p));self.assertIsNotNone(self.state()[0][2])
 def test_low_threshold_is_same_invalidation_contract(self):
  j,p=self.start();self.set_start_before_event(j);self.event(kind='stock.low_threshold');self.finish(j,self.ack(p));self.assertIsNotNone(self.state()[0][2])
 def test_provider_facility_generation_and_sku_are_isolated(self):
  self.raw("INSERT INTO sa_domain.warehouse_inventory VALUES(0,'dashboard','ONE',1,20,now()-interval '1 minute',NULL),(0,'dashboard','THREE',1,20,now()-interval '1 minute',NULL),(0,'unicommerce','ONE',1,20,now()-interval '1 minute',NULL),(1,'dashboard','ONE',1,20,now()-interval '1 minute',NULL),(0,'dashboard','ONE',2,20,now()-interval '1 minute',NULL)");self.event();self.assertEqual(self.raw('SELECT generation,provider,facility_code,sku_id FROM sa_domain.warehouse_inventory WHERE invalidated_at IS NOT NULL'),[(0,'dashboard','ONE',1)])
 def test_quarantined_event_does_not_create_watermark(self):
  self.assertEqual(self.event(facility='UNCONFIGURED')[0]['state'],'quarantined');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_inventory_watermarks'),[(0,)])
 def test_older_snapshot_cannot_overwrite_newer_cached_value(self):
  j,p=self.start();self.set_start_before_event(j);self.raw("INSERT INTO sa_domain.warehouse_inventory VALUES(0,'dashboard','ONE',1,99,clock_timestamp(),NULL)");self.finish(j,self.ack(p));self.assertEqual(self.state()[0][0],99);self.assertIsNone(self.state()[0][2])
 def test_older_unknown_snapshot_cannot_invalidate_newer_known_value(self):
  j,p=self.start();self.set_start_before_event(j);self.raw("INSERT INTO sa_domain.warehouse_inventory VALUES(0,'dashboard','ONE',1,99,clock_timestamp(),NULL)");self.finish(j,self.ack(p,known=False));self.assertEqual(self.state()[0][0],99);self.assertIsNone(self.state()[0][2])
 def test_request_start_is_preparation_time_not_response_time(self):
  j,p=self.start();self.set_start_before_event(j);started=self.as_of(j);self.finish(j,self.ack(p));self.assertEqual(self.state()[0][1],started);self.assertIsNone(self.state()[0][2])
 def test_retry_lease_records_new_snapshot_start(self):
  j,p=self.start();self.set_start_before_event(j);old=self.as_of(j);self.finish(j,{'code':'RETRY','error_code':'PROVIDER_UNAVAILABLE'});self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s',(uuid.UUID(j['id']),));j2=self.claim();self.prepare(j2);self.assertGreater(self.as_of(j2),old)
 def test_expired_lease_cannot_write_cache(self):
  j,p=self.start();self.raw("UPDATE sa_domain.outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=%s",(uuid.UUID(j['id']),))
  with assert_app_conflict(self),self.c.transaction():self.finish(j,self.ack(p))
  self.assertEqual(self.state(),[])
 def test_private_watermark_helpers_are_not_browser_or_service_api(self):
  for role in ['sa_app','authenticated','service_role']:
   for query in ["SELECT * FROM sa_domain.warehouse_inventory_watermarks","SELECT sa_domain.warehouse_inventory_invalidate(0,'dashboard','ONE',now(),'[]')","SELECT sa_domain.warehouse_inventory_store(gen_random_uuid(),gen_random_uuid(),1,12)"]:
    with self.subTest(role=role,query=query),self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():
     self.c.execute('RESET ROLE');self.c.execute('SET LOCAL ROLE '+role);self.c.execute(query)
 def test_concurrent_callback_commit_serializes_before_snapshot_store(self):
  j,p=self.start();self.set_start_before_event(j)
  with connect() as callback:
   callback.execute('BEGIN');callback.execute("SELECT sa_domain.warehouse_inventory_invalidate(0,'dashboard','ONE',clock_timestamp(),%s)",(Jsonb([{'sku_code':'SKU A'}]),))
   started=threading.Event()
   def finish_snapshot():started.set();return self.finish(j,self.ack(p))
   try:
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
     future=pool.submit(finish_snapshot)
     try:
      self.assertTrue(started.wait(2))
      # Finish must wait for the cold-key lock held by the uncommitted callback.
      with self.assertRaises(concurrent.futures.TimeoutError):future.result(timeout=.1)
     finally:callback.execute('COMMIT')
     self.assertEqual(future.result(timeout=3)['state'],'done');self.assertIsNotNone(self.state()[0][2])
   finally:
    # Commit is necessary only for actual cross-session visibility. Remove its
    # synthetic key even if an assertion fails; all other fixtures roll back.
    self.c.execute('ROLLBACK');callback.execute('ROLLBACK');callback.execute("DELETE FROM sa_domain.warehouse_inventory_watermarks WHERE generation=0 AND provider='dashboard' AND facility_code='ONE' AND sku_id=1");self.c.execute('BEGIN')



if __name__=='__main__':unittest.main()
