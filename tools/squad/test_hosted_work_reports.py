"""Read-only staging operational reports across seven mapped personas."""
import datetime,json,sys,uuid
from pathlib import Path
import psycopg
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect

def run():
 results=[]
 with connect('staging') as c,c.transaction():
  c.execute("SET LOCAL statement_timeout='15s'")
  actors=c.execute("""SELECT DISTINCT ON(u.role) u.role,u.id,m.auth_user_id FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id AND m.enrollment_state='ready'
   JOIN auth.users au ON au.id=m.auth_user_id AND au.role='sa_app' AND(au.banned_until IS NULL OR au.banned_until<now()) WHERE u.role IN(0,2,4,7,8,9,11) AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE ORDER BY u.role,u.id""").fetchall()
  for role,id,actor in actors:
   sid=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid,actor));c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(actor),'session_id':str(sid)}),));c.execute('SET LOCAL ROLE sa_app')
   queries=[('work_metrics',"SELECT canto_api.v1_work_metrics('2026-01-01','2026-11-08')")]
   if role in [0,2,4,7,8]:queries.append(('tailor_leaderboard',"SELECT canto_api.v1_tailor_leaderboard(NULL,'2026-01-01','2026-11-08',NULL,30)"))
   for name,query in queries:
    samples=[]
    for _ in range(11):samples.append(c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query).fetchone()[0][0]['Execution Time'])
    payload=c.execute(query).fetchone()[0]
    if role in [7,8] and name=='tailor_leaderboard':assert all('amount' not in x for x in payload['data'])
    row={'rpc':name,'role':role,'database_p95_ms':max(samples[1:]),'samples_ms':samples[1:],'target_ms':200,'cohort_orders':payload.get('cohort',{}).get('orders'),'returned_records':len(payload.get('data',[])),'ranked_subjects':payload.get('summary',{}).get('subjects')};results.append(row);print(json.dumps(row),flush=True)
   c.execute('SET LOCAL ROLE postgres')
  # Only temporary Auth sessions were inserted; no business row changes.
  report={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'warm database reports, January–November source-shaped data, seven role sessions; excludes network/concurrent load','queries':results,'business_writes':0,'all_temporary_sessions_rolled_back':True}
  (ROOT/'docs/squad-one-audit/implementation-evidence/staging-work-reports-performance.json').write_text(json.dumps(report,indent=2)+'\n')
  raise psycopg.Rollback()
 assert all(x['database_p95_ms']<x['target_ms'] for x in results),[x for x in results if x['database_p95_ms']>=x['target_ms']]
 print(json.dumps({'passed':True,'business_writes':0,'temporary_sessions_rolled_back':True}))
if __name__=='__main__':run()
