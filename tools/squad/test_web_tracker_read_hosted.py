"""Fresh disposable staging staff against frozen frontend. Default is preflight.
Creates no source people, write scope or provider jobs; never changes a real staff
profile/password. Credentials and sessions only cross child stdin in memory.
"""
import argparse,hashlib,json,os,re,secrets,subprocess,sys,urllib.request,uuid
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
import tracker_read_fixture as fixture
from deployed_frontend_manifest import load_release
from browser_entry_manifest import frontend_preflight as reviewed_frontend_preflight
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
from management import api
CHECKPOINT=ROOT/'tools/squad/private/tracker-read-checkpoint.json'
def save(state):
 CHECKPOINT.parent.mkdir(parents=True,exist_ok=True,mode=0o700);temporary=CHECKPOINT.with_suffix('.tmp')
 with temporary.open('w') as out:os.chmod(temporary,0o600);json.dump(state,out,indent=2);out.flush();os.fsync(out.fileno())
 temporary.replace(CHECKPOINT)
def base_url(value):
 u=urlparse(value);assert not(u.username or u.password or u.query or u.fragment) and u.path in ('','/')
 assert u.scheme=='http' and u.hostname in ['localhost','127.0.0.1'] or u.scheme=='https' and(u.hostname=='scottdashboard.vercel.app' or bool(re.fullmatch(r'scottdashboard-[a-z0-9-]+-mayur8291s-projects\.vercel\.app',u.hostname or '')))
 return value.rstrip('/')+'/'
class BrowserShutdownUnconfirmed(RuntimeError):pass

def built_entry(html):
 class Entries(HTMLParser):
  def __init__(self):super().__init__();self.entries=[]
  def handle_starttag(self,tag,attrs):
   attrs=dict(attrs)
   if tag=='script' and attrs.get('type')=='module' and attrs.get('src'):self.entries.append(attrs['src'])
 parser=Entries();parser.feed(html)
 assert len(parser.entries)==1 and re.fullmatch(r'/assets/index-[A-Za-z0-9_-]+\.js',parser.entries[0]),'Expected one built admin entry module'
 return parser.entries[0]

def startup_preflight(base):
 process=subprocess.run(['node','tools/squad/web-tracker-startup-preflight.mjs',base],cwd=ROOT,text=True,capture_output=True,timeout=30)
 try:result=json.loads(process.stdout)
 except (ValueError,TypeError):raise AssertionError('Anonymous frontend startup preflight did not return a valid result') from None
 assert process.returncode==0 and result.get('ready') is True and result.get('errors')==[], 'Anonymous frontend startup failed before account creation: '+json.dumps(result.get('errors',[]))[:1000]
 return result

def frontend_preflight(base,release=None):
 """Verify the exact frozen build before fetching keys or creating identities."""
 if release is not None:
  actual=reviewed_frontend_preflight(base.rstrip('/'),release)
  return {'path':actual['entry_path'],'sha256':actual['entry_sha256'],'matches_reviewed_release':True,'release':release,'startup':startup_preflight(base)}
 base=base_url(base);dist=ROOT/'apps/admin/dist'
 entry=built_entry((dist/'index.html').read_text());local=(dist/entry.lstrip('/')).read_bytes()
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 opener=urllib.request.build_opener(NoRedirect)
 def fetch(path,limit):
  req=urllib.request.Request(base+path.lstrip('/'),headers={'Cache-Control':'no-cache','Accept-Encoding':'identity'})
  with opener.open(req,timeout=15) as response:
   assert response.status==200 and response.geturl()==req.full_url,'Frontend preflight redirect/status mismatch'
   content=response.read(limit+1);assert len(content)<=limit,'Frontend preflight response exceeds limit';return content
 assert built_entry(fetch('/',2_000_000).decode('utf-8'))==entry,'Served frontend entry differs from apps/admin/dist; fix the preview/deployment target before creating accounts'
 expected=hashlib.sha256(local).hexdigest();actual=hashlib.sha256(fetch(entry,10_000_000)).hexdigest()
 assert actual==expected,'Served frontend entry bytes differ from apps/admin/dist; no accounts created'
 return {'path':entry,'sha256':expected,'matches_admin_dist':True,'startup':startup_preflight(base)}

