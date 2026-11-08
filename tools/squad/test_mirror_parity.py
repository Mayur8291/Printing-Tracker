"""Rollback-only catalog mutations prove backend parity detects real differences."""
import unittest
from unittest.mock import patch
import psycopg
import local_db
import verify_mirror_parity as parity

class MirrorCatalogTests(unittest.TestCase):
    def setUp(self):
        self.c=local_db.connect();self.tx=self.c.transaction();self.tx.__enter__()
    def tearDown(self):
        self.tx.__exit__(psycopg.Rollback,psycopg.Rollback(),None);self.c.close()
    def rows(self,key):return parity.schema_rows(self.c)[key]
    def test_null_function_acl_differs_from_explicit_empty(self):
        self.c.execute('CREATE FUNCTION sa_domain.parity_probe() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$')
        self.assertIsNone(self.c.execute("SELECT proacl FROM pg_proc WHERE oid='sa_domain.parity_probe()'::regprocedure").fetchone()[0])
        before=self.rows('functions')
        self.c.execute('REVOKE ALL ON FUNCTION sa_domain.parity_probe() FROM PUBLIC,postgres')
        self.assertEqual(self.c.execute("SELECT proacl::text FROM pg_proc WHERE oid='sa_domain.parity_probe()'::regprocedure").fetchone()[0],'{}')
        self.assertNotEqual(before,self.rows('functions'))
    def test_source_column_permission_detected(self):
        before=self.rows('columns')
        self.c.execute('GRANT UPDATE(encrypted_password) ON sa_snapshot_20261019.sa_users TO sa_executor')
        self.assertNotEqual(before,self.rows('columns'))
    def test_composite_field_change_detected(self):
        self.c.execute('CREATE TYPE sa_domain.parity_type AS (value integer)')
        before=self.rows('columns')
        self.c.execute('ALTER TYPE sa_domain.parity_type ALTER ATTRIBUTE value TYPE bigint')
        self.assertNotEqual(before,self.rows('columns'))
    def test_enum_domain_type_acl_detected(self):
        self.c.execute("CREATE TYPE sa_domain.parity_enum AS ENUM ('a'); CREATE DOMAIN sa_domain.parity_domain AS int CHECK(VALUE>0)")
        before=self.rows('types')
        self.c.execute("ALTER TYPE sa_domain.parity_enum ADD VALUE 'b'; ALTER DOMAIN sa_domain.parity_domain ADD CONSTRAINT maximum CHECK(VALUE<10); REVOKE USAGE ON TYPE sa_domain.parity_enum FROM PUBLIC")
        self.assertNotEqual(before,self.rows('types'))
    def test_view_definition_detected(self):
        self.c.execute('CREATE VIEW sa_domain.parity_view AS SELECT 1 AS value')
        before=self.rows('views')
        self.c.execute('CREATE OR REPLACE VIEW sa_domain.parity_view AS SELECT 2 AS value')
        self.assertNotEqual(before,self.rows('views'))
    def test_sequence_structure_not_current_value(self):
        self.c.execute('CREATE SEQUENCE sa_domain.parity_sequence')
        before=self.rows('sequences')
        self.c.execute("SELECT nextval('sa_domain.parity_sequence')")
        self.assertEqual(before,self.rows('sequences'))
        self.c.execute('ALTER SEQUENCE sa_domain.parity_sequence INCREMENT BY 2')
        self.assertNotEqual(before,self.rows('sequences'))
    def test_membership_inherit_and_set_options_detected(self):
        self.c.execute('GRANT sa_executor TO authenticated WITH INHERIT FALSE, SET FALSE')
        before=self.rows('role_memberships')
        self.c.execute('GRANT sa_executor TO authenticated WITH INHERIT TRUE')
        self.assertNotEqual(before,self.rows('role_memberships'))
        before=self.rows('role_memberships')
        self.c.execute('GRANT sa_executor TO authenticated WITH SET TRUE')
        self.assertNotEqual(before,self.rows('role_memberships'))
    def test_global_default_acl_detected(self):
        before=self.rows('default_acl')
        self.c.execute('ALTER DEFAULT PRIVILEGES FOR ROLE sa_executor GRANT SELECT ON TABLES TO authenticated')
        self.assertNotEqual(before,self.rows('default_acl'))
    def test_required_schema_missing_fails(self):
        with patch.object(parity,'SCHEMAS',parity.SCHEMAS+['parity_missing']):
            with self.assertRaisesRegex(RuntimeError,'schema missing'):self.rows('columns')
    def test_role_power_detected(self):
        before=self.rows('roles')
        self.c.execute('ALTER ROLE sa_executor CREATEROLE')
        self.assertNotEqual(before,self.rows('roles'))

class MirrorRuntimeTests(unittest.TestCase):
    def test_all_runtime_write_guards_required(self):
        parity.validate_runtime((False,[],None))
        for value in ((True,[],None),(False,[1],None),(False,[],'future'),None):
            with self.subTest(value=value),self.assertRaises(RuntimeError):parity.validate_runtime(value)
    def test_exact_active_edge_inventory_and_digests_required(self):
        rows=[{'slug':slug,'status':'ACTIVE','verify_jwt':False,'ezbr_sha256':'a'*64} for slug in parity.EXPECTED_FUNCTIONS]
        self.assertEqual(len(parity.edge_artifacts(rows)),4)
        for invalid in (rows[:-1],rows+[rows[0]]):
            with self.assertRaises(RuntimeError):parity.edge_artifacts(invalid)
        for key,value in (('status','DEPLOYING'),('verify_jwt',True),('ezbr_sha256',None),('ezbr_sha256','bad')):
            invalid=[dict(row) for row in rows];invalid[0][key]=value
            with self.subTest(key=key),self.assertRaises(RuntimeError):parity.edge_artifacts(invalid)

if __name__=='__main__':unittest.main()
