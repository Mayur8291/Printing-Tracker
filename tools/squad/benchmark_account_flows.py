"""Warm staging proof RPC timings. Synthetic writes and sequence changes roll back."""
import datetime,json,sys,uuid
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect

def run():
 samples={k:[] for k in ['request','prepare','finish']};email=json.loads((ROOT/'../Canto/canto-sync/private/auth-test.json').read_text())['email']
 with connect('staging') as c:
  with c.transaction():
   assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
   assert c.execute('SELECT cutover,active_job FROM sa_sync.environment_state').fetchone()==(False,None)
   for name in ['sa_domain.audit_id_seq','sa_domain.outbox_sequence_id_seq','sa_domain.account_flows_sequence_id_seq']:
    v,called=c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*name.split('.')))).fetchone();c.execute(sql.SQL('ALTER SEQUENCE {} RESTART WITH {}').format(sql.Identifier(*name.split('.')),sql.Literal(v+int(called))))
   legacy,auth=c.execute('SELECT legacy_user_id,auth_user_id FROM sa_identity.sa_auth_identities WHERE canonical_email=%s',(email,)).fetchone()
   c.execute('UPDATE sa_sync.environment_state SET cutover=true')
   def service():
    c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");c.execute('SET LOCAL ROLE service_role')
   def timed(k,q,args,i):
    plan=c.execute('EXPLAIN(ANALYZE,FORMAT JSON) '+q,args).fetchone()[0][0]
    if i>=2:samples[k].append(plan['Execution Time'])
   for i in range(12):
    c.execute('SET LOCAL ROLE postgres');c.execute("UPDATE sa_domain.account_flows SET created_at=now()-interval '2 hours' WHERE email=%s",(email,));flow=uuid.uuid4();service()
    timed('request','SELECT canto_api.squad_account_flow_request(%s,%s,%s,%s,%s,%s,%s)',(flow,'recovery',email,Jsonb({}),'a'*64,'b'*64,'c'*48),i)
    timed('prepare','SELECT canto_api.squad_account_flow_prepare(%s,%s,%s,%s,%s)',(flow,'recovery',email,'b'*64,'d'*64),i)
    c.execute('SET LOCAL ROLE postgres');lease=c.execute('SELECT lease_token FROM sa_domain.account_flows WHERE id=%s',(flow,)).fetchone()[0]
    c.execute('UPDATE auth.users SET encrypted_password=%s WHERE id=%s',('rollback-synthetic-'+uuid.uuid4().hex,auth))
    c.execute("UPDATE auth.users SET raw_app_meta_data=raw_app_meta_data||jsonb_build_object('squad_account_flow',%s::text) WHERE id=%s",(str(flow),auth))
    c.execute('SET CONSTRAINTS ALL IMMEDIATE');c.execute('SET CONSTRAINTS ALL DEFERRED');service()
    timed('finish','SELECT canto_api.squad_account_flow_finish(%s,%s)',(flow,lease),i)
   c.execute('SET LOCAL ROLE postgres');raise psycopg.Rollback()
 result={k:{'samples':len(v),'p95_ms':max(v)} for k,v in samples.items()};assert max(v['p95_ms'] for v in result.values())<500
 evidence={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'warm_database_commands':result,'all_changes_and_sequences_rolled_back':True,'scope':'Two warmups, ten measured EXPLAIN ANALYZE RPC executions on the existing controlled customer. Real mail/Auth/SDK latency is recorded separately. Not a concurrent-load SLA.'}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-account-flow-performance.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence))
if __name__=='__main__':run()
