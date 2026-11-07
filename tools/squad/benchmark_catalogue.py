"""Staging catalogue policy/performance probe. Temporary sessions/quotes roll back."""
import datetime,json,math,sys,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect
import psycopg
from psycopg.types.json import Jsonb

def run():
 results=[]
 with connect('staging') as c:
  with c.transaction():
   c.execute("SET LOCAL statement_timeout='10s'")
   actors=c.execute("""SELECT DISTINCT ON(u.role) u.role,m.auth_user_id FROM sa_snapshot_20261019.sa_users u
    JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id WHERE m.enrollment_state='ready' AND u.deleted_at IS NULL
    AND u.disabled IS NOT TRUE AND NOT(u.role=3 AND u.approved IS FALSE) AND u.role IN(0,1,3,10) ORDER BY u.role,u.id""").fetchall()
   for role,actor in actors:
    session=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(session,actor))
    c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(actor),'session_id':str(session)}),));c.execute('SET LOCAL ROLE sa_app')
    base=c.execute("SELECT canto_api.v1_catalog_tree('products','{}',NULL,1)").fetchone()[0]['data']
    classes=c.execute("SELECT canto_api.v1_rmp_search('{}',NULL,NULL,1)").fetchone()[0]['data']
    extra=[]
    if base:extra.append(('fabrics',f"SELECT canto_api.v1_configurator_options({int(base[0]['id'])},'fabrics',NULL,NULL,NULL,30)"))
    if classes:extra.append(('variants',f"SELECT canto_api.v1_rmp_variants({int(classes[0]['id'])},NULL,'{{}}',NULL,30)"))
    for name,query in [('custom_catalogue',"SELECT canto_api.v1_catalog_tree('products','{}',NULL,30)"),('rmp_search',"SELECT canto_api.v1_rmp_search('{}',NULL,NULL,30)")]+extra:
     samples=[]
     for n in range(12):
      plan=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query).fetchone()[0][0]
      if n>=2:samples.append(plan['Execution Time'])
     result={'role':role,'query':name,'samples':len(samples),'database_p95_ms':round(sorted(samples)[math.ceil(len(samples)*.95)-1],2)}
     results.append(result);print(json.dumps(result),flush=True)
    c.execute('SET LOCAL ROLE postgres')
   raise psycopg.Rollback()
 report={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'method':'EXPLAIN ANALYZE; 2 warmups, 10 samples; DB execution excludes network',
 'business_writes':0,'all_temporary_sessions_rolled_back':True,'results':results}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-catalogue-performance.json').write_text(json.dumps(report,indent=2)+'\n')
 assert all(r['database_p95_ms']<200 for r in results),'Read p95 target failed'
if __name__=='__main__':run()
