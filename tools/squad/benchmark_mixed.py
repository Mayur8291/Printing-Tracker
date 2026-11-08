"""Concurrent local actual-RPC load; synthetic data only, exact fixture cleanup.

SQUAD_TEST_DATABASE=squad_test_stock PYTHONPATH=tools/squad \
  tools/canto-sync/.venv/bin/python tools/squad/benchmark_mixed.py

No HTTP, provider, hosted database, or worker invocation. Measured mutations roll
back one transaction at a time. Separate hot-record trials commit and verify
their own rows. Existing synthetic row keys and fingerprints must be restored.
"""
import argparse,concurrent.futures,datetime,decimal,hashlib,json,math,os,statistics,threading,time,uuid
from collections import Counter,defaultdict
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
from fixtures import session,rpc
from local_db import connect,DATABASE,ROOT
from test_catalogue import seed_catalogue
from test_pricing import CONFIG,custom

D=decimal.Decimal
BASE=1000000
METHOD="One MATERIALIZED start-clock CTE, one actual public RPC evaluation, then server end-clock; client timer surrounds execute/fetch. Server elapsed includes waits/execution, excludes parse/plan and network. Not HTTP latency."

def check(value,message):
 if not value:raise AssertionError(message)

def actor(c,n):c.execute('RESET ROLE');session(c,n)

def version(c,kind,id):
 c.execute('RESET ROLE');return c.execute('SELECT sa_domain.version(%s,%s)',(kind,id)).fetchone()[0]

def query(name,args):
 check(name.startswith('v1_') and name.replace('_','').isalnum(),'Invalid RPC name')
 return sql.SQL('canto_api.{}({})').format(sql.Identifier(name),sql.SQL(',').join(sql.Placeholder() for _ in args))

def timed(c,name,args=()):
 statement=sql.SQL("WITH started AS MATERIALIZED(SELECT clock_timestamp() AS at), result AS MATERIALIZED(SELECT {} AS value FROM started) SELECT result.value,extract(epoch FROM(clock_timestamp()-started.at))*1000 FROM started CROSS JOIN result").format(query(name,args))
 start=time.perf_counter();r,server=c.execute(statement,args).fetchone();elapsed=(time.perf_counter()-start)*1000
 return r,{'rpc':name,'server_elapsed_ms':float(server),'client_elapsed_ms':elapsed}

def summary(rows):
 def metric(key):
  values=sorted(r[key] for r in rows)
  return {'p50_ms':round(statistics.median(values),3),'p95_ms':round(values[math.ceil(.95*len(values))-1],3),'max_ms':round(values[-1],3)}
 return {'samples':len(rows),'server':metric('server_elapsed_ms'),'client':metric('client_elapsed_ms')}

