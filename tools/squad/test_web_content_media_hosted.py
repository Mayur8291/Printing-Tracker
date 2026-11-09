"""Exact-owned ready PNG/ZIP/promotion acceptance and optional native Safari.
Default is read-only. Only the release integrator executes or recovers staging.
"""
import argparse,datetime,hashlib,json,os,uuid
from pathlib import Path
import test_hosted_business_journeys as business
import web_content_fixture as media
import native_safari_handoff as safari
from test_web_document_outputs_hosted import child,private_json
from management import api
from browser_entry_manifest import frontend_preflight,loopback_base,validate_frontend
EVIDENCE=business.ROOT/'docs/squad-one-web/evidence/owned-content-media-acceptance.json'

def content_frontend(base):
 frontend=frontend_preflight(loopback_base(base))
 assert frontend['entry_path'].startswith('/assets/index-'),'Owned content requires the frozen built frontend'
 manifest=json.loads((business.ROOT/'docs/squad-one-web/evidence/clean-web-dist-manifest.json').read_text())
 assert manifest.get(frontend['entry_path'].lstrip('/'))==frontend['entry_sha256'],'Served entry differs from reviewed clean build'
 source=json.loads((business.ROOT/'docs/squad-one-web/evidence/clean-web-source-manifest.json').read_text())
 for relative,digest in source.items():
  assert hashlib.sha256((business.ROOT/relative).read_bytes()).hexdigest()==digest,'Application source changed since reviewed build'
 return frontend

def validate(state):
 business.validate(state);media.validate(state)
 if 'frontend' in state['web_content_media']:validate_frontend(state['web_content_media']['frontend'])
 assert not any(state.get(k) for k in ('web_media','web_catalogue_media','web_catalogue_terms','web_output_rehearsal','document_outputs','weekly_mail_rehearsal'))
 assert state['web_content_media'].get('browser_state','not_started') in ('not_started','active','closed','shutdown_unconfirmed','recovery_shutdown_confirmed')
 if state.get('native_safari_handoff'):
  assert state['native_safari_handoff']['format']=='squad-native-safari-handoff/v1'
  assert state['native_safari_handoff']['state'] in ('planned','active','shutdown_unconfirmed','shutdown_confirmed','recovery_shutdown_confirmed')
 return state

def cleanup(c,state,key):
 validate(state);p=state['web_content_media']
 assert p.get('browser_state') not in ('active','shutdown_unconfirmed'),'Confirm browser shutdown before cleanup'
 assert state.get('native_safari_handoff',{}).get('state') not in ('active','shutdown_unconfirmed'),'Confirm Safari shutdown before cleanup'
 entries=business.journal(state)
 # Deterministic browser UUID reservations are fine; no business command may
 # have executed in this read-only output test, even if a journal claims it.
 assert not c.execute("SELECT 1 FROM sa_domain.audit WHERE actor_id=ANY(%s::uuid[]) AND id>%s AND (operation IS DISTINCT FROM 'rehearsal.cleanup' OR command_key IS DISTINCT FROM %s::uuid) LIMIT 1",([a['auth_id'] for a in state['identity']['actors']],state['audit_start'],state['run_id'])).fetchone(),'Unexpected application mutation'
 prior=c.execute("SELECT 1 FROM sa_domain.audit WHERE operation='rehearsal.cleanup' AND command_key=%s",(state['run_id'],)).fetchone()
 if not prior:media.cleanup_storage(c,state,key,business.save)
 else:assert p['storage_deleted'] and media.snapshot(c)==p['before']
 return business.cleanup(c,state,entries,media_cleanup=media.cleanup_database)

def bind_report(state,report):
 p=media.validate(state)
 assert report['environment']=='staging' and report['run_id']==state['run_id']
 assert set(report['journeys'])=={'content-media'} and report['browser_errors']==report['network_violations']==0
 r=report['journeys']['content-media'];assert r['completeRequiredMedia'] is True
 assert r['productId']==p['class_id'] and r['promotionId']==p['ready_id']
 assert r['coverage']['productZip']['imageBytes']==p['bytes'] and r['coverage']['productZip']['imageSha256']==p['sha256']
 assert r['coverage']['promotionDownload']=={'downloaded':True,'bytes':p['bytes'],'sha256':p['sha256']}
 assert r['coverage']['promotionMissing'] is True
 expected={'freshCustomerGrantVerified':True,'customerId':str(state['base']+3),'promotionId':p['ready_id'],'promotionName':p['ready_name'],'category':p['category'],'uploadDate':p['upload_date'],'productId':p['class_id'],'productName':p['product_name'],'filename':p['sha256'],'bytes':p['bytes'],'sha256':p['sha256']}
 assert r['nativeOracle']==expected
 return expected

def native_handoff(c,state,credentials,oracle):
 credential=safari.customer_credentials(state,credentials)
 try:
  expires=c.execute('SELECT test_write_expires_at FROM sa_domain.runtime_state WHERE singleton').fetchone()[0]
  seconds=safari.lease_seconds(expires)
  # Safe fixture identifiers and checksum only. The native UI must independently
  # obtain another fresh authorized grant through its real Download control.
  print(json.dumps({'native_safari_media_oracle':oracle,'frontend':state['web_content_media']['frontend']}),flush=True)
  state['native_safari_handoff']['state']='active';business.save(state)
  try:result=safari.handoff(credential,seconds)
  except BaseException:
   state['native_safari_handoff']['state']='shutdown_unconfirmed';business.save(state);raise
  assert result['shutdown_confirmed'] is True
  state['native_safari_handoff']['state']='shutdown_confirmed';business.save(state)
  return result
 finally:credential.clear()

