import json,tempfile,unittest
from pathlib import Path
from pglast import parse_sql
import legacy_remap as legacy
from snapshot import read_schema,render_schema,fingerprint
from sync import check_capture

class SafetyTests(unittest.TestCase):
    def test_fingerprint_order_independent_but_duplicate_sensitive(self):
        self.assertEqual(fingerprint([b'a\n',b'b\n']),fingerprint([b'b\n',b'a\n']))
        self.assertNotEqual(fingerprint([b'a\n']),fingerprint([b'a\n',b'a\n']))
        self.assertNotEqual(fingerprint([b'a\n']),fingerprint([b'b\n']))
    def test_wrong_environment_rejected_before_archive(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);(p/'capture.json').write_text(json.dumps({'environment':'production'}))
            with self.assertRaisesRegex(RuntimeError,'environment mismatch'):check_capture('staging',p)
    def test_reviewed_staging_schema_roundtrip(self):
        m,_=read_schema(Path(__file__).resolve().parent / Path('tests/fixtures/staging-schema.sql'),'staging')
        statements=render_schema(m,'sa_import_test')
        self.assertGreater(len(statements),500)
        self.assertEqual(len(m.tables),86)
        self.assertIn('dashboard_reservation_id',m.tables['orders'])
        for s in ['DROP TABLE public.users','CREATE TABLE public.rogue(id bigint)',
                  'CREATE TABLE evil.users(id bigint)',
                  "ALTER TABLE public.users ALTER COLUMN id SET DEFAULT nextval('public.rogue'::regclass)"]:
            with self.assertRaises(RuntimeError):m.transform(parse_sql(s)[0].stmt)
    def test_reject_public_destination(self):
        m,_=read_schema(Path(__file__).resolve().parent / Path('tests/fixtures/production-schema.sql'),'production')
        with self.assertRaises(RuntimeError):render_schema(m,'public')
    def test_production_schema_roundtrip(self):
        m,_=read_schema(Path(__file__).resolve().parent / Path('tests/fixtures/production-schema.sql'),'production')
        self.assertEqual(len(m.foreign_keys),150)
        render_schema(m,'sa_import_test')
        self.assertEqual(len(legacy.negative_tests(m)),8)
    def test_copy_key_escaping_and_composite_keys(self):
        from delta_sync import keyed
        row=b'alpha\\tbeta\t42\tline\\nvalue\n'
        self.assertEqual(keyed(row,[0]),b'alpha\\tbeta')
        self.assertEqual(keyed(row,[0,1]),b'alpha\\tbeta\t42')
    def test_source_primary_keys_complete(self):
        from delta_sync import primary_keys
        m,_=read_schema(Path(__file__).resolve().parent / Path('tests/fixtures/production-schema.sql'),'production')
        keys=primary_keys(m)
        self.assertEqual(len(keys),86)
        self.assertEqual(keys['users'],['id'])
        self.assertEqual(keys['ar_internal_metadata'],['key'])
        self.assertEqual(keys['schema_migrations'],['version'])
    def test_copy_cannot_run_program(self):
        m,_=read_schema(Path(__file__).resolve().parent / Path('tests/fixtures/production-schema.sql'),'production')
        with self.assertRaises(RuntimeError):legacy.transform_copy(parse_sql("COPY public.users FROM PROGRAM 'id'")[0].stmt,m)
    def test_sequence_cannot_execute_expression(self):
        m,_=read_schema(Path(__file__).resolve().parent / Path('tests/fixtures/production-schema.sql'),'production')
        with self.assertRaises(RuntimeError):legacy.transform_setval(parse_sql("SELECT pg_catalog.setval('public.users_id_seq', pg_catalog.pg_backend_pid(), true)")[0].stmt,m)

if __name__=='__main__':unittest.main()
