"""Dedicated exact-owned staging Firefox/WebKit acceptance lifecycle.

Default preflight performs reads only. --execute prepares the existing synthetic
persona fixture, never production data. --recover accepts only this harness's
checkpoint. The browser cannot submit application mutations; native Safari is
not covered. Run one engine per fixture to fit the 15-minute rehearsal scope.
"""
import argparse
import datetime
import json
import os
from pathlib import Path

import test_hosted_business_journeys as business
import native_safari_handoff as safari
from browser_entry_manifest import frontend_preflight, loopback_base, validate_frontend
from deployed_frontend_manifest import load_release, validate_release
from test_web_document_outputs_hosted import child, private_json

FORMAT='squad-web-cross-browser/v1'
TIMEOUT=720
DIAGNOSTIC={'format':'squad-firefox-failed-personas-diagnostic/v1','roles':[10,11,12],'original_failed_run':'d78820f5-28a4-42b5-81ec-9a647970d99b'}
EVIDENCE=business.ROOT/'docs/squad-one-web/evidence'
OTHER_MARKERS=('web_media','web_catalogue_media','web_catalogue_terms','web_output_rehearsal','document_outputs','weekly_mail_rehearsal')


def validate(state):
    business.validate(state)
    marker=state.get('web_cross_browser')
    assert isinstance(marker,dict)
    base_keys=set(marker)-{'diagnostic'}
    assert base_keys in ({'format','engine','timeout_seconds'},{'format','engine','timeout_seconds','frontend'},{'format','engine','timeout_seconds','frontend','release'})
    if 'diagnostic' in marker:
        assert marker['diagnostic']==DIAGNOSTIC and marker['engine']=='firefox'
        assert not state.get('native_safari_handoff'),'Diagnostic does not authorize native handoff'
    if 'frontend' in marker:validate_frontend(marker['frontend'],marker.get('release'))
    assert marker['format']==FORMAT and marker['engine'] in ('firefox','webkit') and marker['timeout_seconds']==TIMEOUT
    assert not any(state.get(k) for k in OTHER_MARKERS),'Wrong rehearsal checkpoint'
    native=state.get('native_safari_handoff')
    if native is not None:
        assert set(native)=={'format','state'} and native['format']=='squad-native-safari-handoff/v1'
        assert native['state'] in ('planned','active','shutdown_confirmed','shutdown_unconfirmed','recovery_shutdown_confirmed')
    return state


def runtime_check():
    """Check local test tooling before creating a hosted fixture; no browser run."""
    module=Path(os.environ.get('SQUAD_PLAYWRIGHT_MODULE','/tmp/squad-playwright-1.65.0/node_modules/playwright/index.mjs'))
    assert module.is_file(),'Isolated Playwright module is unavailable'
    package=json.loads((module.parent/'package.json').read_text())
    assert package['name']=='playwright' and package['version']=='1.65.0','Pinned test runtime changed'
    cache=Path(os.environ.get('PLAYWRIGHT_BROWSERS_PATH','/tmp/squad-playwright-browsers-1.65.0'))
    return module,cache


def check_engine(engine):
    assert engine in ('firefox','webkit')
    module,cache=runtime_check()
    directory=cache/('firefox-1572' if engine=='firefox' else 'webkit-2388')
    assert directory.is_dir(),f'Isolated {engine} engine is unavailable'
    return {**os.environ,'SQUAD_PLAYWRIGHT_MODULE':str(module),'PLAYWRIGHT_BROWSERS_PATH':str(cache)}


def payload_for(state,credentials,anon):
    validate(state)
    return {'url':business.identities.URL,'anon':anon,'actors':[a for a in credentials if a['role'] in (DIAGNOSTIC['roles'] if state['web_cross_browser'].get('diagnostic') else business.identities.ROLES)],'run_id':state['run_id'],
            'journal':state['journal'],'fixture':state['fixture'],**({'diagnostic':DIAGNOSTIC} if state['web_cross_browser'].get('diagnostic') else {}),'browser_engines':[state['web_cross_browser']['engine']],
            **({'frontend':state['web_cross_browser']['frontend']} if 'frontend' in state['web_cross_browser'] else {}),
            **({'release':state['web_cross_browser']['release']} if 'release' in state['web_cross_browser'] else {})}


