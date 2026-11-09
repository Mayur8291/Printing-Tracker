import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from guest_flow_selection import requested_flows,checkpoint_selection,completed_selection,KINDS
import test_web_guest_hosted as runner

class GuestFlowSelection(unittest.TestCase):
    def state(self):return {'run_id':'11111111-1111-4111-8111-111111111111','requested_flows':['recovery','invite'],'flows':{kind:{'id':'request-'+kind}for kind in KINDS}}
    def test_default_all_and_explicit_nonempty_canonical_subset(self):
        self.assertEqual(requested_flows(),list(KINDS));self.assertEqual(requested_flows('invite,recovery'),['recovery','invite'])
        for invalid in ['',[],['recovery','recovery'],['unknown'],'recovery, confirm']:
            with self.subTest(invalid=invalid),self.assertRaises(AssertionError):requested_flows(invalid)
    def test_checkpoint_selection_is_required_and_cannot_be_reordered(self):
        state=self.state();self.assertEqual(checkpoint_selection(state),('recovery','invite'))
        for value in [None,[],['invite','recovery'],['recovery','recovery']]:
            wrong=dict(state,requested_flows=value)
            with self.assertRaises(AssertionError):checkpoint_selection(wrong)
        with patch.object(runner.guest.identities,'connect') as connect:
            with self.assertRaisesRegex(AssertionError,'retain the checkpoint'):runner.run(recover=True,flows='recovery')
            connect.assert_not_called()
    def test_subset_report_never_claims_four_flows_and_rejects_extra_or_foreign_receipts(self):
        state=self.state();results=[{'kind':kind,'requestId':'request-'+kind}for kind in state['requested_flows']]
        self.assertEqual(completed_selection(state,results),{'requested_flows':['recovery','invite'],'untested_flows':['register','confirm'],'all_flows_passed':False})
        for invalid in [results[:1],results[::-1],results+[{'kind':'register','requestId':'request-register'}],[dict(results[0],requestId='foreign'),results[1]]]:
            with self.assertRaises(AssertionError):completed_selection(state,invalid)
        full=dict(state,requested_flows=list(KINDS));self.assertTrue(completed_selection(full,[{'kind':k,'requestId':'request-'+k}for k in KINDS])['all_flows_passed'])
    def test_subset_public_artifact_does_not_replace_all_flow_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'guests.json';path.write_text('full-result')
            with patch.object(runner,'EVIDENCE',path):runner.evidence_write(self.state(),{'all_flows_passed':False},public=True)
            self.assertEqual(path.read_text(),'full-result')
            self.assertFalse(json.loads(path.with_name('guests-recovery-invite.json').read_text())['all_flows_passed'])

if __name__=='__main__':unittest.main()
