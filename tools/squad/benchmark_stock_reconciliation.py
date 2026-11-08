"""Synthetic reconciliation bounds on an isolated local database; every fixture rolls back."""
import datetime,json,uuid
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect,DATABASE
from fixtures import session,rpc
from test_catalogue import seed_catalogue
ROOT=Path(__file__).resolve().parents[2]

def run():
 results=[]
 with connect() as c:
  seed_catalogue(c)
  with c.transaction():
   c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
   c.execute("INSERT INTO sa_snapshot_20261019.sa_orders(id,customer_id,address_id,created_at,updated_at) SELECT n,110,100,now(),now() FROM generate_series(900000,913169)n")
   c.execute("INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,item_type,rmp_class_id,rmp_brand_id,rmp_category_id,uc_order_status,created_at,updated_at) SELECT n,n,1,1,1,1,'COMPLETE',now(),now() FROM generate_series(900000,913169)n")
   c.execute('INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,dispatched_quantity,created_at,updated_at) SELECT n,1,10,0,now(),now() FROM generate_series(900000,913169)n')
   c.execute('INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,dispatched_quantity,rmp_class_id,rmp_brand_id,rmp_category_id,created_at,updated_at) SELECT 110,n,n,1,0,10,1,1,1,1,now(),now() FROM generate_series(900000,913169)n')
   for table in ['orders','items','quantities','stocks','stock_useds']:c.execute(f'ANALYZE sa_snapshot_20261019.sa_{table}')
   session(c,100)
   for limit in [25,100]:
    samples=[]
    for _ in range(13):samples.append(c.execute("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT canto_api.v1_stock_reconciliation(110,'review','{}',NULL,%s)",(limit,)).fetchone()[0][0]['Execution Time'])
    results.append({'operation':f'review_{limit}','database_p95_ms':max(samples[3:]),'samples_ms':samples[3:],'target_ms':200})
   page=rpc(c,'v1_stock_reconciliation',(110,'review',Jsonb({}),None,100));payload={'receipts':[{'id':r['id'],'expected_version':r['version']} for r in page['data']],'reason':'Synthetic performance test','idempotency_key':str(uuid.uuid4())}
   samples=[]
   for _ in range(13):
    with c.transaction():
     samples.append(c.execute("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT canto_api.v1_stock_reconciliation(110,'rebuild',%s)",(Jsonb(payload),)).fetchone()[0][0]['Execution Time'])
     raise psycopg.Rollback()
   results.append({'operation':'rebuild_100','database_p95_ms':max(samples[3:]),'samples_ms':samples[3:],'target_ms':500})
   raise psycopg.Rollback()
 evidence={'environment':'local_synthetic','database':DATABASE,'measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'receipt_rows':13170,'scope':'Single dealer matching largest observed staging ledger; warm database timings, no network/provider/load SLA','results':results}
 path=ROOT/'docs/squad-one-audit/implementation-evidence/local-stock-reconciliation-performance.json';path.write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence,indent=2))
 assert all(x['database_p95_ms']<x['target_ms'] for x in results),'Reconciliation performance budget exceeded'
if __name__=='__main__':run()
