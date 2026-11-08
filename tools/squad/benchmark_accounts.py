"""Staging account command and reconciliation DB timings; all changes roll back."""
import datetime,json,sys,uuid
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect

def run():
 measurements={k:[] for k in ['status_with_revocation','claim','prepare','finish']}
 credentials=json.loads((ROOT/'../Canto/canto-sync/private/auth-test.json').read_text())
 with connect('staging') as c:
  with c.transaction():
   assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
   assert c.execute('SELECT cutover,active_job FROM sa_sync.environment_state').fetchone()==(False,None)
   for name in ['sa_domain.audit_id_seq','sa_domain.outbox_sequence_id_seq']:
    value,called=c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*name.split('.')))).fetchone();c.execute(sql.SQL('ALTER SEQUENCE {} RESTART WITH {}').format(sql.Identifier(*name.split('.')),sql.Literal(value+int(called))))
   target,target_auth=c.execute('SELECT legacy_user_id,auth_user_id FROM sa_identity.sa_auth_identities WHERE canonical_email=%s',(credentials['email'],)).fetchone()
   actor=c.execute("SELECT p.id FROM public.profiles p JOIN auth.users a ON a.id=p.id WHERE p.role='admin' AND a.role='authenticated' AND(a.banned_until IS NULL OR a.banned_until<now()) LIMIT 1").fetchone()[0]
   sid=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid,actor));claims=json.dumps({'role':'authenticated','sub':str(actor),'session_id':str(sid)})
   c.execute('UPDATE sa_sync.environment_state SET cutover=true')
   def role(worker=False):
    c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims',%s,true)",('{"role":"service_role"}' if worker else claims,));c.execute('SET LOCAL ROLE '+('service_role' if worker else 'authenticated'))
   def timed(name,q,args,i):
    plan=c.execute('EXPLAIN(ANALYZE,FORMAT JSON) '+q,args).fetchone()[0][0]
    if i>=2:measurements[name].append(plan['Execution Time'])
   for i in range(12):
    c.execute('SET LOCAL ROLE postgres');version=c.execute("SELECT sa_domain.version('person',%s)",(target,)).fetchone()[0]
    c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(uuid.uuid4(),target_auth))
    role();timed('status_with_revocation','SELECT canto_api.account_user_status(%s,%s,%s,%s,%s)',(target,'disable' if i%2==0 else 'enable','Rollback performance acceptance',version,uuid.uuid4()),i)
    role(True);timed('claim','SELECT canto_api.squad_job_claim(1)',(),i)
    c.execute('SET LOCAL ROLE postgres');job=c.execute("SELECT id,lease_token FROM sa_domain.outbox WHERE status='leased' ORDER BY sequence_id DESC LIMIT 1").fetchone();role(True)
    timed('prepare','SELECT canto_api.squad_account_prepare(%s,%s)',job,i)
    timed('finish','SELECT canto_api.squad_account_finish(%s,%s,%s)',(*job,Jsonb({'auth_user_id':str(target_auth),'exists':True,'confirmed':True})),i)
   c.execute('SET LOCAL ROLE postgres');raise psycopg.Rollback()
 result={k:{'samples':len(v),'p95_ms':max(v)} for k,v in measurements.items()}
 evidence={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'warm_database_commands':result,'all_changes_rolled_back':True,'scope':'Two warmups and ten measured EXPLAIN ANALYZE executions. Current mapped test account, actual session deletion, lease and SQL attestation; external provider calls measured in separate real SDK journey. Not concurrent-load SLA.'}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-account-performance.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence));assert max(v['p95_ms'] for v in result.values())<500
if __name__=='__main__':run()
