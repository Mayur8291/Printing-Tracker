"""Independent safety and recovery checks for the staged business rehearsal.

All tests use isolated PostgreSQL and an outer rollback transaction. Hosted
setup/cleanup is exercised verbatim, with actual synthetic GoTrue-shaped rows;
the composite uses the shared SDK through the local SQL-only transport.
"""
import copy
import json
import unittest
import uuid

import psycopg
from psycopg.types.json import Jsonb

from fixtures import rpc,session
from test_business_journey_composition import run_sdk
from test_catalogue import seed_catalogue
import test_persona_harness as persona_tests
import test_hosted_business_journeys as harness


class BusinessHarness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from local_db import connect
        with connect() as c:seed_catalogue(c)

    def setUp(self):
        persona_tests.PersonaHarness.setUp(self)
        self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids=%s::uuid[],test_write_expires_at=NULL',([],))

    def tearDown(self):
        persona_tests.PersonaHarness.tearDown(self)

    def prepared(self):
        state=harness.plan(self.c)
        # Production RPC transactions start after the checkpoint. This local
        # suite intentionally shares one outer rollback transaction, so now()
        # remains its start time for every generated source row.
        state['created_at']=self.c.execute('SELECT transaction_timestamp()').fetchone()[0].isoformat()
        credentials=harness.prepare(self.c,state)
        for actor in credentials:actor['password']=''
        return state

    def assert_scope_disabled(self):
        self.assertEqual(self.c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone(),(False,[],None))

    def test_cron_pause_and_restore_roll_back_partial_failure_atomically(self):
        self.assertIsNone(self.c.execute("SELECT to_regclass('cron.job')").fetchone()[0], 'Fake Cron fixture requires the isolated database')
        self.c.execute('''CREATE SCHEMA IF NOT EXISTS cron;
          CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text NOT NULL,active boolean NOT NULL,schedule text NOT NULL,command text NOT NULL);
          INSERT INTO cron.job VALUES
            (1,'squad-first',true,'* * * * *','SELECT 1'),
            (2,'squad-second',true,'* * * * *','SELECT 2'),
            (3,'squad-disabled',false,'* * * * *','SELECT 3'),
            (4,'unrelated-job',true,'* * * * *','SELECT 4');
          CREATE FUNCTION cron.alter_job(job_id bigint,active boolean) RETURNS void LANGUAGE plpgsql AS $f$
          BEGIN
            IF job_id=2 AND current_setting('squad.test_cron_fail_second',true)='on' THEN
              RAISE EXCEPTION 'Injected second Cron update failure';
            END IF;
            UPDATE cron.job SET active=$2 WHERE jobid=$1;
          END $f$;
        ''')
        state={'crons':harness.cron_state(self.c)}
        self.c.execute("SELECT set_config('squad.test_cron_fail_second','on',true)")
        with self.assertRaisesRegex(psycopg.errors.RaiseException,'Injected second Cron'):
            harness.set_crons(self.c,state,True)
        self.assertEqual(harness.cron_state(self.c),state['crons'], 'First pause must roll back when the second update fails')
        self.c.execute("SELECT set_config('squad.test_cron_fail_second','off',true)")
        harness.set_crons(self.c,state,True)
        paused=harness.cron_state(self.c);self.assertTrue(all(not row['active'] for row in paused))
        self.c.execute("SELECT set_config('squad.test_cron_fail_second','on',true)")
        with self.assertRaisesRegex(psycopg.errors.RaiseException,'Injected second Cron'):
            harness.set_crons(self.c,state,False)
        self.assertEqual(harness.cron_state(self.c),paused, 'First restore must roll back when the second update fails')
        self.c.execute("SELECT set_config('squad.test_cron_fail_second','off',true)")
        harness.set_crons(self.c,state,False)
        self.assertEqual(harness.cron_state(self.c),state['crons'])
        harness.set_crons(self.c,state,False)  # An already-restored recovery repeats safely.
        harness.set_crons(self.c,state,True);harness.set_crons(self.c,state,False)
        self.assertEqual(harness.cron_state(self.c),state['crons'])
        self.assertTrue(self.c.execute('SELECT active FROM cron.job WHERE jobid=4').fetchone()[0])

    def profile_command(self,state):
        actor=next(a for a in state['identity']['actors'] if a['role']==0)
        session_id=uuid.uuid4();self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session_id,actor['auth_id']))
        self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':actor['auth_id'],'session_id':str(session_id),'role':'sa_app'}),));self.c.execute('SET LOCAL ROLE sa_app')
        current=rpc(self.c,'v1_me');label='recovery.profile';key=uuid.uuid5(uuid.UUID(state['run_id']),label)
        rpc(self.c,'v1_profile_save',(Jsonb({'name':state['label']+' updated admin'}),current['version'],key))
        self.c.execute('RESET ROLE')
        return [{'kind':'command','value':{'key':str(key),'label':label}}]

    def test_prepare_clean_and_repeated_recovery_restore_source_exactly(self):
        state=self.prepared()
        result=harness.cleanup(self.c,state,[])
        self.assertTrue(result['source_content_restored']);self.assertEqual(result['owned_commands'],0)
        self.assertEqual(harness.source_state(self.c),state['source_before'])
        self.assertEqual(harness.cleanup(self.c,state,[]),result)
        self.assert_scope_disabled()

    def test_checkpoint_rejects_foreign_environment_range_table_and_root_id(self):
        state=harness.plan(self.c)
        alterations=[('environment','production'),('base',103),('data_base',100),('journal','/tmp/not-the-owned-journal'),('label','Foreign')]
        for field,value in alterations:
            changed=copy.deepcopy(state);changed[field]=value
            with self.subTest(field=field),self.assertRaises((AssertionError,ValueError)):harness.validate(changed)
        for table,ids in [('public.profiles',[103]),('sa_snapshot_20261019.sa_users',[103])]:
            changed=copy.deepcopy(state);changed['fixture']['fixture_tables'].append({'table':table,'ids':ids,'rows':[]})
            with self.subTest(table=table),self.assertRaises(AssertionError):harness.validate(changed)

    def test_preflight_rejects_existing_pending_work(self):
        from fixtures import uid
        self.c.execute("INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation) VALUES(%s,'profile.updated','person',100,%s,0)",(uid(100),uuid.uuid4()))
        with self.assertRaisesRegex(AssertionError,'Existing worker work'):harness.plan(self.c)

    def test_preexisting_source_content_drift_rolls_back_cleanup(self):
        state=self.prepared()
        self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET name='Changed outside rehearsal' WHERE id=103")
        with self.assertRaisesRegex(AssertionError,'Source contents differ'):harness.cleanup(self.c,state,[])
        self.assertEqual(self.c.execute('SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=103').fetchone()[0],'Changed outside rehearsal')
        self.assertTrue(self.c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id=%s',(state['base'],)).fetchone())
        self.assert_scope_disabled()

    def test_preexisting_foreign_child_link_is_not_deleted(self):
        state=self.prepared()
        self.c.execute('UPDATE sa_snapshot_20261019.sa_items SET cutting_master_id=%s WHERE id=1001',(state['base']+9,))
        with self.assertRaisesRegex(AssertionError,'Preexisting or foreign'):harness.cleanup(self.c,state,[])
        self.assertEqual(self.c.execute('SELECT cutting_master_id FROM sa_snapshot_20261019.sa_items WHERE id=1001').fetchone()[0],state['base']+9)
        self.assert_scope_disabled()

    def test_new_foreign_fk_child_transaction_is_not_deleted(self):
        state=self.prepared()
        # A separate subtransaction gives the row a distinct xmin, just as an
        # unrelated committed writer would have in the real HTTP rehearsal.
        with self.c.transaction():
            row=self.c.execute("INSERT INTO sa_snapshot_20261019.sa_tasks(note,created_by_id,created_at,updated_at) VALUES('Foreign task referencing fixture',%s,now(),now()) RETURNING id",(state['base'],)).fetchone()[0]
        with self.assertRaisesRegex(AssertionError,'Preexisting or foreign'):harness.cleanup(self.c,state,[])
        self.assertEqual(self.c.execute('SELECT note FROM sa_snapshot_20261019.sa_tasks WHERE id=%s',(row,)).fetchone()[0],'Foreign task referencing fixture')
        self.assert_scope_disabled()

    def test_foreign_update_to_owned_root_is_not_deleted(self):
        state=self.prepared()
        with self.c.transaction():
            self.c.execute("UPDATE sa_snapshot_20261019.sa_users SET name='Foreign edit of fixture' WHERE id=%s",(state['base'],))
        with self.assertRaisesRegex(AssertionError,'unowned transaction'):harness.cleanup(self.c,state,[])
        self.assertEqual(self.c.execute('SELECT name FROM sa_snapshot_20261019.sa_users WHERE id=%s',(state['base'],)).fetchone()[0],'Foreign edit of fixture')
        self.assert_scope_disabled()

    def test_changed_source_generation_refuses_cleanup_after_disabling_scope(self):
        state=self.prepared();self.c.execute('UPDATE sa_domain.runtime_state SET generation=generation+1')
        with self.assertRaisesRegex(AssertionError,'Source generation changed'):harness.cleanup(self.c,state,[])
        self.assert_scope_disabled()

    def test_unaudited_revision_delta_is_not_acknowledged(self):
        state=self.prepared();self.c.execute('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1')
        with self.assertRaisesRegex(AssertionError,'revision differs'):harness.cleanup(self.c,state,[])
        self.assertEqual(self.c.execute('SELECT synced_revision FROM sa_sync.environment_state').fetchone()[0],state['identity']['synced_revision'])
        self.assert_scope_disabled()

    def test_unrelated_audited_command_is_not_acknowledged(self):
        state=self.prepared()
        self.c.execute("INSERT INTO sa_domain.audit(actor_id,legacy_user_id,operation,kind,entity_id,command_key,changes) VALUES(%s,103,'profile.updated','person',103,%s,'{}')",(uuid.uuid4(),uuid.uuid4()))
        self.c.execute('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1')
        with self.assertRaisesRegex(AssertionError,'Foreign or unjournaled'):harness.cleanup(self.c,state,[])
        self.assert_scope_disabled()

    def test_expired_rehearsal_is_readonly_and_still_recoverable(self):
        state=self.prepared();actor=next(a for a in state['identity']['actors'] if a['role']==3)
        sid=uuid.uuid4();self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(sid,actor['auth_id']))
        self.c.execute("UPDATE sa_domain.runtime_state SET test_write_expires_at=now()-interval '1 second'")
        self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':actor['auth_id'],'session_id':str(sid),'role':'sa_app'}),));self.c.execute('SET LOCAL ROLE sa_app')
        current=rpc(self.c,'v1_me')
        with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState),self.c.transaction():rpc(self.c,'v1_profile_save',(Jsonb({'name':'Expired write'}),current['version'],uuid.uuid4()))
        self.c.execute('RESET ROLE');self.assertTrue(harness.cleanup(self.c,state,[])['source_content_restored'])
        self.assert_scope_disabled()

    def test_forged_response_inventory_cannot_erase_unrelated_new_row(self):
        state=self.prepared()
        row=self.c.execute("INSERT INTO sa_snapshot_20261019.sa_tasks(note,created_by_id,created_at,updated_at) VALUES('Unrelated new task',101,now(),now()) RETURNING id").fetchone()[0]
        forged=[{'kind':'entity','value':{'kind':'task','id':str(row)}}]
        with self.assertRaises(AssertionError):harness.cleanup(self.c,state,forged)
        self.assertEqual(self.c.execute('SELECT note FROM sa_snapshot_20261019.sa_tasks WHERE id=%s',(row,)).fetchone()[0],'Unrelated new task')
        self.assert_scope_disabled()

    def test_background_attempt_refuses_cleanup(self):
        state=self.prepared();entries=self.profile_command(state)
        self.c.execute('UPDATE sa_domain.outbox SET attempts=1 WHERE command_key=%s',(entries[0]['value']['key'],))
        with self.assertRaisesRegex(AssertionError,'background work unexpectedly'):harness.cleanup(self.c,state,entries)
        self.assert_scope_disabled()

    def test_modified_command_label_does_not_authorize_cleanup(self):
        state=self.prepared();entries=self.profile_command(state);entries[0]['value']['label']='recovery.forged'
        with self.assertRaisesRegex(AssertionError,'Journal command key changed'):harness.cleanup(self.c,state,entries)
        self.assert_scope_disabled()

    def test_repeated_recovery_rechecks_revision(self):
        state=self.prepared();harness.cleanup(self.c,state,[])
        self.c.execute('UPDATE sa_sync.environment_state SET edit_revision=edit_revision+1')
        with self.assertRaises(AssertionError):harness.cleanup(self.c,state,[])

    def test_repeated_recovery_rejects_recreated_auth_identity(self):
        state=self.prepared();harness.cleanup(self.c,state,[]);actor=state['identity']['actors'][0]
        self.c.execute("INSERT INTO auth.users(id,role,email,banned_until) VALUES(%s,'sa_app',%s,'2101-01-01')",(actor['auth_id'],actor['email']))
        with self.assertRaisesRegex(AssertionError,'Auth identity reappeared'):harness.cleanup(self.c,state,[])
        self.assertIsNotNone(self.c.execute('SELECT 1 FROM auth.users WHERE id=%s',(actor['auth_id'],)).fetchone())

    def test_repeated_recovery_rechecks_public_structure(self):
        state=self.prepared();harness.cleanup(self.c,state,[])
        self.c.execute('ALTER TABLE public.profiles ADD COLUMN unexpected_recovery_probe boolean')
        with self.assertRaises(AssertionError):harness.cleanup(self.c,state,[])

    def test_repeated_recovery_preserves_later_staff_activity(self):
        from fixtures import uid
        state=self.prepared();cleaned=harness.cleanup(self.c,state,[])
        self.c.execute('UPDATE auth.users SET raw_user_meta_data=%s WHERE id=%s',(Jsonb({'foreign':'change'}),uid(999)))
        # A completed fixture has no authority over subsequent live Auth
        # activity. Recovery verifies its own tombstones and returns the
        # original receipt; it must never restore an old staff row.
        self.assertEqual(harness.cleanup(self.c,state,[]),cleaned)
        self.assertEqual(self.c.execute('SELECT raw_user_meta_data FROM auth.users WHERE id=%s',(uid(999),)).fetchone()[0],{'foreign':'change'})

    def test_composite_cleanup_recovers_lost_results_and_nested_backorder_keys(self):
        state=self.prepared();actors={}
        for actor in state['identity']['actors']:
            session_id=uuid.uuid4();self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session_id,actor['auth_id']))
            actors[actor['role']]={**actor,'session_id':str(session_id)}
        result=run_sdk(self.c,state['fixture'],actors,state['run_id'])
        self.assertEqual(len(result['report']['collaboration']['checks']),7)
        # Simulate every response inventory being lost. The durable pre-call key
        # journal and committed audit/source relationships must suffice.
        commands=[entry for entry in result['journal'] if entry['kind']=='command']
        self.assertTrue(self.c.execute("SELECT 1 FROM sa_domain.audit WHERE operation='backorder.placed' AND changes?'placement_command_key' AND id>%s",(state['audit_start'],)).fetchone())
        cleaned=harness.cleanup(self.c,state,commands)
        self.assertGreater(cleaned['owned_commands'],50)
        self.assertTrue(cleaned['source_content_restored'])
        self.assertEqual(harness.source_state(self.c),state['source_before'])
        self.assertEqual(harness.cleanup(self.c,state,commands),cleaned)
        self.assert_scope_disabled()


if __name__=='__main__':unittest.main(verbosity=2)