class Baseline:
 """Only used against the exclusive synthetic database. No unrestricted DELETE."""
 def __init__(self,c):
  self.tables={};self.order=[]
  for schema,table,columns in c.execute("""SELECT n.nspname,t.relname,array_agg(a.attname ORDER BY x.ordinality)
   FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_index i ON i.indrelid=t.oid AND i.indisprimary
   JOIN unnest(i.indkey) WITH ORDINALITY x(attnum,ordinality) ON true JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=x.attnum
   WHERE n.nspname IN('sa_domain','sa_snapshot_20261019') AND t.relkind='r' GROUP BY n.nspname,t.relname"""):
   ident=sql.Identifier(schema,table);keys=sql.SQL('jsonb_build_array({})').format(sql.SQL(',').join(sql.Identifier(x) for x in columns))
   entries=c.execute(sql.SQL('SELECT {},to_jsonb(t) FROM {} t ORDER BY {}').format(keys,ident,keys)).fetchall()
   self.tables[(schema,table)]={'keys':[Jsonb(x[0]) for x in entries],'fingerprint':self.fingerprint([x[1] for x in entries]),'ident':ident,'expr':keys,'count':len(entries)}
  # Delete child rows before referenced parents. Self-reference rows are removed
  # together by their exact new-key set; no schema or constraint is disabled.
  edges={t:set() for t in self.tables}
  for a,b,c_,d in c.execute("SELECT sn.nspname,s.relname,tn.nspname,t.relname FROM pg_constraint f JOIN pg_class s ON s.oid=f.conrelid JOIN pg_namespace sn ON sn.oid=s.relnamespace JOIN pg_class t ON t.oid=f.confrelid JOIN pg_namespace tn ON tn.oid=t.relnamespace WHERE f.contype='f'"):
   if (a,b) in edges and(c_,d) in edges and(a,b)!=(c_,d):edges[(c_,d)].add((a,b))
  while edges:
   ready=sorted(k for k,v in edges.items() if not v)
   check(ready,'Cannot safely order synthetic cleanup dependencies')
   self.order.extend(ready)
   for k in ready:del edges[k]
   for deps in edges.values():deps.difference_update(ready)
  self.env=c.execute('SELECT edit_revision,synced_revision,updated_at FROM sa_sync.environment_state').fetchone()
  self.allow=c.execute('SELECT allow_test_writes FROM sa_domain.runtime_state').fetchone()[0]
  self.direct=c.execute('SELECT is_direct_deal FROM sa_snapshot_20261019.sa_users WHERE id=103').fetchone()[0]
  self.state=c.execute('SELECT state FROM sa_snapshot_20261019.sa_addresses WHERE id=100').fetchone()[0]
 @staticmethod
 def fingerprint(rows):return hashlib.sha256(json.dumps(rows,sort_keys=True,separators=(',',':'),default=str).encode()).hexdigest()
 def cleanup(self,c):
  with c.transaction():
   c.execute('RESET ROLE')
   for t in self.order:
    x=self.tables[t];c.execute(sql.SQL('DELETE FROM {} WHERE NOT({}=ANY(%s::jsonb[]))').format(x['ident'],x['expr']),(x['keys'],))
   c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=%s WHERE id=103',(self.direct,))
   c.execute('UPDATE sa_snapshot_20261019.sa_addresses SET state=%s WHERE id=100',(self.state,))
   c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=%s',(self.allow,))
   c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s,updated_at=%s',self.env)
   for t,x in self.tables.items():
    rows=c.execute(sql.SQL('SELECT to_jsonb(t) FROM {} t ORDER BY {}').format(x['ident'],x['expr'])).fetchall()
    check(self.fingerprint([r[0] for r in rows])==x['fingerprint'],'Cleanup baseline changed: '+'.'.join(t))
  return {'tables_verified':len(self.tables),'all_baseline_row_fingerprints_restored':True,'environment_revisions_restored':True,'sequence_gaps_retained':True}

