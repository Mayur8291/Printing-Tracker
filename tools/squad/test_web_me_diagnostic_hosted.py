"""Serial staging diagnostic; default preflight, unchanged owned-fixture cleanup.

No commercial journeys, source commands, provider calls, email or migrations.
The existing fixture setup creates its usual principals. Only Customer logs in.
"""
import argparse
import datetime
import json
from pathlib import Path
import test_hosted_business_journeys as business
from test_web_document_outputs_hosted import child,private_json
from me_sql_diagnostic import measure_me_sql
FORMAT='squad-me-diagnostic/v1'
OTHER_MARKERS=('web_media','web_catalogue_media','web_catalogue_terms','web_output_rehearsal','document_outputs','weekly_mail_rehearsal','web_cross_browser','web_stock_reconciliation')

def validate(state):
    business.validate(state)
    assert state.get('web_me_diagnostic')=={'format':FORMAT,'role':3,'samples':6}
    assert not any(state.get(key) for key in OTHER_MARKERS),'Wrong diagnostic checkpoint'
    return state

def bind_browser(state,report):
    validate(state)
    assert report['run_id']==state['run_id'] and report['environment']=='staging' and report['role']==3
    assert report['format']=='squad-me-browser-diagnostic/v1'
    assert report['contract']=='/rest/v1/rpc/v1_me' and report['application_mutations']==0
    assert report['browser_errors']==report['network_violations']==0
    assert len(report['samples'])==6 and [s['index'] for s in report['samples']]==list(range(6))
    assert all(s['outcome'] in ('completed','failed') for s in report['samples'])
    assert all(s.get('status')==200 and s.get('observed_rows')==1 for s in report['samples'] if s['outcome']=='completed')
    return report

def cleanup(c,state):
    validate(state);assert business.journal(state)==[],'Read-only diagnostic has an unexpected command'
    return business.cleanup(c,state,journal_entries=[])

def run(execute=False,recover=False):
    assert not(execute and recover)
    if not recover:assert not business.CHECKPOINT.exists(),'Recover the current owned fixture first'
    with business.identities.connect('staging') as c:
        assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh or release active'
        shared=False;credentials=[];payload={}
        try:
            if recover:
                state=validate(json.loads(business.CHECKPOINT.read_text()));cleaned=cleanup(c,state)
                business.set_crons(c,state,False);business.CHECKPOINT.unlink();print(json.dumps({'cleanup':cleaned,'diagnostic_not_inferred':True}));return
            assert not business.CHECKPOINT.exists(),'Another fixture is active'
            state=business.plan(c);state['web_me_diagnostic']={'format':FORMAT,'role':3,'samples':6};validate(state)
            if not execute:
                print(json.dumps({'mode':'read-only preflight','environment':'staging','role':3,'browser_samples':6,'sql_samples':6,'application_commands':0,'existing_fixture_reused':True}));return
            folder=business.PRIVATE/('web-me-diagnostic-'+state['run_id']);business.save(state)
            try:
                business.set_crons(c,state,True)
                with c.transaction():credentials=business.prepare(c,state);business.save(state)
                Path(state['journal']).touch(mode=0o600,exist_ok=False)
                customer=next(actor for actor in credentials if actor['role']==3)
                assert not c.execute('SELECT 1 FROM auth.sessions WHERE user_id=%s',(customer['auth_id'],)).fetchone(),'New fixture already has an unexpected session'
                c.execute('SELECT pg_advisory_lock_shared(20261107,1)');shared=True;c.execute('SELECT pg_advisory_unlock(20261107,1)')
                payload={'format':FORMAT,'url':business.identities.URL,'anon':business.identities.keys('staging'),'actors':[customer],'run_id':state['run_id'],'expected_user_id':customer['id']}
                browser=bind_browser(state,child(['node','tools/squad/web-me-diagnostic-hosted.mjs'],payload,folder,'browser',300))
                sessions=c.execute('SELECT id FROM auth.sessions WHERE user_id=%s',(customer['auth_id'],)).fetchall()
                assert len(sessions)==1,'Diagnostic must bind the single actual Customer login session'
                sql=measure_me_sql(c,auth_id=customer['auth_id'],session_id=sessions[0][0],expected_user_id=customer['id'])
                private_json(folder/'sql-report.json',sql)
                report={'format':FORMAT,'run_id':state['run_id'],'environment':'staging','browser':browser,'sql':sql,
                        'comparison':'Serial browser then direct SQL on the same exact owned Customer/session. No concurrent workload introduced by this harness; elapsed transport and SQL are different measurements. Original failed observation remains evidence.'}
            finally:
                for actor in credentials:actor['password']=''
                payload.clear()
                if shared:
                    c.execute("SET lock_timeout='15s'");c.execute('SELECT pg_advisory_lock(20261107,1)');c.execute('SELECT pg_advisory_unlock_shared(20261107,1)');shared=False
                cleaned=cleanup(c,state);business.set_crons(c,state,False)
                private_json(folder/'cleanup.json',cleaned)
                private_json(folder/'checkpoint-completed.json',state);business.CHECKPOINT.unlink()
            assert cleaned['owned_commands']==cleaned['owned_auth_revisions']==0
            report.update(cleanup=cleaned,cron_restored=True,cutover_unchanged=True,measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
            target=business.ROOT/'docs/squad-one-web/evidence/me-browser-sql-diagnostic.json';target.write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps(report,indent=2))
        finally:
            if shared:c.execute('SELECT pg_advisory_unlock_shared(20261107,1)')
            c.execute('SELECT pg_advisory_unlock(20261107,1)')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);group=parser.add_mutually_exclusive_group();group.add_argument('--execute',action='store_true');group.add_argument('--recover',action='store_true');args=parser.parse_args();run(args.execute,args.recover)
