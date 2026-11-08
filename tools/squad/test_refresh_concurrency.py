from sqlstate_assertions import assert_app_conflict
import concurrent.futures,json,threading,time,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import seed,uid,session,rpc
from domain_sync import before_publication,after_publication

class RefreshFence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with connect() as c: seed(c)
    def setUp(self): self.c=connect();self.c.execute('BEGIN')
    def tearDown(self): self.c.execute('ROLLBACK');self.c.close()
    def test_cutover_blocks_source_publication(self):
        self.c.execute('UPDATE sa_sync.environment_state SET cutover=true')
        with self.assertRaisesRegex(RuntimeError,'disabled after cutover'): before_publication(self.c)
    def test_changed_revision_blocks_previously_approved_refresh(self):
        self.c.execute('UPDATE sa_sync.environment_state SET edit_revision=4')
        with self.assertRaisesRegex(RuntimeError,'changed after refresh approval'): before_publication(self.c,3)
    def test_dirty_mirror_requires_discard(self):
        self.c.execute('UPDATE sa_sync.environment_state SET edit_revision=1')
        with self.assertRaisesRegex(RuntimeError,'explicit replacement'): before_publication(self.c)
    def test_refresh_invalidates_retry_and_pending_events(self):
        self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');session(self.c,103)
        key=uuid.uuid4();args=(Jsonb({'name':'Changed'}),'0:0',key)
        rpc(self.c,'v1_profile_save',args);self.c.execute('RESET ROLE')
        before_publication(self.c,1)
        self.assertEqual(after_publication(self.c),{'generation':1,'discarded_mirror_events':1})
        session(self.c,103)
        with assert_app_conflict(self):rpc(self.c,'v1_profile_save',args)
    def test_refresh_closes_leased_attempt_history(self):
        job=uuid.uuid4();lease=uuid.uuid4()
        self.c.execute("INSERT INTO sa_domain.outbox(id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,status,lease_token,lease_until) VALUES(%s,%s,'profile.saved','person',103,%s,0,'leased',%s,now()+interval '1 minute')",(job,uid(103),uuid.uuid4(),lease))
        self.c.execute('INSERT INTO sa_domain.job_attempts(lease_token,job_id,attempt) VALUES(%s,%s,1)',(lease,job))
        after_publication(self.c)
        self.assertEqual(self.c.execute('SELECT state,error_code FROM sa_domain.job_attempts WHERE lease_token=%s',(lease,)).fetchone(),('failed','SOURCE_REFRESH_DISCARDED'))
    def test_password_change_fenced(self):
        with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):
            self.c.execute("UPDATE auth.users SET encrypted_password='synthetic-change' WHERE id=%s",(uid(103),))
    def test_password_change_marks_dirty(self):
        self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
        self.c.execute("UPDATE auth.users SET encrypted_password='synthetic-change' WHERE id=%s",(uid(103),))
        self.assertEqual(self.c.execute('SELECT edit_revision FROM sa_sync.environment_state').fetchone()[0],1)
    def test_staff_credential_change_unaffected(self):
        self.c.execute("UPDATE auth.users SET encrypted_password='synthetic-change' WHERE id=%s",(uid(999),))
        self.assertEqual(self.c.execute('SELECT edit_revision FROM sa_sync.environment_state').fetchone()[0],0)
    def test_source_reconciliation_bypass_is_explicit(self):
        self.c.execute("SELECT set_config('squad.source_enrollment','on',true)")
        self.c.execute("UPDATE auth.users SET encrypted_password='synthetic-source' WHERE id=%s",(uid(103),))
        self.assertEqual(self.c.execute('SELECT edit_revision FROM sa_sync.environment_state').fetchone()[0],0)
    def test_refresh_and_auth_update_do_not_deadlock(self):
        self.c.execute('SELECT pg_advisory_xact_lock(20261107,1)')
        t=time.monotonic()
        with connect() as other:
            other.execute("SET statement_timeout='2s'")
            with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):
                other.execute("UPDATE auth.users SET encrypted_password='synthetic-change' WHERE id=%s",(uid(103),))
        self.assertLess(time.monotonic()-t,1)
    def test_login_timestamp_not_a_business_write(self):
        self.c.execute('UPDATE auth.users SET updated_at=now() WHERE id=%s',(uid(103),))
        self.assertEqual(self.c.execute('SELECT edit_revision FROM sa_sync.environment_state').fetchone()[0],0)

class ConcurrentCommands(unittest.TestCase):
    def setUp(self):
        with connect() as c:
            seed(c)
            self.initial=c.execute('SELECT edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()
            c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
        self.keys=[]
    def tearDown(self):
        with connect() as c,c.transaction():
            c.execute('DELETE FROM sa_domain.outbox WHERE command_key=ANY(%s)',(self.keys,))
            c.execute('DELETE FROM sa_domain.audit WHERE command_key=ANY(%s)',(self.keys,))
            c.execute('DELETE FROM sa_domain.commands WHERE key=ANY(%s)',(self.keys,))
            c.execute("DELETE FROM sa_domain.entity_versions WHERE kind='person' AND entity_id=111")
            c.execute("UPDATE sa_snapshot_20261019.sa_users SET name='Persona 111' WHERE id=111")
            c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false')
            c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s',self.initial)
    def run_pair(self,keys):
        barrier=threading.Barrier(2)
        def command(key):
            with connect() as c:
                try:
                    with c.transaction():
                        session(c,111);barrier.wait(timeout=3)
                        return rpc(c,'v1_profile_save',(Jsonb({'name':'Concurrent'}),'0:0',key))
                except psycopg.Error as e:return e.sqlstate
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:return list(pool.map(command,keys))
    def test_simultaneous_same_key_commits_once(self):
        self.keys=[uuid.uuid4()];results=self.run_pair(self.keys*2)
        self.assertIsInstance(results[0],dict);self.assertEqual(results[0],results[1])
        with connect() as c:self.assertEqual(c.execute('SELECT count(*) FROM sa_domain.audit WHERE command_key=%s',(self.keys[0],)).fetchone()[0],1)
    def test_competing_edits_do_not_lose_updates(self):
        self.keys=[uuid.uuid4(),uuid.uuid4()];results=self.run_pair(self.keys)
        self.assertEqual(sum(isinstance(x,dict) for x in results),1);self.assertIn('PT409',results)

if __name__=='__main__':unittest.main(verbosity=2)
