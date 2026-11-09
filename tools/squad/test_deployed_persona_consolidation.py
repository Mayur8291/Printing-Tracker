"""Local structural acceptance-proof tests; no browser/hosted fixture execution."""
import copy
import json
import unittest
from verify_deployed_persona_consolidation import consolidate, FIRST, LAST, ROUTES, BASE_CHECKS, ORIGINAL_RUN, DIAGNOSTIC, ENTRY_SHA

FOLLOWUP = '11111111-2222-4333-8444-555555555555'

def fixtures():
    release={'format':'squad-reviewed-deployed-frontend/v1','base':'https://scottdashboard.vercel.app','entry_path':'/assets/index-C1WMMJOg.js','entry_sha256':ENTRY_SHA,'git_commit':'93f8f66a48885edcd6150853189fe4c7529639fa','deployment_id':'dpl_Fqy14pKC3xbP2Bm5wL9S1Bd3ojDh'}
    frontend={k:release[k] for k in ('base','entry_path','entry_sha256')}
    def row(role):
        return {'role':role,'entry_sha256':ENTRY_SHA,'routes':[{'route':r,'issues':[]}for r in ROUTES[role]],'checks':BASE_CHECKS+(['dialog_tab_trap_escape_focus_return']if role==0 else[]),'errors':[],'nativeErrors':[],'pageErrors':[],'expectedCaughtLockDiagnostics':[],'email':'MUST_NOT_COPY@example.invalid','screenshot':'/Users/PRIVATE/image.png'}
    def report(roles):return {'release':release,'frontend':frontend,'finished_at':'2026-11-09T00:00:00Z','engines':[{'name':'firefox','version':'159.0','networkViolations':[],'roles':[row(r)for r in roles]}],'failures':[]}
    original=report(FIRST+LAST);original['failures']=[{'role':r,'engine':'firefox','error':'TimeoutError','message':'PRIVATE ERROR'}for r in LAST]
    for r in original['engines'][0]['roles'][-3:]:r.update(routes=[],checks=[],errors=[{'private':'EXCLUDED'}])
    followup=report(LAST);followup.update(diagnostic=DIAGNOSTIC,allPersonasPassed=False)
    def cleanup(run):return {'run_id':run,'owned_commands':0,'owned_auth_revisions':0,'edit_revision_before':7,'edit_revision_after':7,'synced_revision_after':7,'audit_and_commands_retained':True,'jobs_terminalized':True,'source_content_restored':True,'staff_auth_preserved_during_cleanup':True,'removed_documents':0,'removed_source_rows':53,'tables':{'sa_users':17,'sa_other':36}}
    recovery={'recovered':True,'acceptance_not_inferred':True,'cleanup':cleanup(ORIGINAL_RUN)}
    receipt={'run_id':FOLLOWUP,'diagnostic':DIAGNOSTIC,'all_personas_passed':False,'release':release,'frontend':frontend,'engine':'firefox','version':'159.0','environment':'staging','personas':3,'routes':28,'keyboard_checks':9,'viewport':{'width':360,'height':844},'native_safari_tested':False,'application_mutations':0,'provider_requests':0,'emails_sent':0,'cron_restored':True,'cutover_unchanged':True,'source_content_restored':True,'immutable_audits_retained':True,'cleanup':cleanup(FOLLOWUP)}
    return original,recovery,followup,receipt,release

class Consolidation(unittest.TestCase):
    def test_exact_disjoint_coverage_with_private_values_excluded(self):
        result=consolidate(*fixtures());self.assertTrue(result['passed']);self.assertEqual((result['personas'],result['routes'],result['keyboard_checks']),(11,102,34));self.assertEqual(len({r['role']for r in result['actors']}),11)
        text=json.dumps(result)
        for secret in ('MUST_NOT_COPY','PRIVATE','EXCLUDED','@example') :self.assertNotIn(secret,text)
        self.assertEqual(result['original_run']['overall_result'],'failed_retained');self.assertFalse(result['followup_run']['original_subset_all_personas_passed'])
    def test_missing_role_route_check_or_transport_violation_refused(self):
        for mutate in [lambda v:v[2]['engines'][0]['roles'].pop(),lambda v:v[2]['engines'][0]['roles'][0]['routes'].pop(),lambda v:v[0]['engines'][0]['roles'][0]['checks'].pop(),lambda v:v[2]['engines'][0]['networkViolations'].append({'method':'POST'}),lambda v:v[2]['engines'][0]['roles'][0]['nativeErrors'].append({'message':'bad'})]:
            with self.subTest(mutate=mutate):
                values=fixtures();mutate(values)
                with self.assertRaises(AssertionError):consolidate(*values)
    def test_cleanup_absent_changed_revisions_or_false_restoration_refused(self):
        for mutate in [lambda v:v[1].update(recovered=False),lambda v:v[1]['cleanup'].update(source_content_restored=False),lambda v:v[3]['cleanup'].update(edit_revision_after=8),lambda v:v[3].update(cron_restored=False),lambda v:v[3]['cleanup'].update(owned_commands=1),lambda v:v[3]['cleanup'].update(run_id=ORIGINAL_RUN)]:
            values=fixtures();mutate(values)
            with self.assertRaises(AssertionError):consolidate(*values)
    def test_different_release_cannot_be_combined(self):
        values=copy.deepcopy(fixtures());values[2]['release']=dict(values[4],git_commit='0'*40)
        with self.assertRaises(AssertionError):consolidate(*values)
        values=fixtures();values[2]['engines'][0]['roles'][0]['entry_sha256']='0'*64
        with self.assertRaises(AssertionError):consolidate(*values)
    def test_original_failures_cannot_be_erased_or_subset_promoted(self):
        for mutate in [lambda v:v[0].update(failures=[]),lambda v:v[2].update(allPersonasPassed=True),lambda v:v[3].update(all_personas_passed=True),lambda v:v[3].update(personas=11)]:
            values=fixtures();mutate(values)
            with self.assertRaises(AssertionError):consolidate(*values)
    def test_unrelated_pageerror_cannot_be_classified_as_lock_noise(self):
        values=fixtures();row=values[2]['engines'][0]['roles'][0];row['pageErrors']=[{'source':'playwright_pageerror','name':'Error','message':'different'}];row['expectedCaughtLockDiagnostics']=[{**row['pageErrors'][0],'classification':'firefox_caught_zero_wait_lock_callback'}]
        with self.assertRaises(AssertionError):consolidate(*values)

if __name__=='__main__':unittest.main()
