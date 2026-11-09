"""Composed UI capability command sequence with existing exact hosted cleanup.
Actual local PostgreSQL/SDK; no browser, HTTP, providers or committed fixtures.
"""
import json
import selectors
import subprocess
import time
import unittest
import uuid
from pathlib import Path
import test_business_harness as base_harness
from test_business_journey_composition import dispatch
import test_hosted_business_journeys as harness

ROOT=Path(__file__).resolve().parents[2]

class ConditionalContentCleanup(unittest.TestCase):
    setUpClass=classmethod(base_harness.BusinessHarness.setUpClass.__func__)
    setUp=base_harness.BusinessHarness.setUp
    tearDown=base_harness.BusinessHarness.tearDown
    prepared=base_harness.BusinessHarness.prepared

    def journey(self,fail_stage=None):
        state=self.prepared();actors={}
        for actor in state['identity']['actors']:
            session_id=uuid.uuid4()
            self.c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session_id,actor['auth_id']))
            actors[actor['role']]={**actor,'session_id':str(session_id)}
        process=subprocess.Popen(['node','tools/squad/web-capabilities-local-bridge.mjs'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
        selector=selectors.DefaultSelector()
        try:
            process.stdin.write(json.dumps({'fixture':state['fixture'],'run_id':state['run_id'],'fail_stage':fail_stage})+'\n');process.stdin.flush()
            selector.register(process.stdout,selectors.EVENT_READ);deadline=time.monotonic()+45
            while True:
                self.assertGreater(deadline,time.monotonic(),'Local capability composition exceeded bound')
                self.assertTrue(selector.select(timeout=5),'Local capability runner stopped responding')
                line=process.stdout.readline();self.assertTrue(line,'Local capability runner ended early')
                message=json.loads(line)
                if message['kind']=='result':
                    process.stdin.close();self.assertEqual(process.wait(timeout=5),0,process.stderr.read());return state,message
                self.assertEqual(message['kind'],'rpc')
                response=dispatch(self.c,message,actors)
                process.stdin.write(json.dumps(response)+'\n');process.stdin.flush()
        finally:
            selector.close()
            if process.poll() is None:process.kill();process.wait(timeout=5)
            for stream in [process.stdin,process.stdout,process.stderr]:
                if stream and not stream.closed:stream.close()

    def test_all_sixteen_stages_cleanup_exactly_with_audits_retained(self):
        state,result=self.journey();self.assertNotIn('failed',result,result.get('failed'))
        self.assertTrue(result['report']['completeTransitionMatrix']);self.assertEqual(len(result['report']['stages']),16)
        audit_before=self.c.execute('SELECT id,to_jsonb(a) FROM sa_domain.audit a WHERE id>%s ORDER BY id',(state['audit_start'],)).fetchall()
        before=len(audit_before)
        self.assertGreater(before,16)
        cleaned=harness.cleanup(self.c,state,result['journal'])
        self.assertTrue(cleaned['source_content_restored']);self.assertEqual(cleaned['owned_commands'],before)
        self.assertEqual(harness.source_state(self.c),state['source_before'])
        self.assertEqual(self.c.execute('SELECT id,to_jsonb(a) FROM sa_domain.audit a WHERE id=ANY(%s) ORDER BY id',([row[0] for row in audit_before],)).fetchall(),audit_before)
        self.assertEqual(self.c.execute('SELECT allow_test_writes,test_actor_ids FROM sa_domain.runtime_state').fetchone(),(False,[]))
        self.assertEqual(harness.cleanup(self.c,state,result['journal']),cleaned)

    def test_interrupted_promotions_observer_still_cleans_exact_owned_commands(self):
        state,result=self.journey('11:promotions');self.assertEqual(result['failed']['message'],'Injected UI observer failure')
        self.assertTrue(any(row['kind']=='command' and row['value']['label']=='capabilities.web-role-11-promotions' for row in result['journal']))
        cleaned=harness.cleanup(self.c,state,result['journal']);self.assertTrue(cleaned['source_content_restored'])
        self.assertEqual(harness.source_state(self.c),state['source_before'])

    def test_missing_grant_journal_refuses_cleanup_and_preserves_fixture(self):
        state,result=self.journey('11:promotions')
        entries=[row for row in result['journal'] if not(row['kind']=='command' and row['value']['label']=='capabilities.web-role-11-promotions')]
        with self.assertRaisesRegex(AssertionError,'unjournaled|Foreign'):
            harness.cleanup(self.c,state,entries)
        self.assertTrue(self.c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_users WHERE id=%s',(state['base']+11,)).fetchone())

if __name__=='__main__':unittest.main(verbosity=2)
