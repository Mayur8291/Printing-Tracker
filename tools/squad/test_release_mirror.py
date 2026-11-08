"""Release rehearsal: exact reviewed history, source preservation and recovery.

Only the isolated local PostgreSQL harness is used. No provider, Management API,
hosted deployment or filesystem baseline is modified.
"""
from contextlib import contextmanager
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import psycopg
from local_db import connect
import release_mirror as release


class MirrorReleaseInputs(unittest.TestCase):
    def test_explicit_post_commit_presence_exception_is_narrow(self):
        old = {'public': {'hr_user_presence': {'rows': 21, 'digest': ['before']},
                          'admin_emails': {'rows': 1, 'digest': ['admin']}},
               'auth': {'users': {'rows': 100, 'digest': ['credentials']}}}
        new = json.loads(json.dumps(old))
        new['public']['hr_user_presence']['digest'] = ['heartbeat']
        with self.assertRaisesRegex(RuntimeError, 'data changed'):
            release.recovery_data_check(new, old)
        self.assertEqual(release.recovery_data_check(new, old, True), ['public.hr_user_presence'])
        for group, table in [('auth', 'users'), ('public', 'admin_emails')]:
            changed = json.loads(json.dumps(new)); changed[group][table]['digest'] = ['changed']
            with self.assertRaisesRegex(RuntimeError, 'beyond'):
                release.recovery_data_check(changed, old, True)
        new['public']['hr_user_presence']['rows'] = 22
        with self.assertRaisesRegex(RuntimeError, 'data changed'):
            release.recovery_data_check(new, old, True)

    def test_explicit_cutoff_and_squad_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory/'20261109000000_squad_one.sql').write_text('SELECT 1;')
            (directory/'20261109000001_unrelated.sql').write_text('SELECT 2;')
            got = release.migrations('20261109000000', directory)
            self.assertEqual([m.name for m in got], ['squad_one'])
            for invalid in (None, '', 'latest', '20261109000001'):
                with self.assertRaises(RuntimeError): release.migrations(invalid, directory)

    def test_history_requires_exact_staging_bodies_names_and_full_prefix(self):
        m = release.Migration('20261109000000', 'squad_one', 'SELECT 1;')
        good = {m.version: {'name': m.name, 'statements': [m.body]}}
        release.verify_history(good, [m], complete=True)
        for rows in ({}, {m.version: {'name': m.name, 'statements': ['SELECT 2;']}},
                     {m.version: {'name': 'other', 'statements': [m.body]}},
                     good | {'20261109000001': {'name': 'squad_later', 'statements': ['SELECT 3;']}}):
            with self.assertRaises(RuntimeError): release.verify_history(rows, [m], complete=True)

    def test_existing_non_squad_history_is_preserved(self):
        m = release.Migration('20261109000000', 'squad_one', 'SELECT 1;')
        release.verify_history({'20200101000000': {'name': 'old_schema', 'statements': ['SELECT 1;']}},
                               [m], complete=False)

    def test_atomic_json_replaces_complete_file_with_private_permissions(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'receipt.json'
            release.atomic_json(path, {'before': 1})
            release.atomic_json(path, {'after': 2})
            self.assertEqual(json.loads(path.read_text()), {'after': 2})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertFalse(path.with_name(path.name+'.tmp').exists())

    def test_baseline_failure_retains_durable_recovery_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'receipt.json'
            saved = {'after': {'catalog': [1], 'domain-access': [2]}}
            release.atomic_json(path, saved)
            original = release.atomic_json
            def fail_second(target, value):
                if 'domain-access' in target.name: raise OSError('injected disk failure')
                return original(target, value)
            with patch.object(release, 'atomic_json', side_effect=fail_second), self.assertRaises(OSError):
                release.baseline_publish('production', saved, Path(tmp))
            self.assertTrue(path.exists())
            self.assertEqual(json.loads((Path(tmp)/'production-catalog.json').read_text()), [1])


class MirrorReleaseDatabase(unittest.TestCase):
    def setUp(self):
        self.c = connect()
        self.c.execute('BEGIN ISOLATION LEVEL REPEATABLE READ')
        self.c.execute("SET LOCAL search_path=pg_catalog")
        self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")
        self.c.execute("UPDATE sa_sync.environment_state SET cutover=false,active_job=NULL,environment='staging'")
        self.c.execute('CREATE SCHEMA IF NOT EXISTS supabase_migrations')
        self.c.execute('CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[])')
        self.c.execute('DELETE FROM supabase_migrations.schema_migrations')
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)/'release.json'
        self.silence = patch.object(release, 'progress'); self.silence.start()
        # Tests preserve an outer rollback transaction. The real guard/locking
        # code still runs, but SET TRANSACTION cannot run inside its savepoint.
        self.locked_patch = patch.object(release, 'locked', side_effect=self.locked)
        self.locked_patch.start()
        self.catalog_patch = patch.object(release, 'check_catalog'); self.catalog_patch.start()

    def tearDown(self):
        self.catalog_patch.stop(); self.locked_patch.stop(); self.silence.stop()
        self.c.execute('ROLLBACK'); self.c.close(); self.tmp.cleanup()

    def locked(self, c, environment):
        self.assertTrue(c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0])
        c.execute('LOCK TABLE sa_sync.environment_state IN ACCESS EXCLUSIVE MODE')
        state = release.environment_state(c, environment)
        columns, projection = release.source_projection(c)
        c.execute(psycopg.sql.SQL('LOCK TABLE {} IN SHARE MODE').format(psycopg.sql.SQL(',').join(
            psycopg.sql.Identifier(release.SCHEMA, table) for table in projection)))
        return state, columns, projection

    def migration(self, body):
        return release.Migration('20261109000000', 'squad_release_mirror_test', body)

    def expected(self, migration):
        with self.c.transaction():
            for statement in release.statements(migration.body): self.c.execute(statement)
            result = release.artifact_catalog(self.c)
            raise psycopg.Rollback()
        return result

    def execute(self, migration, *, check=True, expected=None):
        return release.execute_release(self.c, 'staging', [migration],
            release.artifact_catalog(self.c) if expected is None else expected, None,
            check=check, receipt_path=self.path)

    def test_default_release_is_real_atomic_rollback(self):
        migration = self.migration("CREATE FUNCTION sa_domain.release_mirror_test() RETURNS integer LANGUAGE sql AS 'SELECT 1'; REVOKE ALL ON FUNCTION sa_domain.release_mirror_test() FROM PUBLIC")
        expected = self.expected(migration)
        result = self.execute(migration, expected=expected)
        self.assertEqual(result['mode'], 'rollback verification')
        self.assertEqual(len(result['projection']), 86)
        self.assertIsNone(self.c.execute("SELECT to_regprocedure('sa_domain.release_mirror_test()')").fetchone()[0])
        self.assertEqual(self.c.execute('SELECT count(*) FROM supabase_migrations.schema_migrations').fetchone()[0], 0)
        self.assertFalse(self.path.exists())

    def test_committed_path_writes_exact_recovery_receipt(self):
        migration = self.migration('SELECT 1;')
        result = self.execute(migration, check=False)
        self.assertEqual(result, json.loads(self.path.read_text()))
        self.assertEqual(self.c.execute('SELECT statements FROM supabase_migrations.schema_migrations').fetchone()[0], [migration.body])
        with self.assertRaisesRegex(RuntimeError, 'recover first'): self.execute(migration, check=False)

    def test_source_business_update_is_detected_and_rolled_back(self):
        # A source metadata table is used so the test works without persona seeds.
        before = release.row_digest(self.c, release.SCHEMA, 'sa_ar_internal_metadata')
        migration = self.migration("INSERT INTO sa_snapshot_20261019.sa_ar_internal_metadata(key,value,created_at,updated_at) VALUES('release-test','forbidden',now(),now())")
        with self.assertRaisesRegex(RuntimeError, 'Protected source'): self.execute(migration)
        self.assertEqual(release.row_digest(self.c, release.SCHEMA, 'sa_ar_internal_metadata'), before)

    def test_existing_source_column_change_is_rejected(self):
        migration = self.migration('ALTER TABLE sa_snapshot_20261019.sa_orders ADD COLUMN unreviewed text')
        with self.assertRaisesRegex(RuntimeError, 'column definitions'): self.execute(migration)
        self.assertFalse(any(r[1]=='unreviewed' for r in release.column_catalog(self.c)))

    def test_public_data_and_auth_credentials_are_protected(self):
        # Auth INSERT bypasses imported identities only for a plain non-Canto
        # principal; source/global Auth hooks still run in the local database.
        for body in ("INSERT INTO public.admin_emails(email) VALUES('release-owned@example.com')",
                     "INSERT INTO auth.users(id,role,email,encrypted_password) VALUES('aaaaaaaa-0000-0000-0000-000000000001','authenticated','release-owned@example.com','test-hash')"):
            with self.subTest(body=body[:30]), self.assertRaisesRegex(RuntimeError, 'Protected source'):
                self.execute(self.migration(body))

    def test_auth_operational_timestamps_excluded_but_password_not_excluded(self):
        user = self.c.execute("SELECT id FROM auth.users LIMIT 1").fetchone()
        if user is None:
            self.c.execute("INSERT INTO auth.users(id,role,email,encrypted_password) VALUES('aaaaaaaa-0000-0000-0000-000000000002','authenticated','timestamp@example.com','test-hash')")
            user = ('aaaaaaaa-0000-0000-0000-000000000002',)
        before = release.row_digest(self.c, 'auth', 'users', excluded=('updated_at','last_sign_in_at'))
        self.c.execute('UPDATE auth.users SET updated_at=clock_timestamp() WHERE id=%s', user)
        self.assertEqual(release.row_digest(self.c, 'auth', 'users', excluded=('updated_at','last_sign_in_at')), before)
        with self.c.transaction():
            self.c.execute("UPDATE auth.users SET raw_user_meta_data=raw_user_meta_data||'{\"release_test\":true}' WHERE id=%s", user)
            self.assertNotEqual(release.row_digest(self.c, 'auth', 'users', excluded=('updated_at','last_sign_in_at')), before)
            raise psycopg.Rollback()

    def test_true_sequence_change_is_detected(self):
        before = release.sequence_states(self.c)
        name = next(iter(before))
        # Transactional ALTER RESTART: unlike setval this test itself rolls back.
        statement = psycopg.sql.SQL('ALTER SEQUENCE {}.{} RESTART WITH 987654321').format(
            psycopg.sql.Identifier(release.SCHEMA), psycopg.sql.Identifier(name)).as_string(self.c)
        with self.assertRaisesRegex(RuntimeError, 'sequences changed'): self.execute(self.migration(statement))
        self.assertEqual(release.sequence_states(self.c), before)

    def test_staging_artifact_mismatch_rolls_back(self):
        migration = self.migration("CREATE FUNCTION sa_domain.release_mirror_test() RETURNS integer LANGUAGE sql AS 'SELECT 1'; REVOKE ALL ON FUNCTION sa_domain.release_mirror_test() FROM PUBLIC")
        with self.assertRaisesRegex(RuntimeError, 'differ from'): self.execute(migration)
        self.assertIsNone(self.c.execute("SELECT to_regprocedure('sa_domain.release_mirror_test()')").fetchone()[0])

    def test_unsafe_publicly_callable_domain_function_rolls_back(self):
        migration = self.migration("CREATE FUNCTION sa_domain.release_mirror_test() RETURNS integer LANGUAGE sql AS 'SELECT 1'; GRANT EXECUTE ON FUNCTION sa_domain.release_mirror_test() TO PUBLIC")
        with self.assertRaisesRegex(RuntimeError, 'Unsafe domain'): self.execute(migration)

    def test_source_column_table_and_schema_grants_cannot_be_blessed(self):
        for body in ('GRANT UPDATE(encrypted_password) ON sa_snapshot_20261019.sa_users TO sa_executor',
                     'GRANT SELECT ON sa_snapshot_20261019.sa_orders TO authenticated',
                     'GRANT CREATE ON SCHEMA sa_domain TO sa_app',
                     'ALTER DEFAULT PRIVILEGES FOR ROLE sa_executor GRANT SELECT ON TABLES TO authenticated'):
            with self.subTest(body=body), self.assertRaisesRegex(RuntimeError, 'differ from'):
                self.execute(self.migration(body))

    def test_private_membership_and_role_powers_cannot_be_blessed(self):
        for body in ('GRANT sa_executor TO authenticated WITH INHERIT FALSE, SET TRUE',
                     'ALTER ROLE sa_app CREATEROLE', 'ALTER ROLE sa_executor CREATEDB',
                     'ALTER ROLE sa_worker REPLICATION'):
            with self.subTest(body=body), self.assertRaisesRegex(RuntimeError, 'Private role|Unsafe private'):
                self.execute(self.migration(body))

    def test_media_references_and_storage_objects_are_preserved(self):
        for body in ("INSERT INTO sa_media.objects(sha256,object_path,bytes,content_type) VALUES(repeat('f',64),'release-mirror-test',1,'application/pdf')",
                     "INSERT INTO sa_admin.media(resource,record_id,field,url) VALUES('users',1900000099,'profile_image','release-mirror-test')",
                     "INSERT INTO storage.objects(id,bucket_id,name) VALUES('aaaaaaaa-0000-0000-0000-000000000003','squad-documents','release-mirror-test')"):
            with self.subTest(body=body[:40]), self.assertRaisesRegex(RuntimeError, 'Protected source'):
                self.execute(self.migration(body))

    def test_existing_bucket_changes_and_foreign_bucket_additions_are_rejected(self):
        for body in ("UPDATE storage.buckets SET public=true WHERE id='squad-documents'",
                     "INSERT INTO storage.buckets(id,name,public) VALUES('release-unreviewed','release-unreviewed',false)"):
            with self.subTest(body=body[:40]), self.assertRaisesRegex(RuntimeError, 'Protected source'):
                self.execute(self.migration(body))

    def test_only_exact_known_private_bucket_addition_is_allowed(self):
        self.c.execute("DELETE FROM storage.buckets WHERE id='squad-uploads'")
        wrong = "INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('squad-uploads','squad-uploads',true,104857600)"
        with self.assertRaisesRegex(RuntimeError, 'configuration differs'): self.execute(self.migration(wrong))
        right = wrong.replace('true,104857600', 'false,104857600')
        self.assertEqual(self.execute(self.migration(right))['mode'], 'rollback verification')
        self.assertFalse(self.c.execute("SELECT 1 FROM storage.buckets WHERE id='squad-uploads'").fetchone())

    def test_migration_batch_preserves_nested_semicolons_order_and_history(self):
        migration = self.migration("""BEGIN;
          CREATE FUNCTION sa_domain.release_batch_first() RETURNS text LANGUAGE plpgsql AS $f$
            BEGIN PERFORM 1; RETURN 'first;second'; END $f$;
          REVOKE ALL ON FUNCTION sa_domain.release_batch_first() FROM PUBLIC;
          CREATE FUNCTION sa_domain.release_batch_second() RETURNS text LANGUAGE sql AS $f$
            SELECT sa_domain.release_batch_first()||';third' $f$;
          REVOKE ALL ON FUNCTION sa_domain.release_batch_second() FROM PUBLIC;
          COMMIT;""")
        expected = self.expected(migration)
        self.execute(migration, check=False, expected=expected)
        self.assertEqual(self.c.execute('SELECT sa_domain.release_batch_second()').fetchone(), ('first;second;third',))
        self.assertEqual(self.c.execute('SELECT statements FROM supabase_migrations.schema_migrations').fetchone()[0], [migration.body])

    def test_failed_batch_rolls_back_earlier_statements(self):
        migration = self.migration("CREATE TABLE sa_domain.release_batch_probe(id int); SELECT 1/0;")
        with self.assertRaisesRegex(RuntimeError, 'SQLSTATE=22012'): self.execute(migration)
        self.assertIsNone(self.c.execute("SELECT to_regclass('sa_domain.release_batch_probe')").fetchone()[0])

    def test_mirror_cutover_and_rehearsal_guards(self):
        for statement in ("UPDATE sa_sync.environment_state SET cutover=true",
                          "UPDATE sa_domain.runtime_state SET allow_test_writes=true",
                          "UPDATE sa_sync.environment_state SET active_job=gen_random_uuid()"):
            with self.c.transaction():
                self.c.execute(statement)
                with self.assertRaises(RuntimeError): self.execute(self.migration('SELECT 1'))
                raise psycopg.Rollback()

    def test_approved_companion_columns_match_staging_without_source_value_changes(self):
        columns = release.column_catalog(self.c)
        spec = release.bootstrap_spec(release.ROOT/'tools/squad/sql/production_snapshot_compatibility.sql', columns)
        self.assertEqual(release.apply_bootstrap(self.c, spec, columns), [])
        # Reproduce the first-install source shape only inside this outer local
        # rollback transaction; production release never drops any column.
        for name in ('squad_warehouse_active_poll', 'squad_uniware_failed_recovery'):
            self.c.execute(psycopg.sql.SQL('DROP INDEX IF EXISTS {}.{}').format(
                psycopg.sql.Identifier(release.SCHEMA), psycopg.sql.Identifier(name)))
        self.c.execute('ALTER TABLE sa_snapshot_20261019.sa_orders DROP COLUMN dashboard_reservation_id CASCADE, DROP COLUMN order_source CASCADE')
        before, projection = release.source_projection(self.c)
        data = release.protected_data(self.c, projection)
        self.assertEqual(release.apply_bootstrap(self.c, spec, before), sorted(release.COMPANION_COLUMNS))
        release.assert_columns_unchanged(self.c, before, spec, sorted(release.COMPANION_COLUMNS))
        self.assertEqual(release.protected_data(self.c, projection), data)

    def test_bootstrap_rejects_unexpected_sql_and_defaults(self):
        columns = release.column_catalog(self.c)
        original_read = Path.read_text
        path = release.ROOT/'tools/squad/sql/production_snapshot_compatibility.sql'
        for body in ("DELETE FROM sa_snapshot_20261019.sa_orders",
                     "ALTER TABLE sa_snapshot_20261019.sa_orders ADD COLUMN arbitrary text",
                     "ALTER TABLE sa_snapshot_20261019.sa_orders ADD COLUMN dashboard_reservation_id varchar; ALTER TABLE sa_snapshot_20261019.sa_orders ADD COLUMN order_source varchar NOT NULL DEFAULT 'dashboard'"):
            with patch.object(Path, 'read_text', lambda target: body if target==path.resolve() else original_read(target)):
                with self.assertRaises(RuntimeError): release.bootstrap_spec(path, columns)

    @contextmanager
    def borrowed(self, *args, **kwargs):
        yield self.c

    def test_committed_baseline_recovery_never_reexecutes_migration(self):
        migration = self.migration('SELECT 1;')
        expected = release.artifact_catalog(self.c)
        self.execute(migration, check=False)
        published = []
        with patch.object(release, 'connect', self.borrowed), patch.object(release, 'baseline_publish',
                side_effect=lambda environment, saved: published.append((environment,saved['after']))):
            result = release.recover('staging', migration.version, [migration], expected, self.path)
        self.assertEqual(result['mode'], 'committed release baselines recovered')
        self.assertEqual(len(published), 1)
        self.assertFalse(self.path.exists())

    def test_uncommitted_receipt_recovers_without_publishing_new_baseline(self):
        migration = self.migration('SELECT 1;')
        expected = release.artifact_catalog(self.c)
        with self.c.transaction():
            self.execute(migration, check=False)
            raise psycopg.Rollback()
        with patch.object(release, 'connect', self.borrowed), patch.object(release, 'baseline_publish') as publish:
            result = release.recover('staging', migration.version, [migration], expected, self.path)
        self.assertIn('did not commit', result['mode']); publish.assert_not_called()
        self.assertFalse(self.path.exists())

    def test_recovery_rejects_tampered_destination_and_changed_data(self):
        migration = self.migration('SELECT 1;')
        expected = release.artifact_catalog(self.c)
        self.execute(migration, check=False)
        saved = json.loads(self.path.read_text())
        saved['project_ref'] = release.PROJECTS['production']
        release.atomic_json(self.path, saved)
        with self.assertRaisesRegex(RuntimeError, 'target differs'):
            release.recover('staging', migration.version, [migration], expected, self.path)
        saved['project_ref'] = release.PROJECTS['staging']; release.atomic_json(self.path, saved)
        self.c.execute("INSERT INTO public.admin_emails(email) VALUES('after-commit@example.com')")
        with patch.object(release, 'connect', self.borrowed), self.assertRaisesRegex(RuntimeError, 'data changed'):
            release.recover('staging', migration.version, [migration], expected, self.path)
        self.assertTrue(self.path.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
