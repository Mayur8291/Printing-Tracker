"""Dedicated staging catalogue PNG / optional opaque-branding browser acceptance.

Default: read-only preflight. --execute is release-integrator controlled. Recovery
accepts only this marked checkpoint; browser IDs never establish deletion scope.
Uses the shared business checkpoint and refresh fence so rehearsals cannot overlap.
"""
import argparse,datetime,json,os,uuid
from pathlib import Path
import test_hosted_business_journeys as business
import web_catalogue_media_recovery as media
from test_web_document_outputs_hosted import child,private_json
from management import api

ROOT=business.ROOT
EVIDENCE=ROOT/'docs/squad-one-web/evidence/catalogue-media-acceptance.json'


def validate(state):
    business.validate(state);media.validate(state)
    assert not any(state.get(k) for k in ('web_media','web_catalogue_terms','web_output_rehearsal','document_outputs','weekly_mail_rehearsal')),'Wrong rehearsal checkpoint'
    return state


def preflight(c,state,opaque=False):
    media.plan(c,state,business.PRIVATE,opaque);validate(state)
    assert c.execute("SELECT bool_and(NOT public),count(*) FROM storage.buckets WHERE id IN('squad-uploads','canto-media')").fetchone()==(True,2),'Private upload/media buckets required'
    assert c.execute("SELECT to_regprocedure('canto_api.v1_product_images(bigint,text,integer)')::text,to_regprocedure('canto_api.v1_product_image_comment(bigint,text,text,uuid)')::text").fetchone()==('canto_api.v1_product_images(bigint,text,integer)','canto_api.v1_product_image_comment(bigint,text,text,uuid)'),'Product image contract126 required'
    if opaque:
        definition=c.execute("SELECT pg_get_functiondef('sa_domain.account_upload_reserve(jsonb,jsonb,text,uuid)'::regprocedure)").fetchone()[0]
        assert all(anchor in definition for anchor in ("WHEN 'application/octet-stream' THEN 26214400","resource_<>'brandings' OR field_<>'attachment'",'|cdr|raw)$')), 'Exact opaque branding policy130 required'
    return {'mode':'read-only preflight','environment':'staging','catalogue_png':True,'opaque_branding':opaque,'provider_requests':0,'emails_sent':0,'source_tables':len(state['source_before']),'cron_jobs':state['crons']}


def payload_for(state,credentials,anon):
    validate(state);p=state['web_catalogue_media']
    return {'url':business.identities.URL,'anon':anon,'actors':credentials,'run_id':state['run_id'],'journal':state['journal'],'fixture':state['fixture'],
            'web_catalogue_media':{k:p[k] for k in ('actor_id','legacy_id','configuration','opaque','branding_spec','files')}}


def bind_report(c,state,report):
    """Client observations select candidates; server receipts establish ownership."""
    validate(state);p=state['web_catalogue_media']
    assert report['environment']=='staging' and report['run_id']==state['run_id']
    assert set(report['journeys'])=={'catalogue-media'} and report['browser_errors']==0 and report['network_violations']==0
    result=report['journeys']['catalogue-media'];owned,roots,concrete=media.bindings(c,state,business.journal(state))
    assert len(owned)==len(p['files']) and set(roots)==({'product','branding'} if p['opaque'] else {'product'})
    assert sorted(result['uploadIds'])==sorted(u['id'] for u,_ in owned)
    assert result['cleanupProof']=={'passed':True,'observations_only':True,'product_id':str(roots['product']),'branding_id':str(roots['branding']) if p['opaque'] else None,'independent_server_cleanup_required':True}
    assert result['downloads']==[{'downloaded':True,'bytes':f['bytes'],'sha256':f['sha256']} for f in p['files']]
    checks=['actual_ui_owned_design_png_append_preview_exact_download_guidelines_create_edit_and_detach']+(['actual_ui_owned_unlinked_branding_opaque_upload_download_only_exact_bytes_and_detach'] if p['opaque'] else [])
    assert result['checks']==checks
    # Final browser claims are not enough: every concrete attachment must be
    # detached and both versioned guideline commands must exist in server audit.
    for target in concrete:
        assert not c.execute('SELECT 1 FROM sa_media.references WHERE resource=%s AND record_id=%s AND field=%s',target).fetchone(),'Attachment remains active'
    assert c.execute("SELECT count(*) FROM sa_domain.audit WHERE actor_id=%s AND id>%s AND operation='product_image.comment_saved'",(p['actor_id'],state['audit_start'])).fetchone()==(2,)
    assert c.execute("SELECT count(*) FROM sa_domain.media_history WHERE actor_id=%s AND command_key IN(SELECT key FROM sa_domain.commands WHERE actor_id=%s) AND operation='detach'",(p['actor_id'],p['actor_id'])).fetchone()==(len(p['files']),)
    return {'server_bound_roots':len(roots),'exact_uploads':len(owned),'exact_downloads':len(result['downloads']),'retained_audit_proof':True}


