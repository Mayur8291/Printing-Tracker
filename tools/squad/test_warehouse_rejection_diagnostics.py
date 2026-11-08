"""Numeric provider diagnostics do not relax durable attempt/uncertainty rules."""
import copy
import unittest
import uuid

import test_warehouse_rehearsal as fixture
import test_warehouse_customers as ordinary


class WarehouseRejectionDiagnostics(unittest.TestCase):
    setUpClass = classmethod(lambda cls: fixture.WarehouseRehearsal.setUpClass.__func__(cls))
    setUp = fixture.WarehouseRehearsal.setUp
    tearDown = fixture.WarehouseRehearsal.tearDown
    raw = fixture.WarehouseRehearsal.raw
    worker = fixture.WarehouseRehearsal.worker
    rejects = fixture.WarehouseRehearsal.rejects
    register = fixture.WarehouseRehearsal.register
    prepare = fixture.WarehouseRehearsal.prepare
    finish = fixture.WarehouseRehearsal.finish
    receipt = fixture.WarehouseRehearsal.receipt
    done = fixture.WarehouseRehearsal.done
    through = fixture.WarehouseRehearsal.through
    ready_again = fixture.WarehouseRehearsal.ready_again

    def result(self, status=200, codes=None):
        return {'code': 'REJECTED', 'error_code': 'PROVIDER_REJECTED',
                'proof': {'source': 'provider_rejection', 'http_status': status,
                          'error_codes': [10025] if codes is None else codes}}

    def customer(self):
        self.done('preflight')
        return self.prepare('customer')

    def test_numeric_receipt_is_retained_without_claiming_absence_or_allowing_replay(self):
        grant = self.customer()
        receipt = self.result()
        reply = self.finish('customer', grant, receipt)
        self.assertEqual(reply['state'], 'blocked')
        self.assertEqual(reply['error_code'], 'PROVIDER_REJECTED')
        self.assertNotIn('proof', reply)
        stored = self.raw("SELECT attempted,completed,state,result FROM sa_domain.warehouse_rehearsal_steps WHERE run_id=%s AND step='customer'", (self.run_id,))[0]
        self.assertEqual(stored, (True, False, 'blocked', receipt))
        self.assertEqual(self.prepare('customer')['state'], 'blocked')
        with self.rejects('55000'):
            self.prepare('submit')
        with self.rejects('55000'):
            self.prepare('customer_disable')
        self.assertEqual(self.finish('customer', grant, receipt), reply)
        with self.rejects('PT409'):
            self.finish('customer', grant, self.result(codes=[10026]))

    def test_empty_and_ten_bounded_unique_codes_are_accepted(self):
        for codes in [[], [0], list(range(999990, 1000000))]:
            with self.c.transaction(force_rollback=True):
                grant = self.customer()
                self.assertEqual(self.finish('customer', grant, self.result(599, codes))['state'], 'blocked')

    def test_http_status_is_exact_bounded_integer(self):
        grant = self.customer()
        for status in [None, True, '200', 99, 600, 200.5, 200.0]:
            with self.subTest(status=status), self.rejects('22023'):
                self.finish('customer', grant, self.result(status))
        self.assertEqual(self.finish('customer', grant, self.result(100))['state'], 'blocked')

    def test_error_codes_are_bounded_unique_nonnegative_integers(self):
        grant = self.customer()
        for codes in [None, {}, '10025', list(range(11)), [1, 1], [-1], [1000000], [1.5], [1.0], ['1'], [True], [None]]:
            result = self.result()
            result['proof']['error_codes'] = codes
            with self.subTest(codes=codes), self.rejects('22023'):
                self.finish('customer', grant, result)

    def test_no_raw_text_fields_or_negative_attempt_proof_are_permitted(self):
        grant = self.customer()
        for key, value in [('message', 'sensitive provider text'), ('field_names', ['customer.email']), ('mutation_attempted', False), ('payload', {'email': 'someone@example.com'})]:
            result = self.result()
            result['proof'][key] = value
            with self.subTest(key=key), self.rejects('22023'):
                self.finish('customer', grant, result)

    def test_only_rejected_provider_rejected_can_carry_diagnostic_proof(self):
        grant = self.customer()
        for code, error in [('RETRY', 'PROVIDER_REJECTED'), ('RECONCILIATION_REQUIRED', 'PROVIDER_REJECTED'), ('REJECTED', 'PROVIDER_TIMEOUT')]:
            result = self.result()
            result.update(code=code, error_code=error)
            with self.subTest(code=code, error=error), self.rejects('22023'):
                self.finish('customer', grant, result)

    def test_rejected_order_can_only_recover_through_exact_cleanup(self):
        self.through('customer')
        grant = self.prepare('submit')
        self.assertEqual(self.finish('submit', grant, self.result(409, [40001]))['state'], 'blocked')
        self.assertEqual(self.prepare('submit')['state'], 'blocked')
        with self.rejects('55000'):
            self.prepare('customer_disable')
        cleanup = self.prepare('cleanup_initial')
        self.assertIn('submit', cleanup['attempted_steps'])
        self.assertEqual(self.finish('cleanup_initial', cleanup)['state'], 'done')
        self.done('customer_disable')

    def test_original_negative_proof_still_only_clears_first_retry(self):
        grant = self.customer()
        self.finish('customer', grant, {'code': 'RETRY', 'error_code': 'PROVIDER_UNAVAILABLE', 'proof': {'mutation_attempted': False}})
        self.ready_again('customer')
        grant = self.prepare('customer')
        self.assertFalse(grant['attempted'])
        self.assertEqual(self.finish('customer', grant, self.result())['state'], 'blocked')
        self.assertEqual(self.raw("SELECT attempted FROM sa_domain.warehouse_rehearsal_steps WHERE run_id=%s AND step='customer'", (self.run_id,)), [(True,)])


