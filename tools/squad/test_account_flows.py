"""Email proof, enumeration resistance and provider credential fencing."""
from sqlstate_assertions import assert_app_conflict
import unittest,uuid,json
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed_orders,uid,session
class AccountFlows(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_orders(c)
 def setUp(self):
  self.flow_purposes={};self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_sync.environment_state SET cutover=true');self.service()
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def service(self):
  self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SET LOCAL ROLE service_role')
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);result=r.fetchall() if r.description else None;self.constraints();self.service();return result
 def constraints(self):
  self.c.execute('SET CONSTRAINTS auth.squad_account_credential_fence IMMEDIATE');self.c.execute('SET CONSTRAINTS auth.squad_account_credential_fence DEFERRED')
 def request(self,purpose='recovery',email='persona-103@squad.invalid',payload=None,id=None,grant=None,available=True):
  result=self.c.execute('SELECT canto_api.squad_account_flow_request(%s,%s,%s,%s,%s,%s,%s,%s,%s)',(id or uuid.uuid4(),purpose,email,Jsonb(payload or {}),'a'*64,'b'*64,'c'*49,available,grant)).fetchone()[0];self.flow_purposes[result['request_id']]=purpose;return result
 def profile(self):return{'first_name':'First','last_name':'Last','company_name':'Business','phone':'1234567890','addresses':[{'address':'Street','state':'State','city':'City','zip_code':'123456'}]}
 def test_request_does_not_send_or_disclose_code(self):
  r=self.request();self.assertEqual(set(r),{'request_id','accepted','expires_in'});self.assertEqual(self.raw("SELECT event_type,payload FROM sa_domain.outbox"),[('account.challenge_mail',{'flow_id':r['request_id']})]);self.assertNotIn('b'*64,json.dumps(r))
 def test_unknown_and_disabled_requests_have_identical_public_shape(self):
  known=self.request();unknown=self.request(email='absent@example.invalid');self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=203');blocked=self.request(email='persona-203@squad.invalid')
  self.assertEqual({k:v for k,v in known.items() if k!='request_id'},{k:v for k,v in unknown.items() if k!='request_id'});self.assertEqual(set(blocked),set(known));self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.outbox'),[(1,)])
 def test_idempotent_request_does_not_reissue_code_or_mail(self):
  id=uuid.uuid4();self.assertEqual(self.request(id=id),self.request(id=id));self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.account_flows'),[(1,)]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.outbox'),[(1,)])
 def test_request_key_cannot_change_recipient(self):
  id=uuid.uuid4();self.request(id=id)
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.request(id=id,email='persona-203@squad.invalid')
 def test_email_cooldown_is_private_and_does_not_invalidate_first_code(self):
  self.request();self.request();self.assertEqual(self.raw('SELECT state FROM sa_domain.account_flows ORDER BY sequence_id'),[('pending',),('dummy',)]);self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.outbox'),[(1,)])
 def test_registration_creates_no_person_before_proof(self):
  self.request('register','new@example.invalid',self.profile());self.assertEqual(self.raw("SELECT count(*) FROM sa_snapshot_20261019.sa_users WHERE email='new@example.invalid'"),[(0,)]);self.assertEqual(self.raw('SELECT count(*) FROM sa_identity.sa_auth_identities WHERE canonical_email=%s',('new@example.invalid',)),[(0,)])
 def test_registration_cannot_choose_privileges_or_price(self):
  for field in ['role','approved','features','price_type_id']:
   with self.subTest(field=field),self.c.transaction():
    try:self.request('register','new@example.invalid',dict(self.profile(),**{field:True}))
    except psycopg.errors.InvalidParameterValue:raise psycopg.Rollback()
    else:self.fail('Privileged field accepted')
 def test_staff_email_collision_never_creates_a_registration_mail(self):
  self.request('register','existing-staff@example.invalid',self.profile(),available=False);self.assertEqual(self.raw('SELECT state FROM sa_domain.account_flows'),[('dummy',)])
 def test_mirror_mode_rejects_guest_writes(self):
  self.raw('UPDATE sa_sync.environment_state SET cutover=false')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.request()
 def test_public_caller_cannot_forge_a_known_proof_hash(self):
  self.c.execute('RESET ROLE');session(self.c,100)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.request()
 def test_invitation_requires_live_authorization(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.request('invite',grant=uuid.uuid4())
 def test_valid_invitation_grant_derives_recipient_and_cannot_be_reused(self):
  self.c.execute('RESET ROLE');session(self.c,100);g=self.c.execute('SELECT canto_api.account_invitation_authorize(103)').fetchone()[0];self.service();self.request('invite',grant=uuid.UUID(g['grant']))
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.request('invite',grant=uuid.UUID(g['grant']))
 def test_native_password_change_invalidates_issued_proof_revision(self):
  self.request();self.raw("UPDATE auth.users SET encrypted_password='synthetic-new-value' WHERE id=%s",(uid(103),));self.assertEqual(self.raw('SELECT revision,last_completed_flow FROM sa_domain.credential_states WHERE legacy_user_id=103'),[(1,None)])
 def test_late_or_forged_provider_marker_cannot_change_password(self):
  self.c.execute('RESET ROLE')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.raw("UPDATE auth.users SET encrypted_password='synthetic',raw_app_meta_data=jsonb_build_object('squad_account_flow',%s::text) WHERE id=%s",(str(uuid.uuid4()),uid(103)))
 def prepare(self,id,email='persona-103@squad.invalid',code='b'*64,password='d'*64):
  return self.c.execute('SELECT canto_api.squad_account_flow_prepare(%s,%s,%s,%s,%s,true)',(uuid.UUID(id),self.flow_purposes.get(id,'recovery'),email,code,password)).fetchone()[0]
 def finish(self,t,error=None):return self.c.execute('SELECT canto_api.squad_account_flow_finish(%s,%s,%s)',(uuid.UUID(t['flow_id']),uuid.UUID(t['lease_token']),error)).fetchone()[0]
 def provider(self,t,create=False):
  metadata=Jsonb({'application':'canto','legacy_user_id':t['legacy_user_id'],'legacy_role_id':t['legacy_role_id'],'squad_account_flow':t['flow_id']})
  if create:
   self.c.execute('RESET ROLE')
   self.c.execute("INSERT INTO auth.users(id,role,email,encrypted_password,raw_app_meta_data) VALUES(%s,'',%s,%s,'{}')",(uuid.UUID(t['auth_user_id']),t['email'],'synthetic-'+uuid.uuid4().hex))
   self.c.execute("UPDATE auth.users SET role='sa_app' WHERE id=%s",(uuid.UUID(t['auth_user_id']),))
   self.c.execute('UPDATE auth.users SET raw_app_meta_data=%s WHERE id=%s',(metadata,uuid.UUID(t['auth_user_id'])))
   self.c.execute('UPDATE auth.users SET banned_until=%s WHERE id=%s',(None if t['allowed'] else '2126-01-01',uuid.UUID(t['auth_user_id'])))
   self.constraints();self.service()
  else:
   self.c.execute('RESET ROLE')
   self.c.execute('UPDATE auth.users SET encrypted_password=%s WHERE id=%s',('synthetic-'+uuid.uuid4().hex,uuid.UUID(t['auth_user_id'])))
   self.c.execute('UPDATE auth.users SET raw_app_meta_data=%s WHERE id=%s',(metadata,uuid.UUID(t['auth_user_id'])))
   self.constraints();self.service()
 def test_wrong_proof_attempts_commit_and_stop_after_five(self):
  id=self.request()['request_id']
  for i in range(5):self.assertEqual(self.prepare(id,code='e'*64)['error'],'INVALID_OR_EXPIRED_CODE')
  self.assertEqual(self.raw('SELECT attempts,state FROM sa_domain.account_flows'),[(5,'failed')]);self.assertEqual(self.prepare(id)['error'],'INVALID_OR_EXPIRED_CODE')
 def test_wrong_recipient_cannot_use_valid_code(self):
  id=self.request()['request_id'];self.assertEqual(self.prepare(id,email='persona-203@squad.invalid')['error'],'INVALID_OR_EXPIRED_CODE')
 def test_verified_registration_reserves_identity_and_blocks_unapproved_login(self):
  id=self.request('register','new@example.invalid',self.profile())['request_id'];t=self.prepare(id,email='new@example.invalid');self.assertFalse(t['allowed']);self.provider(t,True);r=self.finish(t);self.assertEqual(r['next'],'await_approval');self.assertTrue(r['completed']);self.assertEqual(self.raw('SELECT role,customer_registered_by,approved,onboarded FROM sa_snapshot_20261019.sa_users WHERE id=%s',(int(t['legacy_user_id']),)),[(3,0,False,False)])
 def test_successful_recovery_requires_real_provider_credential_commit(self):
  id=self.request()['request_id'];t=self.prepare(id);self.assertEqual(self.finish(t)['error'],'PROVIDER_UNAVAILABLE');t=self.prepare(id);self.provider(t);r=self.finish(t);self.assertEqual(r['next'],'sign_in');self.assertEqual(self.prepare(id),{'replayed':True,'result':r})
 def test_lost_provider_response_is_reconciled_without_another_password_write(self):
  id=self.request()['request_id'];t=self.prepare(id);self.provider(t);self.raw("UPDATE sa_domain.account_flows SET lease_until=now()-interval '1 second' WHERE id=%s",(uuid.UUID(id),));retry=self.prepare(id);self.assertTrue(retry['provider_committed']);self.assertTrue(self.finish(retry)['completed']);self.assertEqual(self.raw('SELECT revision FROM sa_domain.credential_states WHERE legacy_user_id=103'),[(1,)])
 def test_changed_password_cannot_reuse_consumed_command(self):
  id=self.request()['request_id'];t=self.prepare(id);self.provider(t);self.finish(t);self.assertEqual(self.prepare(id,password='e'*64)['error'],'ACCOUNT_REQUEST_CONFLICT')
 def test_native_password_change_invalidates_older_request(self):
  id=self.request()['request_id'];self.raw("UPDATE auth.users SET encrypted_password='newer-native-password' WHERE id=%s",(uid(103),));self.assertEqual(self.prepare(id)['error'],'INVALID_OR_EXPIRED_CODE')
 def test_provider_failure_releases_lease_for_same_payload_retry(self):
  id=self.request()['request_id'];t=self.prepare(id);self.assertEqual(self.finish(t,'PROVIDER_UNAVAILABLE')['error'],'PROVIDER_UNAVAILABLE');self.assertNotEqual(self.prepare(id)['lease_token'],t['lease_token'])
 def test_duplicate_inflight_completion_never_issues_second_provider_call(self):
  id=self.request()['request_id'];self.prepare(id);self.assertEqual(self.prepare(id)['error'],'ACCOUNT_REQUEST_BUSY')
 def test_older_delayed_password_write_is_rejected_after_new_flow_takes_lease(self):
  old_id=self.request()['request_id'];old=self.prepare(old_id)
  self.raw("UPDATE sa_domain.account_flows SET created_at=now()-interval '2 minutes',lease_until=now()-interval '1 second' WHERE id=%s",(uuid.UUID(old_id),));self.raw("UPDATE sa_domain.credential_states SET lease_until=now()-interval '1 second' WHERE legacy_user_id=103")
  new_id=self.request()['request_id'];new=self.prepare(new_id)
  with self.c.transaction():
   try:self.provider(old)
   except psycopg.errors.ObjectNotInPrerequisiteState:raise psycopg.Rollback()
   else:self.fail('Delayed password overwrote newer flow')
  self.service();self.provider(new);self.finish(new);self.assertEqual(self.prepare(old_id)['error'],'INVALID_OR_EXPIRED_CODE')
 def test_signup_email_race_fails_before_creating_source_person(self):
  id=self.request('register','new@example.invalid',self.profile())['request_id']
  self.raw("UPDATE sa_snapshot_20261019.sa_users SET email='new@example.invalid' WHERE id=203")
  self.assertEqual(self.prepare(id,email='new@example.invalid')['error'],'ACCOUNT_UNAVAILABLE');self.assertEqual(self.raw("SELECT count(*) FROM sa_snapshot_20261019.sa_users WHERE email='new@example.invalid'"),[(1,)])
 def test_refresh_generation_expires_code_without_source_mutation(self):
  id=self.request()['request_id'];self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1');self.assertEqual(self.prepare(id)['error'],'INVALID_OR_EXPIRED_CODE')

 def test_client_request_id_cannot_impersonate_a_job_actor(self):
  self.request(id=uid(203));self.assertNotEqual(self.raw('SELECT actor_id FROM sa_domain.outbox')[0][0],uid(203))
 def test_wrong_route_cannot_create_a_registration(self):
  id=self.request('register','new@example.invalid',self.profile())['request_id'];r=self.c.execute('SELECT canto_api.squad_account_flow_prepare(%s,%s,%s,%s,%s,true)',(uuid.UUID(id),'recovery','new@example.invalid','b'*64,'d'*64)).fetchone()[0];self.assertEqual(r['error'],'INVALID_OR_EXPIRED_CODE');self.assertEqual(self.raw("SELECT count(*) FROM sa_snapshot_20261019.sa_users WHERE email='new@example.invalid'"),[(0,)])
 def claim_mail(self):
  jobs=self.c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0]['jobs'];self.assertEqual(jobs[0]['handler'],'account_mail');return jobs[0]
 def prepare_mail(self,j):return self.c.execute('SELECT canto_api.squad_account_mail_prepare(%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']))).fetchone()[0]
 def finish_mail(self,j,sent,error=None):return self.c.execute('SELECT canto_api.squad_account_mail_finish(%s,%s,%s,%s)',(uuid.UUID(j['id']),uuid.UUID(j['lease_token']),sent,error)).fetchone()[0]
 def test_mail_cipher_only_available_under_a_current_service_lease(self):
  self.request();j=self.claim_mail();self.assertEqual(self.prepare_mail(j)['ciphertext'],'c'*49);self.assertEqual(self.finish_mail(j,True)['state'],'done');self.assertEqual(self.raw('SELECT mail_state,code_cipher FROM sa_domain.account_flows'),[('sent',None)]);self.assertTrue(self.finish_mail(j,True)['replayed'])
 def test_mail_provider_failure_keeps_cipher_for_bounded_retry(self):
  self.request();j=self.claim_mail();self.assertEqual(self.finish_mail(j,False,'PROVIDER_UNAVAILABLE')['state'],'pending');self.assertEqual(self.raw('SELECT mail_state,code_cipher FROM sa_domain.account_flows'),[('queued','c'*49)])
 def test_expired_mail_intent_skips_delivery(self):
  self.request();j=self.claim_mail();self.raw("UPDATE sa_domain.account_flows SET expires_at=now()-interval '1 second'");self.assertTrue(self.prepare_mail(j)['skip']);self.finish_mail(j,False);self.assertEqual(self.raw('SELECT mail_state FROM sa_domain.account_flows'),[('skipped',)])
 def test_disabled_account_is_checked_again_before_email_delivery(self):
  self.request();j=self.claim_mail();self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=103');self.assertTrue(self.prepare_mail(j)['skip'])
 def test_abandoned_mail_lease_reaches_visible_failure(self):
  self.request();j=self.claim_mail();self.raw("UPDATE sa_domain.outbox SET attempts=5,lease_until=now()-interval '1 second' WHERE id=%s",(uuid.UUID(j['id']),));self.c.execute('SELECT canto_api.squad_job_claim(1)');self.assertEqual(self.raw('SELECT mail_state,code_cipher FROM sa_domain.account_flows'),[('failed',None)])
 def test_mail_lease_cannot_be_used_for_another_job(self):
  self.request();j=self.claim_mail();j['id']=str(uuid.uuid4())
  with assert_app_conflict(self):self.prepare_mail(j)

 def test_native_change_after_recovery_rejects_delayed_same_marker(self):
  id=self.request()['request_id'];t=self.prepare(id);self.provider(t);self.finish(t)
  self.raw("UPDATE auth.users SET encrypted_password='native-chosen-newer-password' WHERE id=%s",(uid(103),))
  with self.c.transaction():
   try:self.provider(t)
   except psycopg.errors.ObjectNotInPrerequisiteState:raise psycopg.Rollback()
   else:self.fail('Same stale marker overwrote native password')
  self.assertEqual(self.raw('SELECT encrypted_password FROM auth.users WHERE id=%s',(uid(103),)),[('native-chosen-newer-password',)])
 def test_provider_metadata_alone_cannot_attest_a_password_change(self):
  id=self.request()['request_id'];t=self.prepare(id)
  self.raw("UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||jsonb_build_object('squad_account_flow',%s::text) WHERE id=%s",(id,uid(103)))
  self.assertEqual(self.finish(t)['error'],'PROVIDER_UNAVAILABLE')
 def test_deferred_provider_guard_rejects_expired_lease(self):
  id=self.request()['request_id'];t=self.prepare(id)
  self.raw("UPDATE sa_domain.account_flows SET lease_until=NULL WHERE id=%s",(uuid.UUID(id),))
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.provider(t)
 def test_deferred_password_guard_releases_transaction_evidence(self):
  id=self.request()['request_id'];t=self.prepare(id);self.provider(t)
  self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.credential_transactions'),[(0,)])
 def test_cleanup_in_mirror_expires_secrets_and_profile_without_publication(self):
  id=self.request('register','new@example.invalid',self.profile())['request_id']
  self.raw("UPDATE sa_domain.account_flows SET expires_at=now()-interval '1 minute',created_at=now()-interval '25 hours',password_fingerprint=repeat('a',64)")
  self.raw('UPDATE sa_sync.environment_state SET cutover=false')
  r=self.c.execute('SELECT canto_api.squad_account_flow_cleanup()').fetchone()[0];self.assertEqual(r['expired_flows'],1)
  self.assertEqual(self.raw('SELECT state,email,payload,code_cipher,password_fingerprint FROM sa_domain.account_flows'),[('expired','',{},None,None)])
 def test_cleanup_keeps_live_codes(self):
  self.request();self.assertEqual(self.c.execute('SELECT canto_api.squad_account_flow_cleanup()').fetchone()[0]['expired_flows'],0)
 def test_invitation_grants_have_a_bounded_actor_quota(self):
  self.c.execute('RESET ROLE');session(self.c,100)
  for i in range(20):self.c.execute('SELECT canto_api.account_invitation_authorize(103)')
  with self.assertRaises(psycopg.errors.ProgramLimitExceeded):self.c.execute('SELECT canto_api.account_invitation_authorize(103)')
 def test_cleanup_removes_expired_invitation_grants(self):
  self.c.execute('RESET ROLE');session(self.c,100);self.c.execute('SELECT canto_api.account_invitation_authorize(103)');self.service()
  self.raw("UPDATE sa_domain.invitation_grants SET expires_at=now()-interval '1 second'")
  self.assertEqual(self.c.execute('SELECT canto_api.squad_account_flow_cleanup()').fetchone()[0]['expired_grants'],1)
 def test_source_publication_expires_flows_and_invalidates_credential_revision(self):
  import sys
  from pathlib import Path
  sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'canto-sync'))
  from domain_sync import after_publication
  id=self.request()['request_id'];self.prepare(id);self.c.execute('RESET ROLE');r=after_publication(self.c)
  self.assertEqual(r['discarded_account_flows'],1);self.service()
  self.assertEqual(self.prepare(id)['error'],'INVALID_OR_EXPIRED_CODE')
  self.assertEqual(self.raw('SELECT revision,active_flow,last_completed_flow FROM sa_domain.credential_states WHERE legacy_user_id=103'),[(1,None,None)])
 def test_person_email_proof_is_separate_from_approval(self):
  self.c.execute('RESET ROLE');session(self.c,100);r=self.c.execute('SELECT canto_api.v1_person_get(103)').fetchone()[0]
  self.assertIn('email_confirmed',r);self.assertIn('invitation_required',r)

 def routing(self,auto=True,disabled=False):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_zones(id,name,created_at,updated_at) VALUES(1,'South',now(),now()) ON CONFLICT DO NOTHING")
  self.raw("INSERT INTO sa_snapshot_20261019.sa_rmp_price_types(id,name,price_for,zone_id,created_at,updated_at) VALUES(2,'South',1,1,now(),now()) ON CONFLICT DO NOTHING")
  self.raw("INSERT INTO sa_snapshot_20261019.sa_cities(name,zone_id,created_at,updated_at) VALUES('City',1,now(),now())")
  self.raw("INSERT INTO sa_snapshot_20261019.sa_addresses(user_id,address,city,created_at,updated_at) VALUES(110,'Dealer road','City',now(),now()),(210,'Dealer 2','City',now(),now())")
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET auto_approve_customers=%s,disabled=%s WHERE id=110',(auto,disabled))
 def test_autoapproval_links_all_eligible_zone_dealers_when_one_allows(self):
  self.routing();id=self.request('register','new@example.invalid',self.profile())['request_id'];t=self.prepare(id,email='new@example.invalid');self.assertTrue(t['allowed'])
  self.assertEqual(self.raw('SELECT dealer_id FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=%s ORDER BY dealer_id',(int(t['legacy_user_id']),)),[(110,),(210,)])
  self.assertEqual(self.raw('SELECT approved,onboarded,zone_id,rmp_price_type_id,dealers_count FROM sa_snapshot_20261019.sa_users WHERE id=%s',(int(t['legacy_user_id']),)),[(True,True,1,2,2)])
 def test_no_autoapproval_keeps_customer_pending_without_dealer_links(self):
  self.routing(False);id=self.request('register','new@example.invalid',self.profile())['request_id'];t=self.prepare(id,email='new@example.invalid');self.assertFalse(t['allowed'])
  self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=%s',(int(t['legacy_user_id']),)),[(0,)])
 def test_disabled_dealer_cannot_autoapprove_a_customer(self):
  self.routing(True,True);id=self.request('register','new@example.invalid',self.profile())['request_id'];t=self.prepare(id,email='new@example.invalid');self.assertFalse(t['allowed'])

 def test_confirmation_creates_auth_identity_but_cannot_approve_customer(self):
  id_=7000000;email='unactivated@example.invalid';auth=uuid.uuid4()
  self.raw("INSERT INTO sa_snapshot_20261019.sa_users(id,email,name,role,approved,onboarded,created_at,updated_at) VALUES(%s,%s,'Pending',3,false,false,now(),now())",(id_,email))
  self.raw('INSERT INTO sa_sync.legacy_identity_keys VALUES(%s)',(id_,))
  self.raw("INSERT INTO sa_identity.sa_auth_identities(auth_user_id,legacy_user_id,canonical_email,import_disposition,enrollment_state,source_was_confirmed,confirmation_basis) VALUES(%s,%s,%s,'candidate','blocked',false,'not_activated')",(auth,id_,email))
  id=self.request('confirm',email)['request_id'];t=self.prepare(id,email);self.assertFalse(t['allowed']);self.provider(t,True)
  self.assertEqual(self.finish(t)['next'],'await_approval');self.assertEqual(self.raw('SELECT confirmed_at IS NOT NULL,approved FROM sa_snapshot_20261019.sa_users WHERE id=%s',(id_,)),[(True,False)])
 def test_invitation_completion_uses_same_proof_and_credential_guards(self):
  self.c.execute('RESET ROLE');session(self.c,100);g=self.c.execute('SELECT canto_api.account_invitation_authorize(103)').fetchone()[0];self.service()
  id=self.request('invite',grant=uuid.UUID(g['grant']))['request_id'];t=self.prepare(id);self.provider(t);self.assertTrue(self.finish(t)['completed'])
 def test_unapproved_customer_cannot_use_recovery_to_get_login(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_users SET approved=false WHERE id=103');id=self.request()['request_id']
  self.assertEqual(self.prepare(id)['error'],'INVALID_OR_EXPIRED_CODE');self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.outbox'),[(0,)])
 def test_disabling_account_after_request_prevents_proof_completion(self):
  id=self.request()['request_id'];self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=103')
  self.assertEqual(self.prepare(id)['error'],'ACCOUNT_UNAVAILABLE')

if __name__=='__main__':unittest.main(verbosity=2)
