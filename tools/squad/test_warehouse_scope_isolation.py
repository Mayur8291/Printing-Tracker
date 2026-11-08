"""Independent inventory polling, exact overlap constraints and concurrent admission.

Only the concurrency class commits synthetic local fixtures. It captures and
restores all affected baseline rows; no source order or provider is changed.
"""
import concurrent.futures
import threading
import unittest
import uuid

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from fixtures import rpc, session, uid
from local_db import connect
from test_catalogue import seed_catalogue
from test_warehouse_receipts import ownership


def service(c):
    c.execute('RESET ROLE')
    c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
    c.execute('SET LOCAL ROLE service_role')


class ScopeIsolation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as c:
            seed_catalogue(c)

    def setUp(self):
        self.c = connect()
        self.c.execute('BEGIN')
        ownership(self.c)
        self.actor()

    def tearDown(self):
        self.c.execute('ROLLBACK')
        self.c.close()

    def actor(self, user=100):
        self.c.execute('RESET ROLE')
        session(self.c, user, 'authenticated' if user == 999 else 'sa_app')

    def raw(self, query, args=()):
        self.c.execute('RESET ROLE')
        result = self.c.execute(query, args)
        rows = result.fetchall() if result.description else None
        self.actor()
        return rows

    def manual(self, scope, user=100, key=None):
        self.actor(user)
        return rpc(self.c, 'v1_integration_reconcile', ('dashboard', scope, None, key or uuid.uuid4()))

    def configure(self):
        self.actor()
        return rpc(self.c, 'v1_warehouse_schedule_configure', (True, '0:0', uuid.uuid4()))

    def beat(self):
        service(self.c)
        return self.c.execute('SELECT canto_api.squad_warehouse_heartbeat()').fetchone()[0]

    def claim(self):
        service(self.c)
        jobs = self.c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0]['jobs']
        self.assertEqual(len(jobs), 1)
        self.assertEqual(jobs[0]['handler'], 'warehouse')
        return jobs[0]

    def prepare(self, job):
        service(self.c)
        return self.c.execute('SELECT canto_api.squad_warehouse_prepare(%s,%s)', (job['id'], job['lease_token'])).fetchone()[0]

    def finish(self, job, result):
        service(self.c)
        return self.c.execute('SELECT canto_api.squad_warehouse_finish(%s,%s,%s)', (job['id'], job['lease_token'], Jsonb(result))).fetchone()[0]

    def inventory_round(self):
        self.assertEqual(self.prepare(self.claim())['state'], 'done')
        for _ in range(2):
            job = self.claim()
            prepared = self.prepare(job)
            self.assertEqual(prepared['operation'], 'inventory')
            result = self.finish(job, {
                'code': 'CONFIRMED',
                'inventory': [{'sku_code': sku, 'known': True, 'available': 12} for sku in prepared['payload']['skus']],
                'proof': {'facility_code': prepared['facility_code']},
            })
            self.assertEqual(result['state'], 'done')

    def test_nonoverlapping_manual_scopes_are_independent_across_actors(self):
        orders = self.manual('orders', 100)
        inventory = self.manual('inventory', 999)
        self.assertNotEqual(orders['id'], inventory['id'])
        self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_reconciliations'), [(2,)])

    def test_same_scope_cross_actor_conflict_is_visible_to_private_admission(self):
        self.manual('inventory', 100)
        with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState), self.c.transaction():
            self.manual('inventory', 999)

    def test_all_blocks_both_individual_scopes_across_actors(self):
        self.manual('all', 999)
        for scope in ['orders', 'inventory', 'all']:
            with self.subTest(scope=scope), self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState), self.c.transaction():
                self.manual(scope)

    def test_either_individual_scope_blocks_manual_all(self):
        for scope in ['orders', 'inventory']:
            with self.subTest(scope=scope), self.c.transaction(force_rollback=True):
                self.manual(scope)
                with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState), self.c.transaction():
                    self.manual('all', 999)

    def test_same_command_replays_before_conflict_without_duplicate_audit(self):
        key = uuid.uuid4()
        first = self.manual('inventory', key=key)
        self.assertEqual(first, self.manual('inventory', key=key))
        self.assertEqual(self.raw("SELECT count(*) FROM sa_domain.audit WHERE operation='integration.reconcile'"), [(1,)])

    def test_private_helper_is_not_a_public_or_service_rpc(self):
        for role in ['sa_app', 'authenticated', 'service_role']:
            with self.subTest(role=role), self.assertRaises(psycopg.errors.InsufficientPrivilege), self.c.transaction():
                self.c.execute('RESET ROLE')
                self.c.execute(sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(role)))
                self.c.execute("SELECT sa_domain.warehouse_reconcile_blocker(0,'dashboard','inventory')")

    def test_database_indexes_enforce_every_overlap_even_without_admission(self):
        for left in ['orders', 'inventory', 'all']:
            for right in ['orders', 'inventory', 'all']:
                with self.subTest(left=left, right=right), self.c.transaction(force_rollback=True):
                    self.c.execute('RESET ROLE')
                    query = "INSERT INTO sa_domain.warehouse_reconciliations(actor_id,generation,provider,scope) VALUES(%s,0,'dashboard',%s)"
                    self.c.execute(query, (uid(100), left))
                    if left == right or 'all' in (left, right):
                        with self.assertRaises(psycopg.errors.UniqueViolation), self.c.transaction():
                            self.c.execute(query, (uid(999), right))
                    else:
                        self.c.execute(query, (uid(999), right))

    def test_database_constraints_are_generation_and_provider_specific(self):
        self.raw("INSERT INTO sa_domain.warehouse_reconciliations(actor_id,generation,provider,scope) VALUES(%s,0,'dashboard','all'),(%s,1,'dashboard','all'),(%s,0,'unicommerce','all')", (uid(100), uid(100), uid(100)))
        self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_reconciliations'), [(3,)])

    def test_terminal_run_releases_both_resources(self):
        first = self.manual('all')
        self.raw("UPDATE sa_domain.warehouse_reconciliations SET state='failed' WHERE id=%s", (first['id'],))
        self.manual('orders')
        self.manual('inventory')

    def test_scheduler_falls_back_when_preferred_due_scope_is_busy(self):
        self.configure()
        self.manual('orders', 999)
        self.raw("UPDATE sa_domain.warehouse_schedule SET last_scope='inventory'")
        self.assertEqual(self.beat()['scope'], 'inventory')
        self.assertEqual(self.beat()['state'], 'busy')

    def test_manual_all_blocks_both_scheduled_scopes(self):
        self.configure()
        first = self.manual('all', 999)
        self.assertEqual(self.beat(), {'state': 'busy', 'id': first['id']})
        self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_scheduled_runs'), [(0,)])

    def test_scheduler_does_not_start_other_scope_before_its_deadline(self):
        self.configure()
        first = self.manual('inventory', 999)
        self.raw("UPDATE sa_domain.warehouse_schedule SET next_orders_at=now()+interval '1 hour'")
        self.assertEqual(self.beat(), {'state': 'busy', 'id': first['id']})

    def test_hour_long_order_retry_does_not_block_actual_inventory_refresh(self):
        self.raw("UPDATE sa_snapshot_20261019.sa_orders SET uc_order_id=NULL")
        self.raw("UPDATE sa_snapshot_20261019.sa_orders SET order_source='dashboard',uc_order_id='ord_1001',uc_status='PROCESSING' WHERE id=1001")
        self.raw('UPDATE sa_snapshot_20261019.sa_items SET item_type=1 WHERE order_id=1001')
        self.configure()
        self.assertEqual(self.beat()['scope'], 'inventory')
        self.inventory_round()
        order_run = self.beat()
        self.assertEqual(order_run['scope'], 'orders')
        self.prepare(self.claim())
        job = self.claim()
        self.assertEqual(self.prepare(job)['operation'], 'reconcile')
        self.assertEqual(self.finish(job, {'code': 'RETRY', 'error_code': 'PROVIDER_UNAVAILABLE', 'retry_after_seconds': 3600})['state'], 'pending')
        before = self.raw('SELECT available_at FROM sa_domain.outbox WHERE id=%s', (job['id'],))[0][0]
        self.raw("UPDATE sa_domain.warehouse_schedule SET next_inventory_at=now()-interval '1 minute'")
        self.raw("UPDATE sa_domain.warehouse_inventory SET as_of=now()-interval '6 minutes'")
        self.actor(103)
        self.assertEqual(rpc(self.c, 'v1_rmp_variants', (1,))['data'][0]['availability']['status'], 'stale')
        self.assertEqual(self.beat()['scope'], 'inventory')
        self.inventory_round()
        self.actor(103)
        self.assertEqual(rpc(self.c, 'v1_rmp_variants', (1,))['data'][0]['availability']['status'], 'ready')
        self.assertEqual(self.raw('SELECT status,available_at FROM sa_domain.outbox WHERE id=%s', (job['id'],)), [('pending', before)])
        self.assertEqual(self.raw('SELECT state FROM sa_domain.warehouse_reconciliations WHERE id=%s', (order_run['id'],)), [('running',)])


