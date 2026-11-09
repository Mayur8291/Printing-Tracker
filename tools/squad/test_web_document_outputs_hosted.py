"""Staging browser request → exact PDF worker → browser download acceptance.

Default is a read-only preflight. The release integrator runs --execute, or
--recover after an interruption. No account closure, generic worker, email,
provider request, cutover, audit deletion or revision rewind is permitted.
"""
import argparse
import datetime
import json
import os
import shutil
import subprocess
import uuid
from pathlib import Path

import test_hosted_business_journeys as business
import document_output_recovery as recovery
from management import api

ROOT=business.ROOT
EVIDENCE=ROOT/'docs/squad-one-web/evidence/document-output-acceptance.json'
MODULES='commerce,operations,feedback,reporting'


def private_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    with open(path,'w') as file:
        os.chmod(path,0o600)
        json.dump(value,file,indent=2,default=business.serial)
        file.flush();os.fsync(file.fileno())


def select_requests(c,state,report):
    """Report IDs select candidates; server audit and journal establish ownership."""
    assert report['environment']=='staging' and report['run_id']==state['run_id']
    assert set(report['journeys'])==set(MODULES.split(','))
    ids=report['journeys']['reporting']['entities']['documentIds']
    assert isinstance(ids,list) and len(ids)==3 and len(set(ids))==3
    ids=[str(uuid.UUID(value)) for value in ids]
    rows=c.execute('SELECT id::text,kind,role_id FROM sa_domain.documents WHERE id=ANY(%s::uuid[])',(ids,)).fetchall()
    assert len(rows)==3 and {row[1] for row in rows}=={'delivery_challan','tailor_weekly','catalogue'}
    selected=[{'document_id':id,'kind':kind,'role':role} for id,kind,role in rows if kind!='catalogue']
    assert {r['kind']:r['role'] for r in selected}=={'delivery_challan':7,'tailor_weekly':4}
    state['web_document_output_requests']=sorted(selected,key=lambda row:row['kind'])
    # This proves exact journaled UUIDv5 command, actor, generation, request audit,
    # document and job binding before registering any output capability.
    return recovery.bindings(c,state)


def cleanup(c,state,service_key):
    business.validate(state)
    assert state.get('web_output_rehearsal') is True
    prior=c.execute("SELECT 1 FROM sa_domain.audit WHERE operation='rehearsal.cleanup' AND command_key=%s",(state['run_id'],)).fetchone()
    if not prior:
        recovery.cleanup_storage(c,state,service_key,business.save,business.identities.URL)
    elif state.get('document_outputs'):
        assert state['document_outputs']['storage_deleted'] and not recovery.object_rows(c,state['document_outputs']['documents'])
    return business.cleanup(c,state,document_cleanup=recovery.cleanup_callback)


def child(command,payload,folder,label,timeout,env=None):
    """Keep diagnostics before cleanup; never persist stdin credentials."""
    secrets=[a.get('password','') for a in payload.get('actors',[])]+[payload.get('anon',''),payload.get('worker_secret','')]
    def sanitized(value):
        value=value.decode(errors='replace') if isinstance(value,bytes) else value or ''
        for secret in secrets:
            if secret:value=value.replace(secret,'[redacted]')
        return value[-12000:]
    try:
        process=subprocess.run(command,input=json.dumps(payload),text=True,capture_output=True,cwd=ROOT,timeout=timeout,env=env)
    except subprocess.TimeoutExpired as error:
        private_json(folder/(label+'-failure.json'),{'failure':'timeout','stderr':sanitized(error.stderr)})
        raise RuntimeError(label+' timed out; private diagnostics retained') from None
    if process.returncode:
        private_json(folder/(label+'-failure.json'),{'failure':'subprocess','returncode':process.returncode,'stderr':sanitized(process.stderr)})
        raise RuntimeError(label+' failed; inspect '+str(folder/(label+'-failure.json')))
    try:result=json.loads(process.stdout)
    except (ValueError,TypeError):
        private_json(folder/(label+'-failure.json'),{'failure':'invalid_json','stderr':sanitized(process.stderr)})
        raise RuntimeError(label+' returned invalid JSON') from None
    # Current adapters intentionally exclude credentials and signed URLs. Refuse
    # accidental credential echo before saving any adapter response.
    encoded=json.dumps(result)
    assert not any(secret and secret in encoded for secret in secrets),'Adapter report contains a credential'
    private_json(folder/(label+'-report.json'),result)
    return result


