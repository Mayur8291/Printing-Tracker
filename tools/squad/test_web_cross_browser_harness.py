"""Lifecycle/runner boundary tests: temporary files, real manifest validation,
isolated fake connection, and no shared/local/hosted database connections."""
import contextlib
import copy
import datetime
import io
import json
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import test_web_cross_browser_hosted as runner
import test_web_document_outputs_hosted as outputs

business=runner.business


class Connection:
    def __init__(self,events):self.events=events;self.locked=True;self.fail_upgrade=False
    def execute(self,query):
        self.events.append(query)
        if self.fail_upgrade and query=='SELECT pg_advisory_lock(20261107,1)':raise RuntimeError('upgrade blocked')
        return self
    def fetchone(self):return (self.locked,)
    @contextlib.contextmanager
    def transaction(self):
        self.events.append('BEGIN')
        try:yield
        except Exception:self.events.append('ROLLBACK');raise
        else:self.events.append('COMMIT')


def manifest():
    run=uuid.uuid4();base=1900000000
    identity={'format':'squad-persona-fixture/v1','environment':'staging','url':business.identities.URL,'run_id':str(run),
              'label':'SQP '+run.hex[:12],'base':base,'stage':'planned','generation':1,'edit_revision':5,'synced_revision':5,
              'actors':[{'role':r,'id':str(base+r),'auth_id':str(uuid.uuid5(run,str(r))),'email':f'squad-persona-{run.hex[:12]}-{r}@mailinator.com'} for r in business.identities.ROLES],
              'objects':{'factories':[base+100,base+101],'addresses':[base+102,base+103],'orders':[base+104,base+105],
                         'items':[base+106,base+107],'quantities':[base+108,base+109],'dealer_link':base+110,'size':base+111}}
    state={'format':'squad-business-fixture/v1','environment':'staging','run_id':str(run),'identity':identity,'base':base,
           'data_base':1901000000,'label':'SQB '+run.hex[:12],'journal':str(business.PRIVATE/f'business-{run}.jsonl'),
           'source_before':{'sa_users':{'count':1,'max_id':4,'digest':['1','2','3','4']}},'stage':'planned','crons':[],
           'flags_before':{'allow_test_writes':False,'test_actor_ids':[],'test_write_expires_at':None}}
    state['fixture']=business.plan_fixture(state);business.validate(state);return state


