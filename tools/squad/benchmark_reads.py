"""Repeatable warm DB timings on larger synthetic data; all generated rows roll back."""
import argparse,json,math,statistics
from local_db import connect,PRIVATE
from fixtures import seed_orders,session,rpc
from psycopg.types.json import Jsonb

def run(rows=100000):
    with connect() as c:
        seed_orders(c)
        c.execute('BEGIN')
        try:
            c.execute("""INSERT INTO sa_snapshot_20261019.sa_orders(id,customer_id,address_id,customer_sc_id,assigned_to_id,assigned_worker_id,
              order_item_type,status,created_at,updated_at,created_on,due_on,total_quantity,total_amount)
              SELECT 10000+n,CASE WHEN n%%100=0 THEN 103 ELSE 203 END,CASE WHEN n%%100=0 THEN 100 ELSE 200 END,
              CASE WHEN n%%100=0 THEN 101 ELSE 201 END,CASE WHEN n%%100=0 THEN 104 ELSE 204 END,
              CASE WHEN n%%100=0 THEN 111 ELSE 211 END,n%%3,n%%2,now(),now(),now(),now()+interval '10 days',10,1000
              FROM generate_series(1,%s) n""",(rows,))
            c.execute('ANALYZE sa_snapshot_20261019.sa_orders')
            result=[]
            for actor in [100,101,102,103,104,110,111]:
                session(c,actor)
                for name,sql in [('orders',"SELECT canto_api.v1_orders_list('{}',NULL,30)"),('dashboard',"SELECT canto_api.v1_dashboard('{}')")]:
                    values=[]
                    for n in range(15):
                        plan=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+sql).fetchone()[0][0]
                        if n>=3:values.append(plan['Execution Time'])
                    result.append({'actor_role':actor-100,'query':name,'samples':len(values),
                      'p50_ms':round(statistics.median(values),2),'p95_ms':round(sorted(values)[math.ceil(len(values)*.95)-1],2)})
                c.execute('RESET ROLE')
            PRIVATE.mkdir(exist_ok=True)
            (PRIVATE/'read-benchmark.json').write_text(json.dumps({'synthetic_orders':rows+12,'results':result},indent=2)+'\n')
            print(json.dumps({'synthetic_orders':rows+12,'results':result},indent=2))
            return result
        finally:c.execute('ROLLBACK')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--rows',type=int,default=100000);args=parser.parse_args();run(args.rows)
