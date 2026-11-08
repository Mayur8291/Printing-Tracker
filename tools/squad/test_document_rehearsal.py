"""Exact staging PDF rehearsals never unlock the general queue or mail workers."""
import unittest
import uuid
import concurrent.futures
import time
from contextlib import contextmanager

import psycopg
from psycopg.types.json import Jsonb

from fixtures import rpc, session, uid
from local_db import connect
from test_catalogue import seed_catalogue
import test_production_execution as work


class DocumentRehearsal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as c:
            seed_catalogue(c)

    actor = work.Execution.actor
    raw = work.Execution.raw
    iv = work.Execution.iv
    cut = work.Execution.cut
    assign = work.Execution.assign
    inspect = work.Execution.inspect
    dispatch = work.Execution.dispatch

    def setUp(self):
        work.Execution.setUp(self)
        self.raw("UPDATE sa_sync.environment_state SET environment='staging',cutover=false,active_job=NULL")
        self.raw("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,"
                 "test_write_expires_at=clock_timestamp()+interval '15 minutes'",
                 ([uid(104), uid(107), uid(108), uid(109)],))
        self.actor(104)

    tearDown = work.Execution.tearDown

    @contextmanager
    def rejects(self, code):
        with self.assertRaises(psycopg.DatabaseError) as caught:
            with self.c.transaction():
                yield
        self.assertEqual(caught.exception.sqlstate, code)

    def worker(self):
        self.c.execute('RESET ROLE')
        self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
        self.c.execute('SET LOCAL ROLE service_role')

    def request(self, kind='tailor_weekly', spec=None):
        spec = spec if spec is not None else {
            'tailor_id': '105', 'week_start': '2026-10-24', 'delivery': 'download'}
        result = rpc(self.c, 'v1_document_request', (kind, Jsonb(spec), uuid.uuid4()))
        self.last = self.raw('SELECT id,job_id,actor_id,generation FROM sa_domain.documents WHERE id=%s',
                             (uuid.UUID(result['id']),))[0]
        return self.last

    def register(self, doc=None, deadline="clock_timestamp()+interval '10 minutes'", **changes):
        document, job, actor, generation = doc or self.last
        values = {'job': job, 'document': document, 'actor': actor, 'generation': generation}
        values.update(changes)
        return self.raw('INSERT INTO sa_domain.document_rehearsals'
                        '(job_id,document_id,actor_id,generation,expires_at) '
                        f'VALUES(%s,%s,%s,%s,{deadline}) RETURNING request_hash',
                        tuple(values[k] for k in ['job', 'document', 'actor', 'generation']))[0][0]

    def claim(self, doc=None):
        self.worker()
        return self.c.execute('SELECT canto_api.squad_document_rehearsal_claim(%s)',
                              ((doc or self.last)[1],)).fetchone()[0]['jobs']

    def call(self, name, j, result=None):
        self.worker()
        args = (uuid.UUID(j['id']), uuid.UUID(j['lease_token']))
        if result is not None:
            args += (Jsonb(result),)
        return self.c.execute('SELECT canto_api.' + name + '(' + ','.join(['%s'] * len(args)) + ')',
                              args).fetchone()[0]

    def prepared(self):
        self.request()
        self.register()
        j = self.claim()[0]
        return j, self.call('squad_document_prepare', j)

    def finish(self, j, code='READY'):
        result = {'code': code}
        if code == 'READY':
            result.update(bytes=1000, pages=1, sha256='a' * 64)
        return self.call('squad_document_finish', j, result)

    def test_weekly_prepare_finish_and_actor_download_keep_mirror_closed(self):
        j, p = self.prepared()
        self.assertEqual((p['state'], p['snapshot']['kind']), ('prepared', 'tailor_weekly'))
        self.assertEqual(self.finish(j)['state'], 'done')
        self.actor(104)
        grant = self.c.execute('SELECT canto_api.account_document_grant(%s)', (self.last[0],)).fetchone()[0]
        self.assertEqual(grant['bucket'], 'squad-documents')
        self.assertTrue(grant['path'].endswith(str(self.last[0]) + '/document.pdf'))
        self.assertEqual(self.raw('SELECT cutover FROM sa_sync.environment_state'), [(False,)])
        self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.worker_context'), [(0,)])
        self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type IN('document.mail','business.mail')"), [(0,)])

    def test_challan_capture_is_selected_actual_dispatch(self):
        self.actor(109)
        self.cut()
        self.assign()
        self.inspect()
        a = self.dispatch(3)
        self.dispatch(7)
        self.request('delivery_challan', {'item_id': '1001', 'dispatch_id': str(a['history_id']), 'delivery': 'download'})
        self.register()
        j = self.claim()[0]
        result = self.call('squad_document_prepare', j)
        self.assertEqual(result['snapshot']['quantity'], 3)
        self.assertEqual(self.finish(j)['state'], 'done')
        self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.outbox WHERE event_type='document.mail'"), [(0,)])

    def test_only_two_registered_jobs_can_be_claimed_and_generic_queue_stays_paused(self):
        a = self.request()
        self.register(a)
        b = self.request()
        self.register(b)
        foreign = self.request()
        self.assertEqual(len(self.claim(a)), 1)
        self.assertEqual(len(self.claim(b)), 1)
        with self.rejects('55000'):
            self.claim(foreign)
        self.worker()
        self.assertEqual(self.c.execute('SELECT canto_api.squad_job_claim(10)').fetchone()[0], {'jobs': [], 'paused': True})
        self.assertEqual(self.raw('SELECT status,attempts FROM sa_domain.outbox WHERE id=%s', (foreign[1],)), [('pending', 0)])

    def test_maximum_two_registrations_global_across_actors(self):
        for _ in range(2):
            self.request()
            self.register()
        self.request()
        with self.rejects('54000'):
            self.register()

    def test_registration_requires_exact_actor_generation_and_job(self):
        self.request()
        for overrides, code in [({'actor': uid(107)}, '42501'), ({'actor': uid(203)}, '55000'),
                                ({'generation': 999}, '55000'), ({'job': uuid.uuid4()}, '42501'),
                                ({'document': uuid.uuid4()}, '42501')]:
            with self.subTest(overrides=overrides), self.rejects(code):
                self.register(**overrides)

    def test_registration_deadline_bounds(self):
        self.request()
        for deadline in ["clock_timestamp()-interval '1 second'", "clock_timestamp()+interval '16 minutes'", 'NULL']:
            with self.subTest(deadline=deadline), self.rejects('55000'):
                self.register(deadline=deadline)
        self.raw("UPDATE sa_domain.runtime_state SET test_write_expires_at=clock_timestamp()+interval '2 minutes'")
        with self.rejects('55000'):
            self.register()

    def test_registration_cannot_be_edited(self):
        self.request()
        self.register()
        with self.rejects('42501'):
            self.raw("UPDATE sa_domain.document_rehearsals SET expires_at=expires_at+interval '1 minute'")

    def test_registration_requires_immutable_audit_binding(self):
        self.request()
        self.raw("UPDATE sa_domain.audit SET changes='{}' WHERE operation='document.requested'")
        with self.rejects('42501'):
            self.register()

    def test_catalogue_and_email_are_not_rehearsal_capabilities(self):
        self.request(spec={'tailor_id': '105', 'week_start': '2026-10-24', 'delivery': 'email'})
        with self.rejects('42501'):
            self.register()
        self.raw('UPDATE sa_domain.runtime_state SET test_actor_ids=array_append(test_actor_ids,%s)', (uid(103),))
        self.actor(103)
        self.request('catalogue', {'delivery': 'download'})
        with self.rejects('42501'):
            self.register()

    def test_implicit_delivery_is_not_registered(self):
        self.request(spec={'tailor_id': '105', 'week_start': '2026-10-24'})
        with self.rejects('42501'):
            self.register()

    def test_preexisting_capture_or_lease_cannot_be_registered(self):
        d = self.request()
        for sql in ["UPDATE sa_domain.documents SET snapshot='{}' WHERE id=%s",
                    "UPDATE sa_domain.documents SET parts='[{}]' WHERE id=%s"]:
            with self.c.transaction(force_rollback=True):
                self.raw(sql, (d[0],))
                with self.rejects('42501'):
                    self.register()
        self.raw('UPDATE sa_domain.outbox SET attempts=1 WHERE id=%s', (d[1],))
        with self.rejects('42501'):
            self.register()

    def test_registry_and_helpers_are_private_with_rls(self):
        self.c.execute('RESET ROLE')
        self.assertEqual(self.c.execute("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='sa_domain.document_rehearsals'::regclass").fetchone(), (True, True))
        for role in ['anon', 'authenticated', 'sa_app', 'service_role']:
            for privilege in ['SELECT', 'INSERT', 'UPDATE', 'DELETE']:
                self.assertFalse(self.c.execute("SELECT has_table_privilege(%s,'sa_domain.document_rehearsals',%s)", (role, privilege)).fetchone()[0])
                self.assertFalse(self.c.execute("SELECT has_table_privilege(%s,'sa_domain.document_rehearsal_receipts',%s)", (role, privilege)).fetchone()[0])
            for signature in ['document_rehearsal_scope(uuid)', 'document_rehearsal_current(uuid)', 'document_worker_fence(uuid,uuid)',
                              'document_rehearsal_record(uuid,uuid,text)', 'document_prepare_standard(uuid,uuid)',
                              'document_finish_standard(uuid,uuid,jsonb)']:
                self.assertFalse(self.c.execute('SELECT has_function_privilege(%s,%s,\'execute\')', (role, 'sa_domain.' + signature)).fetchone()[0])
            self.assertEqual(self.c.execute("SELECT has_function_privilege(%s,'canto_api.squad_document_rehearsal_claim(uuid)','execute')", (role,)).fetchone()[0], role == 'service_role')

    def test_app_cannot_claim_or_register(self):
        self.request()
        self.register()
        with self.rejects('42501'):
            self.c.execute('SELECT canto_api.squad_document_rehearsal_claim(%s)', (self.last[1],))
        with self.rejects('42501'):
            self.c.execute('INSERT INTO sa_domain.document_rehearsals(job_id) VALUES(%s)', (uuid.uuid4(),))

    def test_service_database_role_without_service_jwt_cannot_claim(self):
        self.request()
        self.register()
        self.c.execute('RESET ROLE')
        self.c.execute('SET LOCAL ROLE service_role')
        with self.rejects('42501'):
            self.c.execute('SELECT canto_api.squad_document_rehearsal_claim(%s)', (self.last[1],))

    def test_registration_denied_in_production_cutover_or_refresh(self):
        self.request()
        for assignment in ["environment='production'", 'cutover=true', f"active_job='{uuid.uuid4()}'"]:
            with self.subTest(assignment=assignment), self.c.transaction(force_rollback=True):
                self.raw('UPDATE sa_sync.environment_state SET ' + assignment)
                with self.rejects('55000'):
                    self.register()

    def test_claim_denied_after_production_cutover_refresh_or_generation_change(self):
        self.request()
        self.register()
        for sql in ["UPDATE sa_sync.environment_state SET environment='production'",
                    'UPDATE sa_sync.environment_state SET cutover=true',
                    f"UPDATE sa_sync.environment_state SET active_job='{uuid.uuid4()}'",
                    'UPDATE sa_domain.runtime_state SET generation=generation+1']:
            with self.subTest(sql=sql), self.c.transaction(force_rollback=True):
                self.raw(sql)
                with self.rejects('55000'):
                    self.claim()

    def test_allowlist_revocation_and_deadline_are_checked_each_call(self):
        j, _ = self.prepared()
        for sql in ['UPDATE sa_domain.runtime_state SET allow_test_writes=false',
                    "UPDATE sa_domain.runtime_state SET test_actor_ids='{}'",
                    "UPDATE sa_domain.runtime_state SET test_write_expires_at=clock_timestamp()-interval '1 second'"]:
            with self.subTest(sql=sql), self.c.transaction(force_rollback=True):
                self.raw(sql)
                with self.rejects('55000'):
                    self.call('squad_document_prepare', j)
                with self.rejects('55000'):
                    self.finish(j)

    def test_expiry_after_claim_blocks_capture_and_publish(self):
        self.request()
        self.register(deadline="clock_timestamp()+interval '0.10 seconds'")
        j = self.claim()[0]
        self.raw('SELECT pg_sleep(0.12)')
        with self.rejects('55000'):
            self.call('squad_document_prepare', j)
        with self.rejects('55000'):
            self.finish(j)

    def test_expiry_after_capture_blocks_publish_without_output_receipt(self):
        self.request()
        self.register(deadline="clock_timestamp()+interval '0.2 seconds'")
        j = self.claim()[0]
        self.call('squad_document_prepare', j)
        self.raw('SELECT pg_sleep(0.22)')
        with self.rejects('55000'):
            self.finish(j)
        self.assertEqual(self.raw('SELECT phase,job_state FROM sa_domain.document_rehearsal_receipts'), [('prepare', 'leased')])

    def test_registered_capability_delete_revokes_running_job(self):
        j, _ = self.prepared()
        self.raw('DELETE FROM sa_domain.document_rehearsals WHERE job_id=%s', (self.last[1],))
        with self.rejects('55000'):
            self.finish(j)
        self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.document_rehearsal_receipts WHERE job_id=%s', (self.last[1],)), [(1,)])

    def test_modified_request_and_job_payload_are_rejected(self):
        j, _ = self.prepared()
        for sql, args in [("UPDATE sa_domain.documents SET request=request||'{\"delivery\":\"email\"}' WHERE id=%s", (self.last[0],)),
                          ("UPDATE sa_domain.documents SET request=request||'{\"include_team\":true}' WHERE id=%s", (self.last[0],)),
                          ("UPDATE sa_domain.outbox SET payload='{}' WHERE id=%s", (self.last[1],))]:
            with self.subTest(sql=sql), self.c.transaction(force_rollback=True):
                self.raw(sql, args)
                with self.rejects('42501'):
                    self.finish(j)

    def test_disabled_banned_or_changed_role_fails_claim_atomically(self):
        self.request()
        self.register()
        for sql, args in [('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=104', ()),
                          ('UPDATE sa_snapshot_20261019.sa_users SET role=3 WHERE id=104', ()),
                          ("UPDATE auth.users SET banned_until=now()+interval '1 hour' WHERE id=%s", (uid(104),))]:
            with self.subTest(sql=sql), self.c.transaction(force_rollback=True):
                self.raw(sql, args)
                with self.assertRaises(psycopg.DatabaseError):
                    with self.c.transaction():
                        self.claim()
                self.assertEqual(self.raw('SELECT status,attempts FROM sa_domain.outbox WHERE id=%s', (self.last[1],)), [('pending', 0)])
                self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.job_attempts WHERE job_id=%s', (self.last[1],)), [(0,)])
                self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.worker_context'), [(0,)])

    def test_current_authority_revoked_between_capture_and_publish(self):
        j, _ = self.prepared()
        self.raw('UPDATE sa_snapshot_20261019.sa_users SET role=3 WHERE id=104')
        with self.rejects('42501'):
            self.finish(j)
        self.assertEqual(self.raw('SELECT state,object_path FROM sa_domain.documents WHERE id=%s', (self.last[0],)), [('rendering', None)])

    def test_changed_authority_after_claim_blocks_prepare(self):
        self.request()
        self.register()
        j = self.claim()[0]
        self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=104')
        with self.assertRaises(psycopg.DatabaseError):
            with self.c.transaction():
                self.call('squad_document_prepare', j)
        self.assertEqual(self.raw('SELECT snapshot FROM sa_domain.documents WHERE id=%s', (self.last[0],)), [(None,)])

    def test_normal_production_cutover_worker_has_no_rehearsal_requirement_or_receipt(self):
        self.raw("UPDATE sa_sync.environment_state SET environment='production',cutover=true")
        self.raw("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")
        self.request()
        self.worker()
        jobs = self.c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0]['jobs']
        self.assertEqual(len(jobs), 1)
        p = self.call('squad_document_prepare', jobs[0])
        self.assertEqual(p['state'], 'prepared')
        self.assertEqual(self.finish(jobs[0])['state'], 'done')
        self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.document_rehearsal_receipts'), [(0,)])

    def test_worker_receipt_proves_exact_nested_publish_row_even_if_response_lost(self):
        j, _ = self.prepared()
        self.finish(j)
        proof = self.raw("SELECT p.phase,p.document_xmin=d.xmin::text,"
                         "p.document_sha256=encode(sha256(convert_to(to_jsonb(d)::text,'UTF8')),'hex'),"
                         "p.job_state,p.lease_token=j.lease_token FROM sa_domain.document_rehearsal_receipts p "
                         "JOIN sa_domain.documents d ON d.id=p.document_id JOIN sa_domain.outbox j ON j.id=p.job_id")[0]
        self.assertEqual(proof, ('finish', True, True, 'done', True))
        self.raw('DELETE FROM sa_domain.document_rehearsals WHERE job_id=%s', (self.last[1],))
        self.raw('DELETE FROM sa_domain.documents WHERE id=%s', (self.last[0],))
        self.assertEqual(self.raw('SELECT phase,job_state FROM sa_domain.document_rehearsal_receipts'), [('finish', 'done')])

    def test_foreign_document_edit_cannot_be_blessed_by_prepare_retry(self):
        j, _ = self.prepared()
        prior = self.raw('SELECT document_xmin,document_sha256 FROM sa_domain.document_rehearsal_receipts')[0]
        self.raw("UPDATE sa_domain.documents SET snapshot=snapshot||'{\"foreign\":true}' WHERE id=%s", (self.last[0],))
        with self.rejects('42501'):
            self.call('squad_document_prepare', j)
        with self.rejects('42501'):
            self.finish(j)
        self.assertEqual(self.raw('SELECT document_xmin,document_sha256 FROM sa_domain.document_rehearsal_receipts')[0], prior)

    def test_identical_foreign_update_changes_xmin_and_is_denied(self):
        j, _ = self.prepared()
        # A separate savepoint gives the foreign writer a different xid, like a
        # committed external transaction, while this entire test remains rollback-only.
        with self.c.transaction():
            self.raw('UPDATE sa_domain.documents SET request=request WHERE id=%s', (self.last[0],))
        with self.rejects('42501'):
            self.finish(j)

    def test_target_factory_scope_rechecked_at_claim(self):
        self.request()
        self.register()
        self.raw('UPDATE sa_snapshot_20261019.sa_users SET factory_manager_id=204 WHERE id=105')
        with self.rejects('42501'):
            self.claim()

    def test_busy_claim_and_terminal_replay_do_not_duplicate_attempts(self):
        j, _ = self.prepared()
        self.assertEqual(self.claim(), [])
        self.assertEqual(self.finish(j)['state'], 'done')
        self.assertTrue(self.finish(j)['replayed'])
        self.assertEqual(self.claim(), [])
        self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.job_attempts WHERE job_id=%s', (self.last[1],)), [(1,)])

    def test_foreign_and_expired_lease_denied(self):
        j, _ = self.prepared()
        forged = j | {'lease_token': str(uuid.uuid4())}
        with self.rejects('PT409'):
            self.finish(forged)
        self.raw("UPDATE sa_domain.outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=%s", (self.last[1],))
        with self.rejects('PT409'):
            self.finish(j)

    def test_expired_lease_retries_same_document_and_bounds_attempts(self):
        j, p = self.prepared()
        for n in range(2, 6):
            self.raw("UPDATE sa_domain.outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=%s", (self.last[1],))
            j = self.claim()[0]
            self.assertEqual(j['attempt'], n)
            self.assertEqual(self.call('squad_document_prepare', j)['snapshot_hash'], p['snapshot_hash'])
        self.raw("UPDATE sa_domain.outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=%s", (self.last[1],))
        self.assertEqual(self.claim(), [])
        self.assertEqual(self.raw('SELECT state,error_code FROM sa_domain.documents WHERE id=%s', (self.last[0],)), [('failed', 'LEASE_EXHAUSTED')])
        self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.job_attempts WHERE job_id=%s', (self.last[1],)), [(5,)])

    def test_storage_retry_preserves_snapshot_and_reuses_exact_claim(self):
        j, p = self.prepared()
        self.assertEqual(self.finish(j, 'STORAGE_UNAVAILABLE')['state'], 'pending')
        self.assertEqual(self.claim(), [])
        self.raw('UPDATE sa_domain.outbox SET available_at=now() WHERE id=%s', (self.last[1],))
        j = self.claim()[0]
        self.assertEqual(self.call('squad_document_prepare', j)['snapshot_hash'], p['snapshot_hash'])
        self.assertEqual(self.finish(j)['state'], 'done')

    def test_lease_extension_cannot_outlive_registration(self):
        self.request()
        self.register(deadline="clock_timestamp()+interval '2 minutes'")
        j = self.claim()[0]
        self.call('squad_document_prepare', j)
        self.assertEqual(self.raw('SELECT j.lease_until<=c.expires_at FROM sa_domain.outbox j JOIN sa_domain.document_rehearsals c ON c.job_id=j.id'), [(True,)])

    def test_no_mail_worker_or_generic_worker_fence_bypass(self):
        j, _ = self.prepared()
        with self.rejects('55000'):
            self.call('squad_document_mail_prepare', j)
        with self.rejects('55000'):
            self.call('squad_notification_prepare', j)
        with self.rejects('55000'):
            self.call('squad_business_mail_prepare', j)
        self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.worker_context'), [(0,)])


