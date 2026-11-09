"""WEB-GAP-01 isolated SQL security/atomicity tests; no hosted Auth calls."""
import json
import time
import unittest
import uuid

import psycopg
from psycopg.types.json import Jsonb
from fixtures import claims, seed_orders, sid, uid
from local_db import connect
from sqlstate_assertions import is_app_conflict


class SelfClosure(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as connection:
            seed_orders(connection)

    def setUp(self):
        self.c = connect()
        self.c.execute('BEGIN')
        self.c.execute('UPDATE sa_sync.environment_state SET cutover=true')
        # seed_orders reuses the suite-wide session, which can legitimately be
        # older than the five-minute password proof window. Model a new password
        # login per test; retain that older session to test complete revocation.
        self.password_session = uuid.uuid4()
        self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',
                       (self.password_session, uid(103)))
        self.actor = 103
        self.authenticate(103)

    def tearDown(self):
        self.c.execute('ROLLBACK')
        self.c.close()

    def authenticate(self, actor=103, amr=None, session_id=None, role='sa_app'):
        self.actor = actor
        self.c.execute('RESET ROLE')
        proof = claims(actor, role)
        if actor == 103:
            proof['session_id'] = str(self.password_session)
        proof['amr'] = [{'method': 'password', 'timestamp': int(time.time())}] if amr is None else amr
        if session_id is not None:
            proof['session_id'] = str(session_id)
        self.claims = proof
        self.c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps(proof),))
        self.c.execute(psycopg.sql.SQL('SET LOCAL ROLE {}').format(psycopg.sql.Identifier(role)))

    def raw(self, query, args=()):
        self.c.execute('RESET ROLE')
        cursor = self.c.execute(query, args)
        result = cursor.fetchall() if cursor.description else None
        self.c.execute('SET LOCAL ROLE sa_app')
        return result

    def close(self, version='0:0', key=None, confirmation='DELETE MY ACCOUNT'):
        return self.c.execute('SELECT canto_api.v1_account_close(%s,%s,%s)',
                              (version, key or uuid.uuid4(), confirmation)).fetchone()[0]

    def rejects(self, exception, operation):
        with self.c.transaction():
            try:
                operation()
            except exception:
                raise psycopg.Rollback()
            self.fail('Operation unexpectedly succeeded')

    def test_customer_closure_preserves_orders_addresses_identity_and_credentials(self):
        before = self.raw("SELECT row_to_json(t) FROM sa_snapshot_20261019.sa_orders t WHERE customer_id=103 ORDER BY id")
        identity = self.raw('SELECT auth_user_id,canonical_email FROM sa_identity.sa_auth_identities WHERE legacy_user_id=103')
        self.raw('INSERT INTO auth.refresh_tokens(user_id,session_id) VALUES(%s,%s)', (str(uid(103)), sid(103)))
        extra = uuid.uuid4()
        self.raw('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)', (extra, uid(103)))
        self.raw('INSERT INTO auth.refresh_tokens(user_id,session_id) VALUES(%s,%s)', (str(uid(103)), extra))
        result = self.close()
        self.assertEqual(result['state'], 'closed')
        self.assertTrue(result['sessions_revoked'])
        self.assertEqual(before, self.raw("SELECT row_to_json(t) FROM sa_snapshot_20261019.sa_orders t WHERE customer_id=103 ORDER BY id"))
        self.assertEqual(identity, self.raw('SELECT auth_user_id,canonical_email FROM sa_identity.sa_auth_identities WHERE legacy_user_id=103'))
        self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_addresses WHERE user_id=103'), [(1,)])
        self.assertEqual(self.raw('SELECT disabled,deleted_at IS NOT NULL,email FROM sa_snapshot_20261019.sa_users WHERE id=103'), [(True, True, 'persona-103@squad.invalid')])
        self.assertEqual(self.raw('SELECT count(*) FROM auth.sessions WHERE user_id=%s', (uid(103),)), [(0,)])
        self.assertEqual(self.raw('SELECT count(*) FROM auth.refresh_tokens WHERE user_id=%s', (str(uid(103)),)), [(0,)])
        self.assertEqual(self.raw("SELECT banned_until>'2100-01-01',role,encrypted_password FROM auth.users WHERE id=%s", (uid(103),)), [(True, 'sa_app', None)])
        self.assertEqual(self.raw('SELECT enrollment_state FROM sa_identity.sa_auth_identities WHERE legacy_user_id=103'), [('blocked',)])
        self.raw('SET CONSTRAINTS ALL IMMEDIATE')

    def test_every_other_role_and_staff_is_denied(self):
        for actor in [100,101,102,104,107,108,109,110,111,112,999]:
            with self.subTest(actor=actor):
                self.authenticate(actor, role='authenticated' if actor==999 else 'sa_app')
                self.rejects(psycopg.errors.InsufficientPrivilege, self.close)

    def test_rpc_has_no_foreign_target_parameter(self):
        arguments = self.raw("SELECT proargnames FROM pg_proc WHERE oid='canto_api.v1_account_close(text,uuid,text)'::regprocedure")[0][0]
        self.assertEqual(arguments, ['p_expected_version','p_idempotency_key','p_confirmation'])
        self.close()
        self.assertEqual(self.raw('SELECT disabled,deleted_at FROM sa_snapshot_20261019.sa_users WHERE id=203'), [(False,None)])
        self.assertEqual(self.raw('SELECT count(*) FROM auth.sessions WHERE user_id=%s', (uid(203),)), [(1,)])

    def test_recent_password_proof_required_not_refresh_or_recovery(self):
        invalid = [[], [{'method':'token_refresh','timestamp':int(time.time())}],
                   [{'method':'recovery','timestamp':int(time.time())}],
                   [{'method':'password','timestamp':int(time.time())-301}],
                   [{'method':'password','timestamp':int(time.time())+90}],
                   [{'method':'password','timestamp':'not-a-number'}]]
        for proof in invalid:
            with self.subTest(proof=proof):
                self.authenticate(amr=proof)
                self.rejects(psycopg.errors.InvalidAuthorizationSpecification, self.close)

    def test_old_session_cannot_be_reclassified_as_recent_password(self):
        self.raw("UPDATE auth.sessions SET created_at=now()-interval '10 minutes' WHERE id=%s", (self.password_session,))
        self.rejects(psycopg.errors.InvalidAuthorizationSpecification, self.close)

    def test_old_suite_session_does_not_replace_a_new_password_session(self):
        self.raw("UPDATE auth.sessions SET created_at=now()-interval '1 day' WHERE id=%s", (sid(103),))
        self.authenticate(session_id=sid(103))
        self.rejects(psycopg.errors.InvalidAuthorizationSpecification, self.close)
        self.authenticate()
        self.assertEqual(self.close()['state'], 'closed')
        self.assertEqual(self.raw('SELECT count(*) FROM auth.sessions WHERE user_id=%s', (uid(103),)), [(0,)])

    def test_other_subject_session_cannot_supply_reauthentication(self):
        self.authenticate(session_id=sid(203))
        self.rejects(psycopg.errors.InvalidAuthorizationSpecification, self.close)

    def test_exact_confirmation_and_current_version_required(self):
        self.rejects(psycopg.errors.InvalidParameterValue, lambda:self.close(confirmation='delete'))
        with self.c.transaction():
            try:
                self.close(version='0:999')
            except psycopg.DatabaseError as error:
                self.assertTrue(is_app_conflict(error))
                raise psycopg.Rollback()
            self.fail('Stale version allowed')
        self.assertEqual(self.raw('SELECT count(*) FROM auth.sessions WHERE user_id=%s',(uid(103),)),[(2,)])

    def test_exact_retry_returns_own_receipt_without_reviving_sessions(self):
        key=uuid.uuid4()
        result=self.close(key=key)
        self.assertEqual(self.close(key=key),result)
        self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.audit WHERE operation='account.closed'"),[(1,)])
        self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='account.closed'"),[(1,)])
        self.assertEqual(self.raw('SELECT count(*) FROM auth.sessions WHERE user_id=%s',(uid(103),)),[(0,)])
        self.rejects(psycopg.errors.InvalidParameterValue,lambda:self.close(version='0:1',key=key))
        self.rejects(psycopg.errors.InvalidAuthorizationSpecification,self.close)
        self.rejects(psycopg.errors.InvalidAuthorizationSpecification,lambda:self.c.execute('SELECT canto_api.v1_me()'))

    def test_replay_bound_to_original_session_and_generation(self):
        key=uuid.uuid4()
        self.close(key=key)
        self.authenticate(session_id=uuid.uuid4())
        self.rejects(psycopg.errors.InvalidParameterValue,lambda:self.close(key=key))
        self.authenticate()
        self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1')
        with self.c.transaction():
            try:self.close(key=key)
            except psycopg.DatabaseError as error:
                self.assertTrue(is_app_conflict(error));raise psycopg.Rollback()
            self.fail('Old generation replay accepted')

    def test_mirror_and_refresh_fences_remain_in_force(self):
        self.raw('UPDATE sa_sync.environment_state SET cutover=false')
        self.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=false')
        self.rejects(psycopg.errors.ObjectNotInPrerequisiteState,self.close)
        self.raw('UPDATE sa_sync.environment_state SET cutover=true,active_job=%s',(uuid.uuid4(),))
        self.rejects(psycopg.errors.ObjectNotInPrerequisiteState,self.close)

    def test_rehearsal_requires_exact_actor_and_live_deadline(self):
        self.raw('UPDATE sa_sync.environment_state SET cutover=false')
        self.raw("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,test_write_expires_at=now()+interval '5 minutes'",([uid(203)],))
        self.rejects(psycopg.errors.ObjectNotInPrerequisiteState,self.close)
        self.raw("UPDATE sa_domain.runtime_state SET test_actor_ids=%s,test_write_expires_at=now()-interval '1 second'",([uid(103)],))
        self.rejects(psycopg.errors.ObjectNotInPrerequisiteState,self.close)
        self.raw("UPDATE sa_domain.runtime_state SET test_write_expires_at=now()+interval '5 minutes'")
        self.assertEqual(self.close()['state'],'closed')

    def test_helpers_are_not_client_callable(self):
        self.rejects(psycopg.errors.InsufficientPrivilege,lambda:self.c.execute('SELECT sa_domain.self_closure_password_proof()'))
        self.rejects(psycopg.errors.InsufficientPrivilege,lambda:self.c.execute('SELECT sa_domain.revoke_closed_self_sessions(%s)',(uuid.uuid4(),)))
        self.c.execute('RESET ROLE');self.c.execute('SET LOCAL ROLE sa_account_writer')
        self.rejects(psycopg.errors.InsufficientPrivilege,lambda:self.c.execute('SELECT sa_domain.revoke_closed_self_sessions(%s)',(uuid.uuid4(),)))

    def test_auth_failure_rolls_back_source_ledger_and_revocation(self):
        self.raw("""CREATE FUNCTION public.self_closure_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected closure Auth failure';END $$;
        CREATE TRIGGER self_closure_test_failure BEFORE UPDATE OF banned_until ON auth.users FOR EACH ROW EXECUTE FUNCTION public.self_closure_test_failure();""")
        self.rejects(psycopg.errors.RaiseException,self.close)
        self.assertEqual(self.raw('SELECT deleted_at,disabled FROM sa_snapshot_20261019.sa_users WHERE id=103'),[(None,False)])
        self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.commands WHERE operation='account.closed'"),[(0,)])
        self.assertEqual(self.raw('SELECT count(*) FROM auth.sessions WHERE user_id=%s',(uid(103),)),[(2,)])

    def test_artificial_new_session_still_cannot_access_closed_account(self):
        self.close()
        new_session=uuid.uuid4()
        self.raw('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(new_session,uid(103)))
        self.authenticate(session_id=new_session)
        self.rejects(psycopg.errors.InvalidAuthorizationSpecification,lambda:self.c.execute('SELECT canto_api.v1_me()'))

    def test_existing_admin_self_protection_is_unchanged(self):
        self.authenticate(100)
        self.rejects(psycopg.errors.InsufficientPrivilege,lambda:self.c.execute("SELECT canto_api.account_user_status(100,'archive','Self',%s,%s)",('0:0',uuid.uuid4())))

    def test_closure_has_durable_account_reconciliation(self):
        self.close()
        self.assertEqual(self.raw("SELECT sa_domain.job_handler(event_type,payload) FROM sa_domain.outbox WHERE event_type='account.closed'"),[('account_reconciliation',)])
        self.assertEqual(self.raw('SELECT state FROM sa_domain.account_requests WHERE legacy_user_id=103'),[('queued',)])
        self.assertEqual(self.raw("SELECT sa_domain.account_target(103)->>'allowed'"),[('false',)])

    def test_worker_completes_reconciliation_for_closed_actor(self):
        self.close()
        self.c.execute('RESET ROLE')
        self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
        self.c.execute('SET LOCAL ROLE service_role')
        jobs = self.c.execute('SELECT canto_api.squad_job_claim(5)').fetchone()[0]['jobs']
        self.assertEqual(len(jobs), 1)
        job = jobs[0]
        self.assertEqual(job['handler'], 'account_reconciliation')
        args = (uuid.UUID(job['id']), uuid.UUID(job['lease_token']))
        target = self.c.execute('SELECT canto_api.squad_account_prepare(%s,%s)', args).fetchone()[0]
        self.assertEqual(target['auth_user_id'], str(uid(103)))
        self.assertFalse(target['allowed'])
        result = self.c.execute('SELECT canto_api.squad_account_finish(%s,%s,%s,NULL)',
                                (*args, Jsonb({'auth_user_id':str(uid(103)), 'exists':True, 'confirmed':True}))).fetchone()[0]
        self.assertEqual(result['state'], 'done')
        self.assertEqual(self.raw('SELECT state FROM sa_domain.account_requests WHERE legacy_user_id=103'), [('blocked',)])
        self.assertEqual(self.raw('SELECT count(*) FROM auth.sessions WHERE user_id=%s', (uid(103),)), [(0,)])


if __name__=='__main__':
    unittest.main(verbosity=2)
