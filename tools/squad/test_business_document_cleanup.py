"""Exact-owned queued document recovery; all fixtures stay in local rollback."""
import json
import unittest
import uuid

from psycopg.types.json import Jsonb

from fixtures import rpc
import test_business_harness as base_harness
import test_hosted_business_journeys as harness


class BusinessDocumentCleanup(unittest.TestCase):
    setUpClass = classmethod(lambda cls: base_harness.BusinessHarness.setUpClass())
    setUp = base_harness.BusinessHarness.setUp
    tearDown = base_harness.BusinessHarness.tearDown
    prepared = base_harness.BusinessHarness.prepared

    def request(self):
        state = self.prepared()
        actor = next(a for a in state['identity']['actors'] if a['role'] == 0)
        session = uuid.uuid4()
        self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)', (session, actor['auth_id']))
        self.c.execute("SELECT set_config('request.jwt.claims',%s,true)", (json.dumps({'sub': actor['auth_id'], 'session_id': str(session), 'role': 'sa_app'}),))
        self.c.execute('SET LOCAL ROLE sa_app')
        label = 'cleanup.catalogue'
        key = uuid.uuid5(uuid.UUID(state['run_id']), label)
        result = rpc(self.c, 'v1_document_request', ('catalogue', Jsonb({'selection': {}, 'delivery': 'download'}), key))
        self.c.execute('RESET ROLE')
        return state, actor, result['id'], [{'kind': 'command', 'value': {'key': str(key), 'label': label}}]

    def test_queued_document_requires_audit_and_cleans_idempotently(self):
        state, actor, document, entries = self.request()
        result = harness.cleanup(self.c, state, entries)
        self.assertEqual(result['removed_queued_documents'], 1)
        self.assertFalse(self.c.execute('SELECT 1 FROM sa_domain.documents WHERE id=%s', (document,)).fetchone())
        self.assertTrue(self.c.execute("SELECT 1 FROM sa_domain.audit WHERE operation='document.requested' AND changes->>'document_id'=%s", (document,)).fetchone())
        self.assertEqual(harness.cleanup(self.c, state, entries), result)

    def test_unaudited_document_for_same_actor_refuses_cleanup(self):
        state, actor, document, entries = self.request()
        self.c.execute("INSERT INTO sa_domain.documents(actor_id,legacy_user_id,role_id,generation,kind,request) VALUES(%s,%s,0,0,'catalogue','{\"delivery\":\"download\"}')", (actor['auth_id'], actor['id']))
        with self.assertRaisesRegex(AssertionError, 'ownership differs'):
            harness.cleanup(self.c, state, entries)
        self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.documents WHERE actor_id=%s', (actor['auth_id'],)).fetchone()[0], 2)

    def test_foreign_transaction_update_is_not_deleted(self):
        state, actor, document, entries = self.request()
        with self.c.transaction():
            self.c.execute("UPDATE sa_domain.documents SET request=request||'{\"company_name\":\"foreign edit\"}' WHERE id=%s", (document,))
        with self.assertRaisesRegex(AssertionError, 'outside an owned command'):
            harness.cleanup(self.c, state, entries)
        self.assertTrue(self.c.execute('SELECT 1 FROM sa_domain.documents WHERE id=%s', (document,)).fetchone())

    def test_started_document_cannot_be_deleted(self):
        state, actor, document, entries = self.request()
        self.c.execute("UPDATE sa_domain.documents SET snapshot='{}' WHERE id=%s", (document,))
        with self.assertRaisesRegex(AssertionError, 'Document'):
            harness.cleanup(self.c, state, entries)
        self.assertTrue(self.c.execute('SELECT 1 FROM sa_domain.documents WHERE id=%s', (document,)).fetchone())

    def test_mismatched_job_payload_cannot_authorize_deletion(self):
        state, actor, document, entries = self.request()
        self.c.execute("UPDATE sa_domain.outbox SET payload='{}' WHERE id=(SELECT job_id FROM sa_domain.documents WHERE id=%s)", (document,))
        with self.assertRaisesRegex(AssertionError, 'job differs'):
            harness.cleanup(self.c, state, entries)
        self.assertTrue(self.c.execute('SELECT 1 FROM sa_domain.documents WHERE id=%s', (document,)).fetchone())

    def test_dependent_cleanup_work_is_never_cascaded(self):
        state, actor, document, entries = self.request()
        self.c.execute('INSERT INTO sa_domain.document_cleanup(path,document_id) VALUES(%s,%s)', ('g0/'+actor['auth_id']+'/'+document+'/part-0001.pdf', document))
        with self.assertRaisesRegex(AssertionError, 'dependent work'):
            harness.cleanup(self.c, state, entries)
        self.assertTrue(self.c.execute('SELECT 1 FROM sa_domain.document_cleanup WHERE document_id=%s', (document,)).fetchone())


if __name__ == '__main__':
    unittest.main(verbosity=2)
