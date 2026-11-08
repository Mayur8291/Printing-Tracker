"""Application HTTP conflicts versus PostgreSQL serialization retry signals.

The real engine test uses two committed connections. Import fault injection only
exercises exception propagation at dependency boundaries and is rolled back.
"""
import re
import unittest
import uuid

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from fixtures import rpc
from local_db import connect
import test_airtable as airtable_fixture
import test_order_lifecycle as order_fixture
import test_transfers_worker as csv_fixture


def inject_failure(c, signature, code='40001'):
    """Replace one dependency only inside this test's rollback transaction."""
    c.execute('RESET ROLE')
    definition = c.execute('SELECT pg_get_functiondef(%s::regprocedure)', (signature,)).fetchone()[0]
    parts = definition.split('$function$')
    assert len(parts) == 3
    assert code in ('40001', '40P01')
    c.execute(parts[0] + '$function$ BEGIN RAISE EXCEPTION \'Injected dependency failure\' USING ERRCODE=\'' + code + '\'; END $function$' + parts[2])


class ApplicationConflicts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        csv_fixture.TransferWorker.setUpClass()

    def test_active_catalogue_has_no_synthetic_engine_serialization_error(self):
        with connect() as c:
            rows = c.execute("""SELECT p.oid::regprocedure::text,p.prosrc
              FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname IN ('sa_domain','canto_api','sa_admin') AND p.prokind='f'""").fetchall()
        synthetic = [(name, line) for name, body in rows for line in body.splitlines()
                     if re.search(r"ERRCODE\s*=\s*'40001'|RAISE\s+(?:SQLSTATE\s+'40001'|serialization_failure)", line, re.I)]
        self.assertEqual(synthetic, [])
        self.assertGreater(sum("ERRCODE='PT409'" in body for _, body in rows), 60)

    def test_stale_due_request_returns_pt409_and_rolls_back_all_effects(self):
        f = order_fixture.Lifecycle(methodName='runTest')
        f.setUp()
        try:
            stale = f.version()
            changed = rpc(f.c, 'v1_order_due_save', (1001, '2026-12-01T07:00:00Z', 'First save', stale, uuid.uuid4()))
            before = f.raw('SELECT due_on FROM sa_snapshot_20261019.sa_orders WHERE id=1001')
            revision = f.raw('SELECT edit_revision FROM sa_sync.environment_state')
            key = uuid.uuid4()
            with self.assertRaises(psycopg.DatabaseError) as raised:
                with f.c.transaction():
                    rpc(f.c, 'v1_order_due_save', (1001, '2026-12-02T07:00:00Z', 'Stale save', stale, key))
            self.assertEqual(raised.exception.sqlstate, 'PT409')
            self.assertEqual(f.raw('SELECT due_on FROM sa_snapshot_20261019.sa_orders WHERE id=1001'), before)
            self.assertEqual(f.raw('SELECT edit_revision FROM sa_sync.environment_state'), revision)
            self.assertEqual(f.raw('SELECT count(*) FROM sa_domain.audit WHERE command_key=%s', (key,)), [(0,)])
            self.assertEqual(f.version(), changed['version'])
        finally:
            f.tearDown()

    def test_genuine_engine_serialization_failure_keeps_40001(self):
        # Actual MVCC conflict: no application RAISE or error-code shim involved.
        name = '_serialization_probe_' + uuid.uuid4().hex
        table = sql.Identifier('sa_domain', name)
        a, b = connect(), connect()
        try:
            a.execute(sql.SQL('CREATE TABLE {}(id integer PRIMARY KEY,value integer NOT NULL)').format(table))
            a.execute(sql.SQL('INSERT INTO {} VALUES(1,0)').format(table))
            a.execute('BEGIN ISOLATION LEVEL REPEATABLE READ')
            self.assertEqual(a.execute(sql.SQL('SELECT value FROM {} WHERE id=1').format(table)).fetchone(), (0,))
            b.execute(sql.SQL('UPDATE {} SET value=1 WHERE id=1').format(table))
            with self.assertRaises(psycopg.errors.SerializationFailure) as raised:
                a.execute(sql.SQL('UPDATE {} SET value=2 WHERE id=1').format(table))
            self.assertEqual(raised.exception.sqlstate, '40001')
            a.execute('ROLLBACK')
            self.assertEqual(a.execute(sql.SQL('SELECT value FROM {} WHERE id=1').format(table)).fetchone(), (1,))
        finally:
            a.execute('ROLLBACK')
            a.execute(sql.SQL('DROP TABLE IF EXISTS {}').format(table))
            a.close()
            b.close()


