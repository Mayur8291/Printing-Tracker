"""Hosted transfer DB budgets. Synthetic business records and sequence restarts roll back."""
import datetime,json,sys,uuid
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure

def run():
 results=[]
 with connect('staging') as c:
  before=public_structure(c)
  with c.transaction():
   assert c.execute('SELECT cutover,active_job FROM sa_sync.environment_state').fetchone()==(False,None)
   assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
   assert not c.execute("SELECT 1 FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()
   actor=c.execute("SELECT u.id FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE u.role='authenticated' AND p.role='admin' AND(u.banned_until IS NULL OR u.banned_until<now()) ORDER BY u.id LIMIT 1").fetchone()[0]
   session=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session,actor))
   for name in ['sa_domain.audit_id_seq','sa_admin.audit_id_seq','sa_domain.outbox_sequence_id_seq','sa_domain.transfers_sequence_id_seq','sa_snapshot_20261019.sa_base_product_types_id_seq']:
    last=c.execute(sql.SQL('SELECT last_value FROM {}').format(sql.Identifier(*name.split('.')))).fetchone()[0]
    c.execute(sql.SQL('ALTER SEQUENCE {} RESTART WITH {}').format(sql.Identifier(*name.split('.')),sql.Literal(last+1)))
   c.execute('UPDATE sa_sync.environment_state SET cutover=true')
   def app():
    c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(actor),'session_id':str(session),'role':'authenticated'}),));c.execute('SET LOCAL ROLE authenticated')
   def worker():
    c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");c.execute('SET LOCAL ROLE service_role')
   def measure(name,query,args,budget):
    values=[]
    for n in range(12):
     with c.transaction():
      plan=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query,args).fetchone()[0][0]
      if n>=2:values.append(plan['Execution Time'])
      raise psycopg.Rollback()
    result={'name':name,'p95_ms':max(values),'samples':len(values),'target_ms':budget};results.append(result);print(json.dumps(result),flush=True)
   def claim():
    worker();jobs=c.execute('SELECT canto_api.squad_job_claim(1)').fetchone()[0]['jobs'];assert len(jobs)==1 and jobs[0]['handler']=='transfer';return jobs[0]
   def work_args(j,action,payload=None):return(uuid.UUID(j['id']),uuid.UUID(j['lease_token']),action,Jsonb(payload or {}))
   work='SELECT canto_api.squad_transfer_work(%s,%s,%s,%s)'
   prefix='rollback-transfer-'+uuid.uuid4().hex
   app();u=c.execute("SELECT canto_api.account_transfer_upload('masters','base_product_types',%s,%s)",(Jsonb({'filename':'benchmark.csv','bytes':10000}),uuid.uuid4())).fetchone()[0]
   worker();c.execute('SELECT canto_api.account_transfer_verified(%s,10000,%s)',(uuid.UUID(u['id']),'a'*64));app()
   t=c.execute("SELECT canto_api.v1_import_request('masters',%s,%s)",(Jsonb({'upload_id':u['id']}),uuid.uuid4())).fetchone()[0]
   j=claim();data={'byte_offset':0,'next_byte_offset':10000,'headers':['name'],'rows':[{'row':n+1,'values':{'name':prefix+str(n)}} for n in range(100)],'eof':True}
   measure('validate_100_master_rows',work,work_args(j,'validate',data),2000)
   c.execute(work,work_args(j,'validate',data));app();t=c.execute('SELECT canto_api.v1_import_status(%s)',(uuid.UUID(t['id']),)).fetchone()[0];assert t['state']=='validated'
   c.execute("SELECT canto_api.v1_import_request('masters',%s,%s)",(Jsonb({'id':t['id'],'action':'apply','version':t['version']}),uuid.uuid4()));j=claim()
   measure('apply_50_master_rows',work,work_args(j,'apply'),2000)
   assert c.execute(work,work_args(j,'apply')).fetchone()[0]['state']=='pending';j=claim();assert c.execute(work,work_args(j,'apply')).fetchone()[0]['state']=='done'
   c.execute('SET LOCAL ROLE postgres')
   lo=9000000000005000;hi=lo+1001
   assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_base_product_types WHERE id BETWEEN %s AND %s',(lo,hi)).fetchone()
   c.execute('INSERT INTO sa_snapshot_20261019.sa_base_product_types(id,name,created_at,updated_at) SELECT n,%s||n::text,now(),now() FROM generate_series(%s,%s)n',(prefix+'export',lo,hi))
   app();c.execute("SELECT canto_api.v1_export_request('base_product_types',%s,%s)",(Jsonb({'columns':['id','name'],'search':prefix+'export'}),uuid.uuid4()));j=claim()
   measure('capture_1002_master_export_rows',work,work_args(j,'input'),2000)
   c.execute('SET LOCAL ROLE postgres')
   c.execute("""INSERT INTO sa_domain.transfers(actor_id,principal,generation,direction,kind,resource,state)
     SELECT CASE WHEN n<=100 THEN %s ELSE '00000000-0000-4000-8000-000000000001'::uuid END,'platform',0,'import','masters','base_product_types','completed' FROM generate_series(1,2100)n""",(actor,))
   c.execute('ANALYZE sa_domain.transfers');app()
   measure('history_25_with_2000_unrelated','SELECT canto_api.v1_import_status(NULL,NULL,25)',(),200)
   measure('history_100_with_2000_unrelated','SELECT canto_api.v1_import_status(NULL,NULL,100)',(),500)
   measure('detail_100_row_statuses','SELECT canto_api.v1_import_status(%s,NULL,100)',(uuid.UUID(t['id']),),200)
   c.execute('SET LOCAL ROLE postgres');assert public_structure(c)==before;raise psycopg.Rollback()
  assert public_structure(c)==before
 report={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':results,'all_changes_and_sequences_rolled_back':True,'public_structure_unchanged':True,'scope':'Two warmups and ten measured database executions; 100 synthetic import rows, 50-row atomic apply, 1002 captured export rows, 100 own and 2000 unrelated history records. Storage/CSV parsing/deployed Edge acceptance is separate. Not a mixed-load SLA.'}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-transfers-performance.json').write_text(json.dumps(report,indent=2)+'\n')
 assert all(r['p95_ms']<r['target_ms'] for r in results),results
if __name__=='__main__':run()
