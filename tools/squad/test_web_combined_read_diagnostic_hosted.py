"""Parent-run serial staging reads; original persona graph/cleanup unchanged.

Default preflight. No business command, refresh, provider, cron or cutover change.
On uncertain browser shutdown retain the exact checkpoint until closure is verified.
"""
import argparse
import datetime
import json
import subprocess
import re
from pathlib import Path
import test_hosted_personas as identities
from me_sql_diagnostic import measure_me_sql
from worker_read_sql_diagnostic import measure_worker_sql
from test_web_document_outputs_hosted import private_json
FORMAT='squad-combined-read-diagnostic/v1'
MARKER={'format':FORMAT,'roles':[3,11],'samples':6,'application_commands':0}

def validate(state):
    identities.validate(state)
    assert state.get('web_combined_read_diagnostic')==MARKER,'Wrong diagnostic lifecycle'
    assert not any(key.startswith('web_') and key!='web_combined_read_diagnostic' for key in state),'Mixed browser lifecycle'
    assert 'weekly_mail_inbox' not in state and 'journal' not in state,'Mixed provider/business lifecycle'
    assert type(state.get('diagnostic_browser_active',False)) is bool
    if state.get('diagnostic_guards') is not None:
        guards=state['diagnostic_guards'];assert set(guards)=={'public_structure','staff_auth'}
        assert re.fullmatch('[0-9a-f]{64}',guards['public_structure']) and isinstance(guards['staff_auth'],dict)
    return state

def bind_browser(state,report):
    validate(state);assert report['format']==FORMAT and report['run_id']==state['run_id'] and report['environment']=='staging'
    assert report['browser_closed'] is True and report['browser_errors']==report['network_violations']==report['application_mutations']==0
    assert [r['role'] for r in report['reports']]==[3,11]
    for result,name in zip(report['reports'],['v1_me','v1_order_get']):
        assert result['environment']=='staging' and result['contract']=='/rest/v1/rpc/'+name and result['application_mutations']==0
        assert len(result['samples'])==6 and [s['index'] for s in result['samples']]==list(range(6))
        assert all(s['outcome'] in ('completed','failed') for s in result['samples'])
        assert all(s.get('status')==200 and s.get('observed_rows')==1 for s in result['samples'] if s['outcome']=='completed')
    return report

def browser_closed_return(returncode,receipt,run_id):
    # Even an ordinary exit needs the explicit post-close, run-bound receipt.
    return returncode in (0,1) and isinstance(receipt,dict) and receipt.get('format')==FORMAT and receipt.get('run_id')==run_id and receipt.get('browser_closed') is True

def cleanup(c,state,*,browser_closed_confirmed=False):
    validate(state)
    assert not state.get('diagnostic_browser_active') or browser_closed_confirmed,'Verify browser process closure before recovery'
    guards=state['diagnostic_guards']
    assert identities.public_structure(c)==guards['public_structure'] and identities.staff_auth(c)==guards['staff_auth'],'Unrelated schema or staff identity changed; retain checkpoint for review'
    identities.cleanup(c,state)
    assert identities.public_structure(c)==guards['public_structure'] and identities.staff_auth(c)==guards['staff_auth']
    return {'exact_owned_fixture_removed':True,'retained_blocked_reservations':11,'business_commands':0}

