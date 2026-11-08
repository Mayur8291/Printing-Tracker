"""Database integration tests: real roles, RLS, transactions and command retries."""
import unittest,uuid,json
from local_db import connect
from fixtures import seed,uid,sid,session,rpc
from psycopg.types.json import Jsonb
import psycopg

class Foundation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as c: seed(c)
    def setUp(self):
        self.c=connect();self.c.execute('BEGIN')
    def tearDown(self):
        self.c.execute('ROLLBACK');self.c.close()
    def actor(self,n=103): session(self.c,n)
    def allow_writes(self): self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
    def test_all_eleven_dashboard_actors(self):
        for role in [0,1,2,3,4,7,8,9,10,11,12]:
            session(self.c,100+role)
            me=rpc(self.c,'v1_me')
            self.assertEqual(me['role'],role);self.assertEqual(me['id'],str(100+role))
            self.assertNotIn('encrypted_password',json.dumps(me))
            self.c.execute('RESET ROLE')
    def test_managed_subject_not_login(self):
        self.actor(105)
        with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):rpc(self.c,'v1_me')
    def test_staff_not_app(self):
        session(self.c,999,'authenticated')
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):rpc(self.c,'v1_me')
    def test_direct_table_denied(self):
        self.actor()
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT id FROM sa_snapshot_20261019.sa_users')
    def test_private_mutator_denied(self):
        self.actor()
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute("SELECT sa_domain.bump_version('person',103,'0:0')")
    def test_revoked_session(self):
        self.c.execute('DELETE FROM auth.sessions WHERE id=%s',(sid(103),));self.actor()
        with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):rpc(self.c,'v1_me')
    def test_expired_session(self):
        self.c.execute("UPDATE auth.sessions SET not_after=now()-interval '1 second' WHERE id=%s",(sid(103),));self.actor()
        with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):rpc(self.c,'v1_me')
    def test_disabled_account(self):
        self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=true WHERE id=103');self.actor()
        with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):rpc(self.c,'v1_me')
    def test_unapproved_account(self):
        self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET approved=false WHERE id=103');self.actor()
        with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):rpc(self.c,'v1_me')
    def test_null_approval_compatibility(self):
        self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET approved=null WHERE id=103');self.actor()
        self.assertIsNone(rpc(self.c,'v1_me')['approved'])
    def test_live_role_changes(self):
        self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET role=12 WHERE id=103');self.actor()
        self.assertEqual(rpc(self.c,'v1_me')['role'],12)
    def test_user_metadata_not_authority(self):
        self.c.execute("UPDATE auth.users SET raw_user_meta_data='{"+'"role":0,"admin":true'+"}' WHERE id=%s",(uid(103),));self.actor()
        self.assertEqual(rpc(self.c,'v1_me')['role'],3)
    def test_child_capability_requires_parent(self):
        for enabled in ['false','true']:
            self.c.execute('UPDATE sa_snapshot_20261019.sa_users SET features=%s WHERE id=112',
             (Jsonb([{'key':'3','checked':enabled,'children':[{'key':'3.3','checked':'true'}]}]),))
            session(self.c,112)
            self.assertEqual(rpc(self.c,'v1_me')['capabilities']['configure'],enabled=='true')
            self.c.execute('RESET ROLE')
    def test_mirror_is_readonly(self):
        self.actor()
        with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):
            rpc(self.c,'v1_profile_save',(Jsonb({'name':'Changed'}),'0:0',uuid.uuid4()))
    def test_profile_retry_audit_and_fence(self):
        self.allow_writes();self.actor();key=uuid.uuid4()
        result=rpc(self.c,'v1_profile_save',(Jsonb({'name':'Changed'}),'0:0',key))
        self.assertEqual(result['name'],'Changed');self.assertEqual(result['version'],'0:1')
        self.assertEqual(rpc(self.c,'v1_profile_save',(Jsonb({'name':'Changed'}),'0:0',key)),result)
        self.c.execute('RESET ROLE')
        self.assertEqual(self.c.execute('SELECT edit_revision FROM sa_sync.environment_state').fetchone()[0],1)
        self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.audit').fetchone()[0],1)
        self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.outbox').fetchone()[0],1)
    def test_retry_payload_mismatch(self):
        self.allow_writes();self.actor();key=uuid.uuid4()
        rpc(self.c,'v1_profile_save',(Jsonb({'name':'Changed'}),'0:0',key))
        with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_profile_save',(Jsonb({'name':'Different'}),'0:0',key))
    def test_stale_version(self):
        self.allow_writes();self.actor()
        with self.assertRaises(psycopg.errors.SerializationFailure):rpc(self.c,'v1_profile_save',(Jsonb({'name':'Changed'}),'0:9',uuid.uuid4()))
    def test_profile_rejects_promotion(self):
        self.allow_writes();self.actor()
        with self.assertRaises(psycopg.errors.InvalidParameterValue):rpc(self.c,'v1_profile_save',(Jsonb({'role':0}),'0:0',uuid.uuid4()))
    def test_active_refresh_denies_write(self):
        self.allow_writes();self.c.execute('UPDATE sa_sync.environment_state SET active_job=%s',(uuid.uuid4(),));self.actor()
        with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):rpc(self.c,'v1_profile_save',(Jsonb({'name':'Changed'}),'0:0',uuid.uuid4()))
    def test_generation_invalidates_versions(self):
        self.allow_writes();self.c.execute('UPDATE sa_domain.runtime_state SET generation=1');self.actor()
        with self.assertRaises(psycopg.errors.SerializationFailure):rpc(self.c,'v1_profile_save',(Jsonb({'name':'Changed'}),'0:0',uuid.uuid4()))
    def test_definer_owners_and_public_grants(self):
        unsafe=self.c.execute("""SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='sa_domain'
          AND ((p.prosecdef AND (r.rolsuper OR r.rolbypassrls) AND p.oid NOT IN('sa_domain.auth_context()'::regprocedure,'sa_domain.revoke_account_sessions(bigint)'::regprocedure)) OR (has_function_privilege('anon',p.oid,'EXECUTE') AND p.oid<>'sa_domain.v1_app_bootstrap(text,text)'::regprocedure))""").fetchall()
        self.assertEqual(unsafe,[])
    def test_auth_bridge_cannot_be_called_by_client(self):
        self.actor()
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT * FROM sa_domain.auth_context()')
    def test_no_raw_auth_privileges_for_executor(self):
        for role in ['sa_guard','sa_executor']:
            self.assertFalse(self.c.execute("SELECT has_table_privilege(%s,'auth.users','SELECT')",(role,)).fetchone()[0])

if __name__=='__main__':unittest.main(verbosity=2)
