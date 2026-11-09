"""Production schedule lifecycle with a transaction-aware local fake only.

No hosted connections, keys, providers, Git writes or actual schedule changes.
The existing release_mirror tests exercise the underlying SQL release guard.
"""
import copy
import hashlib
import json
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

import release_web_production as wrapper

THROUGH = '20261109024124'
IDENTITY = [{'version': THROUGH, 'sha256': 'a' * 64}]


class Result:
    def __init__(self, value): self.value = value
    def fetchone(self): return self.value


class FakeDatabase:
    def __init__(self):
        self.rows = [
            {'jobid': 1, 'jobname': 'squad-jobs-minute', 'active': True, 'command': 'owned one'},
            {'jobid': 2, 'jobname': 'squad-documents-pump', 'active': False, 'command': 'owned two'},
            {'jobid': 3, 'jobname': 'squad-media-cleanup', 'active': True, 'command': 'owned three'},
            {'jobid': 4, 'jobname': 'unrelated-live-job', 'active': True, 'command': 'unrelated'},
        ]
        self.environment = ('production', False, None)
        self.runtime = (False, [], None)
        self.lock = True
        self.writes = []
        self.fail_pause = False
        self.fail_restore = False
    @staticmethod
    def digest(row): return hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()
    def cron_state(self, _):
        return [[r['jobid'], r['jobname'], r['active'], self.digest(r)] for r in self.rows]
    @contextmanager
    def connect(self, environment):
        assert environment == 'production'
        yield self
    @contextmanager
    def transaction(self):
        before = copy.deepcopy(self.rows)
        try: yield
        except BaseException:
            self.rows = before
            raise
    def execute(self, sql, params=None):
        if sql.startswith('SELECT pg_try_advisory_xact_lock'): return Result((self.lock,))
        if sql.startswith('SELECT environment,cutover'): return Result(self.environment)
        if sql.startswith('SELECT allow_test_writes'): return Result(self.runtime)
        if sql.startswith('SELECT encode(sha256'):
            active, identity, name = params
            row = next((r for r in self.rows if r['jobid'] == identity and r['jobname'] == name), None)
            return Result((self.digest(dict(row, active=active)),) if row else None)
        if sql.startswith('SELECT cron.alter_job'):
            identity = params[0]
            pause = 'active:=false' in sql
            if self.fail_pause and pause: raise RuntimeError('pause failed')
            if self.fail_restore and not pause: raise RuntimeError('restore failed')
            active = False if pause else params[1]
            self.writes.append((identity, active))
            next(r for r in self.rows if r['jobid'] == identity)['active'] = active
            return Result((None,))
        raise AssertionError('Unexpected statement: ' + sql)