class DocumentRehearsalConcurrency(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as c:
            seed_catalogue(c)

    def test_foreign_edit_committed_while_prepare_waits_cannot_be_blessed(self):
        """The proof must be checked again after acquiring the document lock."""
        c, editor, renderer = connect(), connect(), connect()
        key, document, job = uuid.uuid4(), None, None
        runtime = c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone()
        environment = c.execute('SELECT environment,cutover,active_job,edit_revision FROM sa_sync.environment_state').fetchone()
        try:
            with c.transaction():
                c.execute("UPDATE sa_sync.environment_state SET environment='staging',cutover=false,active_job=NULL")
                c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,"
                          "test_write_expires_at=clock_timestamp()+interval '15 minutes'", ([uid(104)],))
                session(c, 104)
                result = rpc(c, 'v1_document_request', ('tailor_weekly', Jsonb({
                    'tailor_id': '105', 'week_start': '2026-10-24', 'delivery': 'download'}), key))
                document = uuid.UUID(result['id'])
                c.execute('RESET ROLE')
                job = c.execute('SELECT job_id FROM sa_domain.documents WHERE id=%s', (document,)).fetchone()[0]
                c.execute("INSERT INTO sa_domain.document_rehearsals(job_id,document_id,actor_id,generation,expires_at) "
                          "SELECT job_id,id,actor_id,generation,clock_timestamp()+interval '10 minutes' "
                          'FROM sa_domain.documents WHERE id=%s', (document,))
                c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
                c.execute('SET LOCAL ROLE service_role')
                lease = c.execute('SELECT canto_api.squad_document_rehearsal_claim(%s)', (job,)).fetchone()[0]['jobs'][0]
            proof = c.execute('SELECT document_xmin,document_sha256 FROM sa_domain.document_rehearsal_receipts WHERE job_id=%s', (job,)).fetchone()
            editor.execute('BEGIN')
            editor.execute('UPDATE sa_domain.documents SET request=request WHERE id=%s', (document,))
            renderer_pid = renderer.info.backend_pid
            editor_pid = editor.info.backend_pid

            def prepare():
                try:
                    with renderer.transaction():
                        renderer.execute("SET LOCAL statement_timeout='5s'")
                        renderer.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
                        renderer.execute('SET LOCAL ROLE service_role')
                        renderer.execute('SELECT canto_api.squad_document_prepare(%s,%s)',
                                         (job, uuid.UUID(lease['lease_token']))).fetchone()
                    return 'succeeded'
                except psycopg.DatabaseError as error:
                    return error.sqlstate

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(prepare)
                deadline = time.monotonic() + 3
                blocked = False
                while time.monotonic() < deadline:
                    blocked = editor_pid in c.execute('SELECT pg_blocking_pids(%s)', (renderer_pid,)).fetchone()[0]
                    if blocked:
                        break
                    time.sleep(0.01)
                self.assertTrue(blocked, 'Renderer must actually wait for the document writer before the race is released')
                editor.execute('COMMIT')
                self.assertEqual(future.result(timeout=6), '42501')
            self.assertEqual(c.execute('SELECT document_xmin,document_sha256 FROM sa_domain.document_rehearsal_receipts WHERE job_id=%s', (job,)).fetchone(), proof)
            self.assertIsNone(c.execute('SELECT snapshot FROM sa_domain.documents WHERE id=%s', (document,)).fetchone()[0])
            self.assertEqual(c.execute('SELECT count(*) FROM sa_domain.worker_context WHERE job_id=%s', (job,)).fetchone()[0], 0)
        finally:
            editor.execute('ROLLBACK')
            renderer.execute('ROLLBACK')
            with c.transaction():
                c.execute('DELETE FROM sa_domain.worker_context WHERE job_id=%s', (job,))
                c.execute('DELETE FROM sa_domain.document_rehearsals WHERE job_id=%s', (job,))
                c.execute('DELETE FROM sa_domain.document_rehearsal_receipts WHERE job_id=%s', (job,))
                c.execute('DELETE FROM sa_domain.documents WHERE id=%s', (document,))
                c.execute('DELETE FROM sa_domain.job_attempts WHERE job_id=%s', (job,))
                c.execute('DELETE FROM sa_domain.outbox WHERE actor_id=%s AND command_key=%s', (uid(104), key))
                c.execute('DELETE FROM sa_domain.audit WHERE actor_id=%s AND command_key=%s', (uid(104), key))
                c.execute('DELETE FROM sa_domain.commands WHERE actor_id=%s AND key=%s', (uid(104), key))
                c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=%s,test_actor_ids=%s,test_write_expires_at=%s', runtime)
                c.execute('UPDATE sa_sync.environment_state SET environment=%s,cutover=%s,active_job=%s,edit_revision=%s', environment)
            editor.close()
            renderer.close()
            c.close()


if __name__ == '__main__':
    unittest.main(verbosity=2)
