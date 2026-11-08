"""Controlled staging Cron → weekly selector → PDF → five intended mailboxes.

Default is read-only preflight. --execute is held for release-integrator review.
SMTP acknowledgement and downloaded inbox MIME are separate acceptance claims.
"""
import argparse,datetime,json,subprocess,time,uuid
from pathlib import Path
from psycopg import sql
from psycopg.types.json import Jsonb
import test_hosted_business_journeys as business
import weekly_mail_recovery as mail
from management import api

ROOT=business.ROOT
EVIDENCE=ROOT/'docs/squad-one-audit/implementation-evidence/staging-weekly-mail.json'


def install_cron(c,state):
    assert c.info.transaction_status.name=='INTRANS'
    name='squad-mail-rehearsal-'+state['run_id']
    assert not c.execute('SELECT 1 FROM cron.job WHERE jobname=%s',(name,)).fetchone()
    command=sql.SQL('''SELECT net.http_post(url:=%s,
      headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret')),
      body:=jsonb_build_object('capability_id',%s::text),timeout_milliseconds:=60000)
      FROM sa_domain.weekly_mail_rehearsals WHERE id=%s::uuid AND expires_at>clock_timestamp();''').as_string(c)
    # Store only constant URL/capability literals; Vault is resolved at invocation.
    command=command.replace('%s',sql.Literal(business.identities.URL+'/functions/v1/squad-jobs/mail-rehearsal').as_string(c),1)
    command=command.replace('%s',sql.Literal(str(mail.cap_id(state))).as_string(c),1)
    command=command.replace('%s',sql.Literal(str(mail.cap_id(state))).as_string(c),1)
    job=c.execute('SELECT cron.schedule(%s,%s,%s)',(name,'5 seconds',command)).fetchone()[0]
    fingerprint=c.execute("SELECT encode(sha256(convert_to((to_jsonb(j)-'active')::text,'UTF8')),'hex') FROM cron.job j WHERE jobid=%s",(job,)).fetchone()[0]
    state['weekly_mail']['cron']={'jobid':job,'jobname':name,'definition_sha256':fingerprint}
    business.save(state)  # The caller commits only after this fsync.


def remove_cron(c,state):
    expected=state['weekly_mail']['cron'];name='squad-mail-rehearsal-'+state['run_id']
    found=c.execute("SELECT jobid,jobname,encode(sha256(convert_to((to_jsonb(j)-'active')::text,'UTF8')),'hex') FROM cron.job j WHERE jobname=%s",(name,)).fetchall()
    if not found:return
    assert expected and len(found)==1 and found[0]==(expected['jobid'],expected['jobname'],expected['definition_sha256']),'Temporary Cron definition changed'
    c.execute('SELECT cron.unschedule(%s)',(expected['jobid'],))


def cleanup(c,state,key):
    remove_cron(c,state)
    prior=c.execute("SELECT 1 FROM sa_domain.audit WHERE operation='rehearsal.cleanup' AND command_key=%s",(state['run_id'],)).fetchone()
    if not prior:mail.cleanup_storage(c,state,key,business.save,business.identities.URL)
    else:
        assert state['weekly_mail']['storage_deleted']
        # Success-only checkpoints may be absent after a partial run. Immutable
        # server root receipts survive cleanup and retain every output prefix.
        retained=c.execute('''SELECT p.document_id,j.generation,j.actor_id FROM sa_domain.weekly_mail_documents p
          JOIN sa_domain.outbox j ON j.id=p.job_id WHERE p.capability_id=%s''',(mail.cap_id(state),)).fetchall()
        assert len(retained)<=3
        auths={uuid.UUID(a['auth_id']) for a in mail.actors(state).values()}
        assert all(g==state['identity']['generation'] and a in auths for _,g,a in retained)
        prefixes=[f'g{g}/{a}/{d}/' for d,g,a in retained]
        assert not c.execute("SELECT 1 FROM storage.objects WHERE bucket_id='squad-documents' AND EXISTS(SELECT 1 FROM unnest(%s::text[])p WHERE starts_with(name,p))",(prefixes,)).fetchone()
        assert c.execute('SELECT to_jsonb(s) FROM sa_domain.weekly_tailor_schedule s').fetchone()[0]==state['weekly_mail']['schedule_before']
        assert c.execute("SELECT to_jsonb(s) FROM sa_domain.business_mail_settings s WHERE kind='tailor_weekly'").fetchone()[0]==state['weekly_mail']['settings_before']
    return business.cleanup(c,state,weekly_mail_cleanup=mail.callback)


def sdk(config):
    r=subprocess.run(['node','tools/squad/test_weekly_mail_sdk.mjs'],input=json.dumps(config),text=True,capture_output=True,cwd=ROOT,timeout=180)
    if r.returncode:raise RuntimeError('Mail SDK acceptance failed: '+r.stderr[-1500:])
    return json.loads(r.stdout)


