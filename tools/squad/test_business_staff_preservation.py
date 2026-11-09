"""Cleanup distinguishes external live Auth activity from a fixture mutation."""
import unittest
import uuid
from unittest.mock import Mock
from business_cleanup_accounts import independent_staff_changes


class StaffPreservation(unittest.TestCase):
    def setUp(self):
        self.staff, self.fixture = uuid.uuid4(), uuid.uuid4()
        self.before = {str(self.staff): 'before'}
        self.after = {str(self.staff): 'after'}
        self.c = Mock()
        self.c.execute.return_value.fetchall.return_value = [(self.staff, '90', 'after')]

    def test_unchanged_staff_needs_no_exception(self):
        self.assertEqual(independent_staff_changes(self.c, self.before, self.before,
                                                   [self.fixture], {71}), 0)
        self.c.execute.assert_not_called()

    def test_only_independent_existing_row_is_reported(self):
        self.assertEqual(independent_staff_changes(self.c, self.before, self.after,
                                                   [self.fixture], {71}), 1)

    def test_fixture_transaction_cannot_be_excused(self):
        with self.assertRaisesRegex(AssertionError, 'Fixture modified'):
            independent_staff_changes(self.c, self.before, self.after, [self.fixture], {90})

    def test_added_removed_or_missing_staff_is_refused(self):
        for current in [{}, {**self.after, str(uuid.uuid4()): 'new'}]:
            with self.assertRaisesRegex(AssertionError, 'inventory changed'):
                independent_staff_changes(self.c, self.before, current, [self.fixture], {71})
        self.c.execute.return_value.fetchall.return_value = []
        with self.assertRaisesRegex(AssertionError, 'unavailable'):
            independent_staff_changes(self.c, self.before, self.after, [self.fixture], {71})

    def test_fixture_staff_overlap_is_refused(self):
        with self.assertRaisesRegex(AssertionError, 'overlaps'):
            independent_staff_changes(self.c, self.before, self.after, [self.staff], {71})

    def test_hash_and_transaction_must_describe_the_same_row(self):
        self.c.execute.return_value.fetchall.return_value = [(self.staff, '90', 'raced')]
        with self.assertRaisesRegex(AssertionError, 'during attribution'):
            independent_staff_changes(self.c, self.before, self.after, [self.fixture], {71})


if __name__ == '__main__':
    unittest.main(verbosity=2)
