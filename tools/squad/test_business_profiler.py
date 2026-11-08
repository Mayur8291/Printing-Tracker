"""Local-only checks for the prepared rollback profiler; no hosted connection."""
import unittest
from unittest import mock

import psycopg
from psycopg import sql

from local_db import connect
from profile_hosted_business_journeys import context_functions,fence_sequences,sequence_states,sdk_profile
from test_business_journey_composition import prepare_local
import profile_hosted_business_journeys as profiler


class BusinessProfiler(unittest.TestCase):
    def test_error_context_retains_only_function_names_and_lines(self):
        text='''SQL statement "INSERT INTO private_table VALUES ('secret@example.com', 'private-token')"
PL/pgSQL function sa_domain.consume_stock(jsonb,text) line 19 at SQL statement
SQL function "v1_dispatch_record" statement 1
PL/pgSQL function sa_domain.outer_call(text) line 3 at assignment
DETAIL: private-token'''
        self.assertEqual(context_functions(text),[
          {'function':'sa_domain.consume_stock','line':19},{'function':'v1_dispatch_record'},
          {'function':'sa_domain.outer_call','line':3}])

    def test_sequence_restart_rollback_preserves_called_and_uncalled_state(self):
        with connect() as c:
            before=sequence_states(c)
            for called in [False,True]:
                with c.transaction():
                    c.execute('ALTER SEQUENCE sa_domain.audit_id_seq RESTART WITH 917')
                    if called:c.execute("SELECT nextval('sa_domain.audit_id_seq')")
                    expected=sequence_states(c)
                    self.assertEqual(expected['sa_domain.audit_id_seq'],(917,called))
                    with c.transaction():
                        self.assertEqual(fence_sequences(c),expected)
                        for name in expected:c.execute('SELECT nextval(%s::regclass)',(name,))
                        raise psycopg.Rollback()
                    self.assertEqual(sequence_states(c),expected)
                    raise psycopg.Rollback()
            self.assertEqual(sequence_states(c),before)

    def test_fence_blocks_concurrent_nextval_without_consuming_a_value(self):
        with connect() as c:
            before=sequence_states(c)
            with c.transaction():
                fence_sequences(c)
                with connect() as other:
                    with self.assertRaises(psycopg.errors.QueryCanceled):
                        with other.transaction():
                            other.execute("SET LOCAL statement_timeout='100ms'")
                            other.execute("SELECT nextval('sa_domain.audit_id_seq')")
                raise psycopg.Rollback()
            self.assertEqual(sequence_states(c),before)

    def test_disconnect_restores_sequences_without_recovery_setval(self):
        with connect() as reader:before=sequence_states(reader)
        writer=connect()
        try:
            writer.execute('BEGIN');fence_sequences(writer)
            for name in before:writer.execute('SELECT nextval(%s::regclass)',(name,))
        finally:writer.close()
        with connect() as reader:self.assertEqual(sequence_states(reader),before)

    def test_full_shared_sdk_profile_is_rollback_only_and_labels_final_fifo(self):
        with connect() as c:
            before=sequence_states(c)
            runtime=c.execute('SELECT to_jsonb(r) FROM sa_domain.runtime_state r').fetchone()[0]
            with c.transaction():
                fence_sequences(c);fixture=prepare_local(c)
                result=sdk_profile(c,fixture)
                self.assertTrue(result['completed'],result)
                self.assertEqual(result['groups'],{'commercial':8,'factory':3,'collaboration':7})
                self.assertGreater(len(result['samples']),100)
                fifo=[s for s in result['samples'] if s['command_label']=='collaboration.dealer-backorder-7']
                self.assertEqual(len(fifo),1)
                self.assertEqual(fifo[0]['rpc'],'v1_dispatch_record')
                self.assertIsNone(fifo[0]['sqlstate'])
                self.assertGreaterEqual(fifo[0]['sql_ms'],0)
                self.assertNotIn('args',str(result['samples']))
                raise psycopg.Rollback()
            self.assertEqual(sequence_states(c),before)
            self.assertEqual(c.execute('SELECT to_jsonb(r) FROM sa_domain.runtime_state r').fetchone()[0],runtime)

    def test_runner_exception_still_verifies_postrollback_baselines(self):
        # Existing local synthetic tests retain their own allowlist; only this
        # test's read-only preflight is replaced, never the hosted entrypoint.
        def local_preflight(c):
            self.assertEqual(c.info.host,'127.0.0.1')
            return c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()
        with connect() as c:before=sequence_states(c)
        with mock.patch.object(profiler,'preflight',side_effect=local_preflight), \
             mock.patch.object(profiler,'sdk_profile',side_effect=RuntimeError('Injected test failure')), \
             mock.patch.object(profiler,'source_state',wraps=profiler.source_state) as source, \
             mock.patch.object(profiler,'public_structure',wraps=profiler.public_structure) as public, \
             mock.patch.object(profiler,'staff_auth',wraps=profiler.staff_auth) as staff, \
             mock.patch.object(profiler,'cron_state',wraps=profiler.cron_state) as cron:
            with self.assertRaisesRegex(RuntimeError,'Injected test failure'):profiler.run(local=True)
            for check in [source,public,staff,cron]:self.assertEqual(check.call_count,2)
        with connect() as c:self.assertEqual(sequence_states(c),before)


if __name__=='__main__':unittest.main(verbosity=2)
