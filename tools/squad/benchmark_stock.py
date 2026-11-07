"""Staging dealer ledger reads at the largest current inventories; no business writes."""
import datetime,json,sys,uuid
from pathlib import Path
import psycopg
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect

def run():
 results=[]
 with connect('staging') as c,c.transaction():
  actors=c.execute("""SELECT u.id,m.auth_user_id,count(s.id) FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id AND m.enrollment_state='ready'
   JOIN sa_snapshot_20261019.sa_stocks s ON s.user_id=u.id WHERE u.role=10 AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE GROUP BY u.id,m.auth_user_id ORDER BY count(s.id) DESC LIMIT 5""").fetchall()
  for _,auth,receipts in actors:
   sid=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid,auth));c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(auth),'session_id':str(sid)}),));c.execute('SET LOCAL ROLE sa_app')
   samples=[]
   for _ in range(13):samples.append(c.execute('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT canto_api.v1_dealer_stock()').fetchone()[0][0]['Execution Time'])
   r=c.execute('SELECT canto_api.v1_dealer_stock()').fetchone()[0];row={'receipt_rows':receipts,'returned_rows':len(r['data']),'samples_ms':samples[3:],'database_p95_ms':max(samples[3:]),'target_ms':200};results.append(row);print(json.dumps(row),flush=True);c.execute('SET LOCAL ROLE postgres')
  raise psycopg.Rollback()
 p={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'five largest eligible dealer ledgers, warm first-page DB reads; transaction-only sessions; no business writes','results':results}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-largest-dealer-stock-performance.json').write_text(json.dumps(p,indent=2)+'\n')
 assert all(x['database_p95_ms']<x['target_ms'] for x in results)
if __name__=='__main__':run()
