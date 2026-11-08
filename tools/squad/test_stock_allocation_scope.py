"""Receipt allocation authorization stays exact and bounded by referenced IDs."""
import unittest

import psycopg

import test_stock_execution as fixture


class StockAllocationScope(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture.StockExecution.setUpClass()

    def setUp(self):
        self.f = fixture.StockExecution(methodName='runTest')
        self.f.setUp()
        self.f.supply()

    def tearDown(self):
        self.f.tearDown()

    def foreign_dispatch(self):
        f = self.f
        date = f.raw('INSERT INTO sa_snapshot_20261019.sa_job_sheet_dispatched_dates(item_id,dispatched_at,created_at,updated_at) VALUES(2001,now(),now(),now()) RETURNING id')[0][0]
        return f.raw('INSERT INTO sa_snapshot_20261019.sa_dispatched_quantities(job_sheet_dispatched_date_id,quantity_id,dispatched_quantity,qty,created_at,updated_at) SELECT %s,id,1,1,now(),now() FROM sa_snapshot_20261019.sa_quantities WHERE item_id=2001 RETURNING id', (date,))[0][0]

    def insert(self, stock_id, dispatch_id):
        self.f.c.execute('SET LOCAL ROLE sa_executor')
        self.f.c.execute('INSERT INTO sa_snapshot_20261019.sa_stock_useds(stock_id,dispatched_quantity_id,qty,created_at,updated_at) VALUES(%s,%s,1,now(),now())', (stock_id, dispatch_id))

    def test_owned_receipt_cannot_reference_foreign_dispatch(self):
        f = self.f
        stock = f.raw('SELECT id FROM sa_snapshot_20261019.sa_stocks WHERE item_id=1001')[0][0]
        foreign = self.foreign_dispatch()
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            with f.c.transaction():
                self.insert(stock, foreign)
        self.assertEqual(f.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_stock_useds'), [(0,)])

    def test_foreign_receipt_cannot_reference_owned_dispatch(self):
        f = self.f
        f.dispatch(1)
        dispatch = f.raw('SELECT id FROM sa_snapshot_20261019.sa_dispatched_quantities WHERE quantity_id=%s', (f.q,))[0][0]
        foreign = f.raw('INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,created_at,updated_at) VALUES(210,2001,2001,1,0,10,now(),now()) RETURNING id')[0][0]
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            with f.c.transaction():
                self.insert(foreign, dispatch)
        self.assertEqual(f.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_stock_useds WHERE stock_id=%s', (foreign,)), [(0,)])

    def test_private_executor_reads_only_visible_receipt_allocations(self):
        f = self.f
        own = f.dispatch(1)['stock_allocations'][0]['id']
        dispatch = self.foreign_dispatch()
        foreign = f.raw('INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,created_at,updated_at) VALUES(210,2001,2001,1,0,10,now(),now()) RETURNING id')[0][0]
        f.raw('INSERT INTO sa_snapshot_20261019.sa_stock_useds(stock_id,dispatched_quantity_id,qty,created_at,updated_at) VALUES(%s,%s,1,now(),now())', (foreign, dispatch))
        f.c.execute('SET LOCAL ROLE sa_executor')
        self.assertEqual(f.c.execute('SELECT id::text FROM sa_snapshot_20261019.sa_stock_useds ORDER BY id').fetchall(), [(own,)])

    def test_fifo_authorization_does_not_visit_unrelated_dispatch_history(self):
        f = self.f
        # Test-only counter instrumentation preserves the guard's actual result.
        f.c.execute('RESET ROLE')
        definition = f.c.execute("SELECT pg_get_functiondef('sa_domain.work_parent_visible(text,bigint)'::regprocedure)").fetchone()[0]
        instrumented = definition.replace('BEGIN\n', "BEGIN\n PERFORM set_config('squad.test_stock_scope_checks',(coalesce(nullif(current_setting('squad.test_stock_scope_checks',true),''),'0')::integer+1)::text,true);\n", 1)
        assert instrumented != definition
        f.c.execute(instrumented)
        start = 1950000000
        self.assertFalse(f.c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_job_sheet_dispatched_dates WHERE id BETWEEN %s AND %s', (start, start+3051)).fetchone())
        f.c.execute('INSERT INTO sa_snapshot_20261019.sa_job_sheet_dispatched_dates(id,item_id,dispatched_at,created_at,updated_at) SELECT %s+n,2001,now(),now(),now() FROM generate_series(1,3051)n', (start,))
        f.c.execute('INSERT INTO sa_snapshot_20261019.sa_dispatched_quantities(id,job_sheet_dispatched_date_id,quantity_id,dispatched_quantity,qty,created_at,updated_at) SELECT %s+n,%s+n,q.id,1,1,now(),now() FROM generate_series(1,3051)n CROSS JOIN sa_snapshot_20261019.sa_quantities q WHERE q.item_id=2001', (start, start))
        f.c.execute('ANALYZE sa_snapshot_20261019.sa_dispatched_quantities')
        f.c.execute("SELECT set_config('squad.test_stock_scope_checks','0',true)")
        f.actor(110)
        result = f.dispatch(10)
        self.assertEqual([r['quantity'] for r in result['stock_allocations']], [3,7])
        self.assertTrue(result['progress']['order_completed'])
        checks = int(f.c.execute("SELECT current_setting('squad.test_stock_scope_checks')").fetchone()[0])
        self.assertLess(checks, 200, f'Allocation authorization visited unrelated history: {checks} checks')
        self.assertEqual(f.stock()[0]['available'], 0)


if __name__ == '__main__':
    unittest.main()
