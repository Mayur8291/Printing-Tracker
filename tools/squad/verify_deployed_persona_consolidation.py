"""Local-only same-release 8+3 persona read evidence verifier.

Reads already-produced JSON only. No database/network, credentials, fixture
creation or acceptance inference from an unfinished browser/recovery run.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ORIGINAL_RUN = 'd78820f5-28a4-42b5-81ec-9a647970d99b'
ORIGINAL_REPORT_SHA = 'b33e709a895f0762161bf89b8cf97419ca0a4ccfa8d64062bd2bdbff3d7860f0'
POLICY_SHA = 'b3bf66df8ba00bbfc639795f1d3b08740743b3bd423931dc641fe1f1865282e5'
COMMIT = '93f8f66a48885edcd6150853189fe4c7529639fa'
ENTRY_SHA = '19968c448f6a0b207eb4ee83566e2d5886ac5c97e0f637230e6dcc4587a504db'
FIRST = [0, 1, 2, 3, 4, 7, 8, 9]
LAST = [10, 11, 12]
ROUTES = {
    0: 'home catalogue orders people production job-work tasks goals targets reports documents promotions notifications administration profile',
    1: 'home catalogue orders people tasks goals targets reports documents promotions notifications profile',
    2: 'home catalogue orders people production job-work tasks goals reports documents promotions notifications profile',
    3: 'home catalogue orders documents promotions notifications profile',
    4: 'home orders people production tasks reports documents notifications profile',
    7: 'home people production reports documents notifications profile',
    8: 'home people production reports notifications profile',
    9: 'home production reports notifications profile',
    10: 'home catalogue orders people stock documents promotions notifications profile',
    11: 'home catalogue orders job-work tasks goals reports documents promotions notifications profile',
    12: 'home catalogue tasks goals documents promotions notifications profile',
}
ROUTES = {role: ['/squad/' + key for key in keys.split()] for role, keys in ROUTES.items()}
BASE_CHECKS = ['skip_link_keyboard_focus', 'mobile_keyboard_menu_navigation', 'profile_control_edit_without_submit']
DIAGNOSTIC = {'format': 'squad-firefox-failed-personas-diagnostic/v1', 'roles': LAST, 'original_failed_run': ORIGINAL_RUN}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    assert path.is_file() and not path.is_symlink() and path.stat().st_size <= 4_000_000, 'Missing/unsafe evidence file'
    return json.loads(path.read_text())


def release_binding(release):
    assert set(release) == {'format', 'base', 'entry_path', 'entry_sha256', 'git_commit', 'deployment_id'}
    assert release['format'] == 'squad-reviewed-deployed-frontend/v1'
    assert release['base'] == 'https://scottdashboard.vercel.app'
    assert release['entry_path'] == '/assets/index-C1WMMJOg.js' and release['entry_sha256'] == ENTRY_SHA
    assert release['git_commit'] == COMMIT
    assert release['deployment_id'] == 'dpl_Fqy14pKC3xbP2Bm5wL9S1Bd3ojDh'
    return {key: release[key] for key in ('base', 'entry_path', 'entry_sha256')}


def browser_report(report, roles, release):
    assert report['release'] == release and report['frontend'] == release_binding(release)
    assert report.get('finished_at'), 'Unfinished browser report'
    assert len(report['engines']) == 1
    engine = report['engines'][0]
    assert engine['name'] == 'firefox' and engine['version'] == '159.0'
    assert engine['networkViolations'] == []
    assert sorted(row['role'] for row in engine['roles']) == roles
    return {row['role']: row for row in engine['roles']}


def selected_role(row, run_id):
    role = row['role']
    assert row['entry_sha256'] == ENTRY_SHA
    assert row['errors'] == [] and row['nativeErrors'] == []
    assert [r['route'] for r in row['routes']] == ROUTES[role], f'Route gap/order change for role {role}'
    assert all(r['issues'] == [] for r in row['routes'])
    expected_checks = BASE_CHECKS + (['dialog_tab_trap_escape_focus_return'] if role == 0 else [])
    assert row['checks'] == expected_checks, f'Core check gap for role {role}'
    # The reviewed observer retains raw Firefox diagnostics but only the exact
    # already-proven caught-lock class may coexist with successful native checks.
    raw = row.get('pageErrors', [])
    caught = row.get('expectedCaughtLockDiagnostics', [])
    assert len(raw) == len(caught)
    for error, classified in zip(raw, caught):
        assert error == {'source': 'playwright_pageerror', 'name': 'Error', 'message': 'Acquiring an exclusive Navigator LockManager lock \"lock:sb-scvojtvgnkmbupvyslmb-auth-token\" immediately failed'}
        assert classified == {**error, 'classification': 'firefox_caught_zero_wait_lock_callback'}
    return {'role': role, 'run_id': run_id, 'routes': ROUTES[role], 'checks': expected_checks,
            'route_issues': 0, 'fatal_errors': 0, 'native_errors': 0,
            'retained_caught_lock_diagnostics': len(caught), 'entry_sha256': ENTRY_SHA}


def cleanup_proof(value, run_id):
    assert value['run_id'] == run_id
    assert value['owned_commands'] == 0 and value['owned_auth_revisions'] == 0
    assert value['edit_revision_before'] == value['edit_revision_after'] == value['synced_revision_after']
    for key in ('audit_and_commands_retained', 'jobs_terminalized', 'source_content_restored', 'staff_auth_preserved_during_cleanup'):
        assert value[key] is True, 'Unverified cleanup: ' + key
    assert value['removed_documents'] == 0
    assert isinstance(value['removed_source_rows'], int) and value['removed_source_rows'] > 0
    assert all(re.fullmatch(r'sa_[a-z_]+', key) and type(count) is int and count >= 0 for key, count in value['tables'].items())
    assert sum(value['tables'].values()) == value['removed_source_rows']
    return {key: value[key] for key in ('run_id', 'owned_commands', 'owned_auth_revisions', 'removed_source_rows',
        'removed_documents', 'edit_revision_before', 'edit_revision_after', 'synced_revision_after',
        'audit_and_commands_retained', 'source_content_restored', 'staff_auth_preserved_during_cleanup')}


def consolidate(original, recovery, followup, receipt, release):
    original_rows = browser_report(original, sorted(FIRST + LAST), release)
    failures = original['failures']
    assert len(failures) == 3 and sorted(f['role'] for f in failures) == LAST
    assert all(f['engine'] == 'firefox' and f['error'] == 'TimeoutError' for f in failures)
    assert recovery['recovered'] is True and recovery['acceptance_not_inferred'] is True
    recovered = cleanup_proof(recovery['cleanup'], ORIGINAL_RUN)
    followup_id = receipt['run_id']
    assert re.fullmatch(r'[a-f0-9-]{36}', followup_id) and followup_id != ORIGINAL_RUN
    assert receipt['diagnostic'] == DIAGNOSTIC and followup['diagnostic'] == DIAGNOSTIC
    assert receipt['all_personas_passed'] is False and followup['allPersonasPassed'] is False
    assert followup['failures'] == []
    followup_rows = browser_report(followup, LAST, release)
    assert receipt['release'] == release and receipt['frontend'] == release_binding(release)
    assert receipt['engine'] == 'firefox' and receipt['version'] == '159.0'
    assert receipt['environment'] == 'staging' and receipt['personas'] == 3
    assert receipt['routes'] == 28 and receipt['keyboard_checks'] == 9
    assert receipt['viewport'] == {'width': 360, 'height': 844}
    assert receipt['native_safari_tested'] is False
    for key in ('application_mutations', 'provider_requests', 'emails_sent'):
        assert receipt[key] == 0
    for key in ('cron_restored', 'cutover_unchanged', 'source_content_restored', 'immutable_audits_retained'):
        assert receipt[key] is True
    cleaned = cleanup_proof(receipt['cleanup'], followup_id)
    selected = [selected_role(original_rows[role], ORIGINAL_RUN) for role in FIRST] + [selected_role(followup_rows[role], followup_id) for role in LAST]
    assert len(selected) == 11 and len({r['role'] for r in selected}) == 11
    assert sum(len(r['routes']) for r in selected) == 102
    assert sum(len(r['checks']) for r in selected) == 34
    return {'format': 'squad-deployed-persona-consolidated/v1', 'passed': True, 'release': release,
        'environment': 'staging', 'selection_method': 'Disjoint complete roles from two runs of the same exact frontend and positive read-only policy; not one all-persona run.',
        'personas': 11, 'routes': 102, 'keyboard_checks': 34, 'actors': selected,
        'original_run': {'run_id': ORIGINAL_RUN, 'overall_result': 'failed_retained', 'selected_roles': FIRST,
            'selected_routes': 74, 'selected_keyboard_checks': 25,
            'excluded_failed_roles': LAST, 'failures': [{'role': f['role'], 'engine': 'firefox', 'error': 'TimeoutError'} for f in failures]},
        'followup_run': {'run_id': followup_id, 'selected_roles': LAST, 'selected_routes': 28, 'selected_keyboard_checks': 9,
            'original_subset_all_personas_passed': False},
        'cleanup': {'original': recovered, 'followup': cleaned, 'both_verified': True,
            'original_cron_checkpoint_basis': 'The exact reviewed --recover protocol emits recovered:true only after cleanup, Cron restoration and checkpoint unlink; acceptance_not_inferred remains true in that original recovery receipt.'},
        'application_mutations': 0, 'provider_requests': 0, 'emails_sent': 0,
        'scope': 'Live frontend with controlled staging identities: actual login, authorized navigation/read,360px keyboard/profile controls and Admin unsaved city dialog. No workflow mutation replay, real production-user UAT, native production cutover or full role/workflow permutation claim.',
        'gate_mapping': {'EXIT-08': 'Final deployed persona read smoke portion satisfied; existing Tracker/backend/provenance/handoff receipts remain separate required bindings.',
                         'EXIT-07': 'Current live Firefox core/read scope verified; existing WebKit/native/local/security/performance proofs remain separately scoped.'}}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('original-report', 'original-recovery', 'followup-report', 'followup-receipt', 'release', 'output'):
        p.add_argument('--' + name, required=True, type=Path)
    a = p.parse_args()
    paths = {key: getattr(a, key) for key in ('original_report', 'original_recovery', 'followup_report', 'followup_receipt', 'release')}
    values = {key: read_json(path) for key, path in paths.items()}
    assert a.original_report.parent.name == 'web-cross-browser-' + ORIGINAL_RUN
    assert digest(a.original_report) == ORIGINAL_REPORT_SHA, 'Original failure evidence changed'
    assert digest(Path(__file__).with_name('web-cross-browser-policy.mjs')) == POLICY_SHA, 'Read-only policy changed'
    assert a.followup_report.parent.name == 'web-cross-browser-' + values['followup_receipt']['run_id']
    result = consolidate(values['original_report'], values['original_recovery'], values['followup_report'], values['followup_receipt'], values['release'])
    result['readonly_policy_sha256'] = POLICY_SHA
    result['input_sha256'] = {key: digest(path) for key, path in paths.items()}
    assert not a.output.exists(), 'Do not overwrite an immutable consolidated receipt'
    a.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'passed': True, 'personas': 11, 'routes': 102, 'keyboard_checks': 34, 'output_sha256': digest(a.output)}))


if __name__ == '__main__':
    main()