class CrossBrowserHarness(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.folder=Path(self.temp.name)
        self.stack=contextlib.ExitStack();self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(business,'PRIVATE',self.folder))
        self.stack.enter_context(patch.object(business,'CHECKPOINT',self.folder/'checkpoint.json'))
        self.stack.enter_context(patch.object(runner,'EVIDENCE',self.folder/'evidence'))
        self.events=[];self.connection=Connection(self.events);self.state=manifest();self.credentials=[];self.payloads=[]
        self.connect=self.stack.enter_context(patch.object(business.identities,'connect',return_value=contextlib.nullcontext(self.connection)))
        self.runtime=self.stack.enter_context(patch.object(runner,'check_engine',return_value={'TEST_ONLY':'yes'}))
        self.frontend=self.stack.enter_context(patch.object(runner,'frontend_preflight',side_effect=lambda base:{'base':base,'entry_path':'/assets/index-local.js','entry_sha256':'a'*64}))
        self.plan=self.stack.enter_context(patch.object(business,'plan',side_effect=lambda c:self.state))
        self.keys=self.stack.enter_context(patch.object(business.identities,'keys',return_value='private-anon'))
        self.prepare=self.stack.enter_context(patch.object(business,'prepare',side_effect=self.do_prepare))
        self.crons=self.stack.enter_context(patch.object(business,'set_crons',side_effect=lambda c,s,paused:self.events.append('pause' if paused else 'restore')))
        self.clean=self.stack.enter_context(patch.object(business,'cleanup',side_effect=self.do_cleanup))
        self.child=self.stack.enter_context(patch.object(runner,'child',side_effect=self.browser))
        self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
    def do_prepare(self,c,state):
        self.events.append('prepare');state['stage']='prepared';state['fixture']['actors']={str(r):str(state['base']+r) for r in range(13)}
        self.credentials=[dict(a,password='private-password-'+str(a['role'])) for a in state['identity']['actors']];return self.credentials
    def do_cleanup(self,c,state,journal_entries):
        self.events.append('cleanup');self.assertEqual(journal_entries,[]);runner.validate(state)
        return {'owned_commands':0,'owned_auth_revisions':0,'source_content_restored':True,'audit_and_commands_retained':True}
    def browser(self,command,payload,folder,label,timeout,env):
        self.events.append('browser');self.payloads.append(copy.deepcopy(payload));engine=payload['browser_engines'][0]
        self.assertEqual(command,['node','tools/squad/web-cross-browser-hosted.mjs']);self.assertEqual(timeout,720)
        self.assertNotIn('rmpClassId',payload['fixture']['ids']);self.assertIn('rmpClassId',payload['fixture']['commercialExtras'])
        roles=[{**({'entry_sha256':payload['frontend']['entry_sha256']} if 'frontend' in payload else {}),'role':r,'routes':[{'route':'/squad/home','issues':[]}],'errors':[],
                'checks':['skip_link_keyboard_focus','mobile_keyboard_menu_navigation','profile_control_edit_without_submit']+(['dialog_tab_trap_escape_focus_return'] if r==0 else [])} for r in business.identities.ROLES]
        destination=business.PRIVATE/f'web-cross-browser-{payload["run_id"]}'/'report.json';destination.parent.mkdir()
        destination.write_text(json.dumps({**({'frontend':payload['frontend']} if 'frontend' in payload else {}),'failures':[],'engines':[{'name':engine,'version':'test-engine','roles':roles,'networkViolations':[]}]}))
        return {**({'frontend':payload['frontend']} if 'frontend' in payload else {}),'passed':True,'failureGroups':0,'report':str(destination),'engines':[{'name':engine,'version':'test-engine','roles':11,'routes':11}]}
    def test_deployed_receipt_survives_payload_result_cleanup_and_evidence(self):
        from test_deployed_frontend_manifest import RELEASE,BASE
        release_file=self.folder/'release.json';release_file.write_text(json.dumps(RELEASE))
        self.frontend.side_effect=lambda base,release=None:{k:RELEASE[k] for k in ('base','entry_path','entry_sha256')}
        original=self.browser
        def browser(*args,**kwargs):
            result=original(*args,**kwargs);payload=args[1]
            self.assertEqual(payload['release'],RELEASE)
            report_path=Path(result['report']);report=json.loads(report_path.read_text());report['release']=payload['release'];report_path.write_text(json.dumps(report));result['release']=payload['release'];return result
        self.child.side_effect=browser
        runner.run(execute=True,base=BASE,release_manifest=str(release_file))
        self.assertFalse(business.CHECKPOINT.exists());self.clean.assert_called_once()
        accepted=json.loads((runner.EVIDENCE/'firefox-acceptance.json').read_text());self.assertEqual(accepted['release'],RELEASE)
        self.assertTrue(all(not a['password'] for a in self.credentials))
    def test_deployed_native_handoff_rejected_before_database(self):
        from test_deployed_frontend_manifest import RELEASE,BASE
        release_file=self.folder/'release.json';release_file.write_text(json.dumps(RELEASE))
        self.frontend.side_effect=lambda base,release=None:{k:RELEASE[k] for k in ('base','entry_path','entry_sha256')}
        with self.assertRaisesRegex(AssertionError,'does not authorize'):runner.run(execute=True,base=BASE,release_manifest=str(release_file),native_safari=True)
        self.connect.assert_not_called();self.prepare.assert_not_called()
    def marked(self):
        self.state['web_cross_browser']={'format':runner.FORMAT,'engine':'webkit','timeout_seconds':720};return self.state
    def test_default_preflight_never_prepares_or_fetches_credentials(self):
        runner.run();self.prepare.assert_not_called();self.keys.assert_not_called();self.child.assert_not_called();self.crons.assert_not_called();self.clean.assert_not_called()
        self.assertFalse(business.CHECKPOINT.exists())
    def test_success_uses_exact_protocol_fences_and_clears_credentials(self):
        runner.run(execute=True,engine='webkit')
        self.assertEqual(self.payloads[0]['browser_engines'],['webkit']);self.assertTrue(all(not a['password'] for a in self.credentials))
        self.assertFalse(business.CHECKPOINT.exists());self.assertTrue((runner.EVIDENCE/'webkit-acceptance.json').exists())
        expected=['pause','BEGIN','prepare','COMMIT','SELECT pg_advisory_lock_shared(20261107,1)','SELECT pg_advisory_unlock(20261107,1)','browser',"SET lock_timeout='15s'",'SELECT pg_advisory_lock(20261107,1)','SELECT pg_advisory_unlock_shared(20261107,1)','cleanup','restore']
        offset=0
        for event in expected:offset=self.events.index(event,offset)+1
    def test_child_failure_cleans_exact_fixture_without_acceptance(self):
        self.child.side_effect=RuntimeError('browser failed')
        with self.assertRaisesRegex(RuntimeError,'browser failed'):runner.run(execute=True)
        self.clean.assert_called_once();self.assertFalse(business.CHECKPOINT.exists());self.assertFalse(runner.EVIDENCE.exists())
        self.assertTrue(all(not a['password'] for a in self.credentials));self.assertEqual(self.events[-2:],['restore','SELECT pg_advisory_unlock(20261107,1)'])
    def test_cleanup_refusal_retains_checkpoint_and_paused_crons(self):
        self.clean.side_effect=AssertionError('Foreign edit')
        with self.assertRaisesRegex(AssertionError,'Foreign edit'):runner.run(execute=True)
        self.assertTrue(business.CHECKPOINT.exists());self.assertNotIn('restore',self.events);self.assertFalse(runner.EVIDENCE.exists())
    def test_restore_failure_keeps_checkpoint_for_idempotent_recovery(self):
        def crons(c,state,paused):
            if not paused:raise RuntimeError('changed cron')
        self.crons.side_effect=crons
        with self.assertRaisesRegex(RuntimeError,'changed cron'):runner.run(execute=True)
        self.clean.assert_called_once();self.assertTrue(business.CHECKPOINT.exists());self.assertFalse(runner.EVIDENCE.exists())
    def test_upgrade_timeout_does_not_cleanup_without_exclusive_fence(self):
        self.connection.fail_upgrade=True
        with self.assertRaisesRegex(RuntimeError,'upgrade blocked'):runner.run(execute=True)
        self.clean.assert_not_called();self.assertTrue(business.CHECKPOINT.exists());self.assertIn('SELECT pg_advisory_unlock_shared(20261107,1)',self.events)
    def test_recovery_never_starts_browser_or_requires_installed_engine(self):
        business.save(self.marked());runner.run(recover=True)
        self.runtime.assert_not_called();self.plan.assert_not_called();self.keys.assert_not_called();self.child.assert_not_called();self.clean.assert_called_once();self.assertFalse(business.CHECKPOINT.exists())
    def test_wrong_recovery_marker_refuses_before_cleanup(self):
        business.save(self.state)
        with self.assertRaises(AssertionError):runner.run(recover=True)
        self.clean.assert_not_called();self.assertTrue(business.CHECKPOINT.exists())
    def test_mixed_rehearsal_marker_rejected(self):
        self.marked()['web_media']={'format':'other'};business.save(self.state)
        with self.assertRaisesRegex(AssertionError,'Wrong rehearsal'):runner.run(recover=True)
        self.clean.assert_not_called()
    def test_existing_checkpoint_blocks_before_connection(self):
        business.save(self.marked())
        with self.assertRaisesRegex(AssertionError,'existing exact-owned'):runner.run(execute=True)
        self.connect.assert_not_called();self.runtime.assert_not_called()
    def test_racing_checkpoint_rechecked_under_exclusive_fence(self):
        def connect(environment):business.save(self.marked());return contextlib.nullcontext(self.connection)
        self.connect.side_effect=connect
        with self.assertRaisesRegex(AssertionError,'Another rehearsal'):runner.run(execute=True)
        self.plan.assert_not_called();self.assertTrue(business.CHECKPOINT.exists())
    def test_nonempty_command_journal_cannot_authorize_cleanup(self):
        self.marked();Path(self.state['journal']).write_text(json.dumps({'kind':'command','value':{'key':str(uuid.uuid4())}})+'\n')
        with self.assertRaisesRegex(AssertionError,'must remain empty'):runner.cleanup(self.connection,self.state)
        self.clean.assert_not_called()
    def test_report_cannot_claim_pass_with_network_violation(self):
        self.marked();self.do_prepare(self.connection,self.state)
        payload=runner.payload_for(self.state,self.credentials,'anon')
        result=self.browser(['node','tools/squad/web-cross-browser-hosted.mjs'],payload,None,None,720,None)
        p=Path(result['report']);data=json.loads(p.read_text());data['engines'][0]['networkViolations']=[{'path':'/blocked'}];p.write_text(json.dumps(data))
        with self.assertRaises(AssertionError):runner.bind_result(self.state,result)
    def test_runtime_pin_and_missing_engine_fail_before_database(self):
        self.runtime.side_effect=AssertionError('Pinned test runtime changed')
        with self.assertRaisesRegex(AssertionError,'Pinned test runtime'):runner.run(execute=True)
        self.connect.assert_not_called();self.prepare.assert_not_called()
    def test_timeout_diagnostics_redact_credentials_and_cleanup_runs(self):
        self.child.side_effect=outputs.child
        with patch.object(outputs.subprocess,'run',side_effect=subprocess.TimeoutExpired(['node'],720,stderr='private-password-0 private-anon')):
            with self.assertRaisesRegex(RuntimeError,'timed out'):runner.run(execute=True)
        diagnostics=list(self.folder.glob('web-cross-browser/*/*-failure.json'));self.assertEqual(len(diagnostics),1)
        text=diagnostics[0].read_text();self.assertNotIn('private-password',text);self.assertNotIn('private-anon',text)
        self.clean.assert_called_once();self.assertFalse(business.CHECKPOINT.exists())
    def test_clean_preview_origin_is_bound_in_payload_and_acceptance(self):
        runner.run(execute=True,base='http://127.0.0.1:5186')
        self.assertEqual(self.payloads[0]['frontend']['base'],'http://127.0.0.1:5186')
        report=json.loads((runner.EVIDENCE/'firefox-acceptance.json').read_text())
        self.assertEqual(report['frontend'],self.payloads[0]['frontend']);self.assertEqual(self.frontend.call_count,2)
    def test_invalid_frontend_is_rejected_before_any_database_or_fixture(self):
        with self.assertRaisesRegex(AssertionError,'loopback HTTP'):runner.run(execute=True,base='https://outside.invalid')
        self.connect.assert_not_called();self.prepare.assert_not_called();self.frontend.assert_not_called()
    def test_entry_preflight_failure_prevents_fixture_creation(self):
        self.frontend.side_effect=AssertionError('Entry mismatch')
        with self.assertRaisesRegex(AssertionError,'Entry mismatch'):runner.run(execute=True)
        self.connect.assert_not_called();self.prepare.assert_not_called()
    def test_changed_entry_after_browser_refuses_acceptance_but_cleans_owned_fixture(self):
        self.frontend.side_effect=[{'base':'http://localhost:5183','entry_path':'/assets/index-local.js','entry_sha256':'a'*64},{'base':'http://localhost:5183','entry_path':'/assets/index-local.js','entry_sha256':'b'*64}]
        with self.assertRaisesRegex(AssertionError,'Frontend changed'):runner.run(execute=True)
        self.clean.assert_called_once();self.assertFalse(runner.EVIDENCE.exists());self.assertFalse(business.CHECKPOINT.exists())
    def test_wrong_persona_entry_hash_cannot_claim_acceptance(self):
        original=self.browser
        def wrong(*args,**kwargs):
            result=original(*args,**kwargs);p=Path(result['report']);data=json.loads(p.read_text());data['engines'][0]['roles'][0]['entry_sha256']='b'*64;p.write_text(json.dumps(data));return result
        self.child.side_effect=wrong
        with self.assertRaisesRegex(AssertionError,'Persona entry'):runner.run(execute=True)
        self.clean.assert_called_once();self.assertFalse(runner.EVIDENCE.exists())
    def native_patch(self,side_effect=None):
        original=self.connection.fetchone
        self.connection.fetchone=lambda: (datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=3),) if self.events[-1].startswith('SELECT test_write_expires_at') else original()
        return patch.object(runner.safari,'handoff',side_effect=side_effect,return_value={'shutdown_confirmed':True,'manual_acceptance_not_inferred':True})
    def test_native_optional_success_cleans_without_claiming_manual_acceptance(self):
        seen=[]
        def handoff(credential,seconds):
            seen.append(dict(credential));self.assertTrue(30<=seconds<=120)
            saved=json.loads(business.CHECKPOINT.read_text());self.assertEqual(saved['native_safari_handoff']['state'],'active')
            self.assertNotIn(credential['password'],business.CHECKPOINT.read_text())
            return {'shutdown_confirmed':True,'manual_acceptance_not_inferred':True}
        with self.native_patch(handoff):runner.run(execute=True,native_safari=True)
        self.assertEqual(seen,[{'email':self.state['identity']['actors'][3]['email'],'password':'private-password-3'}])
        self.assertFalse(business.CHECKPOINT.exists());self.clean.assert_called_once()
        report=json.loads((runner.EVIDENCE/'firefox-acceptance.json').read_text())
        self.assertFalse(report['native_safari_tested']);self.assertTrue(report['native_safari_handoff']['shutdown_confirmed'])
    def test_native_timeout_retains_checkpoint_crons_and_clears_credentials(self):
        with self.native_patch(runner.safari.ShutdownUnconfirmed()):
            with self.assertRaisesRegex(AssertionError,'shutdown must be confirmed'):runner.run(execute=True,native_safari=True)
        self.assertEqual(json.loads(business.CHECKPOINT.read_text())['native_safari_handoff']['state'],'shutdown_unconfirmed')
        self.clean.assert_not_called();self.assertNotIn('restore',self.events);self.assertFalse(runner.EVIDENCE.exists())
        self.assertTrue(all(not a['password'] for a in self.credentials))
    def test_unconfirmed_native_recovery_requires_explicit_attestation(self):
        self.marked()['native_safari_handoff']={'format':'squad-native-safari-handoff/v1','state':'active'};business.save(self.state)
        with self.assertRaisesRegex(AssertionError,'shutdown must be confirmed'):runner.run(recover=True)
        self.clean.assert_not_called();self.assertTrue(business.CHECKPOINT.exists())
        runner.run(recover=True,confirm_native_shutdown=True);self.clean.assert_called_once();self.assertFalse(business.CHECKPOINT.exists())
    def test_short_native_lease_never_exposes_credentials_and_can_cleanup(self):
        original=self.connection.fetchone
        self.connection.fetchone=lambda:(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=80),) if self.events[-1].startswith('SELECT test_write_expires_at') else original()
        with patch.object(runner.safari,'handoff') as handoff:
            with self.assertRaisesRegex(AssertionError,'Insufficient'):runner.run(execute=True,native_safari=True)
            handoff.assert_not_called()
        self.clean.assert_called_once();self.assertFalse(business.CHECKPOINT.exists());self.assertFalse(runner.EVIDENCE.exists())


if __name__=='__main__':unittest.main()
