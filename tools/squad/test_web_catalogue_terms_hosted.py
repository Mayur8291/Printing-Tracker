"""Parent-owned staging acceptance: real terms upload, one catalogue, exact cleanup.
Default invocation is read-only preflight. No email, provider or generic worker.
"""
import argparse,datetime,json,os,shutil,subprocess
from pathlib import Path
import test_hosted_business_journeys as business
import document_output_recovery as outputs
import web_catalogue_terms_recovery as terms
from test_web_document_outputs_hosted import child,private_json
from management import api

ROOT=business.ROOT
EVIDENCE=ROOT/'docs/squad-one-web/evidence/catalogue-terms-acceptance.json'

def bind_request(c,state,report):
    assert report['phase']=='request' and report['real_browser_upload'] is True
    owned,docs=terms.bindings(c,state,business.journal(state))
    assert owned and len(docs)==1
    doc=docs[0];assert report['document_id']==doc['id'] and report['job_id']==doc['job_id']
    assert report['upload_id']==owned['upload']['id']
    assert report['attachment_reference']=={'resource':'document_attachments','record_id':str(owned['attachment']['id']),'field':'terms'}
    assert doc['request']['selection']=={'class_ids':[state['fixture']['commercialExtras']['rmpClassId']]}
    assert report['terms_sha256']==owned['file']['sha256'] and report['terms_bytes']==owned['file']['bytes']
    state['web_catalogue_terms']['document_id']=doc['id']
    return outputs.bindings(c,state)

def cleanup(c,state,service_key):
    terms.validate(state)
    prior=c.execute("SELECT 1 FROM sa_domain.audit WHERE operation='rehearsal.cleanup' AND command_key=%s",(state['run_id'],)).fetchone()
    if not prior:
        # Quiesce the exact PDF worker before removing its input attachment.
        if state.get('document_outputs'):outputs.cleanup_storage(c,state,service_key,business.save,business.identities.URL)
        terms.cleanup_storage(c,state,business.journal(state),service_key,business.save,business.identities.URL)
    else:
        assert state['web_catalogue_terms']['storage_deleted']
        if state.get('document_outputs'):assert state['document_outputs']['storage_deleted'] and not outputs.object_rows(c,state['document_outputs']['documents'])
    return business.cleanup(c,state,document_cleanup=outputs.cleanup_callback if state.get('document_outputs') else None,media_cleanup=terms.cleanup_database)

def run(execute=False,recover=False):
    if not recover:assert not business.CHECKPOINT.exists(),'Recover the existing fixture first'
    with business.identities.connect('staging') as c:
        assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/release is active'
        shared=False;credentials=[];payload={}
        try:
            if recover:
                state=business.validate(json.loads(business.CHECKPOINT.read_text()));terms.validate(state)
                service=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role')
                result=cleanup(c,state,service);business.set_crons(c,state,False);business.CHECKPOINT.unlink()
                print(json.dumps({'recovered':True,'cleanup':result,'acceptance_not_inferred':True}));return
            state=business.plan(c);terms.plan(c,state)
            assert c.execute("SELECT 1 FROM pg_attribute WHERE attrelid='sa_domain.document_rehearsal_receipts'::regclass AND attname='attachment_row_sha256'").fetchone(),'Migration123 required'
            assert c.execute("SELECT bool_and(NOT public),count(*) FROM storage.buckets WHERE id IN('squad-documents','squad-uploads','canto-media')").fetchone()==(True,3)
            python=shutil.which('python3');raster=shutil.which('pdftoppm');assert python and raster
            subprocess.run([python,'-c','import pypdf'],check=True,capture_output=True)
            if not execute:
                print(json.dumps({'mode':'read-only preflight','environment':'staging','document':'one catalogue','terms':'unique synthetic UTF-8 file','workers':'one immutable job binding','provider_requests':0,'emails_sent':0}));return
            service=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role')
            folder=business.PRIVATE/'web-catalogue-terms'/state['run_id'];folder.mkdir(parents=True,mode=0o700);os.chmod(folder,0o700)
            business.save(state)
            try:
                business.set_crons(c,state,True)
                with c.transaction():credentials=business.prepare(c,state);business.save(state)
                Path(state['journal']).touch(mode=0o600,exist_ok=False);terms.write_file(state)
                c.execute('SELECT pg_advisory_lock_shared(20261107,1)');shared=True;c.execute('SELECT pg_advisory_unlock(20261107,1)')
                payload={'url':business.identities.URL,'anon':business.identities.keys('staging'),'actors':credentials,'run_id':state['run_id'],'journal':state['journal'],'fixture':state['fixture'],'file':state['web_catalogue_terms']['file'],'output_dir':str(folder),'phase':'request'}
                request=child(['node','tools/squad/web-catalogue-terms-hosted.mjs'],payload,folder,'browser-request',240)
                with c.transaction():bind_request(c,state,request);documents=outputs.register(c,state);business.save(state)
                assert len(documents)==1
                secret=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
                payload.update(phase='render',document=documents[0],worker_secret=secret)
                try:report=child(['node','tools/squad/web-catalogue-terms-hosted.mjs'],payload,folder,'browser-render',240)
                finally:payload.pop('worker_secret',None);secret=None
                assert report['document_id']==documents[0]['document_id'] and report['job_id']==documents[0]['job_id']
                snapshot=c.execute('SELECT snapshot FROM sa_domain.documents WHERE id=%s',(report['document_id'],)).fetchone()[0]
                value={'path':str(folder/'catalogue.pdf'),'snapshot':snapshot,'receipt':report,'file':payload['file'],'class_id':state['fixture']['commercialExtras']['rmpClassId'],'label':state['label']}
                private_json(folder/'captured-snapshot.json',value)
                report['pdf_content']=child([python,'tools/squad/verify_web_catalogue_terms_pdf.py'],value,folder,'pdf-content',30)
                subprocess.run([raster,'-scale-to','1600','-png',value['path'],str(folder/'catalogue-page')],check=True,capture_output=True,timeout=30)
                for artifact in folder.iterdir():
                    if artifact.is_file():os.chmod(artifact,0o600)
                report.update(upload=request,private_artifact_directory=str(folder.relative_to(ROOT)),visual_review_required=True)
                private_json(folder/'verified-report.json',report);state['web_catalogue_terms']['result']=report;business.save(state)
            finally:
                for actor in credentials:actor['password']=''
                payload.clear()
                if shared:
                    c.execute("SET lock_timeout='15s'");c.execute('SELECT pg_advisory_lock(20261107,1)');c.execute('SELECT pg_advisory_unlock_shared(20261107,1)');shared=False
                cleaned=cleanup(c,state,service);business.set_crons(c,state,False);business.CHECKPOINT.unlink()
                private_json(folder/'cleanup-report.json',{'run_id':state['run_id'],'cleanup':cleaned,'cron_restored':True,'cutover_unchanged':True,'measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat()})
            report.update(cleanup=cleaned,environment='staging',run_id=state['run_id'],cutover_unchanged=True,cron_restored=True,source_content_restored=True,immutable_audits_retained=True,measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
            EVIDENCE.parent.mkdir(parents=True,exist_ok=True);EVIDENCE.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
        finally:
            if shared:c.execute('SELECT pg_advisory_unlock_shared(20261107,1)')
            c.execute('SELECT pg_advisory_unlock(20261107,1)')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group();g.add_argument('--execute',action='store_true');g.add_argument('--recover',action='store_true');a=p.parse_args();run(a.execute,a.recover)
