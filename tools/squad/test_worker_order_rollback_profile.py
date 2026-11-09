"""Actual local command graph and interruption rollback, never hosted."""
import unittest
import json
import test_business_harness as business_tests
from profile_worker_order_rollback import run_probe, guards, component_queries


class WorkerRollbackProfile(unittest.TestCase):
    # Reuse only the fixture lifecycle, not the inherited broad harness suite.
    setUpClass = classmethod(business_tests.BusinessHarness.setUpClass.__func__)
    setUp = business_tests.BusinessHarness.setUp
    tearDown = business_tests.BusinessHarness.tearDown
    def test_exact_commercial_components_and_rollback(self):
        before = guards(self.c)
        result = run_probe(self.c)
        self.assertTrue(result['rollback_verified'])
        self.assertTrue(result['all_components_completed'], result['samples'])
        self.assertEqual(len(result['samples']), 12)
        self.assertEqual({x['phase'] for x in result['samples']}, {'before_due', 'after_due'})
        self.assertEqual(guards(self.c), before)
        self.assertEqual(result['external_calls'], 0)

    def test_interruption_rolls_back_auth_source_and_settings(self):
        before = guards(self.c)
        with self.assertRaisesRegex(RuntimeError, 'Injected rollback interruption'):
            run_probe(self.c, inject_failure=True)
        self.assertEqual(guards(self.c), before)

    def test_setup_sql_failure_retains_sanitized_context_and_restores_graph(self):
        # This replacement exists only in this isolated test's outer rollback.
        self.c.execute("""CREATE OR REPLACE FUNCTION sa_domain.v1_order_get(
            p_id bigint,p_item_cursor text DEFAULT NULL,p_item_limit integer DEFAULT 50)
            RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog
            AS $f$BEGIN RAISE EXCEPTION 'private diagnostic marker must never escape'
            USING ERRCODE='57014';END$f$""")
        before = guards(self.c)
        report = run_probe(self.c)
        self.assertTrue(report['rollback_verified'])
        self.assertTrue(report['setup_failed'])
        self.assertFalse(report['all_components_completed'])
        failed = [x for x in report['setup_steps'] if x['outcome'] == 'failed']
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]['sqlstate'], '57014')
        self.assertTrue(failed[0]['context_functions'])
        self.assertNotIn('private diagnostic marker', json.dumps(report))
        self.assertEqual(guards(self.c), before)

    def test_temporary_login_role_retains_explicit_postgres_role(self):
        self.c.execute('CREATE ROLE squad_probe_temporary_login NOLOGIN')
        # Model the hosted CLI's already-authorized role transitions. These
        # memberships and the fake login exist only in the outer local rollback.
        self.c.execute('GRANT postgres,sa_app,sa_executor,sa_guard TO squad_probe_temporary_login')
        try:
            self.c.execute('SET SESSION AUTHORIZATION squad_probe_temporary_login')
            self.c.execute('SET ROLE postgres')
            self.assertEqual(self.c.execute('SELECT session_user,current_user').fetchone(),
                             ('squad_probe_temporary_login', 'postgres'))
            result = run_probe(self.c)
            self.assertTrue(result['all_components_completed'], result)
            self.assertTrue(result['rollback_verified'])
            self.assertEqual(len(result['samples']), 12)
        finally:
            self.c.execute('RESET SESSION AUTHORIZATION')
            self.c.execute('SET ROLE postgres')

    def test_scope_plan_comparison_uses_parameter_and_deallocates(self):
        before = guards(self.c)
        report = run_probe(self.c, compare_scope=True)
        self.assertTrue(report['all_components_completed'], report)
        self.assertEqual(len(report['samples']), 6)
        self.assertEqual({x['plan_cache_mode'] for x in report['samples']},
                         {'force_custom_plan', 'force_generic_plan'})
        self.assertEqual({x['component'] for x in report['samples']},
                         {'outer_order', 'scope_order_ids', 'worker_scope_branch'})
        self.assertEqual([x['role'] for x in report['samples'] if x['component']=='worker_scope_branch'],
                         ['sa_guard', 'sa_guard'])
        self.assertEqual(self.c.execute("SELECT count(*) FROM pg_prepared_statements WHERE name LIKE 'squad_worker_scope_%'").fetchone(), (0,))
        self.assertEqual(guards(self.c), before)


class QueryShape(unittest.TestCase):
    def test_unknown_definition_refused(self):
        with self.assertRaises(AssertionError):
            component_queries('SELECT 1', 1, 0)


if __name__ == '__main__':
    unittest.main()
