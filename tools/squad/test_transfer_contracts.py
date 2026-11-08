"""Bulk transfer ownership, row privacy, command fences and live staff authority."""
import json, unittest, uuid
import psycopg
from psycopg.types.json import Jsonb
from fixtures import session, uid
from local_db import connect
from test_catalogue import seed_catalogue

class TransferContracts(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c: seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_sync.environment_state SET cutover=true');self.actor(999)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):
  self.who=n;self.c.execute('RESET ROLE');session(self.c,n,'authenticated' if n==999 else 'sa_app')
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);rows=r.fetchall() if r.description else None;self.actor(self.who);return rows
 def worker(self):
  self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
 def reserve(self,kind='masters',resource='base_product_types',file=None,key=None):
  return self.c.execute('SELECT canto_api.account_transfer_upload(%s,%s,%s,%s)',(kind,resource,Jsonb(file or {'filename':'types.csv','bytes':'19'}),key or uuid.uuid4())).fetchone()[0]
 def verified(self,kind='masters',resource='base_product_types'):
  u=self.reserve(kind,resource);self.worker();self.c.execute('SELECT canto_api.account_transfer_verified(%s,19,%s)',(uuid.UUID(u['id']),'a'*64));self.actor(self.who);return u
 def request(self,u,options=None,key=None):
  kind=self.raw('SELECT kind FROM sa_domain.transfer_uploads WHERE id=%s',(uuid.UUID(u['id']),))[0][0]
  return self.c.execute('SELECT canto_api.v1_import_request(%s,%s,%s)',(kind,Jsonb({'upload_id':u['id'],'options':options or {}}),key or uuid.uuid4())).fetchone()[0]
 def action(self,t,action='apply',key=None,version=None):
  return self.c.execute('SELECT canto_api.v1_import_request(%s,%s,%s)',(t['kind'],Jsonb({'id':t['id'],'action':action,'version':version or t['version']}),key or uuid.uuid4())).fetchone()[0]
 def status(self,id=None,cursor=None,limit=25):
  return self.c.execute('SELECT canto_api.v1_import_status(%s,%s,%s)',(uuid.UUID(id) if id else None,cursor,limit)).fetchone()[0]
 def export(self,request=None,key=None):
  return self.c.execute("SELECT canto_api.v1_export_request('base_product_types',%s,%s)",(Jsonb(request or {}),key or uuid.uuid4())).fetchone()[0]
 def test_upload_path_is_server_owned_private_and_retry_safe(self):
  k=uuid.uuid4();u=self.reserve(key=k);self.assertEqual(u,self.reserve(key=k));self.assertEqual(u['path'],'inputs/'+u['id']+'/file.csv');self.assertEqual(u['bucket'],'squad-transfers');self.assertEqual(self.raw("SELECT public FROM storage.buckets WHERE id='squad-transfers'"),[(False,)])
 def test_filename_traversal_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.reserve(file={'filename':'../bad.csv','bytes':10})
 def test_non_csv_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.reserve(file={'filename':'bad.pdf','bytes':10})
 def test_size_limit_enforced(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.reserve(file={'filename':'big.csv','bytes':'10485761'})
 def test_fractional_size_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.reserve(file={'filename':'bad.csv','bytes':'1.5'})
 def test_unknown_upload_field_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.reserve(file={'filename':'bad.csv','bytes':10,'path':'x'})
 def test_legacy_admin_is_not_printing_tracker_staff(self):
  self.actor(100)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.reserve()
 def test_legacy_admin_can_request_zone_upload(self):
  self.actor(100);u=self.verified('zones',None);t=self.request(u);self.assertEqual(t['kind'],'zones');self.assertEqual(self.status(t['id'])['id'],t['id'])
 def test_customer_cannot_request_zones(self):
  self.actor(103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.reserve('zones',None)
 def test_upload_kind_cannot_be_reinterpreted(self):
  u=self.verified()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.c.execute("SELECT canto_api.v1_import_request('prices',%s,%s)",(Jsonb({'upload_id':u['id']}),uuid.uuid4()))
 def test_unverified_input_rejected(self):
  with self.assertRaises(psycopg.errors.NoDataFound):self.request(self.reserve())
 def test_checksum_conflict_rejected(self):
  u=self.verified();self.worker()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.c.execute('SELECT canto_api.account_transfer_verified(%s,19,%s)',(uuid.UUID(u['id']),'b'*64))
 def test_verification_replay_preserves_used_state(self):
  u=self.verified();self.request(u);self.worker();r=self.c.execute('SELECT canto_api.account_transfer_verified(%s,19,%s)',(uuid.UUID(u['id']),'a'*64)).fetchone()[0];self.assertEqual(r['state'],'used')
 def test_client_cannot_attest_upload(self):
  u=self.reserve()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.account_transfer_verified(%s,19,%s)',(uuid.UUID(u['id']),'a'*64))
 def test_foreign_upload_is_invisible(self):
  u=self.verified('zones',None);self.actor(100)
  with self.assertRaises(psycopg.errors.NoDataFound):self.c.execute('SELECT canto_api.account_transfer_input(%s)',(uuid.UUID(u['id']),))
 def test_source_refresh_invalidates_upload(self):
  u=self.verified();self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1')
  with self.assertRaises(psycopg.errors.NoDataFound):self.c.execute('SELECT canto_api.account_transfer_input(%s)',(uuid.UUID(u['id']),))
 def test_expired_upload_rejected(self):
  u=self.verified();self.raw("UPDATE sa_domain.transfer_uploads SET expires_at=now()-interval '1 second',created_at=now()-interval '4 hours' WHERE id=%s",(uuid.UUID(u['id']),))
  with self.assertRaises(psycopg.errors.NoDataFound):self.request(u)
 def test_validate_is_audited_once_and_replayed(self):
  u=self.verified();k=uuid.uuid4();t=self.request(u,key=k);self.assertEqual(t,self.request(u,key=k));self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.audit WHERE operation='import.validate'"),[(1,)]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(t['job_id']),)),[(1,)])
 def test_only_one_running_import_per_actor(self):
  self.request(self.verified())
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.request(self.verified())
 def test_apply_requires_error_free_completed_validation(self):
  t=self.request(self.verified())
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.action(t)
 def test_apply_requires_current_version(self):
  t=self.request(self.verified());self.raw("UPDATE sa_domain.transfers SET state='validated',valid_rows=1,total_rows=1,revision=1 WHERE id=%s",(uuid.UUID(t['id']),))
  with self.assertRaises(psycopg.errors.SerializationFailure):self.action(t)
 def test_apply_replay_does_not_enqueue_twice(self):
  t=self.request(self.verified());self.raw("UPDATE sa_domain.transfers SET state='validated',valid_rows=1,total_rows=1 WHERE id=%s",(uuid.UUID(t['id']),));k=uuid.uuid4();r=self.action(t,key=k);self.assertEqual(r,self.action(t,key=k));self.assertEqual(r['state'],'applying');self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='transfer.apply'"),[(1,)])
 def test_cancel_revokes_outstanding_lease_and_is_replayable(self):
  t=self.request(self.verified());self.raw("UPDATE sa_domain.outbox SET status='leased',lease_token=gen_random_uuid(),lease_until=now()+interval '1 minute' WHERE id=%s",(uuid.UUID(t['job_id']),));k=uuid.uuid4();r=self.action(t,'cancel',k);self.assertEqual(r,self.action(t,'cancel',k));self.assertEqual(self.raw('SELECT status,lease_token FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(t['job_id']),)),[('dead',None)])
 def test_missing_upload_id_is_bad_request(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.c.execute("SELECT canto_api.v1_import_request('masters','{}',%s)",(uuid.uuid4(),))
 def test_mirror_mode_blocks_bulk_job_even_if_test_writes_enabled(self):
  u=self.verified();self.raw('UPDATE sa_sync.environment_state SET cutover=false');self.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.request(u)
 def test_refresh_active_blocks_export(self):
  self.raw('UPDATE sa_sync.environment_state SET active_job=gen_random_uuid()')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.export()
 def test_export_columns_cannot_include_secrets(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.export({'columns':['encrypted_password']})
 def test_export_duplicate_columns_rejected(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.export({'columns':['name','name']})
 def test_export_request_idempotent(self):
  k=uuid.uuid4();r=self.export({'columns':['id','name']},k);self.assertEqual(r,self.export({'columns':['id','name']},k));self.assertEqual(r['direction'],'export')
 def test_queue_claims_at_most_one_heavy_transfer_per_invocation(self):
  self.export();self.export();self.worker();r=self.c.execute('SELECT canto_api.squad_job_claim(5)').fetchone()[0];self.assertEqual(len([j for j in r['jobs'] if j['handler']=='transfer']),1)
 def test_history_keyset_and_foreign_transfer_privacy(self):
  a=self.export();b=self.export();p=self.status(limit=1);self.assertEqual(p['data'][0]['id'],b['id']);q=self.status(cursor=p['next_cursor'],limit=1);self.assertEqual(q['data'][0]['id'],a['id']);self.actor(100);self.assertEqual(self.status()['data'],[])
 def test_history_cursor_bound_to_principal(self):
  self.export();self.export();p=self.status(limit=1);self.actor(100)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.status(cursor=p['next_cursor'])
 def test_history_omits_raw_and_normalized_csv(self):
  t=self.request(self.verified());self.raw("INSERT INTO sa_domain.transfer_rows(transfer_id,row_number,raw,normalized,errors,state) VALUES(%s,1,'{\"sensitive\":\"input\"}','{\"secret\":\"value\"}','[\"MISSING_NAME\"]','invalid')",(uuid.UUID(t['id']),));r=self.status(t['id']);self.assertEqual(r['rows']['data'][0]['errors'],['MISSING_NAME']);self.assertNotIn('sensitive',json.dumps(r));self.assertNotIn('secret',json.dumps(r))
 def test_revoked_staff_session_cannot_observe_transfer(self):
  self.export();self.raw('DELETE FROM auth.sessions WHERE user_id=%s',(uid(999),))
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.status()
 def staff_context(self):
  j=uuid.uuid4();lease=uuid.uuid4();self.raw("INSERT INTO sa_domain.outbox(id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,status,lease_token,lease_until) VALUES(%s,%s,'transfer.validate','import',1,%s,0,'leased',%s,now()+interval '1 minute')",(j,uid(999),uuid.uuid4(),lease));self.raw('INSERT INTO sa_domain.worker_context VALUES(pg_backend_pid(),txid_current(),%s,%s,0,%s)',(j,uid(999),lease));self.worker();return j
 def worker_platform(self):
  # A transaction-local fixture invokes the private guard without changing the
  # caller's SQL role. Production worker RPCs do this after lease validation.
  self.c.execute('RESET ROLE');self.c.execute("CREATE OR REPLACE FUNCTION pg_temp.test_transfer_context() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS 'SELECT sa_domain.ops_context()'");self.worker();return self.c.execute('SELECT pg_temp.test_transfer_context()').fetchone()[0]
 def test_service_claim_cannot_impersonate_staff(self):
  self.worker();self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'service_role','sub':str(uid(999))}),))
  # Existing request_uid requires actual SQL service_role plus its private transaction lease.
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.worker_platform()
 def test_valid_staff_worker_uses_current_profile_without_login_session(self):
  self.staff_context();self.c.execute('RESET ROLE');self.c.execute('DELETE FROM auth.sessions WHERE user_id=%s',(uid(999),));r=self.worker_platform();self.assertTrue(r['platform']);self.assertFalse(r['admin']);self.assertIsNone(r['legacy_user_id']);self.assertEqual(r['auth_id'],str(uid(999)))
 def test_worker_rechecks_auth_ban(self):
  self.staff_context();self.raw("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=%s",(uid(999),))
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.worker_platform()
 def test_worker_rechecks_profile_removal(self):
  self.staff_context();self.raw('DELETE FROM public.profiles WHERE id=%s',(uid(999),))
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.worker_platform()
 def test_worker_rechecks_expired_lease(self):
  j=self.staff_context();self.raw("UPDATE sa_domain.outbox SET lease_until=now()-interval '1 second' WHERE id=%s",(j,))
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.worker_platform()
 def test_worker_rechecks_context_generation(self):
  self.staff_context();self.raw('UPDATE sa_domain.runtime_state SET generation=1')
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.worker_platform()
 def test_worker_actor_cannot_be_substituted(self):
  self.staff_context();self.raw('UPDATE sa_domain.worker_context SET actor_id=%s',(uid(100),))
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.worker_platform()
 def cleanup(self,ack=None,limit=25):
  self.worker();return self.c.execute('SELECT canto_api.squad_transfer_cleanup(%s,%s)',(ack,limit)).fetchone()[0]['objects']
 def test_cleanup_requires_service_identity(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.squad_transfer_cleanup()')
 def test_cleanup_does_not_touch_live_inputs(self):
  self.verified();self.assertEqual(self.cleanup(),[])
 def test_cleanup_waits_until_last_possible_signed_upload_expires(self):
  u=self.verified();self.raw("UPDATE sa_domain.transfer_uploads SET expires_at=now()-interval '1 second',created_at=now()-interval '2 hours' WHERE id=%s",(uuid.UUID(u['id']),));self.assertEqual(self.cleanup(),[])
 def test_cleanup_allows_inflight_export_upload_to_finish_before_delete(self):
  t=self.export();self.raw("UPDATE sa_domain.transfers SET expires_at=now()-interval '1 second',total_rows=1 WHERE id=%s",(uuid.UUID(t['id']),));self.assertEqual(self.cleanup(),[])
 def test_expired_input_cleanup_ack_and_repeat(self):
  u=self.verified();self.raw("UPDATE sa_domain.transfer_uploads SET expires_at=now()-interval '1 second',created_at=now()-interval '4 hours' WHERE id=%s",(uuid.UUID(u['id']),));q=self.cleanup();self.assertEqual(q[0]['paths'],[u['path']]);self.assertEqual(self.cleanup(),[]);self.assertEqual(self.cleanup([uuid.UUID(q[0]['id'])]),[]);self.assertTrue(self.raw('SELECT cleaned_at IS NOT NULL FROM sa_domain.transfer_uploads WHERE id=%s',(uuid.UUID(u['id']),))[0][0])
 def test_cleanup_reclaims_abandoned_delete_batch(self):
  u=self.verified();self.raw("UPDATE sa_domain.transfer_uploads SET expires_at=now()-interval '1 second',created_at=now()-interval '4 hours' WHERE id=%s",(uuid.UUID(u['id']),));q=self.cleanup();self.raw("UPDATE sa_domain.transfer_cleanup SET claimed_at=now()-interval '3 minutes'");self.assertEqual(self.cleanup(),q)
 def test_cleanup_expiry_fences_queued_job_and_clears_raw_rows(self):
  t=self.request(self.verified());self.raw("UPDATE sa_domain.transfers SET expires_at=now()-interval '1 second' WHERE id=%s",(uuid.UUID(t['id']),));self.raw("INSERT INTO sa_domain.transfer_rows(transfer_id,row_number,raw,normalized,errors) VALUES(%s,1,'{\"name\":\"input\"}','{\"name\":\"normalized\"}','[\"ROW_ERROR\"]')",(uuid.UUID(t['id']),));self.cleanup();self.assertEqual(self.raw('SELECT status,lease_token FROM sa_domain.outbox WHERE id=%s',(uuid.UUID(t['job_id']),)),[('dead',None)]);self.assertEqual(self.raw('SELECT raw,normalized,errors FROM sa_domain.transfer_rows WHERE transfer_id=%s',(uuid.UUID(t['id']),)),[({},None,['ROW_ERROR'])])
 def test_cleanup_covers_export_uploaded_before_checkpoint(self):
  t=self.export();self.raw("UPDATE sa_domain.transfers SET expires_at=now()-interval '6 minutes',total_rows=101 WHERE id=%s",(uuid.UUID(t['id']),));q=self.cleanup();paths={x['paths'][0] for x in q};prefix='g0/'+t['id']+'/';self.assertEqual(paths,{prefix+'part-0000.csv',prefix+'part-0001.csv',prefix+'export.csv'})
 def test_cleanup_batch_has_bounded_paths(self):
  t=self.export();self.raw("UPDATE sa_domain.transfers SET expires_at=now()-interval '6 minutes',total_rows=20000 WHERE id=%s",(uuid.UUID(t['id']),));q=self.cleanup(limit=3);self.assertEqual(len(q),3);self.assertTrue(all(len(x['paths'])==1 for x in q));self.assertLessEqual(self.raw('SELECT count(*) FROM sa_domain.transfer_cleanup')[0][0],100)
 def test_cleanup_rejects_unbounded_request(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.cleanup(limit=26)
 def test_refresh_expires_transfers_and_uploads_without_replay(self):
  from domain_sync import after_publication
  u=self.verified();t=self.request(u);self.c.execute('RESET ROLE');r=after_publication(self.c);self.assertEqual(r['discarded_transfers'],1);self.assertEqual(self.c.execute('SELECT state,error_code FROM sa_domain.transfers WHERE id=%s',(uuid.UUID(t['id']),)).fetchone(),('expired','SOURCE_REFRESH_DISCARDED'));self.assertEqual(self.c.execute('SELECT state FROM sa_domain.transfer_uploads WHERE id=%s',(uuid.UUID(u['id']),)).fetchone(),('expired',));self.assertEqual(self.c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()[0],0)

if __name__=='__main__':unittest.main(verbosity=2)
