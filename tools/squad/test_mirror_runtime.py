"""Pure installer boundary/recovery tests. No hosted API, SQL, CLI or mail."""
import copy
import hashlib
import io
import tempfile
import unittest
from contextlib import contextmanager, redirect_stdout
from pathlib import Path
from unittest.mock import patch

import install_mirror_runtime as installer


def metadata(value):
    return {'digest': hashlib.sha256(value.encode()).hexdigest()}


def command(path='run'):
    return ("SELECT net.http_post(url:='https://" + installer.PROJECTS['staging'] +
            ".supabase.co/functions/v1/squad-jobs/" + path + "'," +
            "headers:=jsonb_build_object('Authorization','Bearer '||(SELECT decrypted_secret " +
            "FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'))," +
            "body:='{}'::jsonb,timeout_milliseconds:=60000) " +
            "WHERE EXISTS(SELECT FROM sa_sync.environment_state WHERE singleton AND cutover AND active_job IS NULL);")


class BoundaryTests(unittest.TestCase):
    def test_cron_replaces_only_own_origin_and_matches_route(self):
        for name in installer.CRONS:
            path = 'media-cleanup' if name == 'squad-media-cleanup' else 'run'
            result = installer.normalized_command(command(path), 'production', name)
            self.assertIn(installer.PROJECTS['production'], result)
            self.assertNotIn(installer.PROJECTS['staging'], result)
            self.assertIn("name='squad_jobs_invocation_secret'", result)

    def test_cron_rejects_foreign_origin_extra_sql_and_wrong_route(self):
        variants = [
            command().replace(installer.PROJECTS['staging'], 'foreign'),
            command().replace("body:='{}'", "body:='https://foreign.example/'"),
            command() + ' DELETE FROM public.orders;',
            command().replace('net.http_post', 'unsafe.run'),
            command().replace('squad_jobs_invocation_secret', 'foreign_secret'),
            command().replace("body:='{}'", "body:=unsafe.side_effect()"),
            command('warehouse-rehearsal'),
            command('media-cleanup'),
        ]
        for value in variants:
            with self.subTest(value=variants.index(value)), self.assertRaises(Exception):
                installer.normalized_command(value, 'production', 'squad-jobs-minute')

    def test_demand_pump_grouped_due_predicate_is_preserved(self):
        value = command().rstrip(';') + " AND EXISTS(SELECT FROM sa_domain.outbox WHERE attempts<5 AND(status='pending' AND available_at<=now() OR status='leased' AND lease_until<now()) AND sa_domain.job_handler(event_type,payload) IN('transfer','document_render'));"
        actual = installer.normalized_command(value, 'production', 'squad-documents-pump')
        self.assertEqual(actual, value.replace(installer.PROJECTS['staging'], installer.PROJECTS['production']))

    def test_existing_secret_rotation_is_refused(self):
        key = 'SQUAD_ACCOUNT_SECRET'
        with self.assertRaisesRegex(Exception, 'refusing rotation'):
            installer.managed_secret({key: metadata('external-change' * 4)}, key, 'managed-value' * 4)
        with self.assertRaisesRegex(Exception, 'no managed Vault'):
            installer.managed_secret({key: metadata('external-change' * 4)}, key, None)

    def test_vault_commit_recovery_and_existing_key_are_stable(self):
        key, value = 'SQUAD_JOBS_SECRET', 'managed-value' * 4
        self.assertEqual(installer.managed_secret({}, key, value), (value, False, True))
        self.assertEqual(installer.managed_secret({key: metadata(value)}, key, value), (value, False, False))
        created, create_vault, write_edge = installer.managed_secret({}, key, None)
        self.assertGreaterEqual(len(created), 32)
        self.assertTrue(create_vault and write_edge)

    def test_existing_unsafe_mirror_configuration_is_not_preserved(self):
        for name, value in [('SQUAD_PUSH_MODE', 'deliver'), ('SQUAD_WEBHOOK_ENABLED', 'true'),
                            ('SQUAD_WAREHOUSE_ENABLED', 'true'), ('SQUAD_WAREHOUSE_ENVIRONMENT', 'staging')]:
            with self.subTest(name=name), self.assertRaisesRegex(Exception, 'safe mirror configuration'):
                installer.safe_configuration({name: metadata(value)}, 'production')

    def test_digest_is_mandatory_before_preserving_secret(self):
        for value in ({}, {'digest': None}, {'digest': 'not-a-digest'}):
            with self.subTest(value=value), self.assertRaisesRegex(Exception, 'digest unavailable'):
                installer.secret_matches(value, 'anything')

    def test_management_value_field_is_digest_not_plaintext(self):
        self.assertTrue(installer.secret_matches({'value': hashlib.sha256(b'validate_only').hexdigest()}, 'validate_only'))
        with self.assertRaisesRegex(Exception, 'digest unavailable'):
            installer.secret_matches({'value': 'validate_only'}, 'validate_only')


