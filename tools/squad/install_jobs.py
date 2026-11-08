"""Install the staging-only Supabase queue pump and its Vault-backed Cron trigger.

No credentials in arguments, files, scheduler text, or output. The worker's DB
fence stays paused until cutover; installing a schedule cannot enable writes.
"""
import json,os,secrets,subprocess,sys,urllib.error,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
from management import api,token,PROJECTS
SECRET_NAME='squad_jobs_invocation_secret'
REF=PROJECTS['staging']
URL='https://'+REF+'.supabase.co'
def run():
 with connect('staging') as c:
  assert c.execute('SELECT environment FROM sa_sync.environment_state').fetchone()[0]=='staging'
  before=public_structure(c)
  present={x[0] for x in c.execute("SELECT extname FROM pg_extension WHERE extname IN('pg_cron','pg_net','supabase_vault')")}
  assert present=={'pg_cron','pg_net','supabase_vault'},'Supabase Cron, Net and Vault must be installed first'
  stored=c.execute('SELECT id,decrypted_secret FROM vault.decrypted_secrets WHERE name=%s',(SECRET_NAME,)).fetchone()
  secret=stored[1] if stored else secrets.token_urlsafe(48)
  api('staging','/secrets',[{'name':'SQUAD_JOBS_SECRET','value':secret}],method='POST')
  env=dict(os.environ,SUPABASE_ACCESS_TOKEN=token())
  subprocess.run(['supabase','functions','deploy','squad-jobs','--project-ref',REF,'--use-api'],cwd=ROOT,env=env,check=True)
  if not stored:c.execute('SELECT vault.create_secret(%s,%s,%s)',(secret,SECRET_NAME,'Service-only Squad queue invocation'))
  # Scheduler text contains only a Vault lookup, never the secret itself.
  command="""SELECT net.http_post(url:='"""+URL+"""/functions/v1/squad-jobs/run',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret')),
    body:='{"limit":3}'::jsonb,timeout_milliseconds:=60000)
    WHERE EXISTS(SELECT FROM sa_sync.environment_state WHERE singleton AND cutover AND active_job IS NULL);"""
  c.execute("SELECT cron.schedule('squad-jobs-minute','* * * * *',%s)",(command,))
  assert public_structure(c)==before,'Printing Tracker structure changed'
  state=c.execute('SELECT cutover FROM sa_sync.environment_state').fetchone()[0]
  assert not state,'This installer smoke test expects mirror mode'
  def call(authorization):
   request=urllib.request.Request(URL+'/functions/v1/squad-jobs/run',data=b'{"limit":1}',headers={'Content-Type':'application/json','Authorization':authorization},method='POST')
   try:
    with urllib.request.urlopen(request,timeout=60) as response:return response.status,json.loads(response.read())
   except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
  assert call('Bearer wrong')[0]==401,'Unauthenticated worker call was not rejected'
  status,result=call('Bearer '+secret)
  assert status==200 and result=={'paused':True,'results':[]},('Worker mirror smoke failed',status,result)
  print(json.dumps({'environment':'staging','function':'squad-jobs','cron':'squad-jobs-minute','unauthorized_rejected':True,'mirror_paused':True,'public_structure_unchanged':True}))
if __name__=='__main__':run()