def run(execute=False,recover=False,native=False,confirm_browser=False,confirm_native=False,base='http://localhost:5186'):
 assert not(execute and recover) and not(recover and native)
 assert not(confirm_browser or confirm_native) or recover
 if not recover:assert not business.CHECKPOINT.exists(),'Recover existing checkpoint first'
 frontend=content_frontend(base) if not recover else None
 with business.identities.connect('staging') as c:
  assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/release active'
  shared=False;credentials=[];payload={}
  try:
   if recover:
    state=validate(json.loads(business.CHECKPOINT.read_text()))
    if confirm_browser:
     assert state['web_content_media'].get('browser_state') in ('active','shutdown_unconfirmed')
     state['web_content_media']['browser_state']='recovery_shutdown_confirmed';business.save(state)
    if confirm_native:
     assert state.get('native_safari_handoff',{}).get('state') in ('active','shutdown_unconfirmed')
     state['native_safari_handoff']['state']='recovery_shutdown_confirmed';business.save(state)
    key=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role')
    result=cleanup(c,state,key);business.set_crons(c,state,False);business.CHECKPOINT.unlink()
    print(json.dumps({'recovered':True,'cleanup':result,'acceptance_not_inferred':True}));return
   assert not business.CHECKPOINT.exists(),'Another checkpoint exists'
   state=business.plan(c);p=media.plan(c,state);p['browser_state']='not_started';p['frontend']=frontend
   if native:state['native_safari_handoff']={'format':'squad-native-safari-handoff/v1','state':'planned'}
   validate(state)
   assert c.execute("SELECT public FROM storage.buckets WHERE id='canto-media'").fetchone()==(False,)
   if not execute:
    print(json.dumps({'mode':'read-only preflight','environment':'staging','owned_objects':1,'ready_references':2,'missing_references':1,'native_safari_handoff':native}));return
   key=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role')
   folder=business.PRIVATE/'web-owned-content'/state['run_id'];folder.mkdir(parents=True,mode=0o700)
   business.save(state)
   try:
    business.set_crons(c,state,True)
    with c.transaction():
     credentials=business.prepare(c,state);media.prepare(c,state);business.save(state)
    Path(state['journal']).touch(mode=0o600,exist_ok=False)
    media.upload(c,state,key,business.save)
    c.execute('SELECT pg_advisory_lock_shared(20261107,1)');shared=True;c.execute('SELECT pg_advisory_unlock(20261107,1)')
    payload={'base':frontend['base'],'url':business.identities.URL,'anon':business.identities.keys('staging'),'actors':credentials,'run_id':state['run_id'],'journal':state['journal'],'fixture':state['fixture'],'web_content_media':media.specification(state)}
    p['browser_state']='active';business.save(state)
    try:report=child(['node','tools/squad/web-business-hosted.mjs'],payload,folder,'owned-content-browser',360,env={**os.environ,'SQUAD_WEB_JOURNEYS':'content-media'})
    except BaseException:
     # A killed/failed process does not prove Chrome is gone. No cleanup until
     # the release owner explicitly confirms shutdown during exact recovery.
     p['browser_state']='shutdown_unconfirmed';business.save(state);raise
    p['browser_state']='closed';business.save(state)
    oracle=bind_report(state,report);assert content_frontend(frontend['base'])==frontend,'Frontend changed during acceptance';report['frontend']=frontend;private_json(folder/'verified-report.json',report)
    if native:report['native_safari_handoff']=native_handoff(c,state,credentials,oracle)
    assert content_frontend(frontend['base'])==frontend,'Frontend changed during native handoff'
   finally:
    for a in credentials:a['password']=''
    payload.clear()
    if shared:
     c.execute("SET lock_timeout='15s'");c.execute('SELECT pg_advisory_lock(20261107,1)');c.execute('SELECT pg_advisory_unlock_shared(20261107,1)');shared=False
    cleaned=cleanup(c,state,key);business.set_crons(c,state,False);business.CHECKPOINT.unlink()
   assert cleaned['owned_commands']==cleaned['owned_auth_revisions']==0
   report.update(cleanup=cleaned,environment='staging',run_id=state['run_id'],source_content_restored=True,cron_restored=True,cutover_unchanged=True,provider_requests=0,measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
   EVIDENCE.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
  finally:
   if shared:c.execute('SELECT pg_advisory_unlock_shared(20261107,1)')
   c.execute('SELECT pg_advisory_unlock(20261107,1)')
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);g=parser.add_mutually_exclusive_group();g.add_argument('--execute',action='store_true');g.add_argument('--recover',action='store_true')
 parser.add_argument('--base',default='http://localhost:5186');parser.add_argument('--native-safari',action='store_true');parser.add_argument('--confirm-browser-shutdown',action='store_true');parser.add_argument('--confirm-native-shutdown',action='store_true');a=parser.parse_args();run(a.execute,a.recover,a.native_safari,a.confirm_browser_shutdown,a.confirm_native_shutdown,a.base)
