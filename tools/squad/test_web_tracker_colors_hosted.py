"""Prepared single Colors UI mutation rehearsal. Default is read-only preflight.

Separate from approved read-only Tracker acceptance; integrator must obtain the
explicit one-record staging mutation authorization before --execute. No lease,
cutover, provider configuration, real account edit or full refresh is performed.
"""
import argparse,hashlib,json,os,secrets,uuid
from pathlib import Path
import tracker_colors_fixture as fixture
from browser_entry_manifest import frontend_preflight
from test_web_tracker_read_hosted import request,child,startup_preflight,BrowserShutdownUnconfirmed
from database import connect
from management import api

ROOT=Path(__file__).resolve().parents[2];PRIVATE=ROOT/'tools/squad/private';CHECKPOINT=PRIVATE/'tracker-colors-checkpoint.json'
BUILD=ROOT/'docs/squad-one-web/evidence/clean-web-build-execution.json';BASE='http://127.0.0.1:5186/'

def durable(path,value):
 path.parent.mkdir(parents=True,exist_ok=True,mode=0o700);tmp=path.with_suffix('.tmp')
 with tmp.open('w') as f:os.chmod(tmp,0o600);json.dump(value,f,indent=2);f.flush();os.fsync(f.fileno())
 tmp.replace(path);fd=os.open(path.parent,os.O_RDONLY)
 try:os.fsync(fd)
 finally:os.close(fd)

def frozen_build():
 manifest=json.loads(BUILD.read_text());assert manifest['status'] in ('built_startup_verified','incremental_built_startup_verified') and manifest['source_unchanged'] is True
 assert manifest['preview'].rstrip('/')+'/'==BASE
 dist=Path(manifest['dist']);assert dist.is_absolute() and str(dist).startswith('/tmp/squad-clean-web-') and str(dist).endswith('/apps/admin/dist')
 entry=manifest['entry_path'];assert entry.startswith('/assets/index-') and '/' not in entry[len('/assets/'):]
 assert hashlib.sha256((dist/entry.lstrip('/')).read_bytes()).hexdigest()==manifest['entry_sha256']
 actual=frontend_preflight(BASE)
 assert actual=={'base':BASE.rstrip('/'),'entry_path':entry,'entry_sha256':manifest['entry_sha256']},'Served build differs from reviewed clean build'
 startup_preflight(BASE)
 return actual

def read_journal(state):
 folder=PRIVATE/('tracker-colors-'+state['run_id']);p=folder/'requests.json'
 if not p.exists():return []
 assert p.is_file() and not p.is_symlink() and p.stat().st_size<=20000
 return fixture.validate_journal(state,json.loads(p.read_text()))

def cleanup(c,state):
 proof=fixture.cleanup(c,state,read_journal(state))
 fixture.business.set_crons(c,state,False)
 assert fixture.business.cron_state(c)==state['crons']
 result={'run_id':state['run_id'],'cleanup':proof,'cron_restored':True,'acceptance_not_inferred':True}
 durable(PRIVATE/('tracker-colors-'+state['run_id'])/'cleanup-receipt.json',result)
 CHECKPOINT.unlink();return result

def ensure_idle():
 for filename in ['business-checkpoint.json','tracker-read-checkpoint.json','guest-account-checkpoint.json','combined-read-diagnostic-checkpoint.json']:
  assert not (PRIVATE/filename).exists(),'Another owned fixture requires completion first'

def run(execute=False,recover=False):
 if not recover:assert not CHECKPOINT.exists(),'Recover the existing Colors checkpoint first'
 ensure_idle();build=frozen_build() if not recover else None
 with connect('staging') as c:
  assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/release active'
  locked=True;actors=[];keys={}
  try:
   ensure_idle()
   if recover:
    state=fixture.validate(json.loads(CHECKPOINT.read_text()));assert not state.get('browser_shutdown_unconfirmed'),'Verify browser shutdown before reviewed recovery'
    print(json.dumps(cleanup(c,state)));return
   state=fixture.plan(c);state['frontend_build']=build
   if not execute:
    print(json.dumps({'mode':'read-only preflight','scope':fixture.FORMAT,'staff_accounts':1,'source_record':'one new Colors row','visible_actions':['create','edit','archive'],'test_lease':False,'provider_execution':False,'frontend_build':build}));return
   durable(CHECKPOINT,state)
   try:
    fixture.business.set_crons(c,state,True)
    keys={x['name']:x['api_key'] for x in api('staging','/api-keys')};a=state['staff']['actors'][0];password=secrets.token_urlsafe(32)
    user=request('/auth/v1/admin/users',keys['service_role'],{'email':a['email'],'password':password,'email_confirm':True,'user_metadata':{'full_name':a['name'],'tracker_read_run':state['run_id']},'app_metadata':{'tracker_read_run':state['run_id']}})
    assert user['email']==a['email'];a['id']=str(uuid.UUID(user['id']));durable(CHECKPOINT,state)
    with c.transaction():fixture.staff.bind(c,state['staff'],a,a['id']);durable(CHECKPOINT,state)
    session=request('/auth/v1/token?grant_type=password',keys['anon'],{'email':a['email'],'password':password});password=''
    assert session['user']['id']==a['id'] and session['user']['role']=='authenticated' and session['expires_in']>=600
    if 'expires_at' not in session:
     import time
     session['expires_at']=int(time.time())+session['expires_in']
    actors=[{'role':'admin','id':a['id'],'email':a['email'],'session':session}]
    # Legacy Masters takes an EXCLUSIVE per-command publication fence; a parent
    # shared fence would block the very UI being tested. Release only for the
    # bounded browser. Cleanup reacquires it and rejects generation/revision drift.
    c.execute('SELECT pg_advisory_unlock(20261107,1)');locked=False
    payload={'base':BASE,'url':fixture.staff.URL,'anon':keys['anon'],'actors':actors,'run_id':state['run_id'],'name':state['name'],'editedName':state['edited_name'],'evidence_dir':str(PRIVATE/('tracker-colors-'+state['run_id']))}
    try:report=child(['node','tools/squad/web-tracker-colors-hosted.mjs'],payload,Path(payload['evidence_dir']),'browser',300)
    except BrowserShutdownUnconfirmed:
     state['browser_shutdown_unconfirmed']=True;durable(CHECKPOINT,state);raise
   finally:
    for a in actors:a['session']={}
    keys.clear()
    if not state.get('browser_shutdown_unconfirmed'):
     if not locked:
      assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Concurrent writer; keep Colors checkpoint and paused schedules'
      locked=True
     cleaned=cleanup(c,state)
   assert report['run_id']==state['run_id'] and len(report['checks'])==3
   assert {'path':build['entry_path'],'sha256':build['entry_sha256']} in report['entryAssets'],'Browser entry differs from clean-build preflight'
   report.update(frontend_build=build,**{k:v for k,v in cleaned.items() if k!='acceptance_not_inferred'})
   durable(ROOT/'docs/squad-one-web/evidence/tracker-colors-acceptance.json',report);print(json.dumps(report,indent=2))
  finally:
   if locked:c.execute('SELECT pg_advisory_unlock(20261107,1)')

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);g=p.add_mutually_exclusive_group();g.add_argument('--execute',action='store_true');g.add_argument('--recover',action='store_true');a=p.parse_args();run(a.execute,a.recover)
