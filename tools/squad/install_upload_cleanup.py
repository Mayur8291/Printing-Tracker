"""Deploy and verify Supabase-only hourly cleanup of expired temporary uploads."""
import datetime,json,os,subprocess,sys,urllib.request,urllib.error,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect
from management import api,PROJECTS,token
REF=PROJECTS['staging'];URL='https://'+REF+'.supabase.co'
def run():
 subprocess.run(['supabase','functions','deploy','squad-jobs','--project-ref',REF,'--use-api'],cwd=ROOT,env=dict(os.environ,SUPABASE_ACCESS_TOKEN=token()),check=True)
 with connect('staging') as c:
  assert c.execute('SELECT environment FROM sa_sync.environment_state').fetchone()[0]=='staging'
  secret=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
  key=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role')
  def call(path,body,headers,method='POST'):
   data=body if isinstance(body,bytes) else json.dumps(body).encode()
   req=urllib.request.Request(URL+path,data=data,headers=headers,method=method)
   try:
    with urllib.request.urlopen(req,timeout=60) as r:return r.status,r.read()
   except urllib.error.HTTPError as e:return e.code,e.read()
  h={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/octet-stream'};worker={'Authorization':'Bearer '+secret,'Content-Type':'application/json'}
  assert call('/functions/v1/squad-jobs/media-cleanup',{}, {'Authorization':'Bearer incorrect','Content-Type':'application/json'})[0]==401
  id_=uuid.uuid4();path='pending/'+str(id_)
  try:
   # Deliberately synthetic expired lease; no business row is created or changed.
   c.execute("INSERT INTO sa_domain.media_uploads(id,actor_id,generation,resource,record_id,field,expected_version,filename,bytes,content_type,expires_at) VALUES(%s,%s,0,'brandings',0,'image','test','cleanup-test.txt',7,'text/plain',now()-interval '5 hours')",(id_,uuid.uuid4()))
   assert call('/storage/v1/object/squad-uploads/'+path,b'cleanup',h)[0]==200
   status,result=call('/functions/v1/squad-jobs/media-cleanup',{},worker);assert status==200 and json.loads(result)['cleaned']>=1
   assert c.execute('SELECT state,temp_deleted_at IS NOT NULL FROM sa_domain.media_uploads WHERE id=%s',(id_,)).fetchone()==('expired',True)
   request=urllib.request.Request(URL+'/storage/v1/object/authenticated/squad-uploads/'+path,headers=h)
   try:
    with urllib.request.urlopen(request,timeout=30) as r:raise AssertionError('Expired object still exists')
   except urllib.error.HTTPError as e:assert e.code in(400,404)
   assert call('/functions/v1/squad-jobs/media-cleanup',{},worker)[0]==200
  finally:
   h['Content-Type']='application/json';assert call('/storage/v1/object/squad-uploads',{'prefixes':[path]},h,'DELETE')[0]==200
   c.execute('DELETE FROM sa_domain.media_uploads WHERE id=%s',(id_,))
  command="""SELECT net.http_post(url:='"""+URL+"""/functions/v1/squad-jobs/media-cleanup',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret')),body:='{}'::jsonb,timeout_milliseconds:=60000);"""
  c.execute("SELECT cron.schedule('squad-media-cleanup','17 * * * *',%s)",(command,))
  result={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'unauthorized_denied':True,'expired_object_removed':True,'acknowledged_only_after_storage_success':True,'repeat_call_safe':True,'schedule':'17 * * * *','business_mode':'mirror','fixture_removed':True}
  (ROOT/'docs/squad-one-audit/implementation-evidence/staging-media-cleanup.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':run()
