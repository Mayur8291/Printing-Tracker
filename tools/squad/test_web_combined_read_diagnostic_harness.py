"""Pure run binding, shutdown and recovery guards; no hosted access."""
import unittest
from unittest.mock import patch
import test_web_combined_read_diagnostic_hosted as h
from test_web_cross_browser_harness import manifest

class CombinedReadHarness(unittest.TestCase):
    def setUp(self):
        self.state=manifest()['identity'];self.state['web_combined_read_diagnostic']=dict(h.MARKER)
        self.state['diagnostic_guards']={'public_structure':'a'*64,'staff_auth':{}}
    def report(self):
        return {'format':h.FORMAT,'run_id':self.state['run_id'],'environment':'staging','browser_closed':True,'browser_errors':0,'network_violations':0,'application_mutations':0,'reports':[{'role':role,'environment':'staging','contract':'/rest/v1/rpc/'+name,'application_mutations':0,'samples':[{'index':i,'outcome':'completed','status':200,'observed_rows':1} for i in range(6)]} for role,name in [(3,'v1_me'),(11,'v1_order_get')]]}
    def test_exact_run_roles_sample_count_and_failed_observation(self):
        value=self.report();h.bind_browser(self.state,value);value['reports'][1]['samples'][2]={'index':2,'outcome':'failed','error_type':'TimeoutError'};h.bind_browser(self.state,value)
        value['reports'][1]['samples'].pop()
        with self.assertRaises(AssertionError):h.bind_browser(self.state,value)
        value=self.report();value['run_id']='foreign'
        with self.assertRaises(AssertionError):h.bind_browser(self.state,value)
    def test_uncertain_shutdown_never_claims_closure(self):
        receipt={'format':h.FORMAT,'run_id':self.state['run_id'],'browser_closed':True}
        for code in [-9,-15,2,5]:self.assertFalse(h.browser_closed_return(code,receipt,self.state['run_id']))
        for receipt in [None,{},dict(receipt,run_id='foreign'),dict(receipt,browser_closed=False)]:self.assertFalse(h.browser_closed_return(0,receipt,self.state['run_id']))
        self.assertTrue(h.browser_closed_return(1,{'format':h.FORMAT,'run_id':self.state['run_id'],'browser_closed':True},self.state['run_id']))
    def test_cleanup_requires_matching_baseline_and_closed_browser(self):
        with patch.object(h.identities,'public_structure',return_value='a'*64),patch.object(h.identities,'staff_auth',return_value={}),patch.object(h.identities,'cleanup') as clean:
            self.state['diagnostic_browser_active']=True
            with self.assertRaisesRegex(AssertionError,'closure'):h.cleanup(object(),self.state)
            clean.assert_not_called();h.cleanup(object(),self.state,browser_closed_confirmed=True);clean.assert_called_once()
        with patch.object(h.identities,'public_structure',return_value='b'*64),patch.object(h.identities,'cleanup') as clean:
            self.state['diagnostic_browser_active']=False
            with self.assertRaisesRegex(AssertionError,'Unrelated'):h.cleanup(object(),self.state)
            clean.assert_not_called()
    def test_missing_guard_and_mixed_marker_failclosed(self):
        self.state['web_media']={}
        with self.assertRaises(AssertionError):h.validate(self.state)
        del self.state['web_media'];del self.state['diagnostic_guards']
        with self.assertRaises(KeyError):h.cleanup(object(),self.state)

if __name__=='__main__':unittest.main()