def cleanup_with_receipt(c,state):
 """Keep exact cleanup evidence even when browser acceptance raises afterward."""
 proof=fixture.cleanup(c,state);assert public_structure(c)==state['public_structure']
 run_id=str(uuid.UUID(state['run_id']));folder=ROOT/'tools/squad/private'/('tracker-read-'+run_id)
 folder.mkdir(parents=True,mode=0o700,exist_ok=True);os.chmod(folder,0o700)
 temporary=folder/'cleanup-receipt.tmp';destination=folder/'cleanup-receipt.json'
 with temporary.open('w') as out:
  os.chmod(temporary,0o600);json.dump({'run_id':run_id,'environment':'staging','cleanup':proof,'public_structure_unchanged':True,'acceptance_not_inferred':True},out,indent=2);out.flush();os.fsync(out.fileno())
 temporary.replace(destination)
 directory_fd=os.open(folder,os.O_RDONLY|getattr(os,'O_DIRECTORY',0))
 try:os.fsync(directory_fd)
 finally:os.close(directory_fd)
 CHECKPOINT.unlink()
 return proof

def child(command,payload,folder,label,timeout):
 """No raw child output crosses the private-artifact boundary with credentials."""
 sensitive=[payload.get('anon','')]
 for actor in payload.get('actors',[]):
  sensitive += [actor.get('email',''),actor.get('id','')]
  sensitive += [actor.get('session',{}).get(key,'') for key in ['access_token','refresh_token']]
 def clean(value):
  value=value.decode(errors='replace') if isinstance(value,bytes) else value or ''
  for secret in sensitive:
   if secret:value=value.replace(secret,'[redacted]')
  return value[-12000:]
 def persist(value):
  folder.mkdir(parents=True,exist_ok=True,mode=0o700)
  file=folder/(label+'-failure.json')
  with file.open('w') as out:os.chmod(file,0o600);json.dump(value,out)
 try:process=subprocess.run(command,input=json.dumps(payload),text=True,capture_output=True,cwd=ROOT,timeout=timeout)
 except subprocess.TimeoutExpired as error:
  persist({'failure':'timeout','stderr':clean(error.stderr)});raise BrowserShutdownUnconfirmed('Tracker browser timed out; preserve identities until browser shutdown is verified') from None
 if process.returncode<0:
  persist({'failure':'terminated','signal':-process.returncode,'stderr':clean(process.stderr)});raise BrowserShutdownUnconfirmed('Tracker browser was killed; preserve identities until browser shutdown is verified')
 if process.returncode==2:
  persist({'failure':'browser_shutdown_unconfirmed','stderr':clean(process.stderr)});raise BrowserShutdownUnconfirmed('Tracker browser closure failed; preserve identities until browser shutdown is verified')
 if process.returncode:
  persist({'failure':'subprocess','stderr':clean(process.stderr)});raise RuntimeError('Tracker browser failed; private diagnostics retained')
 try:result=json.loads(process.stdout)
 except (ValueError,TypeError):
  persist({'failure':'invalid_json','stderr':clean(process.stderr)});raise RuntimeError('Tracker browser returned invalid JSON') from None
 encoded=json.dumps(result)
 assert not any(secret and secret in encoded for secret in sensitive),'Tracker report contains private identity or session data'
 assert result.get('complete') is True and result.get('environment')=='staging'
 return result

