"""The shared assertion must not hide a real database serialization failure."""
import unittest

import psycopg

from sqlstate_assertions import assert_app_conflict, is_app_conflict


class ApplicationConflict(psycopg.DatabaseError):
    sqlstate = 'PT409'


class SqlstateAssertions(unittest.TestCase):
    def test_accepts_exact_application_conflict(self):
        with assert_app_conflict(self):
            raise ApplicationConflict('Record changed')

    def test_rejects_genuine_postgres_serialization_failure(self):
        with self.assertRaises(AssertionError):
            with assert_app_conflict(self):
                raise psycopg.errors.SerializationFailure('Concurrent database transaction')

    def test_rejects_other_database_error_and_missing_exception(self):
        with self.assertRaises(AssertionError):
            with assert_app_conflict(self):
                raise psycopg.errors.UniqueViolation('Duplicate')
        with self.assertRaises(AssertionError):
            with assert_app_conflict(self):
                pass

    def test_predicate_is_exact_and_preserves_unexpected_errors(self):
        self.assertTrue(is_app_conflict(ApplicationConflict('Record changed')))
        self.assertFalse(is_app_conflict(psycopg.errors.SerializationFailure('Retry')))
        self.assertFalse(is_app_conflict(psycopg.errors.UniqueViolation('Duplicate')))
        self.assertFalse(is_app_conflict(ValueError('Other failure')))


if __name__ == '__main__':
    unittest.main(verbosity=2)