def cleanup(c,state,service_key):
    validate(state)
    prior=c.execute("SELECT 1 FROM sa_domain.audit WHERE operation='rehearsal.cleanup' AND command_key=%s",(uuid.UUID(state['run_id']),)).fetchone()
    if not prior:media.cleanup_storage(c,state,business.journal(state),service_key,business.save,business.identities.URL)
    else:assert state['web_catalogue_media']['storage_deleted'] and media.snapshot(c)==state['web_catalogue_media']['before'],'Completed cleanup baseline changed'
    return business.cleanup(c,state,media_cleanup=media.cleanup_database)


def run(execute=False,recover=False,opaque=False):
    assert not(execute and recover)
    if not recover:assert not business.CHECKPOINT.exists(),'Recover the existing exact-owned checkpoint first'
    with business.identities.connect('staging') as c:
        assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/release is active'
        shared=False;credentials=[];payload={}
        try:
            # Recheck under the exclusive fence; the initial check alone races
            # another integrator that is committing its checkpoint.
            if not recover:assert not business.CHECKPOINT.exists(),'Another rehearsal checkpoint exists'
            if recover:
                state=validate(json.loads(business.CHECKPOINT.read_text()))
                service=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role')
                result=cleanup(c,state,service);business.set_crons(c,state,False);business.CHECKPOINT.unlink()
                print(json.dumps({'recovered':True,'cleanup':result,'acceptance_not_inferred':True}));return
            state=business.plan(c);summary=preflight(c,state,opaque)
            if not execute:print(json.dumps(summary));return
            service=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role')
            folder=business.PRIVATE/'web-catalogue-media'/state['run_id'];folder.mkdir(parents=True,mode=0o700);os.chmod(folder,0o700)
            business.save(state)
            try:
                media.write_files(state);business.set_crons(c,state,True)
                with c.transaction():credentials=business.prepare(c,state);business.save(state)
                Path(state['journal']).touch(mode=0o600,exist_ok=False)
                c.execute('SELECT pg_advisory_lock_shared(20261107,1)');shared=True;c.execute('SELECT pg_advisory_unlock(20261107,1)')
                payload=payload_for(state,credentials,business.identities.keys('staging'))
                report=child(['node','tools/squad/web-business-hosted.mjs'],payload,folder,'catalogue-media-browser',600,env={**os.environ,'SQUAD_WEB_JOURNEYS':'catalogue-media'})
                proof=bind_report(c,state,report);report['server_proof']=proof
                private_json(folder/'verified-report.json',report);state['web_catalogue_media']['result']=report;business.save(state)
            finally:
                for actor in credentials:actor['password']=''
                payload.clear()
                if shared:
                    c.execute("SET lock_timeout='15s'");c.execute('SELECT pg_advisory_lock(20261107,1)');c.execute('SELECT pg_advisory_unlock_shared(20261107,1)');shared=False
                cleaned=cleanup(c,state,service);business.set_crons(c,state,False);business.CHECKPOINT.unlink()
            report.update(cleanup=cleaned,environment='staging',run_id=state['run_id'],cutover_unchanged=True,cron_restored=True,source_content_restored=True,immutable_audits_retained=True,provider_requests=0,emails_sent=0,measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
            EVIDENCE.parent.mkdir(parents=True,exist_ok=True);EVIDENCE.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
        finally:
            if shared:c.execute('SELECT pg_advisory_unlock_shared(20261107,1)')
            c.execute('SELECT pg_advisory_unlock(20261107,1)')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group();g.add_argument('--execute',action='store_true');g.add_argument('--recover',action='store_true');p.add_argument('--opaque',action='store_true',help='Include one inert download-only .cdr attachment on a new unlinked branding');a=p.parse_args();run(a.execute,a.recover,a.opaque)