class ProductionScheduleRelease(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.checkpoint = Path(self.tmp.name) / 'schedules.json'
        self.receipt = Path(self.tmp.name) / 'sql.json'
        self.db = FakeDatabase(); self.original = copy.deepcopy(self.db.rows)
        for name, value in [('CHECKPOINT', self.checkpoint), ('connect', self.db.connect), ('release_identity', lambda through: IDENTITY if through == THROUGH else self.fail('unexpected cutoff'))]:
            p = patch.object(wrapper, name, value); p.start(); self.addCleanup(p.stop)
        for target, name, value in [(wrapper.mirror, 'cron_state', self.db.cron_state), (wrapper.mirror, 'checkpoint_path', lambda env: self.receipt), (wrapper.time, 'sleep', lambda _: None)]:
            p = patch.object(target, name, value); p.start(); self.addCleanup(p.stop)
    def invoke(self, **kwargs): return wrapper.run('production', THROUGH, **kwargs)
    def assert_restored(self):
        self.assertEqual(self.db.rows, self.original)
        self.assertFalse(self.checkpoint.exists())
        self.assertTrue(all(identity in (1, 2, 3) for identity, _ in self.db.writes))
    def release(self, environment, through, **kwargs):
        self.assertEqual((environment, through), ('production', THROUGH))
        self.assertTrue(self.checkpoint.exists())
        self.assertEqual(self.checkpoint.stat().st_mode & 0o777, 0o600)
        self.assertEqual([r['active'] for r in self.db.rows], [False, False, False, True])
        return {'mode': 'applied' if kwargs.get('apply') else 'rollback verification'}
    def test_default_rollback_preserves_originally_disabled_and_unrelated_jobs(self):
        with patch.object(wrapper.mirror, 'run', side_effect=self.release) as release:
            result = self.invoke()
        release.assert_called_once_with('production', THROUGH, apply=False)
        self.assertTrue(result['exact_schedules_restored']); self.assert_restored()
    def test_explicit_apply_only_after_durable_pause_receipt(self):
        with patch.object(wrapper.mirror, 'run', side_effect=self.release) as release:
            self.invoke(apply=True)
        release.assert_called_once_with('production', THROUGH, apply=True); self.assert_restored()
    def test_release_failure_without_sql_receipt_restores_and_reraises(self):
        with patch.object(wrapper.mirror, 'run', side_effect=RuntimeError('DDL rejected')):
            with self.assertRaisesRegex(RuntimeError, 'DDL rejected'): self.invoke()
        self.assert_restored()
    def test_pause_failure_rolls_back_and_recovers_the_prepared_receipt(self):
        self.db.fail_pause = True
        with patch.object(wrapper.mirror, 'run') as release:
            with self.assertRaisesRegex(RuntimeError, 'pause failed'): self.invoke()
        release.assert_not_called(); self.assert_restored()
    def test_uncertain_commit_retains_paused_schedules_until_sql_recovery(self):
        def uncertain(*args, **kwargs):
            self.receipt.write_text('{}'); raise RuntimeError('commit outcome uncertain')
        with patch.object(wrapper.mirror, 'run', side_effect=uncertain):
            with self.assertRaisesRegex(RuntimeError, 'uncertain'): self.invoke(apply=True)
        self.assertTrue(self.checkpoint.exists()); self.assertEqual([r['active'] for r in self.db.rows], [False, False, False, True])
        def recover(*args, **kwargs):
            self.assertEqual(kwargs, {'recover_baselines': True})
            self.assertEqual([r['active'] for r in self.db.rows], [False, False, False, True])
            self.receipt.unlink()
        with patch.object(wrapper.mirror, 'run', side_effect=recover): self.invoke(recover=True)
        self.assert_restored()
    def test_failed_sql_recovery_keeps_both_checkpoints_and_pause(self):
        self.prepare_checkpoint(); self.receipt.write_text('{}')
        with patch.object(wrapper.mirror, 'run', side_effect=RuntimeError('protected data differs')):
            with self.assertRaisesRegex(RuntimeError, 'protected data'): self.invoke(recover=True)
        self.assertTrue(self.receipt.exists()); self.assertTrue(self.checkpoint.exists())
        self.assertFalse(any(r['active'] for r in self.db.rows[:3]))
    def prepare_checkpoint(self):
        state = {'format': wrapper.FORMAT, 'environment': 'production', 'through': THROUGH, 'migrations': IDENTITY, 'all_schedules': self.db.cron_state(None)}
        wrapper.mirror.atomic_json(self.checkpoint, state)
        for row in self.db.rows[:3]: row['active'] = False
    def test_crash_after_pause_before_sql_restores_without_migration(self):
        self.prepare_checkpoint()
        with patch.object(wrapper.mirror, 'run') as release: self.invoke(recover=True)
        release.assert_not_called(); self.assert_restored()
    def test_definition_identity_or_unrelated_activity_drift_refuses_and_retains_receipt(self):
        for change in ('command', 'identity', 'unrelated_active'):
            with self.subTest(change=change):
                self.db.rows = copy.deepcopy(self.original); self.prepare_checkpoint()
                if change == 'command': self.db.rows[0]['command'] = 'foreign change'
                elif change == 'identity': self.db.rows[0]['jobid'] = 55
                else: self.db.rows[3]['active'] = False
                before = copy.deepcopy(self.db.rows)
                with self.assertRaises(RuntimeError): self.invoke(recover=True)
                self.assertEqual(self.db.rows, before); self.assertTrue(self.checkpoint.exists())
                self.checkpoint.unlink()
    def test_wrong_environment_or_cutoff_checkpoint_refused_without_restoration(self):
        self.prepare_checkpoint(); state = json.loads(self.checkpoint.read_text()); state['through'] = '20200101000000'; self.checkpoint.write_text(json.dumps(state))
        with self.assertRaisesRegex(RuntimeError, 'exact production release'): self.invoke(recover=True)
        with self.assertRaisesRegex(RuntimeError, 'Explicit production'): wrapper.run('staging', THROUGH)
        self.assertEqual(self.db.writes, []); self.assertTrue(self.checkpoint.exists())
    def test_active_rehearsal_and_busy_lock_refuse_before_checkpoint_or_mutation(self):
        for change in ('runtime', 'lock', 'environment'):
            with self.subTest(change=change):
                self.db.runtime = (False, [], None); self.db.lock = True; self.db.environment = ('production', False, None)
                if change == 'runtime': self.db.runtime = (True, ['owned'], None)
                elif change == 'lock': self.db.lock = False
                else: self.db.environment = ('production', True, None)
                with self.assertRaises(RuntimeError): self.invoke()
                self.assertFalse(self.checkpoint.exists()); self.assertEqual(self.db.writes, [])
    def test_unresolved_existing_receipt_or_recovery_apply_never_runs_release(self):
        self.receipt.write_text('{}')
        with patch.object(wrapper.mirror, 'run') as release:
            with self.assertRaisesRegex(RuntimeError, 'outstanding production SQL'): self.invoke()
            with self.assertRaisesRegex(RuntimeError, 'Recovery cannot apply'): self.invoke(apply=True, recover=True)
        release.assert_not_called(); self.assertEqual(self.db.writes, [])
    def test_restore_commit_failure_retains_checkpoint_for_exact_retry(self):
        self.prepare_checkpoint(); self.db.fail_restore = True
        with self.assertRaisesRegex(RuntimeError, 'restore failed'): self.invoke(recover=True)
        self.assertTrue(self.checkpoint.exists()); self.assertFalse(any(r['active'] for r in self.db.rows[:3]))
        self.db.fail_restore = False; self.invoke(recover=True); self.assert_restored()


if __name__ == '__main__': unittest.main()
