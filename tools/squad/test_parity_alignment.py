"""Real PostgreSQL checks for the explicit environment compatibility release."""
import unittest
from pathlib import Path
from unittest.mock import patch
import psycopg
import local_db
import release_mirror as release
from verify_mirror_parity import schema_rows


class AlignmentTests(unittest.TestCase):
    def setUp(self):
        self.c = local_db.connect()
        self.c.execute('BEGIN')
        self.c.execute('SET search_path=pg_catalog')
        self.c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")
        self.c.execute('UPDATE sa_sync.environment_state SET cutover=false,active_job=NULL')

    def tearDown(self):
        self.c.execute('ROLLBACK')
        self.c.close()

    def test_reviewed_collation_inventory_and_no_casts(self):
        path = release.ROOT / 'tools/squad/sql/production_collation_compatibility.sql'
        columns = schema_rows(self.c)['columns']
        spec = release.collation_spec(path, columns)
        self.assertEqual(len(spec['columns']), 155)
        body = path.read_text()
        for invalid in (body + '\nDROP TABLE sa_identity.sa_auth_identities;',
                        body.replace('COLLATE pg_catalog."default";', 'COLLATE pg_catalog."default" USING NULL;', 1),
                        body.replace('COLLATE pg_catalog."default";', 'COLLATE pg_catalog."C";', 1)):
            with patch.object(Path, 'read_text', return_value=invalid), self.assertRaises(RuntimeError):
                release.collation_spec(path, columns)

    def test_collation_alignment_preserves_values_and_type(self):
        if not self.c.execute("SELECT 1 FROM pg_collation WHERE collname='C.utf8' AND collnamespace='pg_catalog'::regnamespace").fetchone():
            # macOS calls the byte-order locale C; hosted Linux has C.utf8.
            self.c.execute('CREATE COLLATION pg_catalog."C.utf8" FROM pg_catalog."C"')
        self.c.execute('CREATE TABLE sa_identity.parity_text(value varchar(30) COLLATE pg_catalog."C.utf8")')
        self.c.execute("INSERT INTO sa_identity.parity_text VALUES ('éclair'),('Zebra'),('alice'),(NULL)")
        before = release.row_digest(self.c, 'sa_identity', 'parity_text')
        spec = {'columns': [['sa_identity', 'parity_text', 'value', 'character varying(30)']]}
        release.align_collations(self.c, spec)
        self.assertEqual(before, release.row_digest(self.c, 'sa_identity', 'parity_text'))
        self.assertEqual(self.c.execute("SELECT format_type(atttypid,atttypmod),attcollation::regcollation::text FROM pg_attribute WHERE attrelid='sa_identity.parity_text'::regclass AND attname='value'").fetchone(), ('character varying(30)', '"default"'))
        release.align_collations(self.c, spec)
        with self.assertRaises(RuntimeError):
            release.align_collations(self.c, {'columns': [['sa_identity', 'parity_text', 'value', 'text']]})

    def test_identity_alignment_preserves_rows_and_adds_validated_checks(self):
        before = release.row_digest(self.c, 'sa_identity', 'sa_auth_identities')
        body = (release.ROOT / 'supabase/migrations/20261108144542_squad_backend_environment_parity.sql').read_text()
        for stmt in release.statements(body):
            self.c.execute(stmt)
        self.assertEqual(before, release.row_digest(self.c, 'sa_identity', 'sa_auth_identities'))
        rows = self.c.execute("SELECT conname,convalidated FROM pg_constraint WHERE conrelid='sa_identity.sa_auth_identities'::regclass AND conname IN('sa_auth_identities_state_check','sa_auth_identities_confirmation_check','sa_auth_identities_disposition_check')").fetchall()
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(r[1] for r in rows))
        with self.assertRaises(psycopg.errors.CheckViolation), self.c.transaction():
            self.c.execute("INSERT INTO sa_identity.sa_auth_identities(auth_user_id,legacy_user_id,canonical_email,enrollment_state,confirmation_basis,import_disposition,source_was_confirmed) VALUES(gen_random_uuid(),-999999,'fixture@invalid.test','invalid','source_confirmed','candidate',true)")

    def test_rehearsal_blocks_alignment(self):
        self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
        body = (release.ROOT / 'supabase/migrations/20261108144542_squad_backend_environment_parity.sql').read_text()
        with self.assertRaises(psycopg.errors.RaiseException):
            for stmt in release.statements(body):
                self.c.execute(stmt)


if __name__ == '__main__':
    unittest.main()
