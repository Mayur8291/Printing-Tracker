"""Queue leases are service-only; delegated commands recheck live authority."""
import concurrent.futures,json,threading,unittest,uuid
import psycopg
from fixtures import rpc,session,uid
from local_db import connect
import test_order_amendments as amendments

class Jobs(unittest.TestCase):
 setUpClass=classmethod(amendments.Amendments.setUpClass.__func__)
 tearDown=amendments.Amendments.tearDown;actor=amendments.Amendments.actor;raw=amendments.Amendments.raw
 preset=amendments.Amendments.preset;quote=amendments.Amendments.quote;place=amendments.Amendments.place;design=amendments.Amendments.design
 edit=amendments.Amendments.edit;queued=amendments.Amendments.queued;version=amendments.Amendments.version
 def setUp(self):
  amendments.Amendments.setUp(self);self.request=self.queued()
  self.job=self.raw("SELECT id FROM sa_domain.outbox WHERE event_type='order.edited' AND payload->>'request_id'=%s",(self.request['request_id'],))[0][0]
  self.raw('UPDATE sa_sync.environment_state SET cutover=true')
 def worker(self):
  self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'service_role'}),));self.c.execute('SET LOCAL ROLE service_role')
 def claim(self,n=5):self.worker();return self.c.execute('SELECT canto_api.squad_job_claim(%s)',(n,)).fetchone()[0]
 def run_job(self,job=None):
  job=job or self.claim()['jobs'][0];self.worker();return self.c.execute('SELECT canto_api.squad_job_execute(%s,%s)',(uuid.UUID(str(job['id'])),uuid.UUID(str(job['lease_token'])))).fetchone()[0]
 def test_queue_applies_as_original_actor_without_a_session(self):
  self.raw('DELETE FROM auth.sessions WHERE user_id=%s',(uid(101),));r=self.run_job();self.assertEqual(r['state'],'done')
  self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_items WHERE order_id=%s',(self.id,)),[(6,)])
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.worker_context'),[(0,)])
 def test_duplicate_execution_is_idempotent(self):
  j=self.claim()['jobs'][0];self.assertEqual(self.run_job(j)['state'],'done');self.assertTrue(self.run_job(j)['replayed']);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.order_amendments WHERE order_id=%s',(self.id,)),[(1,)])
 def test_attempt_history_retained_across_reclaim(self):
  self.claim();self.raw("UPDATE sa_domain.outbox SET lease_until=now()-interval '1 second' WHERE id=%s",(self.job,));j=self.claim()['jobs'][0];self.run_job(j);self.actor(101)
  rows=rpc(self.c,'v1_job_get',(self.job,))['recent_attempts'];self.assertEqual({r['state'] for r in rows},{'expired','done'});self.assertEqual(len(rows),2)
 def test_abandoned_fifth_lease_reaches_dead_letter(self):
  self.claim();self.raw("UPDATE sa_domain.outbox SET attempts=5,lease_until=now()-interval '1 second' WHERE id=%s",(self.job,));self.assertEqual(self.claim()['jobs'],[]);self.actor(101)
  value=rpc(self.c,'v1_job_get',(self.job,));self.assertEqual(value['state'],'dead');self.assertEqual(value['error_code'],'LEASE_EXHAUSTED')
 def test_terminal_permission_failure_releases_pending_order_request(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=101');self.run_job();self.assertEqual(self.raw('SELECT state FROM sa_domain.order_requests WHERE id=%s',(uuid.UUID(self.request['request_id']),)),[('failed',)])
 def test_current_disabled_actor_blocks_queued_change(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=101');r=self.run_job();self.assertEqual(r['state'],'dead');self.assertEqual(r['error_code'],'28000')
  self.assertEqual(self.raw('SELECT id FROM sa_snapshot_20261019.sa_items WHERE order_id=%s',(self.id,)),[(self.item,)]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.worker_context'),[(0,)])
 def test_auth_ban_blocks_queued_change(self):
  self.raw("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=%s",(uid(101),));self.assertEqual(self.run_job()['state'],'dead')
 def test_changed_role_blocks_queued_change(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET role=2 WHERE id=101');self.assertEqual(self.run_job()['state'],'dead')
 def test_changed_scope_blocks_queued_change(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_orders SET customer_sc_id=201 WHERE id=%s',(self.id,));self.assertEqual(self.run_job()['state'],'dead')
 def test_other_lease_token_rejected(self):
  j=self.claim()['jobs'][0];j['lease_token']=str(uuid.uuid4())
  with self.assertRaises(psycopg.errors.SerializationFailure):self.run_job(j)
 def test_expired_lease_rejected(self):
  j=self.claim()['jobs'][0];self.raw("UPDATE sa_domain.outbox SET lease_until=now()-interval '1 second' WHERE id=%s",(self.job,))
  with self.assertRaises(psycopg.errors.SerializationFailure):self.run_job(j)
 def test_expired_lease_reclaimed_with_new_token(self):
  a=self.claim()['jobs'][0];self.raw("UPDATE sa_domain.outbox SET lease_until=now()-interval '1 second' WHERE id=%s",(self.job,));b=self.claim()['jobs'][0]
  self.assertNotEqual(a['lease_token'],b['lease_token']);self.assertEqual(b['attempt'],2);self.assertEqual(self.run_job(b)['state'],'done')
 def test_active_lease_not_claimed_twice(self):self.assertEqual(len(self.claim()['jobs']),1);self.assertEqual(self.claim()['jobs'],[])
 def test_mirror_claim_is_paused_even_with_test_writes(self):
  self.raw('UPDATE sa_sync.environment_state SET cutover=false');self.assertEqual(self.claim(),{'jobs':[],'paused':True})
 def test_mirror_execution_blocked(self):
  j=self.claim()['jobs'][0];self.raw('UPDATE sa_sync.environment_state SET cutover=false')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.run_job(j)
 def test_generation_replaced_before_claim(self):
  self.raw('UPDATE sa_domain.runtime_state SET generation=1');self.assertEqual(self.claim()['jobs'],[])
 def test_generation_replaced_after_claim(self):
  j=self.claim()['jobs'][0];self.raw('UPDATE sa_domain.runtime_state SET generation=1')
  with self.assertRaises(psycopg.errors.SerializationFailure):self.run_job(j)
 def test_provider_job_not_claimed_by_local_handler(self):
  self.raw("UPDATE sa_domain.outbox SET payload=jsonb_set(payload,'{provider_confirmation_required}','true') WHERE id=%s",(self.job,));self.assertEqual(self.claim()['jobs'],[])
 def test_client_cannot_claim_jobs(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.squad_job_claim()')
 def test_forged_service_claim_under_app_role_cannot_get_execution_context(self):
  self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'service_role','sub':str(uid(101))}),))
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT sa_domain.squad_job_claim(1)')
 def test_service_without_worker_context_cannot_impersonate_user(self):
  self.worker();self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'service_role','sub':str(uid(101))}),));self.c.execute('SET LOCAL ROLE sa_executor')
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.c.execute('SELECT sa_domain.actor()')
 def test_client_cannot_write_worker_context(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT * FROM sa_domain.worker_context')
 def test_claim_has_bounded_batch(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.claim(11)
 def test_owner_can_observe_redacted_job(self):
  value=rpc(self.c,'v1_job_get',(self.job,));self.assertEqual(value['state'],'pending');self.assertNotIn('lease_token',value);self.assertNotIn('payload',value);self.assertNotIn('result',value)
 def test_foreign_actor_cannot_observe_job(self):
  self.actor(201)
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_job_get',(self.job,))
 def test_admin_can_observe_domain_job(self):self.actor(100);self.assertEqual(rpc(self.c,'v1_job_get',(self.job,))['id'],str(self.job))
 def test_platform_cannot_read_business_job(self):
  self.c.execute('RESET ROLE');session(self.c,999,'authenticated')
  with self.assertRaises(psycopg.errors.NoDataFound):rpc(self.c,'v1_job_get',(self.job,))
 def test_platform_can_read_operational_job(self):
  self.raw("UPDATE sa_domain.outbox SET aggregate_kind='integration' WHERE id=%s",(self.job,));self.c.execute('RESET ROLE');session(self.c,999,'authenticated');self.assertEqual(rpc(self.c,'v1_job_get',(self.job,))['id'],str(self.job))
 def test_list_cursor_and_privacy(self):
  self.actor(100);page=rpc(self.c,'v1_jobs_list',(None,None,1));other=rpc(self.c,'v1_jobs_list',(None,page['next_cursor'],100));self.assertNotIn(page['data'][0]['id'],[x['id'] for x in other['data']])
  self.actor(201)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_jobs_list',(None,page['next_cursor'],1))
 def test_nonadmin_cannot_audit(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_audit_list')
 def test_admin_audit_is_redacted(self):
  self.actor(100);rows=rpc(self.c,'v1_audit_list')['data'];self.assertTrue(rows);self.assertNotIn('changes',rows[0])
 def retry_ready(self):
  self.raw("UPDATE sa_domain.outbox SET status='dead',last_error_code='LEASE_EXHAUSTED' WHERE id=%s",(self.job,));self.actor(100);return rpc(self.c,'v1_job_get',(self.job,))
 def retry(self,value,key=None,reason='Retry after incident'):
  return rpc(self.c,'v1_job_retry',(self.job,reason,value['version'],key or uuid.uuid4()))
 def test_retry_is_versioned_audited_and_idempotent(self):
  value=self.retry_ready();key=uuid.uuid4();r=self.retry(value,key);self.assertEqual(r['state'],'pending');self.assertEqual(r,self.retry(value,key));self.assertNotEqual(r['version'],value['version']);self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.audit WHERE operation='job.retried'"),[(1,)])
 def test_retry_payload_mismatch_rejected(self):
  v=self.retry_ready();k=uuid.uuid4();self.retry(v,k)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.retry(v,k,'Different reason')
 def test_retry_ineligible_failure_denied(self):
  v=self.retry_ready();self.raw("UPDATE sa_domain.outbox SET last_error_code='28000' WHERE id=%s",(self.job,))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.retry(v)
 def test_retry_old_generation_denied(self):
  v=self.retry_ready();self.raw('UPDATE sa_domain.runtime_state SET generation=1')
  with self.assertRaises(psycopg.errors.SerializationFailure):self.retry(v)
 def test_worker_has_no_raw_business_or_auth_grants(self):
  self.c.execute('RESET ROLE')
  for table in ['sa_snapshot_20261019.sa_orders','auth.users','sa_snapshot_20261019.sa_users']:
   self.assertFalse(self.c.execute('SELECT has_table_privilege(%s,%s,%s)',('sa_worker',table,'UPDATE')).fetchone()[0])
if __name__=='__main__':unittest.main(verbosity=2)

class QueueConcurrency(unittest.TestCase):
 def test_two_workers_claim_only_one_lease(self):
  from fixtures import seed
  job=uuid.uuid4();barrier=threading.Barrier(2)
  with connect() as c:
   seed(c);before=c.execute('SELECT cutover FROM sa_sync.environment_state').fetchone()[0]
   c.execute('UPDATE sa_sync.environment_state SET cutover=true')
   c.execute("""INSERT INTO sa_domain.outbox(id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload)
    SELECT %s,%s,'order.edited','order',1001,%s,generation,jsonb_build_object('request_id',%s::text,'provider_confirmation_required',false) FROM sa_domain.runtime_state""",(job,uid(101),uuid.uuid4(),str(uuid.uuid4())))
  def claim():
   with connect() as c:
    with c.transaction():
     c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");c.execute('SET LOCAL ROLE service_role');barrier.wait(timeout=10)
     return c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0]['jobs']
  try:
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:result=list(pool.map(lambda _:claim(),range(2)))
   self.assertEqual(sum(len(x) for x in result),1)
   with connect() as c:self.assertEqual(c.execute('SELECT attempts,status FROM sa_domain.outbox WHERE id=%s',(job,)).fetchone(),(1,'leased'))
  finally:
   with connect() as c:
    c.execute('DELETE FROM sa_domain.job_attempts WHERE job_id=%s',(job,));c.execute('DELETE FROM sa_domain.outbox WHERE id=%s',(job,));c.execute('UPDATE sa_sync.environment_state SET cutover=%s',(before,))

class WorkerFence(unittest.TestCase):
 def test_refresh_exclusive_fence_blocks_claim(self):
  with connect() as owner,connect() as worker:
   previous=owner.execute('SELECT cutover FROM sa_sync.environment_state').fetchone()[0]
   owner.execute('UPDATE sa_sync.environment_state SET cutover=true')
   try:
    owner.execute('SELECT pg_advisory_lock(20261107,1)')
    with worker.transaction():
     worker.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");worker.execute('SET LOCAL ROLE service_role')
     with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):worker.execute('SELECT canto_api.squad_job_claim(1)')
   finally:
    owner.execute('SELECT pg_advisory_unlock(20261107,1)');owner.execute('UPDATE sa_sync.environment_state SET cutover=%s',(previous,))