class Cursor:
    def __init__(self, rows): self.rows = rows
    def fetchone(self): return self.rows[0] if self.rows else None
    def fetchall(self): return self.rows
    def __iter__(self): return iter(self.rows)


class FakeConnection:
    def __init__(self, state, env): self.state, self.env = state, env
    def __enter__(self): return self
    def __exit__(self, *args): pass
    @contextmanager
    def transaction(self):
        before = copy.deepcopy((self.state.vault, self.state.crons))
        try: yield self
        except BaseException:
            self.state.vault, self.state.crons = before
            raise
    def execute(self, query, args=None):
        q = ' '.join(query.split())
        self.state.sql.append(q)
        if 'pg_try_advisory_lock(20261107,1)' in q:
            self.state.locked = self.state.allow_lock
            return Cursor([(self.state.allow_lock,)])
        if 'pg_advisory_unlock(20261107,1)' in q:
            self.state.locked = False
            return Cursor([(True,)])
        if q.startswith('SELECT environment,cutover,active_job'):
            return Cursor([(self.env, self.state.cutover, None)])
        if q.startswith('SELECT allow_test_writes'):
            return Cursor([(False, [], None)])
        if q.startswith('SELECT count(*) FROM sa_domain.outbox'):
            return Cursor([(self.state.pending,)])
        if 'FROM cron.job WHERE jobname=ANY' in q:
            return Cursor([(n, s, c, True) for n, s, c in self.state.source_crons])
        if 'FROM supabase_migrations.schema_migrations' in q:
            return Cursor([('20261108125014', ['reviewed'])])
        if q.startswith('SELECT extname'):
            return Cursor([(x,) for x in ['pg_cron', 'pg_net', 'supabase_vault']])
        if 'FROM cron.job WHERE jobname<>ALL' in q:
            return Cursor(copy.deepcopy(self.state.unrelated))
        if q.startswith('SELECT decrypted_secret'):
            value = self.state.vault.get(args[0])
            return Cursor([(value,)] if value else [])
        if q.startswith('SELECT vault.create_secret'):
            self.state.vault[args[1]] = args[0]
            return Cursor([('new-id',)])
        if q.startswith('INSERT INTO storage.buckets'):
            return Cursor([])
        if q.startswith('SELECT public,file_size_limit'):
            limit, mimes = installer.BUCKETS[args[0]]
            return Cursor([(False, limit, mimes)])
        if q.startswith('SELECT schedule,command,active FROM cron.job'):
            value = self.state.crons.get(args[0])
            return Cursor([value] if value else [])
        if q.startswith('SELECT cron.schedule'):
            self.state.crons[args[0]] = (args[1], args[2], True)
            return Cursor([(100,)])
        raise AssertionError('Unexpected installer SQL: ' + q)