class ConcurrentScopeAdmission(unittest.TestCase):
    """Commit only invented local setup; restore the exact captured baseline."""
    @classmethod
    def setUpClass(cls):
        with connect() as c:
            seed_catalogue(c)

    def setUp(self):
        self.baseline = {}
        self.mutable = ['sa_sync.environment_state', 'sa_domain.warehouse_config', 'sa_domain.warehouse_schedule', 'sa_domain.entity_versions']
        self.appended = {
            'sa_domain.warehouse_scheduled_runs': 'reconciliation_id',
            'sa_domain.warehouse_reconciliations': 'id',
            'sa_domain.outbox': 'id',
            'sa_domain.commands': 'key',
            'sa_domain.audit': 'id',
            'sa_domain.cutover_commits': 'id',
            'sa_domain.cutover_acceptances': 'id',
            'sa_snapshot_20261019.sa_settings': 'id',
        }
        with connect() as c:
            for table in self.mutable:
                result = c.execute(sql.SQL('SELECT * FROM {}').format(sql.Identifier(*table.split('.'))))
                self.baseline[table] = ([col.name for col in result.description], result.fetchall())
            for table, key in self.appended.items():
                self.baseline[table] = [row[0] for row in c.execute(sql.SQL('SELECT {} FROM {}').format(sql.Identifier(key), sql.Identifier(*table.split('.'))))]
            with c.transaction():
                ownership(c)
                session(c, 100)
                rpc(c, 'v1_warehouse_schedule_configure', (True, '0:0', uuid.uuid4()))

    def tearDown(self):
        with connect() as c, c.transaction():
            for table, key in self.appended.items():
                c.execute(sql.SQL('DELETE FROM {} WHERE NOT({}=ANY(%s))').format(sql.Identifier(*table.split('.')), sql.Identifier(key)), (self.baseline[table],))
            for table in self.mutable:
                columns, rows = self.baseline[table]
                c.execute(sql.SQL('DELETE FROM {}').format(sql.Identifier(*table.split('.'))))
                for row in rows:
                    c.execute(sql.SQL('INSERT INTO {}({}) VALUES({})').format(sql.Identifier(*table.split('.')), sql.SQL(',').join(map(sql.Identifier, columns)), sql.SQL(',').join(sql.Placeholder() for _ in columns)), tuple(Jsonb(v) if isinstance(v, dict) else v for v in row))
            for table, key in self.appended.items():
                current = [row[0] for row in c.execute(sql.SQL('SELECT {} FROM {}').format(sql.Identifier(key), sql.Identifier(*table.split('.'))))]
                self.assertCountEqual(current, self.baseline[table], table)
            for table in self.mutable:
                self.assertCountEqual(c.execute(sql.SQL('SELECT * FROM {}').format(sql.Identifier(*table.split('.')))).fetchall(), self.baseline[table][1], table)

    def race(self, calls):
        barrier = threading.Barrier(len(calls))
        def invoke(call):
            with connect() as c:
                try:
                    with c.transaction():
                        c.execute("SET LOCAL statement_timeout='5s'")
                        if call == 'heartbeat':
                            service(c)
                        else:
                            session(c, 100 if call[1] == 100 else 999, 'sa_app' if call[1] == 100 else 'authenticated')
                        barrier.wait(timeout=5)
                        if call == 'heartbeat':
                            result = c.execute('SELECT canto_api.squad_warehouse_heartbeat()').fetchone()[0]
                        else:
                            result = rpc(c, 'v1_integration_reconcile', ('dashboard', call[0], None, uuid.uuid4()))
                        return ('ok', result)
                except psycopg.Error as error:
                    return ('error', error.sqlstate)
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(calls)) as pool:
            return list(pool.map(invoke, calls))

    def active(self):
        with connect() as c:
            return c.execute("SELECT scope FROM sa_domain.warehouse_reconciliations WHERE state IN('queued','running') ORDER BY scope").fetchall()

    def test_manual_manual_same_scope_has_one_success_and_explicit_conflict(self):
        result = self.race([('orders', 100), ('orders', 999)])
        self.assertEqual(sum(x[0] == 'ok' for x in result), 1)
        self.assertIn(('error', '55000'), result)
        self.assertEqual(self.active(), [('orders',)])

    def test_manual_manual_distinct_scopes_both_commit(self):
        result = self.race([('orders', 100), ('inventory', 999)])
        self.assertTrue(all(x[0] == 'ok' for x in result), result)
        self.assertEqual(self.active(), [('inventory',), ('orders',)])

    def test_manual_all_and_orders_cannot_overlap_under_race(self):
        result = self.race([('all', 999), ('orders', 100)])
        self.assertEqual(sum(x[0] == 'ok' for x in result), 1)
        self.assertIn(('error', '55000'), result)
        self.assertEqual(len(self.active()), 1)

    def test_manual_all_and_heartbeat_cannot_overlap_under_race(self):
        result = self.race([('all', 999), 'heartbeat'])
        self.assertFalse(any(x == ('error', '40P01') for x in result), result)
        self.assertEqual(len(self.active()), 1)
        self.assertTrue(all(x[0] == 'ok' or x == ('error', '55000') for x in result), result)

    def test_manual_inventory_and_heartbeat_do_not_duplicate_inventory(self):
        result = self.race([('inventory', 999), 'heartbeat'])
        self.assertTrue(all(x[0] == 'ok' or x == ('error', '55000') for x in result), result)
        active = self.active()
        self.assertEqual(active.count(('inventory',)), 1)
        self.assertLessEqual(active.count(('orders',)), 1)

    def test_two_heartbeats_admit_each_due_scope_at_most_once(self):
        result = self.race(['heartbeat', 'heartbeat'])
        self.assertTrue(all(x[0] == 'ok' for x in result), result)
        # If one tick observed the other's schedule/provider lock it returns
        # busy. A subsequent tick can admit the other independent due scope.
        with connect() as c, c.transaction():
            service(c)
            c.execute('SELECT canto_api.squad_warehouse_heartbeat()')
        self.assertEqual(self.active(), [('inventory',), ('orders',)])


if __name__ == '__main__':
    unittest.main()
