"""Legacy uncertain-create failures recover only through leased provider reads."""
from sqlstate_assertions import assert_app_conflict
import unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from fixtures import rpc
import test_warehouse_amendments as amendments

class UniwareFailedRecovery(unittest.TestCase):
 @classmethod
 def setUpClass(cls):amendments.WarehouseAmendments.setUpClass()
 def setUp(self):
  self.f=amendments.WarehouseAmendments();self.f.setUp();self.f.use_uniware();self.f.place(False,3);self.f.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_status='FAILED',order_source='unicommerce',uc_order_id='S-'||id WHERE id=%s",(self.f.oid,))
 def tearDown(self):self.f.tearDown()
 def prepare(self):
  f=self.f;f.actor(999,'authenticated');rpc(f.c,'v1_integration_reconcile',('unicommerce','orders',None,uuid.uuid4()));self.assertEqual(f.prepare(f.claim()[0])['state'],'done');j=f.claim()[0];p=f.prepare(j);self.assertEqual(p['operation'],'reconcile');return j,p
 def observed(self,p,status='PROCESSING'):
  r=self.f.observed(p);r['status']=status;r['proof']['source']='saleorder_get';return r
 def status(self):return self.f.raw('SELECT uc_status FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(self.f.oid,))[0][0]
 def test_exact_legacy_failure_recovers_and_replays_once(self):
  f=self.f;j,p=self.prepare();r=self.observed(p);done=f.finish(j,r);self.assertEqual(done['state'],'done',done);self.assertEqual(done['result']['state'],'applied');self.assertEqual(self.status(),'PROCESSING');self.assertTrue(f.finish(j,r)['replayed']);self.assertEqual(f.raw("SELECT count(*) FROM sa_domain.audit WHERE entity_id=%s AND operation='warehouse.result'",(f.oid,)),[(1,)]);self.assertEqual(f.raw("SELECT count(*) FROM sa_domain.outbox WHERE aggregate_id=%s AND event_type='warehouse.status_changed'",(f.oid,)),[(1,)])
 def test_created_status_is_normalized_by_shared_core(self):
  j,p=self.prepare();self.assertEqual(self.f.finish(j,self.observed(p,'CREATED'))['state'],'done');self.assertEqual(self.status(),'PENDING')
 def test_legacy_replacement_reference_is_preserved_on_recovery(self):
  self.f.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id='S-'||id||'-1' WHERE id=%s",(self.f.oid,));j,p=self.prepare();self.assertEqual(self.f.finish(j,self.observed(p))['state'],'done');self.assertEqual(self.status(),'PROCESSING')
 def test_wrong_facility_cannot_recover_failed(self):
  j,p=self.prepare();r=self.observed(p);r['proof']['items'][0]['facility_code']='THREE';self.assertEqual(self.f.finish(j,r)['state'],'dead');self.assertEqual(self.status(),'FAILED')
 def test_wrong_sku_cannot_recover_failed(self):
  j,p=self.prepare();r=self.observed(p);r['proof']['items'][0]['sku_code']='FOREIGN';self.assertEqual(self.f.finish(j,r)['state'],'dead');self.assertEqual(self.status(),'FAILED')
 def test_wrong_quantity_cannot_recover_failed(self):
  j,p=self.prepare();r=self.observed(p);r['proof']['items'].pop();self.assertEqual(self.f.finish(j,r)['state'],'dead');self.assertEqual(self.status(),'FAILED')
 def test_duplicate_piece_identity_cannot_recover_failed(self):
  j,p=self.prepare();r=self.observed(p);r['proof']['items'][1]['code']=r['proof']['items'][0]['code'];self.assertEqual(self.f.finish(j,r)['state'],'dead');self.assertEqual(self.status(),'FAILED')
 def test_missing_provider_read_source_marker_cannot_recover_failed(self):
  j,p=self.prepare();r=self.observed(p);r['proof'].pop('source');self.assertEqual(self.f.finish(j,r)['state'],'dead');self.assertEqual(self.status(),'FAILED')
 def test_wrong_external_reference_cannot_recover_failed(self):
  j,p=self.prepare();r=self.observed(p);r['external_id']='S-other';self.assertEqual(self.f.finish(j,r)['state'],'dead');self.assertEqual(self.status(),'FAILED')
 def test_wrong_environment_prefix_does_not_recover(self):
  self.f.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id='P-'||id WHERE id=%s",(self.f.oid,));j,p=self.prepare();self.assertEqual(self.f.finish(j,self.observed(p))['state'],'dead');self.assertEqual(self.status(),'FAILED')
 def test_confirmed_failed_link_is_not_legacy_uncertainty(self):
  self.f.raw("INSERT INTO sa_domain.warehouse_links(order_id,provider,external_id,external_code,generation,status) VALUES(%s,'unicommerce',%s,%s,0,'FAILED')",(self.f.oid,'S-'+str(self.f.oid),'S-'+str(self.f.oid)));j,p=self.prepare();self.assertEqual(self.f.finish(j,self.observed(p))['state'],'dead');self.assertEqual(self.status(),'FAILED')
 def test_stale_lease_has_no_recovery_authority(self):
  j,p=self.prepare();bad=dict(j,lease_token=str(uuid.uuid4()))
  with assert_app_conflict(self):
   with self.f.c.transaction():self.f.finish(bad,self.observed(p))
  self.assertEqual(self.status(),'FAILED')
 def test_dashboard_failed_stays_terminal(self):
  f=self.f;f.provider='dashboard';f.raw("UPDATE sa_snapshot_20261019.sa_settings SET value='true' WHERE key='use_dashboard'");f.raw("UPDATE sa_domain.warehouse_config SET provider='dashboard'");f.raw("UPDATE sa_snapshot_20261019.sa_orders SET order_source='dashboard' WHERE id=%s",(f.oid,));f.actor(999,'authenticated');rpc(f.c,'v1_integration_reconcile',('dashboard','orders',None,uuid.uuid4()));f.prepare(f.claim()[0]);j=f.claim()[0];p=f.prepare(j);r=f.observed(p);r['proof']['source']='saleorder_get';self.assertEqual(f.finish(j,r)['state'],'dead');self.assertEqual(self.status(),'FAILED')
 def test_changed_source_provider_cannot_claim_legacy_uniware_failure(self):
  j,p=self.prepare();self.f.raw("UPDATE sa_snapshot_20261019.sa_orders SET order_source='dashboard' WHERE id=%s",(self.f.oid,));self.assertEqual(self.f.finish(j,self.observed(p))['state'],'dead');self.assertEqual(self.status(),'FAILED')
 def test_failed_recovery_helper_is_private_without_browser_or_service_escape(self):
  f=self.f
  for role in ['sa_app','service_role']:
   f.actor(103,role)
   with self.assertRaises(psycopg.errors.InsufficientPrivilege):
    with f.c.transaction():f.c.execute("SELECT sa_domain.uniware_legacy_failure_recoverable(%s,'unicommerce','S-1','S-1','PROCESSING')",(f.oid,))
 def test_scheduled_uniware_poll_includes_failed_but_excludes_complete_and_cancelled(self):
  f=self.f;f.actor(100);rpc(f.c,'v1_warehouse_schedule_configure',(True,'0:0',uuid.uuid4()));f.raw("UPDATE sa_domain.warehouse_schedule SET next_inventory_at=now()+interval '1 day'");f.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id='S-'||id,order_source='unicommerce',uc_status=CASE id WHEN 1001 THEN 'COMPLETE' ELSE 'CANCELLED' END WHERE id IN(1001,1002)");f.service();self.assertEqual(f.c.execute('SELECT canto_api.squad_warehouse_heartbeat()').fetchone()[0]['scope'],'orders');self.assertEqual(f.prepare(f.claim()[0])['state'],'done');self.assertEqual(f.raw("SELECT aggregate_id FROM sa_domain.outbox WHERE event_type='warehouse.order_reconcile'"),[(f.oid,)]);j=f.claim()[0];p=f.prepare(j);self.assertEqual(f.finish(j,self.observed(p))['state'],'done');self.assertEqual(self.status(),'PROCESSING')

if __name__=='__main__':unittest.main(verbosity=2)