def request(path,key,body):
 req=urllib.request.Request(fixture.URL+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','apikey':key,'Authorization':'Bearer '+key})
 with urllib.request.urlopen(req,timeout=45) as response:return json.load(response)
def run(execute=False,recover=False,base=None,release_manifest=None):
 if not recover:assert not CHECKPOINT.exists(),'Recover disposable Tracker fixture first'
 release=load_release(release_manifest,base) if release_manifest and not recover else None
 build=(frontend_preflight(base,release) if release else frontend_preflight(base)) if not recover and (execute or base) else None
 with connect('staging') as c:
  assert c.execute('SELECT pg_try_advisory_lock_shared(20261107,1)').fetchone()[0],'Refresh/release active'
  try:
   if recover:
    state=fixture.validate(json.loads(CHECKPOINT.read_text()));assert not state.get('browser_shutdown_unconfirmed'),'Verify browser shutdown before reviewing this checkpoint';proof=cleanup_with_receipt(c,state);print(json.dumps(proof));return
   state=fixture.plan(c);state['public_structure']=public_structure(c)
   if not execute:print(json.dumps({'mode':'read-only preflight','scope':fixture.FORMAT,'new_staff_accounts':2,'roles':['admin','viewer'],'source_writes':False,'cron_changes':False,'cutover_changes':False,'frontend_build':build}));return
   base=base_url(base);keys={v['name']:v['api_key'] for v in api('staging','/api-keys')};save(state);actors=[];report=None
   try:
    for a in state['actors']:
     password=secrets.token_urlsafe(32)
     user=request('/auth/v1/admin/users',keys['service_role'],{'email':a['email'],'password':password,'email_confirm':True,'user_metadata':{'full_name':a['name'],'tracker_read_run':state['run_id']},'app_metadata':{'tracker_read_run':state['run_id']}})
     assert user['email']==a['email'];a['id']=str(uuid.UUID(user['id']));save(state)
     with c.transaction():fixture.bind(c,state,a,a['id']);save(state)
     session=request('/auth/v1/token?grant_type=password',keys['anon'],{'email':a['email'],'password':password});password=''
     assert session['user']['id']==a['id'] and session['user']['email']==a['email'] and session['user']['role']=='authenticated'
     assert session['expires_in']>=600
     # Explicit expiry keeps browser from invoking token refresh during the read-only window.
     if 'expires_at' not in session:
      import time
      session['expires_at']=int(time.time())+session['expires_in']
     actors.append({'role':a['role'],'id':a['id'],'email':a['email'],'session':session})
    payload={'base':base,'url':fixture.URL,'anon':keys['anon'],'run_id':state['run_id'],'actors':actors,'evidence_dir':str(ROOT/'tools/squad/private'/('tracker-read-'+state['run_id']))}
    try:report=child(['node','tools/squad/web-tracker-read-hosted.mjs'],payload,ROOT/'tools/squad/private'/('tracker-read-'+state['run_id']),'browser',300)
    except BrowserShutdownUnconfirmed:
     state['browser_shutdown_unconfirmed']=True;save(state);raise
   finally:
    for a in actors:a['session']={}
    keys.clear()
    if not state.get('browser_shutdown_unconfirmed'):
     proof=cleanup_with_receipt(c,state)
   assert proof['business_revision_unchanged'],'Unrelated source revision changed; read-only proof is incomplete, exact staff cleanup completed'
   assert {'path':build['path'],'sha256':build['sha256']} in report['entryAssets'],'Browser did not observe the preflight-verified admin build'
   if release:assert reviewed_frontend_preflight(base.rstrip('/'),release)=={k:release[k] for k in ('base','entry_path','entry_sha256')},'Deployment changed during acceptance'
   report.update(run_id=state['run_id'],cleanup=proof,fixture_scope=fixture.FORMAT,environment='staging',source_write_lease=False,frontend_build=build)
   (ROOT/'docs/squad-one-web/evidence/tracker-read-acceptance.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
  finally:c.execute('SELECT pg_advisory_unlock_shared(20261107,1)')
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);g=parser.add_mutually_exclusive_group();g.add_argument('--execute',action='store_true');g.add_argument('--recover',action='store_true');parser.add_argument('--base');parser.add_argument('--release-manifest');args=parser.parse_args();run(args.execute,args.recover,args.base,args.release_manifest)
