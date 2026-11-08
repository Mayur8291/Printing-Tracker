"""Assert application conflicts without accepting PostgreSQL retryable errors."""
from contextlib import contextmanager

import psycopg


APPLICATION_CONFLICT = 'PT409'


def is_app_conflict(error):
    return isinstance(error, psycopg.DatabaseError) and error.sqlstate == APPLICATION_CONFLICT


@contextmanager
def assert_app_conflict(case):
    """Require the exact HTTP-409 application SQLSTATE, not genuine 40001."""
    with case.assertRaises(psycopg.DatabaseError) as caught:
        yield
    case.assertEqual(caught.exception.sqlstate, APPLICATION_CONFLICT)