class FakeRuntime:
    def __init__(self):
        self.vault, self.secrets, self.crons, self.functions, self.sql = {}, {}, {}, {}, []
        self.locked, self.allow_lock, self.cutover, self.pending = False, True, False, 0
        self.fail_secret_post = False
        self.unrelated = [(1, 'existing-job', '0 21 * * *', 'SELECT existing.task()', False)]
        self.source_crons = [(n, '17 * * * *' if n.endswith('cleanup') else '5 seconds',
                              command('media-cleanup' if n.endswith('cleanup') else 'run')) for n in installer.CRONS]
        self.source_functions = {n: {'slug': n, 'verify_jwt': False, 'status': 'ACTIVE',
                                     'ezbr_sha256': 'artifact-' + n} for n in installer.FUNCTIONS}
    def connect(self, env, readonly=False): return FakeConnection(self, env)
    def api(self, env, path, body=None, method=None):
        assert self.locked, 'Remote step must keep the environment guard'
        if path == '/functions':
            return list((self.source_functions if env == 'staging' else self.functions).values())
        if path == '/secrets':
            if method == 'POST':
                if self.fail_secret_post:
                    self.fail_secret_post = False
                    raise RuntimeError('Synthetic API interruption after Vault commit')
                self.secrets.update({x['name']: metadata(x['value']) for x in body})
                return None
            return [dict(name=k, **v) for k, v in self.secrets.items()]
        raise AssertionError(path)
    def deploy(self, args, **kwargs):
        assert self.locked
        assert args[:3] == ['supabase', 'functions', 'deploy'] and '--prune' not in args
        self.functions[args[3]] = self.source_functions[args[3]]


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeRuntime()
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        (root / 'docs/squad-one-audit/implementation-evidence').mkdir(parents=True)
        supplied = {'SQUAD_SMTP_' + k: 'synthetic-' + k for k in ['HOST', 'PORT', 'USERNAME', 'PASSWORD', 'SENDER']}
        supplied['SQUAD_FIREBASE_SERVICE_ACCOUNT'] = 'synthetic-service-account'
        self.patches = [patch.object(installer, 'connect', self.fake.connect),
                        patch.object(installer, 'api', self.fake.api),
                        patch.object(installer, 'legacy_mail', return_value=supplied),
                        patch.object(installer, 'public_structure', return_value='unchanged'),
                        patch.object(installer, 'token', return_value='synthetic-management-key'),
                        patch.object(installer.subprocess, 'run', self.fake.deploy),
                        patch.object(installer, 'ROOT', root)]
        for p in self.patches: p.start()
        self.output = io.StringIO()
        self.redirect = redirect_stdout(self.output)
        self.redirect.__enter__()
    def tearDown(self):
        self.redirect.__exit__(None, None, None)
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()

    def test_preflight_has_no_mutation_and_releases_guard(self):
        installer.run()
        self.assertEqual((self.fake.vault, self.fake.secrets, self.fake.functions, self.fake.crons), ({}, {}, {}, {}))
        self.assertFalse(self.fake.locked)

    def test_apply_and_repeat_preserve_unrelated_work_and_keys(self):
        before = copy.deepcopy(self.fake.unrelated)
        installer.run(True)
        keys = copy.deepcopy(self.fake.vault)
        installer.run(True)
        self.assertEqual(self.fake.vault, keys)
        self.assertEqual(self.fake.unrelated, before)
        self.assertEqual(set(self.fake.functions), set(installer.FUNCTIONS))
        self.assertEqual(set(self.fake.crons), set(installer.CRONS))
        mutations = [q for q in self.fake.sql if re_mutation(q)]
        self.assertTrue(all(q.startswith('INSERT INTO storage.buckets') for q in mutations))
        self.assertNotIn('synthetic-management-key', self.output.getvalue())
        self.assertNotIn('synthetic-PASSWORD', self.output.getvalue())
        self.assertFalse(self.fake.locked)

    def test_vault_committed_api_failure_recovers_without_rotation(self):
        self.fake.fail_secret_post = True
        with self.assertRaisesRegex(RuntimeError, 'Synthetic API interruption'):
            installer.run(True)
        keys = copy.deepcopy(self.fake.vault)
        self.assertEqual(len(keys), 2)
        self.assertFalse(self.fake.locked)
        installer.run(True)
        self.assertEqual(self.fake.vault, keys)

    def test_changed_owned_cron_is_not_overwritten(self):
        self.fake.crons['squad-jobs-minute'] = ('1 * * * *', 'SELECT foreign.task()', False)
        before = copy.deepcopy(self.fake.crons)
        with self.assertRaisesRegex(Exception, 'Existing owned schedule differs'):
            installer.run(True)
        self.assertEqual(self.fake.crons, before)
        self.assertFalse(self.fake.locked)

    def test_active_cutover_or_jobs_or_exclusive_lock_refuses_provisioning(self):
        for field, value in [('cutover', True), ('pending', 1), ('allow_lock', False)]:
            with self.subTest(field=field):
                setattr(self.fake, field, value)
                with self.assertRaises(Exception): installer.run(True)
                self.assertEqual(self.fake.vault, {})
                self.assertEqual(self.fake.secrets, {})
                setattr(self.fake, field, False if field == 'cutover' else 0 if field == 'pending' else True)


def re_mutation(query):
    return query.split(' ', 1)[0] in {'INSERT', 'UPDATE', 'DELETE', 'ALTER', 'DROP', 'CREATE', 'TRUNCATE'}


if __name__ == '__main__': unittest.main()