def run(execute=False,recover=False,browser_closed_confirmed=False):
    assert not(execute and recover);assert not browser_closed_confirmed or recover
    checkpoint=identities.CHECKPOINT
    if not recover:assert not checkpoint.exists(),'Recover existing persona checkpoint first'
    with identities.connect('staging') as c:
        assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh, fixture or release active'
        try:
            if recover:
                state=validate(json.loads(checkpoint.read_text()));cleaned=cleanup(c,state,browser_closed_confirmed=browser_closed_confirmed)
                checkpoint.unlink();print(json.dumps({'cleanup':cleaned,'performance_pass_not_inferred':True}));return
            assert not checkpoint.exists(),'Another persona fixture started'
            assert not (identities.ROOT/'tools/squad/private/business-checkpoint.json').exists(),'Business fixture must finish first'
            state=identities.plan(c);state['web_combined_read_diagnostic']=dict(MARKER);validate(state)
            if not execute:
                print(json.dumps({'mode':'read-only preflight','format':FORMAT,'roles':[3,11],'browser_samples':12,'sql_samples':12,'planned_original_auth_accounts':11,'business_commands':0,'cron_changes':0}));return
            folder=identities.ROOT/'tools/squad/private'/('combined-read-diagnostic-'+state['run_id'])
            structure=identities.public_structure(c);staff=identities.staff_auth(c)
            state['diagnostic_guards']={'public_structure':structure,'staff_auth':staff};identities.save_checkpoint(state)
            credentials=[];payload={};report=None
            try:
                credentials=identities.create(c,state);state['stage']='created';identities.save_checkpoint(state)
                actors=[next(a for a in credentials if a['role']==role) for role in [3,11]]
                for actor in actors:assert not c.execute('SELECT 1 FROM auth.sessions WHERE user_id=%s',(actor['auth_id'],)).fetchone(),'Unexpected prior session'
                payload={'format':FORMAT,'url':identities.URL,'anon':identities.keys('staging'),'run_id':state['run_id'],'actors':actors,'order_id':str(state['objects']['orders'][0])}
                state['diagnostic_browser_active']=True;identities.save_checkpoint(state)
                process=subprocess.run(['node','tools/squad/web-combined-read-diagnostic-hosted.mjs'],input=json.dumps(payload),capture_output=True,text=True,cwd=identities.ROOT,timeout=420)
                try:receipt=json.loads(process.stdout)
                except (ValueError,TypeError):receipt=None
                if browser_closed_return(process.returncode,receipt,state['run_id']):state['diagnostic_browser_active']=False;identities.save_checkpoint(state)
                assert not state['diagnostic_browser_active'],'Browser closure is unconfirmed; checkpoint retained'
                if process.returncode:raise RuntimeError('Combined browser diagnostic failed; sanitized child status '+str(process.returncode))
                browser=bind_browser(state,receipt);private_json(folder/'browser.json',browser)
                sql=[]
                for actor in actors:
                    sessions=c.execute('SELECT id FROM auth.sessions WHERE user_id=%s',(actor['auth_id'],)).fetchall();assert len(sessions)==1,'Bind exactly one real login session'
                    args={'auth_id':actor['auth_id'],'session_id':sessions[0][0],'expected_user_id':actor['id']}
                    sql.append(measure_me_sql(c,**args) if actor['role']==3 else measure_worker_sql(c,**args,order_id=state['objects']['orders'][0]))
                    private_json(folder/'sql.json',sql)
                report={'format':FORMAT,'run_id':state['run_id'],'environment':'staging','browser':browser,'sql':sql,'comparison':'Browser samples first, direct SQL later using the same two real sessions and unchanged original persona fixture. Serial measurements; direct SQL does not reproduce PostgREST setup, pool selection, background app reads or the failed commercial data graph. No causal infrastructure attribution.'}
            finally:
                for actor in credentials:actor['password']=''
                payload.clear()
                if not state.get('diagnostic_browser_active'):
                    cleaned=cleanup(c,state);assert identities.public_structure(c)==structure and identities.staff_auth(c)==staff
                    private_json(folder/'cleanup.json',cleaned);private_json(folder/'checkpoint-completed.json',state);checkpoint.unlink()
            assert report is not None
            report.update(cleanup=cleaned,cutover_unchanged=True,cron_unchanged=True,measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
            target=identities.ROOT/'docs/squad-one-web/evidence/combined-read-diagnostic.json';target.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
        finally:c.execute('SELECT pg_advisory_unlock(20261107,1)')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group();g.add_argument('--execute',action='store_true');g.add_argument('--recover',action='store_true');p.add_argument('--browser-closed-confirmed',action='store_true');a=p.parse_args();run(a.execute,a.recover,a.browser_closed_confirmed)
