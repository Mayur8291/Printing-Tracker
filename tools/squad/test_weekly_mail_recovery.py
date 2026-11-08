"""Rollback-only real source/SDK compositions and exact mail cleanup evidence.

No SMTP or Storage request is made. SQL delivery receipts are explicitly
synthetic; these tests prove bounded ownership and interrupted-run recovery.
"""
import copy
import json
import unittest
import uuid
from unittest.mock import patch

import psycopg
from psycopg.types.json import Jsonb
from fixtures import rpc
import test_business_harness as base
import test_hosted_business_journeys as business
from test_business_journey_composition import run_sdk
import weekly_mail_recovery as recovery


class LeaseTimestamp(unittest.TestCase):
    def test_postgres_fractional_precision(self):
        for digits in ('','1','12','123','1234','73313','123456'):
            with self.subTest(digits=digits):
                value='2026-11-08T19:09:57'+('.'+digits if digits else '')+'+05:30'
                parsed=recovery.lease_deadline(value)
                self.assertEqual(parsed.microsecond,int(digits.ljust(6,'0') or '0'))
                self.assertEqual(parsed.utcoffset().total_seconds(),19800)


class WeeklyMailRecovery(unittest.TestCase):
    setUpClass = classmethod(lambda cls: base.BusinessHarness.setUpClass())
    setUp = base.BusinessHarness.setUp
    tearDown = base.BusinessHarness.tearDown

    def composed(self, register=True):
        state = business.plan(self.c)
        state['weekly_mail_rehearsal'] = True
        business.identities.bind_controlled_inbox(self.c, state['identity'], 'squad-acceptance@example.com')
        state['fixture'] = business.plan_fixture(state)
        recovery.capture_settings(self.c, state)
        credentials = business.prepare(self.c, state)
        for actor in credentials:
            actor['password'] = ''
        self.actors = {}
        for actor in state['identity']['actors']:
            actor = dict(actor, session_id=str(uuid.uuid4()))
            self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)', (actor['session_id'], actor['auth_id']))
            self.actors[actor['role']] = actor
        result = run_sdk(self.c, state['fixture'], self.actors, state['run_id'])
        self.c.execute('RESET ROLE')
        self.state, self.result = state, result

        def key(label):
            value = uuid.uuid5(uuid.UUID(state['run_id']), label)
            result['journal'].append({'kind': 'command', 'value': {'label': label, 'key': str(value)}})
            return value

        self.actor(0)
        current = next(x for x in rpc(self.c, 'v1_mail_settings_read')['data'] if x['kind'] == 'tailor_weekly')
        rpc(self.c, 'v1_mail_settings_save', ('tailor_weekly', [state['base'] + x for x in [0, 2, 4]], current['version'], key('mail.settings')))
        current = rpc(self.c, 'v1_weekly_tailor_schedule_status')
        rpc(self.c, 'v1_weekly_tailor_schedule_configure', (True, current['version'], key('mail.schedule')))
        rpc(self.c, 'v1_document_request', ('catalogue', Jsonb({'selection': {'class_ids': [state['fixture']['commercialExtras']['rmpClassId']]}, 'delivery': 'email'}), key('mail.catalogue')))
        self.c.execute('RESET ROLE')
        spec = self.c.execute('''SELECT d.request FROM sa_domain.documents d JOIN sa_domain.outbox j ON j.id=d.job_id
          WHERE j.command_key=%s AND d.kind='delivery_challan' ''',
          (uuid.uuid5(uuid.UUID(state['run_id']), 'workforce.challan'),)).fetchone()[0]
        self.actor(7)
        rpc(self.c, 'v1_document_request', ('delivery_challan', Jsonb({**spec, 'delivery': 'email'}), key('mail.challan')))
        self.c.execute('RESET ROLE')
        if register:
            recovery.register(self.c, state)
        return state, result

    def actor(self, role):
        self.c.execute('RESET ROLE')
        actor = self.actors[role]
        self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",
                       (json.dumps({'sub': actor['auth_id'], 'session_id': actor['session_id'], 'role': 'sa_app'}),))
        self.c.execute('SET LOCAL ROLE sa_app')

    def service(self):
        self.c.execute('RESET ROLE')
        self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
        self.c.execute('SET LOCAL ROLE service_role')

    def tick(self):
        self.service()
        result = self.c.execute('SELECT canto_api.squad_weekly_mail_rehearsal_tick(%s)', (recovery.cap_id(self.state),)).fetchone()[0]
        self.c.execute('RESET ROLE')
        return result

    def call(self, name, job, value=None):
        self.service()
        args = (job['id'], job['lease_token'])
        if value is not None:
            args += (Jsonb(value) if isinstance(value, dict) else value,)
        result = self.c.execute('SELECT canto_api.' + name + '(' + ','.join(['%s'] * len(args)) + ')', args).fetchone()[0]
        self.c.execute('RESET ROLE')
        return result

    def begin(self, job):
        self.service()
        result = self.c.execute('SELECT canto_api.squad_weekly_mail_rehearsal_send_begin(%s,%s,%s)',
                                (recovery.cap_id(self.state), job['id'], job['lease_token'])).fetchone()[0]
        self.c.execute('RESET ROLE')
        return result

    def until_delivery(self):
        for _ in range(12):
            jobs = self.tick()['jobs']
            self.assertEqual(len(jobs), 1)
            job = jobs[0]
            if job['handler'] == 'document_render':
                prepared = self.call('squad_document_prepare', job)
                self.assertEqual(prepared['state'], 'prepared')
                if prepared['snapshot']['kind'] == 'tailor_weekly':
                    self.assertEqual(prepared['snapshot']['summary']['completed'], 3)
                    self.assertEqual(float(prepared['snapshot']['summary']['amount']), 105)
                self.call('squad_document_finish', job, {'code': 'READY', 'bytes': 1000, 'pages': 1, 'sha256': 'a' * 64})
            elif job['handler'] == 'document_mail':
                self.assertEqual(self.call('squad_document_mail_prepare', job)['state'], 'done')
            else:
                self.assertEqual(job['handler'], 'business_mail')
                message = self.call('squad_business_mail_prepare', job)
                self.assertEqual(message['state'], 'prepared')
                return job, message
        self.fail('Bounded mail delivery unavailable')

    def complete(self):
        messages = []
        for _ in range(5):
            job, message = self.until_delivery()
            grant = self.begin(job)
            self.assertEqual(grant['allowed_recipient'], message['email'])
            self.assertEqual(self.call('squad_business_mail_finish', job, 'SENT')['state'], 'done')
            messages.append(message)
        self.assertEqual(self.tick()['jobs'], [])
        return messages

    def clean(self):
        recovery.quiesce(self.c, self.state)
        self.state['weekly_mail']['storage_deleted'] = True
        return business.cleanup(self.c, self.state, self.result['journal'], weekly_mail_cleanup=recovery.callback)

    def test_five_sql_receipts_cleanup_and_repeat_restore_source_and_settings(self):
        self.composed()
        messages = self.complete()
        self.assertEqual(len(messages), 5)
        self.assertEqual(sorted(x['kind'] for x in messages), ['catalogue', 'delivery_challan', 'tailor_weekly', 'tailor_weekly', 'tailor_weekly'])
        self.assertEqual(len({x['email'] for x in messages}), 4)
        cleaned = self.clean()
        self.assertTrue(cleaned['source_content_restored'])
        self.assertEqual(cleaned['removed_processed_documents'], 3)
        self.assertEqual(self.c.execute("SELECT count(*) FROM sa_domain.weekly_mail_sends WHERE capability_id=%s AND state='accepted'", (recovery.cap_id(self.state),)).fetchone(), (5,))
        self.assertEqual(self.c.execute('SELECT to_jsonb(s) FROM sa_domain.weekly_tailor_schedule s').fetchone()[0], self.state['weekly_mail']['schedule_before'])
        self.assertEqual(self.c.execute("SELECT to_jsonb(m) FROM sa_domain.business_mail_settings m WHERE kind='tailor_weekly'").fetchone()[0], self.state['weekly_mail']['settings_before'])
        self.assertEqual(business.cleanup(self.c, self.state, self.result['journal'], weekly_mail_cleanup=recovery.callback), cleaned)
        self.assertEqual(self.c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone(), (False, [], None))

    def test_rolled_back_registration_recovers_exact_untouched_email_intents(self):
        self.composed(register=False)
        with self.c.transaction(force_rollback=True):
            recovery.register(self.c, self.state)
            durable = copy.deepcopy(self.state)
        self.state = durable
        self.assertFalse(self.c.execute('SELECT 1 FROM sa_domain.weekly_mail_rehearsals WHERE id=%s', (recovery.cap_id(self.state),)).fetchone())
        cleaned = self.clean()
        self.assertEqual(cleaned['removed_processed_documents'], 0)
        self.assertTrue(cleaned['source_content_restored'])
        self.assertFalse(self.c.execute('SELECT 1 FROM sa_domain.weekly_mail_sends WHERE capability_id=%s', (recovery.cap_id(self.state),)).fetchone())

    def test_registered_but_unexecuted_roots_restore_exact_preexisting_settings(self):
        self.c.execute("UPDATE sa_domain.business_mail_settings SET recipient_ids=ARRAY[100,102] WHERE kind='tailor_weekly'")
        self.composed()
        before = self.state['weekly_mail']['settings_before']
        self.assertEqual(before['recipient_ids'], [100, 102])
        self.clean()
        self.assertEqual(self.c.execute("SELECT to_jsonb(m) FROM sa_domain.business_mail_settings m WHERE kind='tailor_weekly'").fetchone()[0], before)

    def test_active_lease_revokes_capability_but_refuses_cleanup_until_grace(self):
        self.composed()
        self.assertEqual(len(self.tick()['jobs']), 1)
        with self.assertRaisesRegex(AssertionError, 'worker may still run'):
            recovery.quiesce(self.c, self.state)
        self.assertFalse(self.c.execute('SELECT 1 FROM sa_domain.weekly_mail_rehearsals WHERE id=%s', (recovery.cap_id(self.state),)).fetchone())
        self.assertEqual(self.c.execute('SELECT allow_test_writes FROM sa_domain.runtime_state').fetchone(), (False,))
        self.assertTrue(self.c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id=%s', (self.state['base'],)).fetchone())

    def test_unknown_smtp_marker_prevents_resend_and_survives_cleanup(self):
        self.composed()
        job, message = self.until_delivery()
        self.begin(job)
        self.call('squad_business_mail_finish', job, 'PROVIDER_UNAVAILABLE')
        self.assertNotIn(job['id'], [x['id'] for x in self.tick()['jobs']])
        # Other exact documents can remain queued; settle any newly leased job
        # after the normal grace using an explicitly owned local test clock.
        self.expire_owned_leases()
        self.clean()
        self.assertEqual(self.c.execute('SELECT state FROM sa_domain.weekly_mail_sends WHERE job_id=%s', (job['id'],)).fetchone(), ('unknown',))
        self.assertEqual(self.c.execute('SELECT status FROM sa_domain.outbox WHERE id=%s', (job['id'],)).fetchone(), ('dead',))

    def expire_owned_leases(self):
        for (job,) in self.c.execute("SELECT j.id FROM sa_domain.weekly_mail_job_receipts r JOIN sa_domain.outbox j ON j.id=r.job_id WHERE r.capability_id=%s AND j.status='leased'", (recovery.cap_id(self.state),)).fetchall():
            self.c.execute("UPDATE sa_domain.outbox SET lease_until=clock_timestamp()-interval '61 seconds' WHERE id=%s", (job,))
            # Clock manipulation is local-only; refresh its exact trusted worker
            # proof to model the same lease naturally expiring on the server.
            self.c.execute("SELECT sa_domain.weekly_mail_record(%s,'test_clock')", (job,))

    def test_lost_smtp_finish_aborts_after_grace_and_records_trigger_document_change(self):
        self.composed()
        job, message = self.until_delivery()
        self.begin(job)
        self.expire_owned_leases()
        self.clean()
        self.assertEqual(self.c.execute('SELECT state FROM sa_domain.weekly_mail_sends WHERE job_id=%s', (job['id'],)).fetchone(), ('started',))
        self.assertEqual(self.c.execute('SELECT status,last_error_code FROM sa_domain.outbox WHERE id=%s', (job['id'],)).fetchone(), ('dead', 'REHEARSAL_MAIL_ABORT'))

    def test_foreign_settings_update_is_not_restored_over(self):
        self.composed()
        with self.c.transaction():
            self.c.execute("UPDATE sa_domain.business_mail_settings SET recipient_ids=ARRAY[100] WHERE kind='tailor_weekly'")
        with self.assertRaisesRegex(AssertionError, 'Settings changed'):
            self.clean()
        self.assertEqual(self.c.execute("SELECT recipient_ids FROM sa_domain.business_mail_settings WHERE kind='tailor_weekly'").fetchone(), ([100],))

    def test_foreign_schedule_run_same_content_xmin_is_rejected(self):
        self.composed()
        self.tick()
        with self.c.transaction():
            self.c.execute('UPDATE sa_domain.weekly_tailor_runs SET queued=queued')
        with self.assertRaisesRegex(AssertionError, 'Schedule run or entry changed'):
            recovery.settings_provenance(self.c, self.state)

    def test_foreign_schedule_entry_same_content_xmin_is_rejected(self):
        self.composed()
        self.tick()
        with self.c.transaction():
            self.c.execute('UPDATE sa_domain.weekly_tailor_entries SET tailor_id=tailor_id')
        with self.assertRaisesRegex(AssertionError, 'Schedule run or entry changed'):
            recovery.settings_provenance(self.c, self.state)

    def test_foreign_unreceipted_outbox_descendant_is_not_deleted(self):
        self.composed()
        self.complete()
        root = self.c.execute('SELECT job_id FROM sa_domain.weekly_mail_documents WHERE capability_id=%s LIMIT 1', (recovery.cap_id(self.state),)).fetchone()[0]
        foreign = self.c.execute("INSERT INTO sa_domain.outbox(parent_id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload) SELECT id,actor_id,'foreign.event','document',aggregate_id,gen_random_uuid(),generation,payload FROM sa_domain.outbox WHERE id=%s RETURNING id", (root,)).fetchone()[0]
        with self.assertRaises(AssertionError):
            recovery.jobs(self.c, self.state, recovery.roots(self.c, self.state))
        self.assertTrue(self.c.execute('SELECT 1 FROM sa_domain.outbox WHERE id=%s', (foreign,)).fetchone())

    def test_foreign_unreceipted_delivery_is_not_deleted(self):
        self.composed()
        self.complete()
        delivery = self.c.execute('SELECT to_jsonb(m) FROM sa_domain.business_mail_deliveries m LIMIT 1').fetchone()[0]
        foreign = self.c.execute("INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation) VALUES(%s,'business.mail_delivery','document',1,%s,0) RETURNING id", (delivery['recipient_auth_id'], uuid.uuid4())).fetchone()[0]
        delivery['job_id'] = str(foreign)
        delivery['source_job'] = str(foreign)
        self.c.execute('INSERT INTO sa_domain.business_mail_deliveries SELECT (jsonb_populate_record(NULL::sa_domain.business_mail_deliveries,%s)).*', (Jsonb(delivery),))
        with self.assertRaises(AssertionError):
            recovery.jobs(self.c, self.state, recovery.roots(self.c, self.state))
        self.assertTrue(self.c.execute('SELECT 1 FROM sa_domain.business_mail_deliveries WHERE job_id=%s', (foreign,)).fetchone())


    def interleave_before_cleanup_lock(self, mutate, at=1):
        """Model a committed writer after an earlier proof read, before row locks.

        The separate savepoint gets its own xmin. Existing foreign-write tests
        prove preservation; these interleavings prove write-boundary revalidation.
        """
        original = recovery.lock_cleanup
        entered = []

        def interleave(c, state):
            entered.append(True)
            if len(entered) == at:
                with c.transaction():
                    mutate(c)
            return original(c, state)

        return patch.object(recovery, 'lock_cleanup', side_effect=interleave)

    def test_quiesce_revalidates_job_after_lock_boundary_interleaving(self):
        self.composed()
        job, _ = self.until_delivery()
        self.begin(job)
        self.expire_owned_leases()
        before = self.c.execute('SELECT job_xmin,job_sha256 FROM sa_domain.weekly_mail_job_receipts WHERE job_id=%s', (job['id'],)).fetchone()
        with self.interleave_before_cleanup_lock(lambda c: c.execute(
                'UPDATE sa_domain.outbox SET payload=payload WHERE id=%s', (job['id'],)), at=2):
            with self.assertRaisesRegex(AssertionError, 'Job/delivery changed'):
                recovery.quiesce(self.c, self.state)
        self.assertEqual(self.c.execute('SELECT status FROM sa_domain.outbox WHERE id=%s', (job['id'],)).fetchone(), ('leased',))
        self.assertEqual(self.c.execute('SELECT job_xmin,job_sha256 FROM sa_domain.weekly_mail_job_receipts WHERE job_id=%s', (job['id'],)).fetchone(), before)
        self.assertEqual(self.c.execute('SELECT state FROM sa_domain.weekly_mail_sends WHERE job_id=%s', (job['id'],)).fetchone(), ('started',))

    def test_cleanup_revalidates_delivery_before_bulk_delete(self):
        self.composed()
        self.complete()
        recovery.quiesce(self.c, self.state)
        self.state['weekly_mail']['storage_deleted'] = True
        delivery = self.c.execute('SELECT job_id FROM sa_domain.business_mail_deliveries LIMIT 1').fetchone()[0]
        with self.interleave_before_cleanup_lock(lambda c: c.execute(
                'UPDATE sa_domain.business_mail_deliveries SET state=state WHERE job_id=%s', (delivery,))):
            with self.assertRaisesRegex(AssertionError, 'Job/delivery changed'):
                business.cleanup(self.c, self.state, self.result['journal'], weekly_mail_cleanup=recovery.callback)
        self.assertTrue(self.c.execute('SELECT 1 FROM sa_domain.business_mail_deliveries WHERE job_id=%s', (delivery,)).fetchone())
        self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.weekly_mail_documents WHERE capability_id=%s', (recovery.cap_id(self.state),)).fetchone(), (3,))

    def test_cleanup_revalidates_settings_before_restore(self):
        self.composed()
        recovery.quiesce(self.c, self.state)
        self.state['weekly_mail']['storage_deleted'] = True
        before = self.c.execute("SELECT recipient_ids FROM sa_domain.business_mail_settings WHERE kind='tailor_weekly'").fetchone()
        with self.interleave_before_cleanup_lock(lambda c: c.execute(
                "UPDATE sa_domain.business_mail_settings SET recipient_ids=ARRAY[100] WHERE kind='tailor_weekly'")):
            with self.assertRaisesRegex(AssertionError, 'Settings changed'):
                business.cleanup(self.c, self.state, self.result['journal'], weekly_mail_cleanup=recovery.callback)
        self.assertEqual(self.c.execute("SELECT recipient_ids FROM sa_domain.business_mail_settings WHERE kind='tailor_weekly'").fetchone(), before)
        self.assertTrue(self.c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id=%s', (self.state['base'],)).fetchone())


if __name__ == '__main__':
    unittest.main(verbosity=2)
