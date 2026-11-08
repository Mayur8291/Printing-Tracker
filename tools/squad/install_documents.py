"""Deploy the three shared Edges and demand-driven job pump, staging only."""
import json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from management import PROJECTS,token
from database import connect,public_structure
from install_jobs import run as deploy_jobs
def run():
 deploy_jobs()
 subprocess.run(['supabase','functions','deploy','squad-account','--project-ref',PROJECTS['staging'],'--use-api'],cwd=ROOT,env=dict(os.environ,SUPABASE_ACCESS_TOKEN=token()),check=True)
 subprocess.run(['supabase','functions','deploy','squad-webhooks','--project-ref',PROJECTS['staging'],'--use-api'],cwd=ROOT,env=dict(os.environ,SUPABASE_ACCESS_TOKEN=token()),check=True)
 with connect('staging') as c:
  before=public_structure(c)
  assert c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone()==('staging',False,None)
  assert c.execute("SELECT public,file_size_limit FROM storage.buckets WHERE id='squad-documents'").fetchone()==(False,67108864)
  version=c.execute("SELECT extversion FROM pg_extension WHERE extname='pg_cron'").fetchone()[0];assert tuple(map(int,version.split('.')[:2]))>=(1,6)
  # No idle HTTP calls. The Edge leases one job immediately before execution; current
  # generation/cutover/lease checks remain inside the service-only queue RPC.
  command="""SELECT net.http_post(url:='https://scvojtvgnkmbupvyslmb.supabase.co/functions/v1/squad-jobs/run',
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret')),
   body:='{"limit":5}'::jsonb,timeout_milliseconds:=60000)
   WHERE EXISTS(SELECT FROM sa_sync.environment_state WHERE singleton AND cutover AND active_job IS NULL)
   AND EXISTS(SELECT FROM sa_domain.outbox WHERE generation=(SELECT generation FROM sa_domain.runtime_state)
    AND attempts<5 AND(status='pending' AND available_at<=now() OR status='leased' AND lease_until<now())
    AND sa_domain.job_handler(event_type,payload) IN('document_render','document_mail','transfer','warehouse','warehouse_webhook','business_mail','airtable','airtable_report','notification_fanout','notification_delivery','local_amendment','account_reconciliation','account_mail'));"""
  c.execute("SELECT cron.schedule('squad-documents-pump','5 seconds',%s)",(command,))
  assert public_structure(c)==before
 print(json.dumps({'environment':'staging','functions':['squad-account','squad-jobs','squad-webhooks'],'private_bucket':'squad-documents','cron':'squad-documents-pump','idle_http_calls':False,'mirror_paused':True,'public_structure_unchanged':True}))
if __name__=='__main__':run()