def bind_result(state,result):
    """Acceptance validates the private browser report; cleanup uses server proof."""
    validate(state);engine=state['web_cross_browser']['engine']
    expected=business.PRIVATE/f'web-cross-browser-{state["run_id"]}'/'report.json'
    assert Path(result['report']).absolute()==expected.absolute(),'Unexpected browser evidence path'
    assert not expected.is_symlink() and expected.is_file() and expected.stat().st_size<=2_000_000
    report=json.loads(expected.read_text())
    assert result['passed'] is True and result['failureGroups']==0 and report['failures']==[]
    assert len(report['engines'])==1 and report['engines'][0]['name']==engine
    entry=report['engines'][0];assert entry['networkViolations']==[]
    frontend=state['web_cross_browser'].get('frontend')
    if frontend:
        assert report.get('frontend')==frontend and result.get('frontend')==frontend,'Browser frontend binding changed'
    if 'release' in state['web_cross_browser']:
        assert report.get('release')==state['web_cross_browser']['release'] and result.get('release')==state['web_cross_browser']['release']
    diagnostic=state['web_cross_browser'].get('diagnostic')
    expected_roles=DIAGNOSTIC['roles'] if diagnostic else business.identities.ROLES
    assert report.get('diagnostic')==diagnostic and result.get('diagnostic')==diagnostic
    roles=entry['roles'];assert sorted(r['role'] for r in roles)==expected_roles
    if diagnostic:
        assert report.get('allPersonasPassed') is False and result.get('allPersonasPassed') is False,'Subset cannot claim all-persona acceptance'
        for role in roles:
            detail=role['auth_diagnostic'];assert detail['format']=='squad-auth-lock-diagnostic/v1' and detail['role']==role['role']
            assert len(detail['locks'])<=2000 and len(detail['requests'])<=2000
    required={'skip_link_keyboard_focus','mobile_keyboard_menu_navigation'}
    for role in roles:
        if frontend:assert role.get('entry_sha256')==frontend['entry_sha256'],'Persona entry was not verified'
        assert not role['errors'] and required<=set(role['checks'])
        assert any(k in role['checks'] for k in ('profile_control_edit_without_submit','profile_control_server_readonly'))
        assert role['routes'] and all(not r['issues'] and r['route'].startswith('/squad/') for r in role['routes'])
        assert len({r['route'] for r in role['routes']})==len(role['routes'])
    if not diagnostic:
        admin=next(r for r in roles if r['role']==0)
        assert any(k in admin['checks'] for k in ('dialog_tab_trap_escape_focus_return','city_dialog_server_readonly'))
    routes=sum(len(r['routes']) for r in roles)
    assert result['engines']==[{'name':engine,'version':entry['version'],'roles':len(expected_roles),'routes':routes}]
    return {'engine':engine,'version':entry['version'],'personas':len(expected_roles),'routes':routes,
            **({'diagnostic':diagnostic,'all_personas_passed':False} if diagnostic else {}),
            'viewport':{'width':360,'height':844},'keyboard_checks':sum(len(r['checks']) for r in roles),
            'native_safari_tested':False,'application_mutations':0,'provider_requests':0,'emails_sent':0,
            **({'frontend':frontend} if frontend else {}),
            **({'release':state['web_cross_browser']['release']} if 'release' in state['web_cross_browser'] else {})}


def cleanup(c,state):
    validate(state)
    assert state.get('native_safari_handoff',{}).get('state') not in ('active','shutdown_unconfirmed'),'Native Safari shutdown must be confirmed before fixture cleanup'
    # No browser commands are authorized by this runner. An unexpected write
    # cannot become an owned cleanup root even if a report calls it a test.
    assert business.journal(state)==[],'Read-only browser journal must remain empty'
    return business.cleanup(c,state,journal_entries=[])


def native_handoff(c,state,credentials):
    credential=safari.customer_credentials(state,credentials)
    try:
        expires_at=c.execute('SELECT test_write_expires_at FROM sa_domain.runtime_state WHERE singleton').fetchone()[0]
        seconds=safari.lease_seconds(expires_at)
        state['native_safari_handoff']['state']='active';business.save(state)
        try:
            result=safari.handoff(credential,seconds)
            assert result['shutdown_confirmed'] is True
        except BaseException:
            state['native_safari_handoff']['state']='shutdown_unconfirmed';business.save(state)
            raise
        state['native_safari_handoff']['state']='shutdown_confirmed';business.save(state)
        return result
    finally:credential.clear()


