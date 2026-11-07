"""Read-only staging report contracts and representative warm database latency."""
import datetime,json,sys,uuid
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect
KINDS=['customers','unique_customers','brands','classes','coordinators','customer_directory','order_items','custom_items','rmp_items']
def run():
 results=[]
 with connect('staging') as c,c.transaction():
  c.execute("SET LOCAL statement_timeout='15s'")
  actors=c.execute("""SELECT DISTINCT ON(u.role) u.role,u.id,m.auth_user_id FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id AND m.enrollment_state='ready'
   JOIN auth.users au ON au.id=m.auth_user_id AND au.role='sa_app' AND(au.banned_until IS NULL OR au.banned_until<now()) WHERE u.role IN(0,1,2) AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE ORDER BY u.role,u.id""").fetchall()
  assert len(actors)==3
  sc=next(id for role,id,actor in actors if role==1)
  for role,id,actor in actors:
   sid=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid,actor));c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(actor),'session_id':str(sid)}),));c.execute('SET LOCAL ROLE sa_app')
   queries=[('coordinator_metrics',"SELECT canto_api.v1_sales_coordinator_metrics(%s,'2026-01-01','2026-11-08')",(sc,))]
   if role==0:queries += [(kind,"SELECT canto_api.v1_sales_report(%s,'2026-01-01','2026-11-08','{}',NULL,30)",(kind,)) for kind in KINDS]
   for name,query,args in queries:
    samples=[]
    for _ in range(11):samples.append(c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query,args).fetchone()[0][0]['Execution Time'])
    payload=c.execute(query,args).fetchone()[0]
    if role==2:assert 'sales' not in payload and 'targets' not in payload
    assert len(payload.get('data',[]))<=30
    if payload.get('next_cursor'):
     next_=c.execute("SELECT canto_api.v1_sales_report(%s,'2026-01-01','2026-11-08','{}',%s,30)",(name,payload['next_cursor'])).fetchone()[0]
     assert not {x['id'] for x in payload['data']}&{x['id'] for x in next_['data']}
    row={'report':name,'role':role,'database_p95_ms':max(samples[1:]),'samples_ms':samples[1:],'target_ms':200,'returned_records':len(payload.get('data',[])),'payload_bytes':len(json.dumps(payload).encode())};results.append(row);print(json.dumps(row),flush=True)
   c.execute('SET LOCAL ROLE postgres')
  report={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'warm database report first pages, January–November source-shaped data; excludes network/concurrent load','queries':results,'business_writes':0,'all_temporary_sessions_rolled_back':True}
  (ROOT/'docs/squad-one-audit/implementation-evidence/staging-sales-reports-performance.json').write_text(json.dumps(report,indent=2)+'\n')
  raise psycopg.Rollback()
 assert all(x['database_p95_ms']<x['target_ms'] for x in results),[x for x in results if x['database_p95_ms']>=x['target_ms']]
 print(json.dumps({'passed':True,'business_writes':0,'temporary_sessions_rolled_back':True}))
if __name__=='__main__':run()
