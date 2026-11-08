"""Atomic Masters DB timings on staging; every fixture and sequence rolls back."""
import datetime,json,sys,uuid
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect

def run():
 measurements={}
 with connect('staging') as c:
  with c.transaction():
   assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
   for name in ['sa_snapshot_20261019.sa_base_product_types_id_seq','sa_snapshot_20261019.sa_rmp_brands_id_seq','sa_domain.audit_id_seq','sa_domain.outbox_sequence_id_seq','sa_domain.media_history_id_seq','sa_admin.audit_id_seq']:
    value,called=c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*name.split('.')))).fetchone()
    c.execute(sql.SQL('ALTER SEQUENCE {} RESTART WITH {}').format(sql.Identifier(*name.split('.')),sql.Literal(value+int(called))))
   actor=c.execute("SELECT p.id FROM public.profiles p JOIN auth.users a ON a.id=p.id WHERE p.role='admin' AND a.role='authenticated' AND(a.banned_until IS NULL OR a.banned_until<now()) LIMIT 1").fetchone()[0]
   sid=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid,actor));claims=json.dumps({'role':'authenticated','sub':str(actor),'session_id':str(sid)})
   def staff():c.execute('RESET ROLE');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(claims,));c.execute('SET LOCAL ROLE authenticated')
   def attest(upload):
    c.execute('RESET ROLE');c.execute('SET LOCAL ROLE service_role');c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
    c.execute('SELECT canto_api.account_upload_verified(%s,%s,10,\'image/png\')',(upload,'e'*64));staff()
   staff()
   for resource in ['base_product_types','rmp_brands']:
    timings=[]
    for i in range(12):
     upload=c.execute('SELECT canto_api.account_upload_reserve(%s,%s,\'new\',%s)',(Jsonb({'resource':resource,'record_id':None,'field':'image'}),Jsonb({'filename':'proof.png','bytes':'10','content_type':'image/png'}),uuid.uuid4())).fetchone()[0]['upload_id'];attest(uuid.UUID(upload))
     plan=c.execute('EXPLAIN(ANALYZE,FORMAT JSON) SELECT canto_api.account_master_save(%s,\'create\',%s,%s,%s)',(resource,Jsonb({'values':{'name':'Rollback performance '+str(uuid.uuid4())}}),[uuid.UUID(upload)],uuid.uuid4())).fetchone()[0][0]
     if i>=2:timings.append(plan['Execution Time'])
    measurements[resource]={'samples':len(timings),'p95_ms':sorted(timings)[-1],'max_ms':max(timings)}
   c.execute('RESET ROLE');raise psycopg.Rollback()
 evidence={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'warm_database_commands':measurements,'fixture_transaction_rolled_back':True,'scope':'EXPLAIN ANALYZE atomic create with already-attested private file; two warmups and ten measured samples per physical/virtual master; network upload and verification measured separately, not a concurrent-load SLA.'}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-master-media-performance.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence));assert max(x['p95_ms'] for x in measurements.values())<500
if __name__=='__main__':run()