def run(execute=False,recover=False,engine='firefox',native_safari=False,confirm_native_shutdown=False,base='http://localhost:5183',release_manifest=None,diagnostic_failed_roles=False):
    assert not(execute and recover) and engine in ('firefox','webkit')
    assert not diagnostic_failed_roles or (engine=='firefox' and not native_safari and not recover),'Fixed diagnostic is Firefox-only and cannot override recovery scope'
    assert not(native_safari and recover),'Use the existing handoff checkpoint when recovering'
    assert not confirm_native_shutdown or recover,'Shutdown confirmation is recovery-only'
    if not recover:assert not business.CHECKPOINT.exists(),'Recover the existing exact-owned checkpoint first'
    env=check_engine(engine) if not recover else None
    release=load_release(release_manifest,base) if release_manifest and not recover else None
    frontend=(frontend_preflight(base,release) if release else frontend_preflight(loopback_base(base))) if not recover else None
    assert not (release and native_safari),'Deployed read-only smoke does not authorize a native handoff'
    with business.identities.connect('staging') as c:
        assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/release is active'
        shared=False;credentials=[];payload={}
        try:
            if not recover:assert not business.CHECKPOINT.exists(),'Another rehearsal checkpoint exists'
            if recover:
                state=validate(json.loads(business.CHECKPOINT.read_text()))
                if confirm_native_shutdown:
                    assert state.get('native_safari_handoff',{}).get('state') in ('active','shutdown_unconfirmed'),'No unconfirmed native Safari handoff exists'
                    state['native_safari_handoff']['state']='recovery_shutdown_confirmed';business.save(state)
                cleaned=cleanup(c,state);business.set_crons(c,state,False);business.CHECKPOINT.unlink()
                print(json.dumps({'recovered':True,'cleanup':cleaned,'acceptance_not_inferred':True}));return
            state=business.plan(c)
            state['web_cross_browser']={'format':FORMAT,'engine':engine,'timeout_seconds':TIMEOUT,'frontend':frontend,**({'release':release} if release else {}),**({'diagnostic':DIAGNOSTIC} if diagnostic_failed_roles else {})};validate(state)
            if native_safari:state['native_safari_handoff']={'format':'squad-native-safari-handoff/v1','state':'planned'}
            if not execute:
                print(json.dumps({'mode':'read-only preflight','environment':'staging','engine':engine,'personas':3 if diagnostic_failed_roles else 11,'fixture_personas':11,
                                  'source_tables':len(state['source_before']),'cron_jobs':state['crons'],'browser_launched':False,
                                  'application_mutations':0,'native_safari_tested':False,'native_safari_handoff_requested':native_safari,'frontend':frontend}));return
            folder=business.PRIVATE/'web-cross-browser'/state['run_id'];folder.mkdir(parents=True,mode=0o700);os.chmod(folder,0o700)
            business.save(state)
            try:
                business.set_crons(c,state,True)
                with c.transaction():credentials=business.prepare(c,state);business.save(state)
                Path(state['journal']).touch(mode=0o600,exist_ok=False)
                c.execute('SELECT pg_advisory_lock_shared(20261107,1)');shared=True;c.execute('SELECT pg_advisory_unlock(20261107,1)')
                payload=payload_for(state,credentials,business.identities.keys('staging'))
                result=child(['node','tools/squad/web-cross-browser-hosted.mjs'],payload,folder,engine+'-browser',TIMEOUT,env=env)
                assert (frontend_preflight(frontend['base'],release) if release else frontend_preflight(frontend['base']))==frontend,'Frontend changed during browser acceptance'
                report=bind_result(state,result);private_json(folder/'verified-report.json',report)
                if native_safari:report['native_safari_handoff']=native_handoff(c,state,credentials)
            finally:
                for actor in credentials:actor['password']=''
                payload.clear()
                if shared:
                    c.execute("SET lock_timeout='15s'");c.execute('SELECT pg_advisory_lock(20261107,1)');c.execute('SELECT pg_advisory_unlock_shared(20261107,1)');shared=False
                cleaned=cleanup(c,state);business.set_crons(c,state,False);business.CHECKPOINT.unlink()
            assert cleaned['owned_commands']==0 and cleaned['owned_auth_revisions']==0,'Unexpected business mutations'
            report.update(environment='staging',run_id=state['run_id'],cleanup=cleaned,cutover_unchanged=True,cron_restored=True,
                          source_content_restored=True,immutable_audits_retained=True,measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
            EVIDENCE.mkdir(parents=True,exist_ok=True)
            (EVIDENCE/(f'{engine}-roles-10-11-12-diagnostic.json' if diagnostic_failed_roles else f'{engine}-acceptance.json')).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
        finally:
            if shared:c.execute('SELECT pg_advisory_unlock_shared(20261107,1)')
            c.execute('SELECT pg_advisory_unlock(20261107,1)')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group();g.add_argument('--execute',action='store_true');g.add_argument('--recover',action='store_true')
    p.add_argument('--base',default='http://localhost:5183',help='Exact loopback HTTP frontend origin; served entry is pinned before fixture creation')
    p.add_argument('--release-manifest',help='Explicit reviewed Git/Vercel entry receipt required for an allowlisted HTTPS deployment')
    p.add_argument('--engine',choices=['firefox','webkit'],default='firefox')
    p.add_argument('--native-safari',action='store_true',help='After engine checks, offer a bounded in-memory Customer handoff for native Safari')
    p.add_argument('--confirm-native-shutdown',action='store_true',help='Recovery only: explicitly attest the native application is signed out, its test tab is closed, and clipboard is cleared')
    p.add_argument('--diagnostic-failed-roles',action='store_true',help='Fixed Firefox roles10/11/12 follow-up with passive Auth/lock timing; never full persona acceptance')
    a=p.parse_args();run(a.execute,a.recover,a.engine,a.native_safari,a.confirm_native_shutdown,a.base,a.release_manifest,a.diagnostic_failed_roles)
