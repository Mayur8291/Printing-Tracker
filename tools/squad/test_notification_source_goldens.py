"""Independent legacy recipient/deep-link goldens, grouped by source branch.

The reviewed fixture contains literal expected recipients and source hashes.
No expected recipient is computed from notification_plan or the live registry.
Every branch traverses plan -> service fanout -> current-authority materialize
-> public inbox target. No device tokens or external delivery are involved.
"""
import json
from pathlib import Path
import unittest
import uuid

from psycopg.types.json import Jsonb

from fixtures import rpc, seed_orders, session, uid
from local_db import connect

GOLDEN_PATH = Path(__file__).parent / 'fixtures/notification_source_goldens.json'
GOLDENS = json.loads(GOLDEN_PATH.read_text())


class NotificationSourceGoldens(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as c:
            seed_orders(c)

    def setUp(self):
        self.c = connect()
        self.c.execute('BEGIN')
        self.c.execute('UPDATE sa_sync.environment_state SET cutover=true')

    def tearDown(self):
        self.c.execute('ROLLBACK')
        self.c.close()

    def raw(self, statement, args=()):
        self.c.execute('RESET ROLE')
        return self.c.execute(statement, args)

    def actor(self, n):
        self.c.execute('RESET ROLE')
        session(self.c, n)

    def worker(self):
        self.c.execute('RESET ROLE')
        self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
        self.c.execute('SET LOCAL ROLE service_role')

    def call(self, name, job, *args):
        self.worker()
        return self.c.execute(
            'SELECT canto_api.' + name + '(' + ','.join(['%s'] * (len(args) + 2)) + ')',
            (uuid.UUID(job['id']), uuid.UUID(job['lease_token'])) + args,
        ).fetchone()[0]

    def claim(self):
        self.worker()
        return self.c.execute('SELECT canto_api.squad_job_claim(10)').fetchone()[0]['jobs']

    def configure(self, case):
        f = case['fixture']
        self.raw('''UPDATE sa_snapshot_20261019.sa_orders SET order_item_type=%s,
            customer_id=%s,customer_dealer_id=%s,status=%s,cutting_status=%s,
            assigned_to_id=%s,assigned_worker_id=%s,customer_sc_id=101 WHERE id=1001''',
            tuple(f[k] for k in ['order_item_type', 'customer_id', 'customer_dealer_id', 'status',
                                'cutting_status', 'assigned_to_id', 'assigned_worker_id']))
        self.raw('''UPDATE sa_snapshot_20261019.sa_items SET cutting_master_id=109,
            completed_by_tailor_quantity_status=%s WHERE id=1001''',
            (f['completed_by_tailor_quantity_status'],))

    def plans(self, case):
        return [r[0] for r in self.raw(
            'SELECT * FROM sa_domain.notification_plan(%s,%s,%s,%s,%s)',
            (case['event'], case['aggregate_kind'], case['aggregate_id'], uid(case['actor']), Jsonb(case['changes'])),
        )]

    def verify_case(self, case):
        self.configure(case)
        plans = self.plans(case)
        self.assertTrue(plans, case['name'])
        self.assertEqual({t for p in plans for t in p['types']}, set(case['expected_strategy_types']))
        actual = {}
        for plan in plans:
            self.assertEqual({'kind': plan['kind'], 'id': plan['id']}, case['expected_target'])
            candidates = self.raw('SELECT user_id,legacy_types FROM sa_domain.notification_candidates(%s,0)', (Jsonb(plan),)).fetchall()
            for person, types in candidates:
                actual.setdefault(str(person), set()).update(types)
        self.assertEqual({person: sorted(types) for person, types in actual.items()}, case['expected_recipients'])

        # Use the real queue lease, fanout, preparation and public inbox. Merely
        # selecting candidate IDs would miss current resource-scope suppression.
        for plan in plans:
            plan = dict(plan, after_recipient='0')
            self.raw('''INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,
                aggregate_id,command_key,generation,payload)
                VALUES(%s,'notification.fanout','notification',%s,%s,0,%s)''',
                (uid(case['actor']), case['aggregate_id'], uuid.uuid4(), Jsonb(plan)))
        denied = set()
        prepared = set()
        for _ in range(20):
            jobs = self.claim()
            if not jobs:
                break
            for job in jobs:
                if job['handler'] == 'notification_fanout':
                    self.assertEqual(self.call('squad_notification_fanout', job)['state'], 'done')
                elif job['handler'] == 'notification_delivery':
                    user_id = self.raw("SELECT payload->>'recipient_id' FROM sa_domain.outbox WHERE id=%s", (uuid.UUID(job['id']),)).fetchone()[0]
                    result = self.call('squad_notification_prepare', job)
                    if user_id in case.get('expected_authority_denials', {}):
                        self.assertEqual(result['state'], 'dead')
                        self.assertEqual(result['error_code'], case['expected_authority_denials'][user_id])
                        self.assertEqual(result['id'], job['id'])
                        self.assertEqual(self.raw('SELECT status FROM sa_domain.outbox WHERE id=%s', (uuid.UUID(job['id']),)).fetchone()[0], 'dead')
                        denied.add(user_id)
                        continue
                    self.assertEqual(result['state'], 'prepared', (case['name'], user_id, result))
                    self.assertEqual(result['devices'], [])
                    self.assertEqual(self.call('squad_notification_finish', job, Jsonb([]))['state'], 'done')
                    self.actor(int(user_id))
                    inbox = rpc(self.c, 'v1_notifications_list', (int(result['notification_id']),))['data']
                    self.assertEqual(len(inbox), 1)
                    self.assertEqual(inbox[0]['target'], case['expected_target'])
                    self.assertEqual(inbox[0]['push_state'], 'inbox_only')
                    prepared.add(user_id)
                else:
                    self.fail('Unexpected unrelated job in isolated golden fixture: ' + job['handler'])
        else:
            self.fail('Notification fixture exceeded bounded queue rounds')
        self.assertEqual(denied, set(case.get('expected_authority_denials', {})))
        self.assertEqual(prepared, set(case['expected_recipients']) - denied)

    def verify_inbox_deliveries(self, expected):
        """Drain public-command notification jobs against literal source audiences."""
        actual = {}
        for _ in range(20):
            jobs = self.claim()
            if not jobs:
                break
            for job in jobs:
                if job['handler'] == 'notification_fanout':
                    self.assertEqual(self.call('squad_notification_fanout', job)['state'], 'done')
                    continue
                self.assertEqual(job['handler'], 'notification_delivery')
                person, topic = self.raw("SELECT payload->>'recipient_id',payload->>'topic' FROM sa_domain.outbox WHERE id=%s", (uuid.UUID(job['id']),)).fetchone()
                result = self.call('squad_notification_prepare', job)
                self.assertEqual(result['state'], 'prepared', (person, topic, result))
                self.assertEqual(result['devices'], [])
                self.assertEqual(self.call('squad_notification_finish', job, Jsonb([]))['state'], 'done')
                self.actor(int(person))
                inbox = rpc(self.c, 'v1_notifications_list', (int(result['notification_id']),))['data']
                self.assertEqual(len(inbox), 1)
                self.assertEqual(inbox[0]['push_state'], 'inbox_only')
                self.assertNotIn((int(person), topic), actual)
                actual[(int(person), topic)] = inbox[0]['target']
        else:
            self.fail('Notification fixture exceeded bounded queue rounds')
        self.assertEqual(actual, expected)

    def test_task_source_assignment_removal_content_and_actor_exclusions(self):
        # Rails TasksController#create/update: assignee + admins for assignment;
        # creator + current assignees + admins, excluding actor, for changes.
        self.actor(101)
        task = rpc(self.c, 'v1_task_save', (None, 'Source task', '2030-01-01T00:00:00Z', None, [102, 104], None, uuid.uuid4()))
        task_id = int(task['id'])
        target = {'kind': 'task', 'id': str(task_id)}
        self.verify_inbox_deliveries({(n, 'task.assigned'): target for n in [100, 200, 102, 104]})
        self.actor(101)
        task = rpc(self.c, 'v1_task_save', (task_id, 'Changed source task', '2030-01-01T00:00:00Z', None, [102, 202], task['version'], uuid.uuid4()))
        expected = {(n, 'task.assigned'): target for n in [100, 200, 202]}
        expected.update({(n, 'task.removed'): None for n in [100, 200, 104]})
        expected.update({(n, 'task.changed'): target for n in [100, 200, 102, 202]})
        self.verify_inbox_deliveries(expected)
        self.actor(102)
        task = rpc(self.c, 'v1_task_transition', (task_id, 1, task['version'], uuid.uuid4()))
        self.verify_inbox_deliveries({(n, 'task.changed'): target for n in [100, 200, 101, 202]})
        self.actor(100)
        rpc(self.c, 'v1_task_save', (task_id, 'Admin source task edit', '2030-01-01T00:00:00Z', None, [102, 202], task['version'], uuid.uuid4()))
        self.verify_inbox_deliveries({(n, 'task.changed'): target for n in [200, 101, 102, 202]})

    def test_rating_source_recipient_and_admin_targets_score_change_only(self):
        # Rails RatingsController#create/update explicitly target recipient and
        # every admin, with rating_id as the actual FCM navigation payload.
        self.raw('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true WHERE id=103')
        self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_by_id=102,assigned_worker_id=NULL WHERE id=1005')
        self.actor(103)
        rating = rpc(self.c, 'v1_rating_save', (None, 'Order', 1005, None, Jsonb({'score': '4', 'positive_comments': 'Helpful'}), None, uuid.uuid4()))
        target = {'kind': 'rating', 'id': rating['id']}
        expected = {(n, 'rating.changed'): target for n in [100, 200, 101]}
        self.verify_inbox_deliveries(expected)
        self.actor(103)
        rating = rpc(self.c, 'v1_rating_save', (int(rating['id']), 'Order', 1005, None, Jsonb({'score': '5', 'positive_comments': 'Helpful'}), rating['version'], uuid.uuid4()))
        self.verify_inbox_deliveries(expected)
        self.actor(103)
        rpc(self.c, 'v1_rating_save', (int(rating['id']), 'Order', 1005, None, Jsonb({'score': '5', 'positive_comments': 'Only comment changed'}), rating['version'], uuid.uuid4()))
        self.verify_inbox_deliveries({})

    def cases(self, prefixes):
        for case in GOLDENS['cases']:
            if not any(case['name'].startswith(prefix) for prefix in prefixes):
                continue
            with self.subTest(branch=case['name']):
                # Savepoint rollback keeps each committed event branch isolated
                # while retaining realistic lease/worker SQL execution.
                with self.c.transaction(force_rollback=True):
                    self.verify_case(case)

    def test_all_115_strategy_helpers_match_independent_source_contracts(self):
        expected = {r['type']: r['recipient_helpers'] for r in GOLDENS['strategy_contracts']}
        actual = {n: helpers for n, helpers in self.raw('SELECT legacy_type,recipients FROM sa_domain.notification_rules')}
        self.assertEqual(actual, expected)
        self.assertEqual(set(expected), set(range(1, 118)) - {13, 25})
        covered = {t for case in GOLDENS['cases'] for t in case['expected_strategy_types']}
        self.assertEqual(set(expected) - covered, {115})
        self.assertEqual(GOLDENS['dormant_original_strategy_types'], [20, 21, 24, 98, 115])
        self.assertEqual([r['type'] for r in GOLDENS['strategy_contracts'] if r['correction']], [92])

    def test_placement_actor_family_and_dealer_relationship_branches(self):
        self.cases(['place_'])

    def test_edit_actor_customer_role_and_relationship_branches(self):
        self.cases(['edit_'])

    def test_registration_and_current_coordinator_targets(self):
        self.cases(['registration', 'coordinator_assigned'])

    def test_factory_cutter_and_partial_complete_production_recipients(self):
        self.cases(['due', 'factory', 'cutter', 'cut_', 'sew_', 'inspect_', 'dispatch'])

    def test_jobworker_assignment_cost_and_three_notifying_stages(self):
        self.cases(['worker_'])

    def test_prices_provider_completion_and_cancellation_recipients(self):
        self.cases(['custom_price', 'rmp_price_', 'provider_', 'custom_cancel', 'dealer_cancel', 'complete'])

    def test_dormant_pickup_and_dealer_ready_routes_do_not_claim_source_producers(self):
        self.cases(['pickup_private', 'dealer_ready_private'])

    def test_foreign_factory_inspectors_and_missing_manager_never_join(self):
        case = next(c for c in GOLDENS['cases'] if c['name'] == 'sew_assigned')
        self.configure(case)
        plans = self.plans(case)
        recipients = {r[0] for p in plans for r in self.raw('SELECT user_id FROM sa_domain.notification_candidates(%s,0)', (Jsonb(p),))}
        self.assertIn(108, recipients)
        self.assertNotIn(208, recipients)
        self.raw('UPDATE sa_snapshot_20261019.sa_orders SET assigned_to_id=NULL WHERE id=1001')
        plans = self.plans(case)
        recipients = {r[0] for p in plans for r in self.raw('SELECT user_id FROM sa_domain.notification_candidates(%s,0)', (Jsonb(p),))}
        self.assertNotIn(108, recipients)
        self.assertNotIn(208, recipients)

    def test_removed_disabled_and_unapproved_candidates_do_not_receive(self):
        case = next(c for c in GOLDENS['cases'] if c['name'] == 'place_1_103_direct')
        self.configure(case)
        self.raw('UPDATE sa_snapshot_20261019.sa_users SET approved=false WHERE id=103')
        self.raw('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=102')
        self.raw('UPDATE sa_snapshot_20261019.sa_users SET deleted_at=now() WHERE id=200')
        plans = self.plans(case)
        recipients = {r[0] for p in plans for r in self.raw('SELECT user_id FROM sa_domain.notification_candidates(%s,0)', (Jsonb(p),))}
        self.assertEqual(recipients, {100, 101, 202})


if __name__ == '__main__':
    unittest.main(verbosity=2)
