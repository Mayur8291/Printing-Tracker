"""Real mapped staging actor; service execution inside the fenced rollback harness."""
import copy,datetime,json,uuid
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2]
def exercise(c,order,request,details,checks):
 results=[];claims=c.execute("SELECT current_setting('request.jwt.claims')").fetchone()[0]
 def app():
  c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(claims,));c.execute('SET LOCAL ROLE sa_app')
 def worker():
  c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");c.execute('SET LOCAL ROLE service_role')
 def measure(name,query,args,budget):
  values=[]
  for _ in range(11):
   with c.transaction():
    plan=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query,args).fetchone()[0][0];values.append(plan['Execution Time']);raise psycopg.Rollback()
  result={'name':name,'samples_ms':values[1:],'p95_ms':max(values[1:]),'target_ms':budget};results.append(result);print(json.dumps({k:result[k] for k in ['name','p95_ms','target_ms']}),flush=True)
 request=copy.deepcopy(request);request['lines']*=6;details=copy.deepcopy(details);details['line_settings']={str(n):details['line_settings']['1'] for n in range(1,7)}
 quote=c.execute('SELECT canto_api.v1_quote(%s)',(Jsonb(request),)).fetchone()[0]
 edit=c.execute('SELECT canto_api.v1_order_edit(%s,%s,%s,%s,%s,%s,%s)',(int(order['id']),uuid.UUID(quote['quote_id']),quote['version'],Jsonb(details),'Rollback worker journey',order['version'],uuid.uuid4())).fetchone()[0]
 assert edit['state']=='queued' and not edit['provider_confirmation_required']
 c.execute('SET LOCAL ROLE postgres');job=c.execute("SELECT id FROM sa_domain.outbox WHERE payload->>'request_id'=%s",(edit['request_id'],)).fetchone()[0]
 # Source mirror is unchanged outside this transaction; the real Cron sees false.
 c.execute('UPDATE sa_sync.environment_state SET cutover=true')
 c.execute("""INSERT INTO sa_domain.outbox(actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation)
  SELECT %s,'profile.saved','person',n,gen_random_uuid(),0 FROM generate_series(1,20000)n""",(uuid.UUID(json.loads(claims)['sub']),))
 c.execute('ANALYZE sa_domain.outbox');app()
 measure('own_jobs_with_20k_events','SELECT canto_api.v1_jobs_list(NULL,NULL,25)',(),200)
 measure('own_job_detail','SELECT canto_api.v1_job_get(%s)',(job,),200)
 page=c.execute('SELECT canto_api.v1_jobs_list(NULL,NULL,25)').fetchone()[0];more=c.execute('SELECT canto_api.v1_jobs_list(NULL,%s,25)',(page['next_cursor'],)).fetchone()[0];assert not{x['id'] for x in page['data']}&{x['id'] for x in more['data']}
 worker();measure('claim_amendment_among_20k_other_events','SELECT canto_api.squad_job_claim(1)',(),500)
 claimed=c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0]['jobs'];assert len(claimed)==1 and claimed[0]['id']==str(job);lease=uuid.UUID(claimed[0]['lease_token'])
 # Remove only this harness's temporary session. Accepted jobs outlive logout,
 # while the Auth account and source role/relationships must remain eligible.
 c.execute('SET LOCAL ROLE postgres');c.execute('DELETE FROM auth.sessions WHERE id=%s',(uuid.UUID(json.loads(claims)['session_id']),));worker()
 measure('leased_six_line_amendment','SELECT canto_api.squad_job_execute(%s,%s)',(job,lease),2000)
 value=c.execute('SELECT canto_api.squad_job_execute(%s,%s)',(job,lease)).fetchone()[0];assert value['state']=='done',value
 retry=c.execute('SELECT canto_api.squad_job_execute(%s,%s)',(job,lease)).fetchone()[0];assert retry['replayed']
 c.execute('SET LOCAL ROLE postgres');assert c.execute('SELECT count(*) FROM sa_domain.worker_context').fetchone()[0]==0
 assert c.execute('SELECT count(*) FROM sa_domain.order_amendments WHERE order_id=%s',(int(order['id']),)).fetchone()[0]==1
 assert c.execute('SELECT state FROM sa_domain.job_attempts WHERE lease_token=%s',(lease,)).fetchone()[0]=='done'
 checks.extend(['leased service execution applies accepted amendment after initiating session ends','duplicate service execution does not apply twice','private delegation context removed; attempt retained','20k unrelated events preserve bounded claim/list performance and disjoint pages'])
 path=ROOT/'docs/squad-one-audit/implementation-evidence/staging-jobs-performance.json'
 path.write_text(json.dumps({'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':results,'scope':'warm database p95; real mapped actor; 20k synthetic queue entries; all rows/temporary cutover rolled back and sequences restored; no provider calls'},indent=2)+'\n')
 assert all(r['p95_ms']<r['target_ms'] for r in results),results