def manifest(c,state):
    docs=mail.roots(c,state);assert len(docs)==3
    weekly=next(d for d in docs if d['kind']=='tailor_weekly')['document']['snapshot']
    expected=state['fixture']['weeklyMail']
    assert weekly['period']['week_start']==expected['weekStart'] and len(weekly['rows'])==1
    assert (weekly['summary']['assigned'],weekly['summary']['completed'],weekly['summary']['pending'])==(3,3,0)
    assert float(weekly['summary']['amount'])==105 and weekly['summary']['needs_reconciliation'] is False
    rows=c.execute('''SELECT s.job_id,s.document_id,s.email,m.recipient_role,m.kind,d.bytes,d.sha256,d.page_count
      FROM sa_domain.weekly_mail_sends s JOIN sa_domain.business_mail_deliveries m ON m.job_id=s.job_id
      JOIN sa_domain.documents d ON d.id=s.document_id WHERE s.capability_id=%s AND s.state='accepted'
      AND m.state='sent' AND d.state='ready' AND d.delivery_state='sent' ORDER BY m.kind,m.recipient_role''',(mail.cap_id(state),)).fetchall()
    assert len(rows)==5
    assert [(r[4],r[3]) for r in rows]==[('catalogue',0),('delivery_challan',3),('tailor_weekly',0),('tailor_weekly',2),('tailor_weekly',4)]
    result={'run_id':state['run_id'],'deliveries':[dict(zip(['job_id','document_id','email','role_id','kind','bytes','sha256','pages'],map(lambda v:str(v) if isinstance(v,uuid.UUID) else v,r))) for r in rows]}
    return docs,result