def run(execute=False,recover=False):
    if not recover:assert not business.CHECKPOINT.exists(),'Recover the existing business checkpoint first'
    with business.identities.connect('staging') as c:
        assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/release is active'
        shared=False;credentials=[];payload={}
        try:
            if recover:
                state=business.validate(json.loads(business.CHECKPOINT.read_text()))
                assert state.get('web_output_rehearsal') is True,'Use the original harness for this checkpoint'
                service_key=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role')
                cleaned=cleanup(c,state,service_key)
                business.set_crons(c,state,False);business.CHECKPOINT.unlink()
                print(json.dumps({'recovered':True,'cleanup':cleaned,'acceptance_not_inferred':True}));return
            state=business.plan(c);state['web_output_rehearsal']=True
            assert c.execute("SELECT to_regclass('sa_domain.document_rehearsals')").fetchone()[0]
            assert c.execute("SELECT public FROM storage.buckets WHERE id='squad-documents'").fetchone()==(False,)
            python=shutil.which('python3');raster=shutil.which('pdftoppm');assert python and raster,'PDF verification dependencies unavailable'
            subprocess.run([python,'-c','import pypdf'],check=True,capture_output=True)
            if not execute:
                print(json.dumps({'mode':'read-only preflight','environment':'staging','browser_modules':MODULES.split(','),'documents':['delivery_challan','tailor_weekly'],'workers':'two immutable browser-request bindings only','cutover':False,'emails_sent':0,'provider_requests':0}));return
            service_key=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role')
            folder=business.PRIVATE/'web-document-outputs'/state['run_id']
            folder.mkdir(parents=True,mode=0o700);os.chmod(folder,0o700)
            business.save(state)
            try:
                business.set_crons(c,state,True)
                with c.transaction():credentials=business.prepare(c,state);business.save(state)
                Path(state['journal']).touch(mode=0o600,exist_ok=False)
                c.execute('SELECT pg_advisory_lock_shared(20261107,1)');shared=True;c.execute('SELECT pg_advisory_unlock(20261107,1)')
                payload={'url':business.identities.URL,'anon':business.identities.keys('staging'),'actors':credentials,'run_id':state['run_id'],'journal':state['journal'],'fixture':state['fixture']}
                journey=child(['node','tools/squad/web-business-hosted.mjs'],payload,folder,'browser-requests',1200,{**os.environ,'SQUAD_WEB_JOURNEYS':MODULES})
                with c.transaction():
                    select_requests(c,state,journey)
                    docs=recovery.register(c,state);business.save(state)
                secret=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
                payload.update(documents=docs,worker_secret=secret,output_dir=str(folder))
                try:report=child(['node','tools/squad/web-document-outputs-hosted.mjs'],payload,folder,'browser-outputs',300)
                finally:payload.pop('worker_secret',None);secret=None
                owned_items=sorted({str(row['value']['id']) for row in business.journal(state) if row.get('kind')=='entity' and row.get('value',{}).get('kind')=='item'})
                assert 0<len(owned_items)<=100
                assert {r['document_id'] for r in report['documents']}=={d['document_id'] for d in docs}
                verify=[]
                for receipt in report['documents']:
                    expected=next(d for d in docs if d['document_id']==receipt['document_id'])
                    assert receipt['kind']==expected['kind'] and receipt['job_id']==expected['job_id']
                    snapshot=c.execute('SELECT snapshot FROM sa_domain.documents WHERE id=%s',(receipt['document_id'],)).fetchone()[0]
                    verify.append({'path':str(folder/(receipt['kind']+'.pdf')),'snapshot':snapshot,'receipt':receipt,'owned_item_ids':owned_items})
                # Snapshot contains only fixture data, but is retained privately to
                # allow independent content review even if exact cleanup refuses.
                private_json(folder/'captured-snapshots.json',verify)
                result=subprocess.run([python,'tools/squad/verify_web_document_output_pdf.py'],input=json.dumps(verify),text=True,capture_output=True,cwd=ROOT,timeout=30)
                if result.returncode:
                    private_json(folder/'pdf-content-failure.json',{'stderr':result.stderr[-4000:]})
                    raise RuntimeError('PDF content verification failed; private diagnostics retained')
                report['pdf_content']=json.loads(result.stdout)
                for item in verify:
                    subprocess.run([raster,'-scale-to','1600','-png',item['path'],str(folder/(item['receipt']['kind']+'-page'))],check=True,capture_output=True,timeout=30)
                for artifact in folder.iterdir():
                    if artifact.is_file():os.chmod(artifact,0o600)
                report.update(visual_review_required=True,private_artifact_directory=str(folder.relative_to(ROOT)),browser_journey_checks=sum(len(j['checks']) for j in journey['journeys'].values()))
                private_json(folder/'verified-report.json',report)
                state['document_output_result']=report;business.save(state)
            finally:
                for actor in credentials:actor['password']=''
                payload.clear()
                if shared:
                    c.execute("SET lock_timeout='15s'");c.execute('SELECT pg_advisory_lock(20261107,1)');c.execute('SELECT pg_advisory_unlock_shared(20261107,1)');shared=False
                cleaned=cleanup(c,state,service_key)
                business.set_crons(c,state,False)
                cleanup_report={'run_id':state['run_id'],'cleanup':cleaned,'cron_restored':True,'cutover_unchanged':True,'acceptance_not_inferred':True}
                (EVIDENCE.parent/'last-document-output-cleanup.json').write_text(json.dumps(cleanup_report,indent=2)+'\n')
                business.CHECKPOINT.unlink()
            report.update(cleanup=cleaned,cutover_unchanged=True,cron_restored=True,source_content_restored=True,immutable_audits_retained=True,environment='staging',run_id=state['run_id'],measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
            EVIDENCE.parent.mkdir(parents=True,exist_ok=True);EVIDENCE.write_text(json.dumps(report,indent=2)+'\n')
            print(json.dumps(report,indent=2))
        finally:
            if shared:c.execute('SELECT pg_advisory_unlock_shared(20261107,1)')
            c.execute('SELECT pg_advisory_unlock(20261107,1)')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group();group.add_argument('--execute',action='store_true');group.add_argument('--recover',action='store_true')
    args=parser.parse_args();run(args.execute,args.recover)
