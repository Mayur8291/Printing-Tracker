"""PROD-03: competing real RPCs share one finite cutting balance.

Local synthetic database only. Each test creates its own work item, commits
concurrent commands, then removes exactly its fixture rows and command keys.
No product, receipt, Auth identity or provider call is created.
"""
import concurrent.futures
import threading
import unittest
import uuid

import psycopg
from psycopg.types.json import Jsonb

from fixtures import rpc, seed_orders, session
from local_db import connect


class JobsheetConcurrency(unittest.TestCase):
    def setUp(self):
        self.item = 9100301
        self.keys = []
        with connect() as c:
            seed_orders(c)
            self.environment = c.execute(
                'SELECT edit_revision,synced_revision,updated_at FROM sa_sync.environment_state'
            ).fetchone()
            self.allow_writes = c.execute(
                'SELECT allow_test_writes FROM sa_domain.runtime_state'
            ).fetchone()[0]
            self.assertIsNone(c.execute(
                'SELECT id FROM sa_snapshot_20261019.sa_orders WHERE id=%s', (self.item,)
            ).fetchone())
            with c.transaction():
                c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
                c.execute("""INSERT INTO sa_snapshot_20261019.sa_orders
                    (id,customer_id,address_id,assigned_to_id,customer_sc_id,
                     order_item_type,status,total_quantity,created_at,updated_at)
                    VALUES(%s,103,100,104,101,1,0,10,now(),now())""", (self.item,))
                c.execute("""INSERT INTO sa_snapshot_20261019.sa_items
                    (id,order_id,cutting_master_id,total_quantity,created_at,updated_at)
                    VALUES(%s,%s,109,10,now(),now())""", (self.item, self.item))
                self.quantity = c.execute("""INSERT INTO sa_snapshot_20261019.sa_quantities
                    (item_id,size_id,quantity,created_at,updated_at)
                    VALUES(%s,1,10,now(),now()) RETURNING id""", (self.item,)).fetchone()[0]
        self.addCleanup(self.clean_fixture)
        with connect() as c, c.transaction():
            version = c.execute("SELECT sa_domain.version('item',%s)", (self.item,)).fetchone()[0]
            session(c, 109)
            rpc(c, 'v1_cutting_record', (
                self.item, Jsonb([{'quantity_id': str(self.quantity), 'quantity': 10}]),
                None, version, self.new_key(),
            ))

    def new_key(self):
        key = uuid.uuid4()
        self.keys.append(key)
        return key

    def version(self):
        with connect() as c:
            return c.execute("SELECT sa_domain.version('item',%s)", (self.item,)).fetchone()[0]

    def args(self, quantity, tailor, key, version):
        return (self.item, Jsonb([{'quantity_id': str(self.quantity),
                 'tailor_id': str(tailor), 'quantity': quantity}]),
                '2026-12-10T00:00:00Z', '2026-12-09T00:00:00Z', version, key)

    def invoke(self, args, barrier=None):
        try:
            with connect() as c, c.transaction():
                session(c, 104)
                c.execute("SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='10s'")
                if barrier is not None:
                    barrier.wait(timeout=10)
                return {'result': rpc(c, 'v1_jobsheet_assign', args), 'sqlstate': None}
        except psycopg.Error as error:
            return {'result': None, 'sqlstate': error.sqlstate}

    def race(self, args):
        barrier = threading.Barrier(len(args))
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(args)) as pool:
            return list(pool.map(lambda a: self.invoke(a, barrier), args))

    def assert_balance(self, allocated, history_count):
        with connect() as c:
            self.assertEqual(c.execute("""SELECT quantity,cutting_done,
                assigned_to_tailor_quantity,completed_by_tailor_quantity,dispatched_quantity
                FROM sa_snapshot_20261019.sa_quantities WHERE id=%s""",
                (self.quantity,)).fetchone(), (10, 10, allocated, 0, 0))
            self.assertEqual(c.execute("""SELECT count(*),coalesce(sum(assigned_quantity),0),
                coalesce(sum(completed_quantity),0) FROM sa_snapshot_20261019.sa_job_sheet_assign_quantities
                WHERE item_id=%s""", (self.item,)).fetchone(), (history_count, allocated, 0))

    def test_same_key_allocates_once_and_preserves_one_history_and_event(self):
        key = self.new_key()
        args = self.args(6, 105, key, self.version())
        results = self.race([args, args, args])
        self.assertTrue(all(r['sqlstate'] is None for r in results), results)
        self.assertTrue(all(r['result'] == results[0]['result'] for r in results))
        self.assert_balance(6, 1)
        with connect() as c:
            for table, column in [('commands', 'key'), ('audit', 'command_key'), ('outbox', 'command_key')]:
                self.assertEqual(c.execute(
                    f'SELECT count(*) FROM sa_domain.{table} WHERE {column}=%s', (key,)
                ).fetchone()[0], 1)

    def test_distinct_tailors_compete_then_reload_respects_remaining_capacity(self):
        version = self.version()
        keys = [self.new_key(), self.new_key()]
        requests = [self.args(6, tailor, key, version) for tailor, key in zip([105, 106], keys)]
        results = self.race(requests)
        self.assertCountEqual([r['sqlstate'] for r in results], [None, '40001'])
        self.assert_balance(6, 1)
        loser = next(i for i, result in enumerate(results) if result['sqlstate'])
        # The failed transaction did not consume its command key or capacity.
        self.assertEqual(self.invoke(requests[loser])['sqlstate'], '40001')
        latest = self.version()
        too_large = self.args(6, [105, 106][loser], keys[loser], latest)
        self.assertEqual(self.invoke(too_large)['sqlstate'], '22023')
        self.assertEqual(self.version(), latest)
        self.assert_balance(6, 1)
        remaining = self.args(4, [105, 106][loser], keys[loser], latest)
        completed = self.invoke(remaining)
        self.assertIsNone(completed['sqlstate'])
        self.assertEqual(completed['result']['progress']['assigned'], 10)
        self.assertEqual(self.invoke(remaining), completed)
        self.assert_balance(10, 2)
        self.assertEqual(self.invoke(self.args(1, 105, self.new_key(), self.version()))['sqlstate'], '22023')
        self.assert_balance(10, 2)
        with connect() as c:
            actual = c.execute("""SELECT t.tailor_id,sum(q.assigned_quantity)
                FROM sa_snapshot_20261019.sa_job_sheet_assign_quantities q
                JOIN sa_snapshot_20261019.sa_item_tailors t ON t.id=q.item_tailor_id
                WHERE q.item_id=%s GROUP BY t.tailor_id ORDER BY t.tailor_id""", (self.item,)).fetchall()
            self.assertEqual(dict(actual), {105: 4 if loser == 0 else 6, 106: 4 if loser == 1 else 6})

    def clean_fixture(self):
        with connect() as c, c.transaction():
            for table in ['job_sheet_assign_quantities', 'job_sheet_assign_tailors', 'item_tailor_quantities']:
                c.execute(f'''DELETE FROM sa_snapshot_20261019.sa_{table}
                    WHERE item_tailor_id IN(SELECT id FROM sa_snapshot_20261019.sa_item_tailors WHERE item_id=%s)''',
                    (self.item,))
            for table in ['job_sheet_assign_dates', 'item_tailors', 'mark_cuttings']:
                if table == 'mark_cuttings':
                    c.execute('DELETE FROM sa_snapshot_20261019.sa_mark_cutting_quantities WHERE quantity_id=%s', (self.quantity,))
                c.execute(f'DELETE FROM sa_snapshot_20261019.sa_{table} WHERE item_id=%s', (self.item,))
            c.execute('DELETE FROM sa_snapshot_20261019.sa_quantities WHERE id=%s', (self.quantity,))
            c.execute('DELETE FROM sa_snapshot_20261019.sa_items WHERE id=%s', (self.item,))
            c.execute('DELETE FROM sa_snapshot_20261019.sa_orders WHERE id=%s', (self.item,))
            c.execute("DELETE FROM sa_domain.entity_versions WHERE kind IN('item','order') AND entity_id=%s", (self.item,))
            for table, column in [('outbox', 'command_key'), ('audit', 'command_key'), ('commands', 'key')]:
                c.execute(f'DELETE FROM sa_domain.{table} WHERE {column}=ANY(%s)', (self.keys,))
            c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=%s', (self.allow_writes,))
            c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s,updated_at=%s', self.environment)
            self.assertEqual(c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_item_tailors WHERE item_id=%s', (self.item,)).fetchone()[0], 0)
            self.assertEqual(c.execute('SELECT count(*) FROM sa_domain.commands WHERE key=ANY(%s)', (self.keys,)).fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
