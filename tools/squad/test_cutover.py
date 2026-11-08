"""Local ownership activation contracts; never connects to a hosted environment."""
from sqlstate_assertions import assert_app_conflict
import datetime,json,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc,uid
from test_catalogue import seed_catalogue
CHECKS=['auth_password_identity_parity','table_content_parity','sequence_high_water','media_storage_integrity','stock_source_integrity','persona_journeys','workflow_acceptance','permission_matrix','refresh_rehearsal','mixed_load','provider_configuration','rollback_rehearsal']
PROJECTS={'staging':('64.227.186.227','scott_international_backend_staging_v2','scvojtvgnkmbupvyslmb'),'production':('165.22.210.53','scott_international_backend_production','levwrmvqdntngeasrtnb')}

def seed_refresh(c,environment='staging',run_id='synthetic-final-refresh'):
 now=c.execute('SELECT now()').fetchone()[0];host,db,project=PROJECTS[environment]
 report={'status':'committed','environment':environment,'archive_sha256':'a'*64,'source_schema_sha256':'b'*64,'tables':86,'rows':26,'table_content':{},'domain':{'generation':0},
  'auth_enrollment':{'password_hash_role_identity_parity':True,'identity_exception_count':0},'public_schema_unchanged':True,'staff_auth_unchanged':True,
  'capture':{'environment':environment,'source_host':host,'database':db,'destination':project,'archive_sha256':'a'*64,'started_at':(now-datetime.timedelta(minutes=20)).isoformat(),'finished_at':(now-datetime.timedelta(minutes=10)).isoformat()}}
 c.execute('UPDATE sa_sync.environment_state SET environment=%s',(environment,))
 c.execute("INSERT INTO sa_sync.refresh_runs(run_id,environment,committed_at,report) VALUES(%s,%s,now()-interval '5 minutes',%s)",(run_id,environment,Jsonb(report)))
 return now

