"""No-DB ownership/report guards for the serial ME diagnostic wrapper."""
import copy
import unittest
from unittest.mock import patch
import test_web_me_diagnostic_hosted as harness

class MeDiagnosticHarness(unittest.TestCase):
    def setUp(self):
        self.state={'run_id':'00000000-0000-4000-8000-000000000001','web_me_diagnostic':{'format':harness.FORMAT,'role':3,'samples':6}}
        self.patch=patch.object(harness.business,'validate',side_effect=lambda state:state);self.patch.start();self.addCleanup(self.patch.stop)
        self.report={'run_id':self.state['run_id'],'environment':'staging','role':3,'format':'squad-me-browser-diagnostic/v1','contract':'/rest/v1/rpc/v1_me','application_mutations':0,'browser_errors':0,'network_violations':0,'samples':[{'index':i,'outcome':'completed','status':200,'observed_rows':1} for i in range(6)]}
    def test_exact_six_samples_and_run_required(self):
        harness.bind_browser(self.state,self.report)
        for change in [{'run_id':'foreign'},{'role':0},{'samples':self.report['samples'][:5]},{'network_violations':1}]:
            with self.subTest(change=change):
                with self.assertRaises(AssertionError):harness.bind_browser(self.state,{**self.report,**change})
    def test_failed_sample_retained_as_diagnostic_not_success(self):
        self.report['samples'][2]={'index':2,'outcome':'failed','error_type':'TimeoutError'}
        result=harness.bind_browser(self.state,self.report)
        self.assertEqual(result['samples'][2]['outcome'],'failed')
    def test_wrong_marker_or_foreign_lifecycle_refused(self):
        for state in [{**self.state,'web_me_diagnostic':{'format':harness.FORMAT,'role':0,'samples':6}},{**self.state,'weekly_mail_rehearsal':True}]:
            with self.assertRaises(AssertionError):harness.validate(state)
    def test_cleanup_never_authorizes_browser_command(self):
        with patch.object(harness.business,'journal',return_value=[{'type':'command'}]),patch.object(harness.business,'cleanup') as cleaned:
            with self.assertRaises(AssertionError):harness.cleanup(object(),self.state)
            cleaned.assert_not_called()
    def test_cleanup_delegates_unchanged_empty_owned_journal(self):
        connection=object()
        with patch.object(harness.business,'journal',return_value=[]),patch.object(harness.business,'cleanup',return_value={'owned_commands':0}) as cleaned:
            self.assertEqual(harness.cleanup(connection,self.state),{'owned_commands':0})
            cleaned.assert_called_once_with(connection,self.state,journal_entries=[])

if __name__=='__main__':unittest.main()
