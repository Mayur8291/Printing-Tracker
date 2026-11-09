"""Actual additive migration, realistic scope, and rollback-only plan regression."""
import unittest
from pglast import parse_sql, ast
from local_db import connect
from profile_worker_scope_index_local import run, MIGRATION


def nodes(plan):
    yield plan
    for child in plan.get('Plans', []):
        yield from nodes(child)


class WorkerScopeIndex(unittest.TestCase):
    def test_actual_migration_scope_security_and_both_plans(self):
        with connect() as c:
            result = run(c)
        for key in ('historical_visibility_preserved', 'foreign_worker_orders_denied',
                    'security_metadata_unchanged', 'index_valid_unfiltered_exact_columns', 'rollback_verified'):
            self.assertTrue(result[key], key)
        self.assertEqual(len(result['samples']), 4)
        for sample in result['samples']:
            self.assertEqual(sample['scope_rows'], 7)
            if sample['candidate_full_index']:
                self.assertTrue(any(n.get('Index Name') == 'squad_orders_worker_scope'
                                    for n in nodes(sample['plan']['Plan'])), sample)

    def test_migration_only_adds_reviewed_index_and_comment(self):
        statements = [x.stmt for x in parse_sql(MIGRATION.read_text())
                      if not isinstance(x.stmt, ast.TransactionStmt)]
        self.assertEqual([type(x) for x in statements], [ast.IndexStmt, ast.CommentStmt])
        index = statements[0]
        self.assertEqual(index.idxname, 'squad_orders_worker_scope')
        self.assertEqual(index.relation.schemaname, 'sa_snapshot_20261019')
        self.assertEqual(index.relation.relname, 'sa_orders')
        self.assertEqual([x.name for x in index.indexParams], ['assigned_worker_id', 'id'])
        self.assertIsNone(index.whereClause)
        self.assertFalse(index.unique)


if __name__ == '__main__':
    unittest.main()
