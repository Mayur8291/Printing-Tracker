"""Private provider acceptance runs use actual rollback SDK/builder captures.

No provider is contacted. Tests distinguish confirmed evidence, retryable reads,
uncertain writes, immutable reservations, and cleanup after ownership changes.
"""
import copy
import hashlib
import json
import time
import unittest
import uuid
from contextlib import contextmanager

import psycopg
from psycopg.types.json import Jsonb

from fixtures import session
from local_db import connect
from profile_hosted_business_journeys import fence_sequences, sequence_states
from test_catalogue import seed_catalogue
from warehouse_source_capture import capture


class WarehouseRehearsal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.run_id = uuid.uuid4()
        cls.email = f'squad-warehouse-{cls.run_id.hex[:16]}@mailinator.com'
        with connect() as c:
            seed_catalogue(c)
            before = sequence_states(c)
            with c.transaction(force_rollback=True):
                c.execute("UPDATE sa_sync.environment_state SET environment='staging',cutover=false,active_job=NULL")
                c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids=\'{}\',test_write_expires_at=NULL')
                fence_sequences(c)
                cls.capture, cls.evidence = capture(c, cls.run_id, 1950000100, 1960000100, 1, cls.email)
            assert sequence_states(c) == before, 'Source capture leaked a sequence change'
            assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id=1950000100').fetchone()
            assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_orders WHERE id=1960000100').fetchone()

    def setUp(self):
        self.c = connect()
        self.c.execute('BEGIN')
        self.c.execute("UPDATE sa_sync.environment_state SET environment='staging',cutover=false,active_job=NULL")
        self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids=\'{}\',test_write_expires_at=NULL')
        self.register()
        self.manifest = json.loads(self.raw('SELECT manifest_json FROM sa_domain.warehouse_rehearsals WHERE id=%s', (self.run_id,))[0][0])

    def tearDown(self):
        self.c.execute('ROLLBACK')
        self.c.close()

    def raw(self, query, args=()):
        self.c.execute('RESET ROLE')
        result = self.c.execute(query, args)
        return result.fetchall() if result.description else None

    def worker(self):
        self.c.execute('RESET ROLE')
        self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
        self.c.execute('SET LOCAL ROLE service_role')

    @contextmanager
    def rejects(self, code):
        with self.assertRaises(psycopg.DatabaseError) as caught:
            with self.c.transaction():
                yield
        self.assertEqual(caught.exception.sqlstate, code)

    def register(self, capture_=None, run_id=None):
        self.c.execute('RESET ROLE')
        return self.c.execute('SELECT sa_domain.warehouse_rehearsal_register(%s,%s,%s,%s)',
                              (run_id or self.run_id, 'scott-test', self.email, Jsonb(capture_ or self.capture))).fetchone()[0]

    def prepare(self, step, run_id=None):
        self.worker()
        return self.c.execute('SELECT canto_api.squad_warehouse_rehearsal_prepare(%s,%s)',
                              (run_id or self.run_id, step)).fetchone()[0]

    def finish(self, step, grant, result=None, run_id=None):
        self.worker()
        return self.c.execute('SELECT canto_api.squad_warehouse_rehearsal_finish(%s,%s,%s,%s)',
                              (run_id or self.run_id, step, uuid.UUID(grant['lease_token']), Jsonb(result or self.receipt(step)))).fetchone()[0]

    def receipt(self, step):
        if step == 'preflight':
            return {'code': 'CONFIRMED', 'proof': {'source': 'exact_codes_absent', 'codes': [self.manifest[k]['saleOrder']['code'] for k in ['initial', 'replacement']]}}
        if step in ['customer', 'customer_disable']:
            return {'code': 'CONFIRMED', 'customer_code': self.manifest['customer']['customer']['code'], 'proof': {'source': 'customer_write_response', 'enabled': step == 'customer'}}
        order = self.manifest['replacement' if step in ['replace', 'reconcile_replacement', 'cancel_replacement', 'cleanup_replacement'] else 'initial']['saleOrder']
        line = order['saleOrderItems'][0]
        cancel = step.startswith(('cancel_', 'cleanup_'))
        # The actual adapter canonicalizes amounts to decimal strings.
        item = {'code': line['code'], 'sku_code': line['itemSku'], 'facility_code': 'WH1',
                'total_price': str(line['totalPrice']), 'selling_price': str(line['sellingPrice']),
                'status': 'CANCELLED' if cancel else 'CREATED'}
        proof = {'source': 'saleorder_get', 'items': [item], 'updated_at': 1794110400000}
        if cancel:
            proof['cancelled_item_codes'] = [line['code']]
        return {'code': 'OBSERVED' if step.startswith('reconcile') else 'CONFIRMED',
                'external_id': order['code'], 'external_code': order['code'],
                'status': item['status'], 'proof': proof}

    def done(self, step):
        grant = self.prepare(step)
        self.assertEqual(grant['state'], 'prepared')
        reply = self.finish(step, grant)
        self.assertEqual(reply['state'], 'done')
        self.assertNotIn('error_code', reply, 'Success must match the exact Edge optional-string contract')
        return grant

    def through(self, step):
        steps = ['preflight', 'customer', 'submit', 'reconcile', 'cancel_initial', 'replace', 'reconcile_replacement', 'cancel_replacement']
        for current in steps[:steps.index(step) + 1]:
            self.done(current)

    def ready_again(self, step):
        self.raw('UPDATE sa_domain.warehouse_rehearsal_steps SET available_at=clock_timestamp()-interval \'1 second\' WHERE run_id=%s AND step=%s', (self.run_id, step))

    def expire_lease(self):
        self.raw('UPDATE sa_domain.warehouse_rehearsals SET lease_until=clock_timestamp()-interval \'1 second\' WHERE id=%s', (self.run_id,))

    def age_run(self, interval):
        # Only the trusted local test fixture bypasses immutable triggers, to
        # exercise the wall-clock deadline without sleeping for 24 hours.
        self.raw('ALTER TABLE sa_domain.warehouse_rehearsals DISABLE TRIGGER warehouse_rehearsal_immutable')
        self.raw('UPDATE sa_domain.warehouse_rehearsals SET created_at=created_at-%s::interval,forward_expires_at=forward_expires_at-%s::interval,cleanup_expires_at=cleanup_expires_at-%s::interval WHERE id=%s', (interval, interval, interval, self.run_id))
        self.raw('ALTER TABLE sa_domain.warehouse_rehearsals ENABLE TRIGGER warehouse_rehearsal_immutable')

    def test_actual_sdk_capture_preserves_distinct_native_amendment_and_custom_fields(self):
        self.assertEqual(self.evidence['shared_sdk_rpc_calls'], 5)
        self.assertEqual(self.capture['customer']['action'], 'create')
        a = self.manifest['initial']['saleOrder']
        b = self.manifest['replacement']['saleOrder']
        self.assertEqual((a['code'], b['code']), ('S-1960000100', 'S-1960000100-1'))
        self.assertNotEqual(a['saleOrderItems'][0]['code'], b['saleOrderItems'][0]['code'])
        self.assertIn(self.capture['source']['request_id'].replace('-', ''), b['saleOrderItems'][0]['code'])
        self.assertEqual({x['name'] for x in a['customFieldValues']}, {'Customer_Details', 'PICKUPDATE', 'Comment'})
        self.assertNotEqual(a['fulfillmentTat'], b['fulfillmentTat'])
        self.assertEqual(len(a['saleOrderItems']), 1)

    def test_prepare_hash_and_attempt_are_durable_before_http(self):
        grant = self.prepare('preflight')
        self.assertFalse(grant['attempted'])
        self.assertEqual(grant['attempted_steps'], [])
        self.assertEqual(hashlib.sha256(grant['manifest_json'].encode()).hexdigest(), grant['manifest_sha256'])
        self.assertEqual(grant['current_generation'], self.manifest['generation'])
        self.assertEqual(self.raw("SELECT attempted,attempts FROM sa_domain.warehouse_rehearsal_steps WHERE run_id=%s AND step='preflight'", (self.run_id,)), [(True, 1)])
        self.assertEqual(self.raw('SELECT state FROM sa_domain.warehouse_rehearsal_attempts WHERE run_id=%s', (self.run_id,)), [('leased',)])

    def test_complete_native_replacement_lifecycle_no_business_queue_or_source_effect(self):
        before = self.raw('SELECT (SELECT count(*) FROM sa_domain.outbox),(SELECT count(*) FROM sa_domain.warehouse_operations),(SELECT count(*) FROM sa_snapshot_20261019.sa_orders),(SELECT edit_revision FROM sa_sync.environment_state)')
        self.through('cancel_replacement')
        self.done('customer_disable')
        self.assertEqual(self.prepare('customer_disable')['state'], 'done')
        self.assertEqual(self.raw('SELECT (SELECT count(*) FROM sa_domain.outbox),(SELECT count(*) FROM sa_domain.warehouse_operations),(SELECT count(*) FROM sa_snapshot_20261019.sa_orders),(SELECT edit_revision FROM sa_sync.environment_state)'), before)
        self.assertEqual(self.raw('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state'), [(False, [], None)])
        self.assertEqual(self.raw('SELECT cutover FROM sa_sync.environment_state'), [(False,)])

    def test_browser_cannot_read_or_invoke_private_rehearsals(self):
        for role in ['anon', 'authenticated', 'sa_app']:
            self.raw('SELECT 1')
            self.c.execute('SET LOCAL ROLE ' + role)
            for query, args in [('SELECT * FROM sa_domain.warehouse_rehearsals', ()), ('SELECT canto_api.squad_warehouse_rehearsal_prepare(%s,\'preflight\')', (self.run_id,)), ('SELECT sa_domain.warehouse_rehearsal_register(%s,\'scott-test\',%s,%s)', (uuid.uuid4(), self.email, Jsonb(self.capture)))]:
                with self.rejects('42501'):
                    self.c.execute(query, args)

    def test_service_cannot_register_read_or_edit_manifest(self):
        self.worker()
        for query, args in [('SELECT * FROM sa_domain.warehouse_rehearsals', ()), ('UPDATE sa_domain.warehouse_rehearsal_steps SET completed=true', ()), ('SELECT sa_domain.warehouse_rehearsal_register(%s,\'scott-test\',%s,%s)', (uuid.uuid4(), self.email, Jsonb(self.capture)))]:
            with self.rejects('42501'):
                self.c.execute(query, args)

    def test_missing_service_claim_and_unknown_run_denied(self):
        self.raw("SELECT set_config('request.jwt.claims','{}',true)")
        self.c.execute('SET LOCAL ROLE service_role')
        with self.rejects('42501'):
            self.c.execute('SELECT canto_api.squad_warehouse_rehearsal_prepare(%s,\'preflight\')', (self.run_id,))
        with self.rejects('42501'):
            self.prepare('preflight', uuid.uuid4())
        with self.rejects('42501'):
            self.prepare('arbitrary_operation')

    def test_manifest_and_code_reservations_cannot_change_or_be_deleted(self):
        for query in ["UPDATE sa_domain.warehouse_rehearsals SET tenant='foreign'", 'DELETE FROM sa_domain.warehouse_rehearsals', "UPDATE sa_domain.warehouse_rehearsal_codes SET code='S-1999999999'", 'DELETE FROM sa_domain.warehouse_rehearsal_codes']:
            with self.rejects('42501'):
                self.raw(query)

    def test_same_tenant_codes_are_reserved_across_future_runs(self):
        with self.rejects('23505'):
            self.register(run_id=uuid.uuid4())
        self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_rehearsal_codes WHERE run_id=%s', (self.run_id,)), [(4,)])

    def test_cross_kind_customer_order_id_collision_is_reserved(self):
        other = copy.deepcopy(self.capture)
        old, new = '1950000100', '1960000100'
        other['source']['customer_id'] = int(new)
        other['source']['order_id'] = 1960000200
        other['customer']['customer_id'] = new
        other['customer']['payload'] = json.loads(json.dumps(other['customer']['payload']).replace(old, new))
        for k in ['initial', 'replacement']:
            o = other[k]['saleOrder']
            o['customerCode'] = 'S-' + new
            o['code'] = o['displayOrderCode'] = 'S-1960000200' + ('-1' if k == 'replacement' else '')
        with self.rejects('23505'):
            self.register(other, uuid.uuid4())

    def test_registration_rejects_non_synthetic_or_stale_or_tampered_builder_capture(self):
        for field, value, code in [('customer_id', 103, '22023'), ('order_id', 1950000100, '55000'), ('generation', 999999, '55000'), ('captured_at', '2020-01-01T00:00:00Z', '55000'), ('builders_sha256', '0' * 64, '22023'), ('request_sha256', None, '22023')]:
            cap = copy.deepcopy(self.capture)
            cap['source'][field] = value
            with self.rejects(code):
                self.register(cap, uuid.uuid4())

    def test_registration_requires_rolled_back_source_ids(self):
        self.raw("INSERT INTO sa_snapshot_20261019.sa_users(id,name,role,created_at,updated_at) VALUES(1950000100,'Collision',3,now(),now())")
        with self.rejects('55000'):
            self.register(run_id=uuid.uuid4())

    def test_registration_requires_exact_controlled_contacts_one_piece_and_wh1(self):
        for change in ['email', 'enabled', 'party', 'pieces', 'facility', 'custom_fields', 'arbitrary']:
            cap = copy.deepcopy(self.capture)
            if change == 'email': cap['initial']['saleOrder']['notificationEmail'] = 'real@example.org'
            if change == 'enabled': cap['customer']['payload']['customer']['enabled'] = False
            if change == 'party': cap['customer']['payload']['customer']['billingAddress']['partyCode'] = 'foreign'
            if change == 'pieces': cap['replacement']['saleOrder']['saleOrderItems'] *= 2
            if change == 'facility': cap['initial']['saleOrder']['saleOrderItems'][0]['facilityCode'] = 'WH2'
            if change == 'custom_fields': cap['replacement']['saleOrder']['customFieldValues'] = []
            if change == 'arbitrary': cap['initial']['saleOrder']['arbitrary_url'] = 'https://elsewhere.invalid'
            with self.rejects('22023'):
                self.register(cap, uuid.uuid4())

    def test_dependency_order_is_enforced(self):
        for step in ['customer', 'submit', 'replace', 'reconcile', 'cleanup_initial', 'cleanup_replacement', 'customer_disable']:
            with self.rejects('55000'):
                self.prepare(step)

    def test_registration_requires_same_positive_low_value_sku(self):
        for field, value in [('itemSku', 'FOREIGN'), ('totalPrice', 0), ('totalPrice', 1000.01), ('sellingPrice', 104)]:
            cap = copy.deepcopy(self.capture)
            cap['replacement']['saleOrder']['saleOrderItems'][0][field] = value
            with self.rejects('22023'):
                self.register(cap, uuid.uuid4())

    def test_registration_is_denied_during_refresh_or_outside_staging_mirror(self):
        for query in ["UPDATE sa_sync.environment_state SET environment='production'", 'UPDATE sa_sync.environment_state SET cutover=true', "UPDATE sa_sync.environment_state SET active_job=gen_random_uuid()"]:
            with self.c.transaction(force_rollback=True):
                self.raw(query)
                with self.rejects('55000'):
                    self.register(run_id=uuid.uuid4())

    def test_production_and_cutover_are_always_denied_including_cleanup(self):
        self.through('submit')
        for query in ["UPDATE sa_sync.environment_state SET environment='production'", 'UPDATE sa_sync.environment_state SET cutover=true']:
            with self.c.transaction(force_rollback=True):
                self.raw(query)
                for step in ['reconcile', 'cleanup_initial']:
                    with self.rejects('55000'):
                        self.prepare(step)

    def test_forward_deadline_and_generation_block_new_forward_but_allow_exact_cleanup(self):
        self.through('submit')
        self.age_run('31 minutes')
        self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1')
        with self.rejects('55000'):
            self.prepare('reconcile')
        grant = self.prepare('cleanup_initial')
        self.assertNotEqual(grant['current_generation'], self.manifest['generation'])
        self.assertEqual(self.finish('cleanup_initial', grant)['state'], 'done')
        self.done('customer_disable')

    def test_cleanup_deadline_denies_prepare_and_finish(self):
        self.through('submit')
        grant = self.prepare('cleanup_initial')
        self.age_run('25 hours')
        with self.rejects('55000'):
            self.finish('cleanup_initial', grant)
        with self.rejects('55000'):
            self.prepare('customer_disable')

    def test_refresh_blocks_forward_but_not_cleanup(self):
        self.through('submit')
        self.raw('UPDATE sa_sync.environment_state SET active_job=%s', (uuid.uuid4(),))
        with self.rejects('55000'):
            self.prepare('reconcile')
        self.done('cleanup_initial')

    def test_late_forward_receipt_records_external_truth_after_generation_and_deadline_change(self):
        self.through('customer')
        grant = self.prepare('submit')
        self.age_run('31 minutes')
        self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1')
        self.assertEqual(self.finish('submit', grant)['state'], 'done')
        with self.rejects('55000'):
            self.prepare('reconcile')
        self.done('cleanup_initial')

    def test_active_lease_prevents_parallel_steps_or_duplicate_prepare(self):
        grant = self.prepare('preflight')
        self.assertEqual(self.prepare('preflight')['state'], 'busy')
        self.assertEqual(self.prepare('customer')['state'], 'busy')
        self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_rehearsal_attempts WHERE run_id=%s', (self.run_id,)), [(1,)])
        self.finish('preflight', grant)

    def test_exact_run_row_lock_skips_without_blocking_or_second_attempt(self):
        # Only private local fixture rows commit, so a second backend can hold
        # the real row lock. No source/provider operation is ever performed.
        self.c.execute('COMMIT')
        other = connect()
        try:
            other.execute('BEGIN')
            other.execute('SELECT id FROM sa_domain.warehouse_rehearsals WHERE id=%s FOR UPDATE', (self.run_id,))
            self.c.execute('BEGIN')
            self.c.execute("SET LOCAL statement_timeout='1000ms'")
            started = time.monotonic()
            self.assertEqual(self.prepare('preflight')['state'], 'busy')
            self.assertLess(time.monotonic() - started, .8)
            self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_rehearsal_attempts WHERE run_id=%s', (self.run_id,)), [(0,)])
            other.execute('ROLLBACK')
            self.done('preflight')
        finally:
            other.execute('ROLLBACK')
            other.close()
            self.c.execute('ROLLBACK')
            # Trusted local test teardown only; runtime/service identities can
            # neither disable these triggers nor remove permanent reservations.
            with self.c.transaction():
                for table, trigger in [('warehouse_rehearsals', 'warehouse_rehearsal_immutable'), ('warehouse_rehearsal_codes', 'warehouse_rehearsal_code_immutable')]:
                    self.c.execute(f'ALTER TABLE sa_domain.{table} DISABLE TRIGGER {trigger}')
                for table in ['warehouse_rehearsal_attempts', 'warehouse_rehearsal_steps', 'warehouse_rehearsal_codes']:
                    self.c.execute(f'DELETE FROM sa_domain.{table} WHERE run_id=%s', (self.run_id,))
                self.c.execute('DELETE FROM sa_domain.warehouse_rehearsals WHERE id=%s', (self.run_id,))
                for table, trigger in [('warehouse_rehearsals', 'warehouse_rehearsal_immutable'), ('warehouse_rehearsal_codes', 'warehouse_rehearsal_code_immutable')]:
                    self.c.execute(f'ALTER TABLE sa_domain.{table} ENABLE TRIGGER {trigger}')
            self.c.execute('BEGIN')

    def test_lost_customer_finish_never_replays_create(self):
        self.done('preflight')
        first = self.prepare('customer')
        self.expire_lease()
        self.assertEqual(self.prepare('customer')['error_code'], 'PROVIDER_CUSTOMER_UNCERTAIN')
        self.assertEqual(self.raw("SELECT state FROM sa_domain.warehouse_rehearsal_attempts WHERE lease_token=%s", (uuid.UUID(first['lease_token']),)), [('expired',)])
        with self.rejects('55000'):
            self.prepare('submit')

    def test_lost_customer_disable_finish_never_replays_edit(self):
        self.through('customer')
        self.prepare('customer_disable')
        self.expire_lease()
        self.assertEqual(self.prepare('customer_disable')['error_code'], 'PROVIDER_CUSTOMER_UNCERTAIN')
        with self.rejects('55000'):
            self.prepare('submit')

    def test_first_preflight_failure_negative_proof_allows_customer_retry(self):
        self.done('preflight')
        g = self.prepare('customer')
        self.finish('customer', g, {'code': 'RETRY', 'error_code': 'PROVIDER_UNAVAILABLE', 'proof': {'mutation_attempted': False}, 'retry_after_seconds': 180})
        self.assertEqual(self.prepare('customer')['state'], 'retry')
        wait = self.raw("SELECT extract(epoch FROM available_at-clock_timestamp()) FROM sa_domain.warehouse_rehearsal_steps WHERE run_id=%s AND step='customer'", (self.run_id,))[0][0]
        self.assertGreater(wait, 179)
        self.ready_again('customer')
        g = self.prepare('customer')
        self.assertFalse(g['attempted'])
        self.assertEqual(self.finish('customer', g)['state'], 'done')

    def test_uncertain_customer_result_cannot_clear_attempt_on_later_preflight(self):
        self.done('preflight')
        g = self.prepare('customer')
        self.finish('customer', g, {'code': 'RETRY', 'error_code': 'PROVIDER_TIMEOUT'})
        self.ready_again('customer')
        self.assertEqual(self.prepare('customer')['state'], 'blocked')

    def test_uncertain_order_attempt_is_preserved_when_reclaimed(self):
        self.through('customer')
        a = self.prepare('submit')
        self.expire_lease()
        b = self.prepare('submit')
        self.assertTrue(b['attempted'])
        self.assertIn('submit', b['attempted_steps'])
        with self.rejects('PT409'):
            self.finish('submit', a)
        self.finish('submit', b, {'code': 'RETRY', 'error_code': 'PROVIDER_UNAVAILABLE', 'proof': {'mutation_attempted': False}})
        self.assertEqual(self.raw("SELECT attempted FROM sa_domain.warehouse_rehearsal_steps WHERE run_id=%s AND step='submit'", (self.run_id,)), [(True,)])

    def test_uncertain_submit_can_only_be_closed_by_exact_cancel_not_absence(self):
        self.through('customer')
        g = self.prepare('submit')
        self.finish('submit', g, {'code': 'RECONCILIATION_REQUIRED', 'error_code': 'PROVIDER_TIMEOUT'})
        g = self.prepare('cleanup_initial')
        self.assertEqual(self.finish('cleanup_initial', g, {'code': 'RECONCILIATION_REQUIRED', 'error_code': 'REHEARSAL_CLEANUP_NOT_FOUND'})['state'], 'retry')
        with self.rejects('55000'):
            self.prepare('customer_disable')
        self.ready_again('cleanup_initial')
        g = self.prepare('cleanup_initial')
        self.assertTrue(g['attempted'])
        self.finish('cleanup_initial', g)
        self.done('customer_disable')

    def test_cleanup_absence_retry_budget_is_bounded_and_never_claims_success(self):
        self.through('submit')
        for n in range(5):
            if n:
                self.ready_again('cleanup_initial')
            g = self.prepare('cleanup_initial')
            self.assertEqual(g['attempted'], n > 0)
            r = self.finish('cleanup_initial', g, {'code': 'RECONCILIATION_REQUIRED', 'error_code': 'REHEARSAL_CLEANUP_NOT_FOUND'})
            self.assertEqual(r['state'], 'blocked' if n == 4 else 'retry')
            wait = self.raw("SELECT extract(epoch FROM available_at-clock_timestamp()) FROM sa_domain.warehouse_rehearsal_steps WHERE run_id=%s AND step='cleanup_initial'", (self.run_id,))[0][0]
            self.assertGreater(wait, 59)
            self.assertLessEqual(wait, 60)
        self.assertEqual(self.prepare('cleanup_initial')['state'], 'blocked')
        with self.rejects('55000'):
            self.prepare('customer_disable')

    def test_cleanup_attempt_seals_forward_even_when_negative_proof_clears_attempted(self):
        self.through('submit')
        g = self.prepare('cleanup_initial')
        self.finish('cleanup_initial', g, {'code': 'RETRY', 'error_code': 'PROVIDER_UNAVAILABLE', 'proof': {'mutation_attempted': False}})
        self.assertEqual(self.raw("SELECT attempted FROM sa_domain.warehouse_rehearsal_steps WHERE run_id=%s AND step='cleanup_initial'", (self.run_id,)), [(False,)])
        with self.rejects('55000'):
            self.prepare('reconcile')
        self.ready_again('cleanup_initial')
        self.done('cleanup_initial')
        self.done('customer_disable')

    def test_cleanup_shares_uncertain_normal_cancel_lineage(self):
        self.through('reconcile')
        self.prepare('cancel_initial')
        self.expire_lease()
        g = self.prepare('cleanup_initial')
        self.assertTrue(g['attempted'])
        self.finish('cleanup_initial', g, {'code': 'RETRY', 'error_code': 'PROVIDER_UNAVAILABLE', 'proof': {'mutation_attempted': False}})
        self.assertEqual(self.raw("SELECT attempted FROM sa_domain.warehouse_rehearsal_steps WHERE run_id=%s AND step='cleanup_initial'", (self.run_id,)), [(True,)])
        self.ready_again('cleanup_initial')
        self.done('cleanup_initial')
        self.done('customer_disable')

    def test_customer_disable_requires_cancellation_for_every_attempted_order(self):
        self.through('replace')
        with self.rejects('55000'):
            self.prepare('customer_disable')
        self.done('cleanup_replacement')
        self.done('customer_disable')

    def test_repeated_receipt_is_idempotent_but_changed_receipt_conflicts(self):
        g = self.prepare('preflight')
        result = self.finish('preflight', g)
        self.assertEqual(self.finish('preflight', g), result)
        with self.rejects('PT409'):
            self.finish('preflight', g, {'code': 'RETRY', 'error_code': 'PROVIDER_UNAVAILABLE'})
        self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_rehearsal_attempts WHERE run_id=%s', (self.run_id,)), [(1,)])

    def test_foreign_lease_step_or_run_never_settles(self):
        g = self.prepare('preflight')
        with self.rejects('PT409'):
            self.finish('customer', g)
        bad = dict(g, lease_token=str(uuid.uuid4()))
        with self.rejects('PT409'):
            self.finish('preflight', bad)
        with self.rejects('42501'):
            self.finish('preflight', g, run_id=uuid.uuid4())
        self.finish('preflight', g)

    def test_provider_receipt_identity_prices_and_enabled_are_checked(self):
        self.done('preflight')
        g = self.prepare('customer')
        bad = self.receipt('customer')
        bad['proof']['enabled'] = False
        with self.rejects('22023'):
            self.finish('customer', g, bad)
        self.finish('customer', g)
        g = self.prepare('submit')
        for field, value in [('external_code', 'S-foreign'), ('status', 'COMPLETE')]:
            bad = self.receipt('submit');bad[field] = value
            with self.rejects('22023'):
                self.finish('submit', g, bad)
        for field, value in [('code', 'S-foreign'), ('sku_code', 'FOREIGN'), ('facility_code', 'WH2'), ('total_price', '105.01'), ('selling_price', 'NaN')]:
            bad = self.receipt('submit');bad['proof']['items'][0][field] = value
            with self.rejects('22023'):
                self.finish('submit', g, bad)
        self.finish('submit', g)

    def test_cancel_requires_exact_acknowledged_item_not_absence_receipt(self):
        self.through('submit')
        g = self.prepare('cleanup_initial')
        for bad in [{'code': 'CONFIRMED', 'proof': {'source': 'exact_code_absent', 'external_code': 'S-1960000100'}}, self.receipt('submit')]:
            with self.rejects('22023'):
                self.finish('cleanup_initial', g, bad)
        self.finish('cleanup_initial', g)

    def test_sanitized_errors_and_bounded_attempt_budget(self):
        g = self.prepare('preflight')
        for result in [{'code': 'RETRY', 'error_code': 'contains secret details'}, {'code': 'RETRY', 'error_code': 'PROVIDER_UNAVAILABLE', 'retry_after_seconds': 3601}, {'code': 'RETRY', 'error_code': 'PROVIDER_UNAVAILABLE', 'proof': {'mutation_attempted': True}}]:
            with self.rejects('22023'):
                self.finish('preflight', g, result)
        for n in range(5):
            if n:
                self.ready_again('preflight');g = self.prepare('preflight')
            reply = self.finish('preflight', g, {'code': 'RETRY', 'error_code': 'PROVIDER_UNAVAILABLE'})
            self.assertEqual(reply['state'], 'blocked' if n == 4 else 'retry')
        self.assertEqual(self.prepare('preflight')['state'], 'blocked')
        self.assertEqual(self.raw('SELECT count(*) FROM sa_domain.warehouse_rehearsal_attempts WHERE run_id=%s', (self.run_id,)), [(5,)])


if __name__ == '__main__':
    unittest.main()