def quote(c):return rpc(c,'v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[custom(6)]}),))

def create_work(c,preset,stage):
 actor(c,103);q=quote(c);r=rpc(c,'v1_order_place',(uuid.UUID(q['quote_id']),q['version'],Jsonb({'due_at':'2026-12-10T07:00:00Z','line_settings':{'1':{'product_id':preset}}}),uuid.uuid4()));o=r['orders'][0];oid=int(o['id']);iid=int(o['items'][0]['item_id'])
 actor(c,102);rpc(c,'v1_order_assign_factory',(oid,104,'Mixed workload fixture',rpc(c,'v1_order_get',(oid,))['version'],uuid.uuid4()))
 v=version(c,'item',iid);actor(c,104);rpc(c,'v1_item_assign_cutter',(iid,109,'Mixed workload fixture',v,uuid.uuid4()))
 c.execute('RESET ROLE');qid=c.execute('SELECT id FROM sa_snapshot_20261019.sa_quantities WHERE item_id=%s',(iid,)).fetchone()[0];assignment=None
 if stage>=1:
  v=version(c,'item',iid);actor(c,109);rpc(c,'v1_cutting_record',(iid,Jsonb([{'quantity_id':str(qid),'quantity':6}]),None,v,uuid.uuid4()))
 if stage>=2:
  v=version(c,'item',iid);actor(c,104);rpc(c,'v1_jobsheet_assign',(iid,Jsonb([{'quantity_id':str(qid),'tailor_id':'105','quantity':6}]),'2026-12-10T00:00:00Z','2026-12-09T00:00:00Z',v,uuid.uuid4()))
  c.execute('RESET ROLE');assignment=c.execute('SELECT tq.id FROM sa_snapshot_20261019.sa_item_tailor_quantities tq JOIN sa_snapshot_20261019.sa_item_tailors t ON t.id=tq.item_tailor_id WHERE t.item_id=%s',(iid,)).fetchone()[0]
 if stage>=3:
  v=version(c,'item',iid);actor(c,108);rpc(c,'v1_jobsheet_inspect',(iid,Jsonb([{'item_tailor_quantity_id':str(assignment),'quantity':6}]),None,v,uuid.uuid4()))
 result={'order':oid,'item':iid,'quantity':qid,'assignment':assignment,'item_version':version(c,'item',iid),'order_version':version(c,'order',oid),'total':q['total'],'stage':stage}
 return result

def seed_shape(c,rows,preset):
 with c.transaction():
  c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true WHERE id=103');c.execute("UPDATE sa_snapshot_20261019.sa_addresses SET state='Karnataka' WHERE id=100")
  c.execute("""INSERT INTO sa_snapshot_20261019.sa_orders(id,customer_id,address_id,customer_sc_id,assigned_to_id,order_item_type,status,uc_status,created_at,updated_at,created_on,due_on,total_quantity,total_amount,sub_total_amount)
   SELECT %s+n,CASE WHEN n%%100<10 THEN 103 ELSE 203 END,CASE WHEN n%%100<10 THEN 100 ELSE 200 END,CASE WHEN n%%100<10 THEN 101 ELSE 201 END,CASE WHEN n%%100<10 THEN 104 ELSE 204 END,
   CASE WHEN n%%10<7 THEN 1 WHEN n%%10<9 THEN 0 ELSE 2 END,CASE WHEN n%%3=0 THEN 1 ELSE 0 END,CASE WHEN n%%37=0 THEN 'CANCELLED' ELSE '' END,
   now()-(n%%730)*interval '1 day',now(),now()-(n%%730)*interval '1 day',now()+(n%%60-30)*interval '1 day',CASE WHEN n%%10=9 THEN 12 ELSE 6 END,CASE WHEN n%%10=9 THEN 2400 ELSE 1200 END,CASE WHEN n%%10=9 THEN 2400 ELSE 1200 END
   FROM generate_series(1,%s)n""",(BASE,rows))
  # Refresh parent statistics before inserting children. Foreign-key prepared
  # plans from the twelve-row seed otherwise retain a sequential parent scan.
  c.execute('ANALYZE sa_snapshot_20261019.sa_orders')
  c.execute("""INSERT INTO sa_snapshot_20261019.sa_items(id,order_id,item_type,product_id,rmp_class_id,cutting_master_id,total_quantity,total_amount,per_piece_amount,created_at,updated_at)
   SELECT %s+n,%s+n,CASE WHEN n%%10 IN(7,8) THEN 1 ELSE 0 END,CASE WHEN n%%10 IN(7,8) THEN NULL ELSE %s END,CASE WHEN n%%10 IN(7,8) THEN 1 ELSE NULL END,CASE WHEN n%%100<10 THEN 109 ELSE 209 END,6,1200,200,now(),now() FROM generate_series(1,%s)n
   UNION ALL SELECT %s+%s+n,%s+n,1,NULL,1,NULL,6,1200,200,now(),now() FROM generate_series(1,%s)n WHERE n%%10=9""",(BASE,BASE,int(preset),rows,BASE,rows,BASE,rows))
  c.execute('ANALYZE sa_snapshot_20261019.sa_items')
  c.execute('INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,created_at,updated_at) SELECT id,1,6,now(),now() FROM sa_snapshot_20261019.sa_items WHERE id>%s AND id<=%s',(BASE,BASE+rows*2))
  for t in ['sa_orders','sa_items','sa_quantities']:
   c.execute(sql.SQL('ANALYZE sa_snapshot_20261019.{}').format(sql.Identifier(t)))
  for t in ['orders','items','quantities']:
   c.execute(sql.SQL("SELECT setval(%s,greatest((SELECT max(id) FROM sa_snapshot_20261019.{}),%s))").format(sql.Identifier('sa_'+t)),('sa_snapshot_20261019.sa_'+t+'_id_seq',BASE+rows*3))

def measured_case(c,op,index,fixtures,preset):
 f=fixtures[op-6 if 6<=op<=9 else 0];key=uuid.uuid4();a=(101,102,103,104)[index%4]
 if op==0:actor(c,a);name,args='v1_orders_list',(Jsonb({}),None,30)
 elif op==1:actor(c,a);name,args='v1_order_get',(f['order'],)
 elif op==2:actor(c,a);name,args='v1_dashboard',(Jsonb({}),)
 elif op==3:actor(c,103);name,args='v1_quote',(Jsonb({'customer_id':'103','address_id':'100','lines':[custom(6)]}),)
 elif op==4:
  actor(c,103);q=quote(c);name,args='v1_order_place',(uuid.UUID(q['quote_id']),q['version'],Jsonb({'due_at':'2026-12-10T07:00:00Z','line_settings':{'1':{'product_id':preset}}}),key)
 elif op==5:actor(c,101);name,args='v1_order_payment_record',(f['order'],'partial',D('100'),'Mixed workload deposit',f['order_version'],key)
 elif op==6:actor(c,109);name,args='v1_cutting_record',(f['item'],Jsonb([{'quantity_id':str(f['quantity']),'quantity':3}]),None,f['item_version'],key)
 elif op==7:actor(c,104);name,args='v1_jobsheet_assign',(f['item'],Jsonb([{'quantity_id':str(f['quantity']),'tailor_id':'105','quantity':3}]),'2026-12-10T00:00:00Z','2026-12-09T00:00:00Z',f['item_version'],key)
 elif op==8:actor(c,108);name,args='v1_jobsheet_inspect',(f['item'],Jsonb([{'item_tailor_quantity_id':str(f['assignment']),'quantity':3}]),None,f['item_version'],key)
 else:actor(c,107);name,args='v1_dispatch_record',(f['item'],Jsonb([{'quantity_id':str(f['quantity']),'quantity':3}]),None,f['item_version'],key)
 result,sample=timed(c,name,args);sample.update(kind='read' if op<=2 else 'command',worker=index)
 # Verification calls are untimed and named separately in the evidence. They
 # remain part of realistic connection occupancy, and are never counted as 400.
 if op==0:
  check(len(result['data'])<=30,'Unbounded order page')
  if a in(101,103):check(all(x['customer_id']=='103' for x in result['data']),'Foreign customer leaked')
 elif op==1:check(result['id']==str(f['order']),'Wrong order detail')
 elif op==2:check(result is not None,'Missing summary')
 elif op==3:check(D(result['total'])>0 and result['quantity']==6,'Quote quantity/money mismatch')
 elif op==4:
  check(D(result['total_amount'])==D(q['total']) and len(result['orders'])==1,'Placement money mismatch');check(rpc(c,name,args)==result,'Placement replay differs')
 elif op==5:
  order=rpc(c,'v1_order_get',(f['order'],));check(D(order['total_amount'])==D(f['total']) and D(order['paid_amount'])==100,'Payment changed selling total');check(rpc(c,name,args)==result,'Payment replay differs')
 else:
  check(rpc(c,name,args)==result,'Work replay differs');c.execute('RESET ROLE')
  balances=c.execute('SELECT quantity,cutting_done,assigned_to_tailor_quantity,completed_by_tailor_quantity,dispatched_quantity FROM sa_snapshot_20261019.sa_quantities WHERE id=%s',(f['quantity'],)).fetchone()
  check(all(0<=x<=6 for x in balances),'Quantity outside capacity');check(all(balances[i]>=balances[i+1] for i in range(4)),'Work stages violate conservation')
  check(c.execute('SELECT total_amount FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(f['order'],)).fetchone()[0]==D(f['total']),'Work changed money')
 if op>=4:
  c.execute('RESET ROLE')
  for table in ['commands','audit','outbox']:
   col='key' if table=='commands' else 'command_key'
   check(c.execute(sql.SQL('SELECT count(*) FROM sa_domain.{} WHERE {}=%s').format(sql.Identifier(table),sql.Identifier(col)),(key,)).fetchone()[0]==1,'Duplicate '+table)
 return sample

def load_worker(index,cycles,barrier,fixtures,preset):
 samples=[];errors=Counter();backend=None;attempts=[]
 with connect() as c:
  backend=c.execute('SELECT pg_backend_pid()').fetchone()[0];c.execute("SET statement_timeout='15s'; SET lock_timeout='10s'")
  for n in range(10):
   with c.transaction():measured_case(c,(n+index*3)%10,index,fixtures,preset);raise psycopg.Rollback()
  barrier.wait(timeout=30)
  measured_started=time.perf_counter()
  for n in range(cycles*10):
   op=(n+index*3)%10
   for attempt in range(3):
    attempt_started=time.perf_counter()
    try:
     with c.transaction():
      sample=measured_case(c,op,index,fixtures,preset);sample['attempt']=attempt+1;raise psycopg.Rollback()
     samples.append(sample);break
    except (psycopg.errors.DeadlockDetected,psycopg.errors.SerializationFailure) as exc:
     errors[exc.sqlstate]+=1
     attempts.append({'operation_index':op,'attempt':attempt+1,'sqlstate':exc.sqlstate,'transaction_elapsed_ms':round((time.perf_counter()-attempt_started)*1000,3)})
     if attempt==2:raise
     time.sleep(.005*(attempt+1))
 return {'worker':index,'backend_pid':backend,'samples':samples,'retryable_errors':dict(errors),'failed_attempts':attempts,'measured_wall_seconds_including_verification':time.perf_counter()-measured_started}

def concurrent_call(actor_id,name,args_list):
 barrier=threading.Barrier(len(args_list))
 def invoke(args):
  started=None
  try:
   with connect() as c,c.transaction():
    session(c,actor_id);c.execute("SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='10s'");barrier.wait(timeout=15);started=time.perf_counter();r,s=timed(c,name,args);return {'result':r,'timing':s,'sqlstate':None}
  except psycopg.Error as exc:return {'sqlstate':exc.sqlstate,'failed_client_elapsed_ms':round((time.perf_counter()-started)*1000,3) if started else None}
 with concurrent.futures.ThreadPoolExecutor(max_workers=len(args_list)) as pool:return list(pool.map(invoke,args_list))

def contention(c,preset):
 cases=[]
 for stage,n,method in [(0,109,'v1_cutting_record'),(3,107,'v1_dispatch_record')]:
  with c.transaction():f=create_work(c,preset,stage)
  def args(v,key,quantity=2):return(f['item'],Jsonb([{'quantity_id':str(f['quantity']),'quantity':quantity}]),None,v,key)
  key=uuid.uuid4();same=concurrent_call(n,method,[args(f['item_version'],key)]*4)
  check(all(x['sqlstate'] is None for x in same),'Same-key contention failed');check(all(x['result']==same[0]['result'] for x in same),'Same-key responses differ')
  c.execute('RESET ROLE');v=version(c,'item',f['item']);keys=[uuid.uuid4() for _ in range(4)];compete=concurrent_call(n,method,[args(v,k) for k in keys]);codes=Counter(x['sqlstate'] or 'success' for x in compete)
  check(codes=={'success':1,'40001':3},'Unexpected concurrent optimistic result: '+str(codes))
  retry_key=next(keys[i] for i,x in enumerate(compete) if x['sqlstate']=='40001')
  with c.transaction():
   v=version(c,'item',f['item']);actor(c,n);retried=rpc(c,method,args(v,retry_key));check(retried['progress']['cut' if stage==0 else 'dispatched']==6,'Reload/retry lost quantity')
  v=version(c,'item',f['item'])
  try:
   with c.transaction():actor(c,n);rpc(c,method,args(v,uuid.uuid4(),1))
  except psycopg.Error as exc:over=exc.sqlstate
  else:raise AssertionError('Over-capacity request accepted')
  c.execute('RESET ROLE');balance=c.execute('SELECT quantity,cutting_done,assigned_to_tailor_quantity,completed_by_tailor_quantity,dispatched_quantity FROM sa_snapshot_20261019.sa_quantities WHERE id=%s',(f['quantity'],)).fetchone()
  check(balance[1 if stage==0 else 4]==6,'Hot balance changed')
  for table in ['commands','audit','outbox']:
   col='key' if table=='commands' else 'command_key';check(c.execute(sql.SQL('SELECT count(*) FROM sa_domain.{} WHERE {}=%s').format(sql.Identifier(table),sql.Identifier(col)),(key,)).fetchone()[0]==1,'Duplicate hot '+table)
  cases.append({'rpc':method,'same_key_successes':4,'same_key_effects':1,'competing_results':dict(codes),'expected_conflict_client_elapsed_ms':[x['failed_client_elapsed_ms'] for x in compete if x['sqlstate']],'reload_retry_successes':1,'over_capacity_sqlstate':over,'balances':list(balance),'same_key_timing':summary([x['timing'] for x in same]),'successful_competing_timing':summary([x['timing'] for x in compete if not x['sqlstate']])})
 with c.transaction():actor(c,103);q=quote(c)
 key=uuid.uuid4();args=(uuid.UUID(q['quote_id']),q['version'],Jsonb({'due_at':'2026-12-10T07:00:00Z','line_settings':{'1':{'product_id':preset}}}),key)
 placement=concurrent_call(103,'v1_order_place',[args]*4);check(all(x['sqlstate'] is None for x in placement),'Duplicate placement failed');check(all(x['result']==placement[0]['result'] for x in placement),'Duplicate order responses differ');check(D(placement[0]['result']['total_amount'])==D(q['total']),'Hot order money mismatch')
 c.execute('RESET ROLE');check(c.execute('SELECT count(*) FROM sa_domain.audit WHERE command_key=%s',(key,)).fetchone()[0]==1,'Multiple placement effects')
 cases.append({'rpc':'v1_order_place','same_key_successes':4,'same_key_order_sets':1,'accepted_total':q['total'],'timing':summary([x['timing'] for x in placement])})
 # Four different customer orders compete for ten pieces of one dealer stock
 # variant. This tests shared stock contention independently of item versioning.
 stock=[]
 with c.transaction():
  c.execute('RESET ROLE')
  for i in range(5):
   oid=c.execute('INSERT INTO sa_snapshot_20261019.sa_orders(customer_id,address_id,customer_dealer_id,customer_sc_id,order_item_type,created_at,updated_at) VALUES(%s,100,%s,101,0,now(),now()) RETURNING id',(110 if i==0 else 103,None if i==0 else 110)).fetchone()[0]
   iid=c.execute("INSERT INTO sa_snapshot_20261019.sa_items(order_id,item_type,rmp_class_id,rmp_brand_id,rmp_category_id,uc_order_status,total_quantity,created_at,updated_at) VALUES(%s,1,1,1,1,'COMPLETE',%s,now(),now()) RETURNING id",(oid,10 if i==0 else 7)).fetchone()[0]
   qid=c.execute('INSERT INTO sa_snapshot_20261019.sa_quantities(item_id,size_id,quantity,created_at,updated_at) VALUES(%s,1,%s,now(),now()) RETURNING id',(iid,10 if i==0 else 7)).fetchone()[0];stock.append({'order':oid,'item':iid,'quantity':qid,'version':version(c,'item',iid)})
  actor(c,110);c.execute('SET LOCAL ROLE sa_executor');c.execute('SELECT sa_domain.receive_dealer_stock(%s)',(stock[0]['item'],))
 stock_args=[(f['item'],Jsonb([{'quantity_id':str(f['quantity']),'quantity':7}]),None,f['version'],uuid.uuid4()) for f in stock[1:]]
 outcomes=concurrent_call(110,'v1_dispatch_record',stock_args);codes=Counter(x['sqlstate'] or 'success' for x in outcomes);check(codes=={'success':1,'55000':3},'Shared stock overconsumed or failed: '+str(codes))
 c.execute('RESET ROLE');received,used=c.execute('SELECT quantity,dispatched_quantity FROM sa_snapshot_20261019.sa_stocks WHERE item_id=%s',(stock[0]['item'],)).fetchone()
 total=c.execute('SELECT sum(dispatched_quantity) FROM sa_snapshot_20261019.sa_quantities WHERE item_id=ANY(%s)',([f['item'] for f in stock[1:]],)).fetchone()[0]
 ledger=c.execute('SELECT sum(u.qty) FROM sa_snapshot_20261019.sa_stock_useds u JOIN sa_snapshot_20261019.sa_stocks s ON s.id=u.stock_id WHERE s.item_id=%s',(stock[0]['item'],)).fetchone()[0]
 check((received,used,total,ledger)==(10,7,7,7),'Shared stock ledger mismatch')
 cases.append({'rpc':'v1_dispatch_record','scenario':'four independent orders compete for one dealer stock variant','results':dict(codes),'received':received,'consumed':used,'available':received-used,'sum_customer_dispatches':total,'sum_stock_ledger':ledger,'expected_insufficient_client_elapsed_ms':[x['failed_client_elapsed_ms'] for x in outcomes if x['sqlstate']],'successful_timing':summary([x['timing'] for x in outcomes if not x['sqlstate']])})
 return cases

def run(rows=100000,cycles=10,output=None):
 check(DATABASE=='squad_test_stock','This runner is restricted to the assigned exclusive synthetic squad_test_stock database')
 check(1000<=rows<=200000 and 1<=cycles<=100,'Fixture budget exceeded')
 through=os.environ.get('SQUAD_TEST_MIGRATION_THROUGH')
 report={'environment':'local_synthetic','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'database':DATABASE,'connections':4,'method':METHOD,'source_data':'Synthetic catalog/identities; 100% invented rows, no customer dumps','providers_called':0,'http_requests':0,'warmup_calls':40,'measured_calls_expected':4*cycles*10,'synthetic_orders':rows,'synthetic_items':rows+sum(n%10==9 for n in range(1,rows+1)),'shape':'70% custom,20% ready-made,10% mixed; two items on mixed orders; 10% customer103/SC101/factory104 scope across all order types; two-year creation span; 1/3 completed; 1/37 canceled. This deterministic synthetic mix is not an assertion about the real production distribution.','verification':'Untimed replay/scope/money/quantity assertions follow calls inside the same transaction. Command/quote sample transactions roll back. Hot-record tests commit own rows.','declared_rebuild_migration_through':through,'source_migration_file_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT/'supabase/migrations').glob('*_squad_*.sql')) if through is not None and p.name.split('_',1)[0]<=through}}
 with connect() as c:
  definitions=c.execute("SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('sa_domain','canto_api') AND p.prokind='f' ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)").fetchall()
  report['actual_database_function_sha256']=hashlib.sha256('\n'.join(x[0] for x in definitions).encode()).hexdigest()
  seed_catalogue(c);baseline=Baseline(c)
  try:
   with c.transaction():
    c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');actor(c,103);preset=rpc(c,'v1_product_configure',(Jsonb(CONFIG),'Mixed benchmark','',uuid.uuid4()))['id']
   c.execute('RESET ROLE');seed_shape(c,rows,preset);fixtures=[]
   for _ in range(4):
    with c.transaction():fixtures.append([create_work(c,preset,stage) for stage in range(4)])
   barrier=threading.Barrier(4);started=time.perf_counter()
   with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    futures=[pool.submit(load_worker,i,cycles,barrier,fixtures[i],preset) for i in range(4)]
    workers=[f.result() for f in futures]
   duration=time.perf_counter()-started;samples=[s for w in workers for s in w['samples']];check(len(samples)==4*cycles*10,'Measured samples missing');check(len({w['backend_pid'] for w in workers})==4,'Not four independent connections')
   groups=defaultdict(list)
   for s in samples:groups[s['rpc']].append(s)
   report.update(samples=len(samples),wall_seconds_including_warmup_and_verification=round(duration,3),measured_wall_seconds_including_verification=round(max(w['measured_wall_seconds_including_verification'] for w in workers),3),rpc_results={name:dict(summary(group),target_ms=200 if group[0]['kind']=='read' else 500) for name,group in sorted(groups.items())},worker_retryable_errors={str(w['worker']):w['retryable_errors'] for w in workers},failed_attempts=[a for w in workers for a in w['failed_attempts']],deadlocks=sum(w['retryable_errors'].get('40P01',0) for w in workers),samples_raw=samples)
   report['contention']=contention(c,preset)
   report['budgets_pass']=all(x['server']['p95_ms']<x['target_ms'] for x in report['rpc_results'].values())
  finally:report['cleanup']=baseline.cleanup(c)
 destination=Path(output) if output else ROOT/'docs/squad-one-audit/implementation-evidence/local-mixed-workload.json';destination.write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({k:v for k,v in report.items() if k not in('samples_raw','migration_file_sha256')},indent=2));check(report['budgets_pass'],'Mixed workload exceeded documented DB budgets');return report

if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--rows',type=int,default=100000);parser.add_argument('--cycles',type=int,default=10);parser.add_argument('--output');args=parser.parse_args();run(args.rows,args.cycles,args.output)
