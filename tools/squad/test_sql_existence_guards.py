"""Existence guards must return a non-empty tuple when a matching row exists."""
import ast
import re
import unittest
from pathlib import Path

from local_db import connect

HERE = Path(__file__).resolve().parent


class SqlExistenceGuards(unittest.TestCase):
    def test_python_sql_does_not_use_zero_column_existence_queries(self):
        failures = []
        for directory in (HERE, HERE.parent / 'canto-sync'):
            for path in directory.glob('*.py'):
                for node in ast.walk(ast.parse(path.read_text())):
                    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                        continue
                    if node.func.attr != 'execute' or not node.args:
                        continue
                    query = node.args[0]
                    if isinstance(query, ast.JoinedStr):
                        query = query.values[0] if query.values else None
                    if isinstance(query, ast.Constant) and isinstance(query.value, str):
                        if re.match(r'\s*SELECT\s+FROM\b', query.value, re.IGNORECASE):
                            failures.append(f'{path.name}:{node.lineno}')
        self.assertEqual(failures, [], 'fetchone() returns falsy () for zero-column matching rows')

    def test_deploy_privilege_guard_detects_an_unsafe_function(self):
        # Exercise the exact release guard, including its owner/privilege joins.
        tree = ast.parse((HERE / 'deploy.py').read_text())
        query = next(node.value for node in ast.walk(tree)
                     if isinstance(node, ast.Constant) and isinstance(node.value, str)
                     and re.match(r'\s*SELECT\s+1\s+FROM\s+pg_proc\b', node.value))
        with connect() as c:
            c.execute('BEGIN')
            try:
                self.assertFalse(c.execute(query).fetchone(), 'Existing function privileges must be safe')
                c.execute('''CREATE FUNCTION sa_domain.test_unsafe_existence_guard() RETURNS integer
                    LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS 'SELECT 1' ''')
                self.assertTrue(c.execute(query).fetchone(), 'Release guard must reject privileged definer')
                c.execute('ALTER FUNCTION sa_domain.test_unsafe_existence_guard() SECURITY INVOKER')
                self.assertTrue(c.execute(query).fetchone(), 'Release guard must also reject anonymous execution')
                c.execute('REVOKE ALL ON FUNCTION sa_domain.test_unsafe_existence_guard() FROM PUBLIC')
                self.assertFalse(c.execute(query).fetchone())
            finally:
                c.execute('ROLLBACK')


if __name__ == '__main__':
    unittest.main()