def run(execute=False,recover=False,inbox=None):
    if execute:assert inbox,'--execute requires an explicit attachment-capable controlled --inbox'
    if not recover:assert not business.CHECKPOINT.exists(),'Recover the active business checkpoint first'
    with business.identities.connect('staging') as c:
        assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh or release is active'
        shared=False;credentials=[]
        try:
            key=None
            if recover:
                state=business.validate(json.loads(business.CHECKPOINT.read_text()));assert state.get('weekly_mail_rehearsal') is True
                key=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role')
                result=cleanup(c,state,key);business.set_crons(c,state,False)
                archive=business.PRIVATE/f"weekly-mail-{state['run_id']}-recovered.json";archive.write_text(json.dumps(state,default=business.serial,indent=2));archive.chmod(0o600)
                business.CHECKPOINT.unlink();print(json.dumps(result));return
            state=business.plan(c);state['weekly_mail_rehearsal']=True
            if inbox:business.identities.bind_controlled_inbox(c,state['identity'],inbox)
            state['fixture']=business.plan_fixture(state);mail.capture_settings(c,state);business.validate(state)
            assert c.execute("SELECT to_regclass('sa_domain.weekly_mail_rehearsals')").fetchone()[0],'Mail rehearsal migration is not installed'
            assert c.execute("SELECT public FROM storage.buckets WHERE id='squad-documents'").fetchone()==(False,)
            assert c.execute("SELECT count(*) FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()==(1,)
            before=state['weekly_mail']['schedule_before'];assert before['enabled'] is False,'Existing automatic report must be inactive'
            latest=state['fixture']['weeklyMail']['weekStart'];assert before['generation']!=state['identity']['generation'] or before['next_week'] in [None,latest],'Existing schedule already processed a different week'
            assert not c.execute('SELECT 1 FROM sa_domain.weekly_tailor_runs WHERE generation=%s AND week_start=%s',(state['identity']['generation'],latest)).fetchone(),'Actual prior-week run already exists'
            subprocess.run(['python3','-c','import pypdf'],check=True,capture_output=True)
            if not execute:
                print(json.dumps({'mode':'read-only preflight','environment':'staging','cutover':False,'weekly_period':latest,'synthetic_completed_pieces':3,'weekly_amount':'105','documents':3,'maximum_test_messages':5,'temporary_settings_restored':True,'inbox_evidence':'five original MIME messages from the explicit controlled inbox','controlled_inbox_bound':bool(inbox)}));return
            key=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role');business.save(state)
            report={}
            try:
                business.set_crons(c,state,True)
                with c.transaction():credentials=business.prepare(c,state);business.save(state)
                Path(state['journal']).touch(mode=0o600,exist_ok=False)
                c.execute('SELECT pg_advisory_lock_shared(20261107,1)');shared=True;c.execute('SELECT pg_advisory_unlock(20261107,1)')
                config={'url':business.identities.URL,'anon':business.identities.keys('staging'),'actors':credentials,'run_id':state['run_id'],'journal':state['journal'],'fixture':state['fixture']}
                composed=subprocess.run(['node','tools/squad/test_business_journeys_hosted_sdk.mjs'],input=json.dumps(config),text=True,capture_output=True,cwd=ROOT,timeout=600)
                if composed.returncode:raise RuntimeError('Business fixture journey failed: '+composed.stderr[-1500:])
                journey=json.loads(composed.stdout)
                original=c.execute("SELECT d.request FROM sa_domain.audit a JOIN sa_domain.documents d ON d.id=(a.changes->>'document_id')::uuid WHERE a.command_key=%s AND a.actor_id=%s AND a.operation='document.requested'",(uuid.uuid5(uuid.UUID(state['run_id']),'workforce.challan'),mail.actors(state)[7]['auth_id'])).fetchone()[0]
                sdk({**config,'mode':'setup','challan_request':{**original,'delivery':'email'}})
                with c.transaction():mail.register(c,state);business.save(state);install_cron(c,state)
                started=time.monotonic()
                while time.monotonic()-started<240:
                    stats=c.execute("SELECT count(*) FILTER(WHERE state='accepted'),count(*) FILTER(WHERE state='unknown') FROM sa_domain.weekly_mail_sends WHERE capability_id=%s",(mail.cap_id(state),)).fetchone()
                    if stats[1]:raise RuntimeError('SMTP outcome uncertain; retain send receipt and do not resend')
                    if stats[0]==5:break
                    failures=c.execute("SELECT 1 FROM sa_domain.weekly_mail_job_receipts p JOIN sa_domain.outbox j ON j.id=p.job_id WHERE p.capability_id=%s AND j.status='dead' LIMIT 1",(mail.cap_id(state),)).fetchone()
                    assert not failures,'Exact mail worker failed; preserve evidence'
                    time.sleep(5)
                else:raise RuntimeError('Exact automatic mail rehearsal did not complete in four minutes')
                docs,inbox=manifest(c,state);state['weekly_mail']['output_documents']=[{k:v for k,v in d.items() if k!='document'} for d in docs];business.save(state)
                report=sdk({**config,'mode':'download','documents':state['weekly_mail']['output_documents']})
                cron=state['weekly_mail']['cron'];runs=c.execute("SELECT status,count(*) FROM cron.job_run_details WHERE jobid=%s GROUP BY status",(cron['jobid'],)).fetchall()
                assert any(status=='succeeded' and count>0 for status,count in runs),'No actual successful Cron invocation'
                folder=business.PRIVATE/'mail-outputs'/state['run_id'];folder.mkdir(parents=True,exist_ok=True,mode=0o700)
                target=folder/'inbox-manifest.json';target.write_text(json.dumps(inbox,indent=2)+'\n');target.chmod(0o600)
                for d in docs:
                    pdf=folder/(d['kind']+'.pdf')
                    check=subprocess.run(['python3','-c',"import sys;from pypdf import PdfReader;r=PdfReader(sys.argv[1]);assert len(r.pages)>0;print(' '.join(p.extract_text() or '' for p in r.pages))",str(pdf)],capture_output=True,text=True,check=True)
                    assert len(check.stdout)>50
                    if d['kind']=='tailor_weekly':
                        assert '105' in check.stdout and 'Completed: 3' in check.stdout and latest in check.stdout
                    subprocess.run(['pdftoppm','-scale-to','1600','-png',str(pdf),str(folder/(d['kind']+'-page'))],check=True,capture_output=True,timeout=30)
                report.update(environment='staging',cutover=False,smtp_accepted=5,recipient_roles={'tailor_weekly':[0,2,4],'catalogue':[0],'delivery_challan':[3]},
                  automatic_cron=True,temporary_cron_runs=dict(runs),weekly_completed=3,weekly_amount='105',week_start=latest,
                  business_checks=sum(len(j.get('checks',[])) for j in journey['journeys'].values()),
                  inbox_verified=False,visual_review_required=True,private_manifest=str(target.relative_to(ROOT)),measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
                state['weekly_mail_result']=report;business.save(state)
            finally:
                for actor in credentials:actor['password']=''
                remove_cron(c,state)
                if shared:
                    c.execute("SET lock_timeout='15s'");c.execute('SELECT pg_advisory_lock(20261107,1)');c.execute('SELECT pg_advisory_unlock_shared(20261107,1)');shared=False
                cleaned=cleanup(c,state,key);business.set_crons(c,state,False)
                archive=business.PRIVATE/f"weekly-mail-{state['run_id']}-completed.json";archive.write_text(json.dumps(state,default=business.serial,indent=2));archive.chmod(0o600);business.CHECKPOINT.unlink()
            report.update(cleanup=cleaned,source_content_restored=True,settings_restored=True,prior_crons_restored=True,send_receipts_retained=True)
            EVIDENCE.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
        finally:
            if shared:c.execute('SELECT pg_advisory_unlock_shared(20261107,1)')
            c.execute('SELECT pg_advisory_unlock(20261107,1)')

if __name__=='__main__':
    p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group();g.add_argument('--execute',action='store_true');g.add_argument('--recover',action='store_true');p.add_argument('--inbox',help='Explicit controlled base inbox; four deterministic run/role aliases are used');a=p.parse_args();run(a.execute,a.recover,a.inbox)
