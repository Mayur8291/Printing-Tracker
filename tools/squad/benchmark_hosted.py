"""Read-policy and DB timing checks on staging; temporary sessions roll back.

These are database role tests, not claims that every persona's password login has
been tested. The controlled customer HTTP login is tested by test_hosted.py.
"""
import datetime,json,math,sys,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect
import psycopg

def run(production_only=False,detail_only=False):
    results=[]
    with connect('staging') as c:
        with c.transaction():
            c.execute("SET LOCAL statement_timeout='5s'")
            actors=c.execute("""SELECT DISTINCT ON(u.role) u.role,m.auth_user_id
              FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id
              WHERE m.enrollment_state='ready' AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE
              AND NOT(u.role=3 AND u.approved IS FALSE) AND u.role IN(0,1,2,3,4,7,8,9,10,11)
              ORDER BY u.role,u.id""").fetchall()
            rows=c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_orders').fetchone()[0]
            for role,actor in actors:
                if production_only and role not in (2,4):continue
                session=uuid.uuid4()
                c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(session,actor))
                c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(actor),'session_id':str(session)}),))
                c.execute('SET LOCAL ROLE sa_app')
                queries=[('factory_queue',"SELECT canto_api.v1_factory_queue(NULL,NULL,NULL,30)")] if production_only else [('orders',"SELECT canto_api.v1_orders_list('{}',NULL,30)"),('dashboard',"SELECT canto_api.v1_dashboard('{}')")]
                if detail_only:queries=[]
                if not production_only:
                    visible=c.execute("SELECT canto_api.v1_orders_list('{}',NULL,1)").fetchone()[0]['data']
                    if visible:queries.append(('order_detail','SELECT canto_api.v1_order_get('+str(int(visible[0]['id']))+')'))
                for name,query in queries:
                    samples=[]
                    for n in range(13):
                        plan=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query).fetchone()[0][0]
                        if n>=3:samples.append(plan['Execution Time'])
                    p95=sorted(samples)[math.ceil(len(samples)*.95)-1]
                    payload=c.execute(query).fetchone()[0]
                    results.append({'role':role,'query':name,'samples':len(samples),'database_p95_ms':round(p95,2),
                      'returned_records':len(payload['data']) if 'data' in payload else len(payload['items']['data']) if 'items' in payload else payload['orders']})
                    print(json.dumps(results[-1]),flush=True)
                c.execute('SET LOCAL ROLE postgres')
            raise psycopg.Rollback()
    report={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
      'order_rows':rows,'method':'EXPLAIN ANALYZE, warm DB execution, transaction-only sessions; excludes network',
      'business_writes':0,'all_temporary_sessions_rolled_back':True,'results':results}
    evidence=ROOT/'docs/squad-one-audit/implementation-evidence';evidence.mkdir(exist_ok=True)
    (evidence/('staging-production-performance.json' if production_only else 'staging-order-detail-performance.json' if detail_only else 'staging-read-performance.json')).write_text(json.dumps(report,indent=2)+'\n')
    assert all(x['database_p95_ms']<200 for x in results),'Read performance target failed'

if __name__=='__main__':run(production_only='--production-only' in sys.argv,detail_only='--detail-only' in sys.argv)
