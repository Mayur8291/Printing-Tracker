"""Staging-only real weekly/challan output proof. Default is read-only preflight.

Uses the existing source-valid business journey. No cutover, generic worker,
SMTP, provider request, audit deletion, or revision rewind is permitted.
The release integrator reviews --execute. --recover uses the same checkpoint.
"""
import argparse
import datetime
import json
import shutil
import subprocess
from pathlib import Path

import test_hosted_business_journeys as business
from document_output_recovery import register,cleanup_storage,cleanup_callback,object_rows
from management import api

ROOT=business.ROOT
EVIDENCE=ROOT/'docs/squad-one-audit/implementation-evidence/staging-document-outputs.json'


def cleanup(c,state,service_key):
    prior=c.execute("SELECT 1 FROM sa_domain.audit WHERE operation='rehearsal.cleanup' AND command_key=%s",(state['run_id'],)).fetchone()
    if not prior:cleanup_storage(c,state,service_key,business.save,business.identities.URL)
    elif state.get('document_outputs'):
        assert state['document_outputs']['storage_deleted'] and not object_rows(c,state['document_outputs']['documents'])
    return business.cleanup(c,state,document_cleanup=cleanup_callback)


def run(execute=False,recover=False):
    if not recover:assert not business.CHECKPOINT.exists(),'Recover the existing business checkpoint first'
    with business.identities.connect('staging') as c:
        assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/release is active'
        shared=False;credentials=[]
        try:
            if recover:
                state=business.validate(json.loads(business.CHECKPOINT.read_text()))
                assert state.get('output_rehearsal') is True,'Use the original harness for this checkpoint'
                key=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role')
                result=cleanup(c,state,key);business.set_crons(c,state,False);business.CHECKPOINT.unlink();print(json.dumps(result));return
            state=business.plan(c);state['output_rehearsal']=True
            assert c.execute("SELECT to_regclass('sa_domain.document_rehearsals')").fetchone()[0],'Exact document rehearsal migration is not installed'
            assert c.execute("SELECT public FROM storage.buckets WHERE id='squad-documents'").fetchone()==(False,)
            python=shutil.which('python3');raster=shutil.which('pdftoppm');assert python and raster,'PDF verification dependencies unavailable'
            subprocess.run([python,'-c','import pypdf'],check=True,capture_output=True)
            if not execute:
                print(json.dumps({'mode':'read-only preflight','environment':'staging','cutover':False,'documents':['delivery_challan','tailor_weekly'],'workers':'two exact registered jobs only','emails_sent':0,'provider_requests':0}));return
            service_key=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role')
            business.save(state)
            try:
                business.set_crons(c,state,True)
                with c.transaction():credentials=business.prepare(c,state);business.save(state)
                Path(state['journal']).touch(mode=0o600,exist_ok=False)
                c.execute('SELECT pg_advisory_lock_shared(20261107,1)');shared=True;c.execute('SELECT pg_advisory_unlock(20261107,1)')
                payload={'url':business.identities.URL,'anon':business.identities.keys('staging'),'actors':credentials,'run_id':state['run_id'],'journal':state['journal'],'fixture':state['fixture']}
                result=subprocess.run(['node','tools/squad/test_business_journeys_hosted_sdk.mjs'],input=json.dumps(payload),text=True,capture_output=True,cwd=ROOT,timeout=600)
                if result.returncode:raise RuntimeError('Business journey failed: '+result.stderr[-1800:])
                journey=json.loads(result.stdout)
                with c.transaction():docs=register(c,state);business.save(state)
                folder=business.PRIVATE/'document-outputs'/state['run_id'];folder.mkdir(parents=True,mode=0o700)
                secret=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
                payload.update(documents=docs,worker_secret=secret,output_dir=str(folder))
                result=subprocess.run(['node','tools/squad/test_document_outputs_sdk.mjs'],input=json.dumps(payload),text=True,capture_output=True,cwd=ROOT,timeout=240)
                payload.pop('worker_secret');secret=None
                if result.returncode:raise RuntimeError('Document output acceptance failed: '+result.stderr[-1800:])
                report=json.loads(result.stdout);state['document_output_result']=report;business.save(state)
                verify=[]
                for receipt in report['documents']:
                    snapshot=c.execute('SELECT snapshot FROM sa_domain.documents WHERE id=%s',(receipt['document_id'],)).fetchone()[0]
                    verify.append({'path':str(folder/(receipt['kind']+'.pdf')),'snapshot':snapshot,'receipt':receipt})
                result=subprocess.run([python,'tools/squad/verify_document_output_pdf.py'],input=json.dumps(verify),text=True,capture_output=True,cwd=ROOT,timeout=30)
                if result.returncode:raise RuntimeError('PDF content verification failed: '+result.stderr[-1200:])
                report['pdf_content']=json.loads(result.stdout)
                # Raster artifacts are retained privately for the integrator's
                # visual review. Extraction alone does not assert layout quality.
                for item in verify:
                    subprocess.run([raster,'-scale-to','1600','-png',item['path'],str(folder/(item['receipt']['kind']+'-page'))],check=True,capture_output=True,timeout=30)
                report['visual_review_required']=True;report['private_artifact_directory']=str(folder.relative_to(ROOT))
                report['business_checks']=sum(len(j.get('checks',[])) for j in journey['journeys'].values())
                report['business_rpc_requests']=journey['transport']['rpc_requests'];state['document_output_result']=report;business.save(state)
            finally:
                for actor in credentials:actor['password']=''
                if shared:
                    c.execute("SET lock_timeout='15s'");c.execute('SELECT pg_advisory_lock(20261107,1)');c.execute('SELECT pg_advisory_unlock_shared(20261107,1)');shared=False
                cleaned=cleanup(c,state,service_key)
                business.set_crons(c,state,False);business.CHECKPOINT.unlink()
            report.update(cleanup=cleaned,cutover_unchanged=True,cron_restored=True,source_content_restored=True,immutable_audits_retained=True,environment='staging',measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
            EVIDENCE.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
        finally:
            if shared:c.execute('SELECT pg_advisory_unlock_shared(20261107,1)')
            c.execute('SELECT pg_advisory_unlock(20261107,1)')


if __name__=='__main__':
    parser=argparse.ArgumentParser();group=parser.add_mutually_exclusive_group();group.add_argument('--execute',action='store_true');group.add_argument('--recover',action='store_true');args=parser.parse_args();run(args.execute,args.recover)