class ImportConflictPropagation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        csv_fixture.TransferWorker.setUpClass()

    def setUp(self):
        self.f = csv_fixture.TransferWorker(methodName='runTest')
        self.f.setUp()

    def tearDown(self):
        self.f.tearDown()

    def test_stale_worker_lease_is_pt409_without_settling_current_lease(self):
        f = self.f
        t = f.start()
        job = f.claim()
        wrong = {**job, 'lease_token': str(uuid.uuid4())}
        with self.assertRaises(psycopg.DatabaseError) as raised:
            with f.c.transaction():
                f.work(wrong, 'input')
        self.assertEqual(raised.exception.sqlstate, 'PT409')
        self.assertEqual(f.status(t)['state'], 'queued')
        self.assertEqual(f.work(job, 'input')['state'], 'ready')

    def test_csv_validation_does_not_turn_engine_failure_into_invalid_row(self):
        f = self.f
        t = f.start()
        job = f.claim()
        inject_failure(f.c, 'sa_domain.transfer_normalize(sa_domain.transfers,jsonb)')
        with self.assertRaises(psycopg.errors.SerializationFailure):
            with f.c.transaction():
                f.work(job, 'validate', {'byte_offset': 0, 'next_byte_offset': 100, 'headers': ['name'],
                    'rows': [{'row': 1, 'values': {'name': 'Retry row'}}], 'eof': True})
        self.assertEqual(f.status(t)['state'], 'queued')
        self.assertEqual(f.raw('SELECT count(*) FROM sa_domain.transfer_rows WHERE transfer_id=%s', (uuid.UUID(t['id']),)), [(0,)])

    def test_csv_apply_does_not_durably_fail_engine_serialization(self):
        f = self.f
        t = f.start()
        _, ready = f.validate(t, [{'name': 'Retry application'}])
        f.actor()
        f.c.execute('SELECT canto_api.v1_import_request(%s,%s,%s)', (ready['kind'], Jsonb({'id': ready['id'], 'action': 'apply', 'version': ready['version']}), uuid.uuid4()))
        job = f.claim()
        inject_failure(f.c, 'sa_admin.master_request(text,text,jsonb)')
        with self.assertRaises(psycopg.errors.SerializationFailure):
            with f.c.transaction():
                f.work(job, 'apply')
        self.assertEqual(f.status(t)['state'], 'applying')
        self.assertEqual(f.raw('SELECT state FROM sa_domain.transfer_rows WHERE transfer_id=%s', (uuid.UUID(t['id']),)), [('valid',)])
        self.assertEqual(f.raw('SELECT status FROM sa_domain.outbox WHERE id=%s', (uuid.UUID(job['id']),)), [('leased',)])

    def test_csv_optimistic_conflict_still_fails_safely_with_pt409(self):
        f = self.f
        t = f.start()
        _, ready = f.validate(t, [{'id': '1', 'name': 'Stale name'}])
        f.raw("UPDATE sa_snapshot_20261019.sa_base_product_types SET updated_at=now()+interval '1 second' WHERE id=1")
        result, status = f.apply(ready)
        self.assertEqual(result['state'], 'dead')
        self.assertEqual(result['error_code'], 'PT409')
        self.assertEqual(status['state'], 'failed')
        self.assertEqual(f.raw('SELECT name FROM sa_snapshot_20261019.sa_base_product_types WHERE id=1'), [('Shirts',)])


class AirtableConflictPropagation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        airtable_fixture.Airtable.setUpClass()

    def setUp(self):
        self.f = airtable_fixture.Airtable(methodName='runTest')
        self.f.setUp()

    def tearDown(self):
        self.f.tearDown()

    def test_airtable_validation_propagates_engine_serialization(self):
        f = self.f
        t = f.start()
        job = f.claim()
        f.capture(job, {'colors': [airtable_fixture.record('colors', 1, {'name': 'Retry color', 'hex_code': '#000000'})]})
        inject_failure(f.c, 'sa_domain.airtable_match_row(bigint)')
        with self.assertRaises(psycopg.errors.SerializationFailure):
            with f.c.transaction():
                f.work(job, 'validate')
        self.assertEqual(f.status(t)['state'], 'validating')
        self.assertEqual(f.raw('SELECT count(*) FROM sa_domain.airtable_rows WHERE transfer_id=%s AND state=\'invalid\'', (uuid.UUID(t['id']),)), [(0,)])

    def test_airtable_apply_propagates_engine_serialization(self):
        f = self.f
        t = f.start()
        ready = f.validate(t, {'colors': [airtable_fixture.record('colors', 1, {'name': 'Retry color', 'hex_code': '#000000'})]})
        f.actor()
        f.c.execute("SELECT canto_api.v1_import_request('airtable',%s,%s)", (Jsonb({'id': ready['id'], 'action': 'apply', 'version': ready['version']}), uuid.uuid4()))
        job = f.claim()
        inject_failure(f.c, 'sa_admin.master_request(text,text,jsonb)')
        with self.assertRaises(psycopg.errors.SerializationFailure):
            with f.c.transaction():
                f.work(job, 'apply')
        self.assertEqual(f.status(t)['state'], 'applying')
        self.assertEqual(f.raw('SELECT count(*) FROM sa_domain.airtable_rows WHERE transfer_id=%s AND state=\'failed\'', (uuid.UUID(t['id']),)), [(0,)])


if __name__ == '__main__':
    unittest.main()