class Cutover(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.actor_id=999;self.now=seed_refresh(self.c);self.actor(999)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.actor_id=n;self.c.execute('RESET ROLE');session(self.c,n,'authenticated' if n==999 else 'sa_app')
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);out=r.fetchall() if r.description else None;self.actor(self.actor_id);return out
 def facts(self):return self.raw('SELECT sa_domain.cutover_facts()')[0][0]
 def evidence(self):
  f=self.facts();return {'source_run_id':f['source']['run_id'],'source_watermark':'Synthetic frozen capture aaaa','source_frozen_at':(self.now-datetime.timedelta(minutes=30)).isoformat(),'freeze_attestation':'Synthetic operator freeze fixture; not a hosted release',
   'artifact_sha256':'c'*64,'verification':{k:True for k in CHECKS},'media_policy':'all_available','media_report_sha256':f['media']['report_sha256'],'identity_policy':'all_eligible','identity_report_sha256':f['identity']['report_sha256'],'verified_at':self.now.isoformat()}
 def register(self,e=None):
  e=e or self.evidence();self.c.execute('SET LOCAL ROLE service_role');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
  r=self.c.execute('SELECT canto_api.squad_cutover_acceptance_register(%s)',(Jsonb(e),)).fetchone()[0];self.actor(self.actor_id);return uuid.UUID(r['id'])
 def preview(self,id=None):return rpc(self.c,'v1_cutover_preview',(id,))
 def commit(self,id,version=None,key=None):return rpc(self.c,'v1_cutover_commit',(id,version or self.preview(id)['version'],key or uuid.uuid4()))
 def test_preview_reports_missing_acceptance_without_writes(self):
  r=self.preview();self.assertFalse(r['ready']);self.assertIn('acceptance_current',r['blockers']);self.assertEqual(self.raw('SELECT cutover,edit_revision FROM sa_sync.environment_state'),[(False,0)]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.cutover_acceptances'),[(0,)])
 def test_verified_staging_commit_changes_ownership_once(self):
  id=self.register();p=self.preview(id);self.assertTrue(p['ready'],p['blockers']);r=self.commit(id,p['version']);self.assertTrue(r['owned']);self.assertEqual(r['generation'],'1');self.assertFalse(r['old_source_refresh_enabled']);self.assertEqual(self.raw('SELECT cutover,edit_revision,synced_revision FROM sa_sync.environment_state'),[(True,1,0)]);self.assertEqual(self.raw('SELECT generation,allow_test_writes FROM sa_domain.runtime_state'),[(1,False)])
 def test_epoch_requires_verified_commit_not_raw_boolean(self):
  self.raw('UPDATE sa_sync.environment_state SET cutover=true');self.assertIsNone(self.raw('SELECT sa_domain.ownership_epoch()')[0][0]['activated_at'])
 def test_epoch_matches_activation_environment_and_generation(self):
  self.commit(self.register());epoch=self.raw('SELECT sa_domain.ownership_epoch()')[0][0];self.assertIsNotNone(epoch['activated_at']);self.assertEqual(epoch['generation'],'1');self.raw('UPDATE sa_domain.runtime_state SET generation=2');self.assertIsNone(self.raw('SELECT sa_domain.ownership_epoch()')[0][0]['activated_at'])
 def test_exact_commit_retry_is_idempotent_even_after_owned_writes(self):
  id=self.register();p=self.preview(id);key=uuid.uuid4();r=self.commit(id,p['version'],key);self.raw('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1');self.assertEqual(r,self.commit(id,p['version'],key));self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.cutover_commits'),[(1,)])
 def test_changed_idempotency_payload_rejected(self):
  id=self.register();p=self.preview(id);key=uuid.uuid4();self.commit(id,p['version'],key)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.commit(id,'d'*64,key)
 def test_second_commit_key_does_not_create_second_epoch(self):
  id=self.register();self.commit(id)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.commit(id,'d'*64)
 def test_no_historical_outbound_events_created(self):
  before=self.raw('SELECT count(*) FROM sa_domain.outbox');self.commit(self.register());self.assertEqual(before,self.raw('SELECT count(*) FROM sa_domain.outbox'));self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.audit WHERE operation='ownership.cutover'"),[(1,)])
 def test_business_rows_and_identity_ids_are_preserved(self):
  before=self.raw('SELECT id,email FROM sa_snapshot_20261019.sa_users ORDER BY id');identity=self.raw('SELECT auth_user_id,legacy_user_id FROM sa_identity.sa_auth_identities ORDER BY legacy_user_id');seq=self.raw('SELECT last_value,is_called FROM sa_snapshot_20261019.sa_users_id_seq');self.commit(self.register());self.assertEqual(before,self.raw('SELECT id,email FROM sa_snapshot_20261019.sa_users ORDER BY id'));self.assertEqual(identity,self.raw('SELECT auth_user_id,legacy_user_id FROM sa_identity.sa_auth_identities ORDER BY legacy_user_id'));self.assertEqual(seq,self.raw('SELECT last_value,is_called FROM sa_snapshot_20261019.sa_users_id_seq'))
 def test_app_admin_is_not_platform_operator(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.preview()
 def test_customer_denied(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.preview()
 def test_staff_cannot_register_own_acceptance(self):
  e=self.evidence()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.squad_cutover_acceptance_register(%s)',(Jsonb(e),))
 def test_service_cannot_commit_ownership(self):
  self.c.execute('SET LOCAL ROLE service_role');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.preview()
 def test_revoked_staff_session_denied(self):
  self.raw('DELETE FROM auth.sessions WHERE user_id=%s',(uid(999),))
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.preview()
 def test_demoted_staff_denied(self):
  self.raw("UPDATE public.profiles SET role='user' WHERE id=%s",(uid(999),))
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.preview()
 def test_generation_change_invalidates_acceptance_and_preview(self):
  id=self.register();p=self.preview(id);self.raw('UPDATE sa_domain.runtime_state SET generation=1');self.assertFalse(self.preview(id)['checks']['acceptance_current'])
  with assert_app_conflict(self):self.commit(id,p['version'])
 def test_local_write_invalidates_acceptance(self):
  id=self.register();self.raw('UPDATE sa_sync.environment_state SET edit_revision=1');r=self.preview(id);self.assertIn('clean_revision',r['blockers']);self.assertIn('acceptance_current',r['blockers'])
 def test_source_run_change_invalidates_acceptance(self):
  id=self.register();self.raw("UPDATE sa_sync.refresh_runs SET report=jsonb_set(report,'{archive_sha256}',to_jsonb(%s::text))",('d'*64,));self.assertIn('acceptance_current',self.preview(id)['blockers'])
 def test_active_refresh_prevents_commit(self):
  id=self.register();self.raw('UPDATE sa_sync.environment_state SET active_job=%s',(uuid.uuid4(),));r=self.preview(id);self.assertIn('no_active_refresh',r['blockers'])
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.commit(id,r['version'])
 def test_pending_event_blocks_without_discarding_it(self):
  self.raw("INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload) VALUES(%s,'unknown.fixture','maintenance',1,%s,0,'{}')",(uid(999),uuid.uuid4()));id=self.register();r=self.preview(id);self.assertIn('no_unfinished_work',r['blockers']);self.assertEqual(r['facts']['unfinished']['events'],1)
 def test_test_override_is_blocker(self):
  self.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=true');self.assertIn('test_override_off',self.preview()['blockers'])
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.register()
 def test_missing_machine_gate_rejected(self):
  e=self.evidence();del e['verification']['sequence_high_water']
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.register(e)
 def test_failed_machine_gate_rejected(self):
  e=self.evidence();e['verification']['stock_source_integrity']=False
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.register(e)
 def test_operator_freeze_must_precede_capture(self):
  e=self.evidence();e['source_frozen_at']=(self.now-datetime.timedelta(minutes=15)).isoformat()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.register(e)
 def test_missing_capture_timestamp_is_blocker(self):
  self.raw("UPDATE sa_sync.refresh_runs SET report=report#-'{capture,started_at}'");self.assertIn('source_timestamps',self.preview()['blockers'])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.register()
 def test_malformed_capture_timestamp_is_blocker(self):
  self.raw("UPDATE sa_sync.refresh_runs SET report=jsonb_set(report,'{capture,finished_at}',to_jsonb('garbage'::text))");self.assertIn('source_timestamps',self.preview()['blockers'])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.register()
 def test_capture_must_finish_after_start(self):
  self.raw("UPDATE sa_sync.refresh_runs SET report=jsonb_set(report,'{capture,finished_at}',to_jsonb((now()-interval '21 minutes')::text))");self.assertIn('source_timestamps',self.preview()['blockers'])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.register()
 def test_capture_must_precede_publication(self):
  self.raw("UPDATE sa_sync.refresh_runs SET report=jsonb_set(report,'{capture,finished_at}',to_jsonb(now()::text))");self.assertIn('source_timestamps',self.preview()['blockers'])
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.register()
 def test_missing_exception_policy_is_invalid(self):
  e=self.evidence();del e['media_policy']
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.register(e)
 def test_missing_identity_policy_is_invalid(self):
  e=self.evidence();del e['identity_policy']
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.register(e)
 def test_old_verification_rejected(self):
  e=self.evidence();e['verified_at']=(self.now-datetime.timedelta(minutes=40)).isoformat()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.register(e)
 def test_expired_acceptance_blocked(self):
  id=self.register();self.raw("UPDATE sa_domain.cutover_acceptances SET expires_at=now()-interval '1 second'");self.assertIn('acceptance_current',self.preview(id)['blockers'])
 def test_revoked_acceptance_blocked(self):
  id=self.register();self.raw('UPDATE sa_domain.cutover_acceptances SET revoked_at=now()');self.assertIn('acceptance_current',self.preview(id)['blockers'])
 def test_wrong_environment_capture_is_blocker(self):
  self.raw("UPDATE sa_sync.refresh_runs SET report=jsonb_set(report,'{capture,destination}',to_jsonb('wrong-project'::text))");self.assertIn('source_environment',self.preview()['blockers'])
 def test_wrong_source_generation_is_blocker(self):
  self.raw("UPDATE sa_sync.refresh_runs SET report=jsonb_set(report,'{domain,generation}','1')");self.assertIn('source_verified',self.preview()['blockers'])
 def test_unverified_auth_report_is_blocker(self):
  self.raw("UPDATE sa_sync.refresh_runs SET report=jsonb_set(report,'{auth_enrollment,password_hash_role_identity_parity}','false')");self.assertIn('source_verified',self.preview()['blockers'])
 def test_pending_identity_blocks(self):
  self.raw("UPDATE sa_identity.sa_auth_identities SET enrollment_state='pending' WHERE legacy_user_id=100");self.assertIn('identity_mappings_complete',self.preview()['blockers'])
 def test_known_missing_media_requires_exact_reviewed_report(self):
  self.raw("INSERT INTO sa_media.references(resource,record_id,field,source_value,status) VALUES('rmp_classes',1,'image1','old-missing.png','missing')");id=self.register();self.assertIn('media_exception_policy',self.preview(id)['blockers']);e=self.evidence();e['media_policy']='reviewed_source_missing';id=self.register(e);self.assertTrue(self.preview(id)['ready'])
 def test_changed_missing_report_invalidates_review(self):
  e=self.evidence();self.raw("INSERT INTO sa_media.references(resource,record_id,field,source_value,status) VALUES('rmp_classes',1,'image1','old-missing.png','missing')")
  with assert_app_conflict(self):self.register(e)
 def test_missing_storage_object_is_hard_blocker_even_with_exception_policy(self):
  self.raw("INSERT INTO sa_media.references(resource,record_id,field,source_value,status,sha256) VALUES('rmp_classes',1,'image1','file.png','ready',%s)",('d'*64,));e=self.evidence();e['media_policy']='reviewed_source_missing';id=self.register(e);self.assertIn('media_verified',self.preview(id)['blockers'])
 def test_known_identity_exceptions_require_explicit_bound_review(self):
  self.raw("UPDATE sa_sync.refresh_runs SET report=jsonb_set(report,'{auth_enrollment,identity_exception_count}','1')");id=self.register();self.assertIn('identity_exception_policy',self.preview(id)['blockers']);e=self.evidence();e['identity_policy']='reviewed_identity_exceptions';id=self.register(e);self.assertTrue(self.preview(id)['ready'])
 def test_duplicate_stock_is_hard_blocker(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET customer_id=110 WHERE id=1001');self.raw('INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,dispatched_quantity,rmp_class_id,rmp_brand_id,rmp_category_id,created_at,updated_at) SELECT 110,1001,1001,1,0,10,0,1,1,1,now(),now() FROM generate_series(1,2)');id=self.register();self.assertIn('stock_unambiguous',self.preview(id)['blockers'])
 def test_production_denied_without_separate_release_authorization(self):
  self.raw('DELETE FROM sa_sync.refresh_runs');self.c.execute('RESET ROLE');self.now=seed_refresh(self.c,'production');self.actor(999);id=self.register();p=self.preview(id);self.assertIn('production_release',p['blockers'])
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.commit(id,p['version'])
 def test_production_requires_exact_unexpired_release_binding(self):
  self.raw('DELETE FROM sa_sync.refresh_runs');self.c.execute('RESET ROLE');self.now=seed_refresh(self.c,'production');self.actor(999);e=self.evidence();release=self.raw("INSERT INTO sa_domain.production_release_authorizations(reference,source_run_id,artifact_sha256,generation,expires_at) VALUES('Synthetic explicit release','synthetic-final-refresh',%s,0,now()+interval '1 hour') RETURNING id",('c'*64,))[0][0];e['release_authorization_id']=str(release);id=self.register(e);self.assertTrue(self.preview(id)['ready']);self.assertTrue(self.commit(id)['owned'])
 def test_client_cannot_create_production_release_authorization(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("INSERT INTO sa_domain.production_release_authorizations(reference,source_run_id,artifact_sha256,generation,expires_at) VALUES('forged','run',%s,0,now()+interval '1 hour')",('c'*64,))
 def test_claimed_source_freeze_does_not_bypass_stock_gate(self):
  self.raw('INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,dispatched_quantity,rmp_class_id,rmp_brand_id,rmp_category_id,created_at,updated_at) VALUES(103,1001,1001,1,0,10,0,1,1,1,now(),now())');id=self.register();self.assertIn('stock_unambiguous',self.preview(id)['blockers'])

if __name__=='__main__':unittest.main(verbosity=2)
