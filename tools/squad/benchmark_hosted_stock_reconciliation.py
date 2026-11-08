"""Hosted existing-ledger reads and synthetic counter repair; all effects roll back."""
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
  structure=public_structure(c)
  with c.transaction():
   assert c.execute('SELECT cutover,active_job FROM sa_sync.environment_state').fetchone()==(False,None)
   assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
   actor=c.execute("SELECT u.id FROM auth.users u JOIN public.profiles p ON p.id=u.id WHERE u.role='authenticated' AND p.role='admin' AND(u.banned_until IS NULL OR u.banned_until<now()) ORDER BY u.id LIMIT 1").fetchone()[0]
   session=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session,actor))
   dealer,receipt_count=c.execute('SELECT user_id,count(*) FROM sa_snapshot_20261019.sa_stocks GROUP BY user_id ORDER BY count(*) DESC LIMIT 1').fetchone()
   def app():
    c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':str(actor),'session_id':str(session),'role':'authenticated'}),));c.execute('SET LOCAL ROLE authenticated')
   def measure(name,query,args,budget):
    values=[]
    for i in range(12):
     with c.transaction():
      plan=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query,args).fetchone()[0][0]
      if i>=2:values.append(plan['Execution Time'])
      raise psycopg.Rollback()
    value={'name':name,'p95_ms':max(values),'samples':len(values),'target_ms':budget};results.append(value);print(json.dumps(value),flush=True)
   app()
   for n in (25,100):measure('largest_dealer_review_'+str(n),"SELECT canto_api.v1_stock_reconciliation(%s,'review','{}',NULL,%s)",(dealer,n),200)
   c.execute('SET LOCAL ROLE postgres');c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,test_write_expires_at=now()+interval '15 minutes'",([actor],))
   variant=c.execute('SELECT size_id,rmp_class_id,rmp_brand_id,rmp_category_id FROM sa_snapshot_20261019.sa_stocks WHERE user_id=%s AND stock_type=0 AND size_id IS NOT NULL AND rmp_class_id IS NOT NULL AND rmp_brand_id IS NOT NULL LIMIT 1',(dealer,)).fetchone();assert variant
   for seq in ('sa_snapshot_20261019.sa_quantities_id_seq','sa_snapshot_20261019.sa_stocks_id_seq','sa_domain.stock_reconciliations_id_seq','sa_domain.audit_id_seq'):
    last=c.execute(sql.SQL('SELECT last_value FROM {}').format(sql.Identifier(*seq.split('.')))).fetchone()[0];c.execute(sql.SQL('ALTER SEQUENCE {} RESTART WITH {}').format(sql.Identifier(*seq.split('.')),sql.Literal(last+1)))
   lo=9000000000003000;hi=lo+99
   assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_orders WHERE id BETWEEN %s AND %s',(lo,hi)).fetchone()
   assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_items WHERE id BETWEEN %s AND %s',(lo,hi)).fetchone()
   address=c.execute('SELECT o.address_id FROM sa_snapshot_20261019.sa_orders o JOIN sa_snapshot_20261019.sa_addresses a ON a.id=o.address_id WHERE o.customer_id=%s ORDER BY o.id DESC LIMIT 1',(dealer,)).fetchone();assert address
   c.execute('INSERT INTO sa_snapshot_20261019.sa_orders(id,customer_id,address_id,created_at,updated_at) SELECT n,%s,%s,now(),now() FROM generate_series(%s,%s)n',(dealer,address[0],lo,hi))
   c.execute("INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,item_type,rmp_class_id,rmp_brand_id,rmp_category_id,uc_order_status,created_at,updated_at) SELECT n,n,1,%s,%s,%s,'COMPLETE',now(),now() FROM generate_series(%s,%s)n",(*variant[1:],lo,hi))
   c.execute('INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,dispatched_quantity,created_at,updated_at) SELECT n,%s,10,0,now(),now() FROM generate_series(%s,%s)n',(variant[0],lo,hi))
   c.execute('INSERT INTO sa_snapshot_20261019.sa_stocks(user_id,order_id,item_id,size_id,stock_type,quantity,dispatched_quantity,rmp_class_id,rmp_brand_id,rmp_category_id,created_at,updated_at) SELECT %s,n,n,%s,0,10,1,%s,%s,%s,now(),now() FROM generate_series(%s,%s)n',(dealer,*variant,lo,hi))
   app();rows=c.execute("SELECT canto_api.v1_stock_reconciliation(%s,'review','{}',NULL,100)",(dealer,)).fetchone()[0]['data'];assert len(rows)==100 and all(r['safe_action']=='rebuild_counter' for r in rows)
   payload={'receipts':[{'id':r['id'],'expected_version':r['version']} for r in rows],'reason':'Rollback-only staging performance acceptance','idempotency_key':str(uuid.uuid4())}
   measure('synthetic_counter_rebuild_100_in_existing_ledger',"SELECT canto_api.v1_stock_reconciliation(%s,'rebuild',%s)",(dealer,Jsonb(payload)),500)
   c.execute('SET LOCAL ROLE postgres');assert public_structure(c)==structure;raise psycopg.Rollback()
  assert public_structure(c)==structure
 report={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'largest_dealer_receipts':receipt_count,'results':results,'public_structure_unchanged':True,'all_changes_and_sequences_rolled_back':True,'scope':'Ten warm measured DB executions after two warmups. Existing largest dealer ledger reads; 100 exact synthetic receipt counter repairs within that ledger. Current staff scope with temporary rolled-back Auth session. No HTTP latency or concurrent-load SLA claim.'}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-stock-reconciliation-performance.json').write_text(json.dumps(report,indent=2)+'\n')
 assert all(r['p95_ms']<r['target_ms'] for r in results),results
if __name__=='__main__':run()
