"""Actual isolated PostgreSQL reads; no hosted connections or setup commands."""
import json
import unittest
from local_db import connect
from fixtures import uid,sid,seed_orders
from worker_read_sql_diagnostic import measure_worker_sql

class WorkerReadDiagnostic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as c:seed_orders(c)
    def measure(self,**changes):
        args={'auth_id':uid(111),'session_id':sid(111),'expected_user_id':111,'order_id':1001};args.update(changes)
        with connect() as c:return measure_worker_sql(c,**args)
    def test_six_real_bounded_reads_readonly_and_sanitized(self):
        result=self.measure();self.assertTrue(result['all_requests_completed']);self.assertTrue(result['read_only'])
        self.assertEqual(len(result['samples']),6);self.assertEqual(result['settings']['statement_timeout'],'10s')
        serialized=json.dumps(result)
        for value in [str(uid(111)),str(sid(111)),'persona-111@','Index Cond','Query Text']:
            self.assertNotIn(value,serialized)
        self.assertEqual(len(result['function_sha256']),6)
    def test_foreign_order_rejected_before_sampling(self):
        with self.assertRaisesRegex(AssertionError,'exact Worker'):self.measure(order_id=2001)
    def test_foreign_session_and_nonworker_rejected(self):
        for changes in [{'session_id':sid(211)},{'auth_id':uid(103),'session_id':sid(103),'expected_user_id':103}]:
            with self.subTest(changes=changes):
                with self.assertRaisesRegex(AssertionError,'not eligible'):self.measure(**changes)

if __name__=='__main__':unittest.main()