class OrdinaryWarehouseDiagnosticCompatibility(unittest.TestCase):
    setUpClass = classmethod(lambda cls: ordinary.WarehouseCustomers.setUpClass.__func__(cls))
    setUp = ordinary.WarehouseCustomers.setUp
    tearDown = ordinary.WarehouseCustomers.tearDown
    actor = ordinary.WarehouseCustomers.actor
    service = ordinary.WarehouseCustomers.service
    raw = ordinary.WarehouseCustomers.raw
    event = ordinary.WarehouseCustomers.event
    claim = ordinary.WarehouseCustomers.claim
    prepare = ordinary.WarehouseCustomers.prepare
    finish = ordinary.WarehouseCustomers.finish
    ack = ordinary.WarehouseCustomers.ack

    def test_ordinary_rejected_customer_settles_dead_with_numeric_receipt(self):
        self.event()
        job = self.claim()[0]
        self.prepare(job)
        proof = {'source': 'provider_rejection', 'http_status': 200, 'error_codes': [10025]}
        result = self.finish(job, {'code': 'REJECTED', 'error_code': 'PROVIDER_REJECTED', 'proof': proof})
        self.assertEqual(result['state'], 'dead')
        self.assertEqual(self.raw('SELECT state,attempted,proof FROM sa_domain.warehouse_operations'), [('rejected', True, proof)])
        self.assertEqual(self.raw('SELECT uc_customer_id FROM sa_snapshot_20261019.sa_users WHERE id=103'), [(None,)])
        self.assertEqual(self.claim(), [])

    def test_ordinary_confirmed_enabled_customer_proof_is_accepted(self):
        self.event()
        job = self.claim()[0]
        grant = self.prepare(job)
        receipt = self.ack(grant)
        receipt['proof']['enabled'] = True
        self.assertEqual(self.finish(job, receipt)['state'], 'done')
        self.assertEqual(self.raw('SELECT proof FROM sa_domain.warehouse_operations'), [(receipt['proof'],)])
        self.assertEqual(self.raw('SELECT uc_customer_id FROM sa_snapshot_20261019.sa_users WHERE id=103'), [('S-103',)])

    def test_ordinary_confirmed_disabled_customer_proof_is_accepted(self):
        self.raw("UPDATE sa_snapshot_20261019.sa_users SET disabled=true,uc_customer_id='S-103' WHERE id=103")
        self.event(actor=100, event='account.status_changed')
        job = self.claim()[0]
        grant = self.prepare(job)
        self.assertEqual(grant['customer_action'], 'edit')
        self.assertFalse(grant['payload']['customer']['enabled'])
        receipt = self.ack(grant)
        receipt['proof']['enabled'] = False
        self.assertEqual(self.finish(job, receipt)['state'], 'done')
        self.assertEqual(self.raw('SELECT proof FROM sa_domain.warehouse_operations'), [(receipt['proof'],)])


if __name__ == '__main__':
    unittest.main(verbosity=2)
