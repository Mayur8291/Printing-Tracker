"""Rolled-back factory journey and representative execution timings."""
import datetime,json,uuid
from pathlib import Path
from psycopg.types.json import Jsonb
import psycopg

def exercise(c,order,checks,actor,version,factory):
 item=int(order['items'][0]['item_id']);c.execute('SET LOCAL ROLE postgres')
 staff=c.execute("""SELECT DISTINCT ON(u.role) u.role,u.id,m.auth_user_id FROM sa_snapshot_20261019.sa_users u
 JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id AND m.enrollment_state='ready'
 WHERE u.role IN(7,8) AND u.factory_manager_id=%s AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE ORDER BY u.role,u.id""",(factory[0],)).fetchall()
 staff={r[0]:(r[1],r[2],uuid.uuid4()) for r in staff}
 tailor=c.execute('SELECT id FROM sa_snapshot_20261019.sa_users WHERE role=5 AND factory_manager_id=%s AND deleted_at IS NULL AND disabled IS NOT TRUE ORDER BY id LIMIT 1',(factory[0],)).fetchone()
 assert set(staff)=={7,8} and tailor,'Factory must have an inspector, dispatch incharge and tailor'
 for _,auth,sid in staff.values():c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid,auth))
 def local_actor(role):
  if role not in staff:return actor(role)
  _,auth,sid=staff[role];c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(auth),'session_id':str(sid)}),));c.execute('SET LOCAL ROLE sa_app')
 q=c.execute('SELECT id,quantity FROM sa_snapshot_20261019.sa_quantities WHERE item_id=%s',(item,)).fetchone();assert q and q[1]==6
 results=[]
 def call(name,args,measure=True,target=500):
  sql='SELECT canto_api.'+name+'('+','.join(['%s']*len(args))+')'
  if measure:
   samples=[]
   for _ in range(11):
    with c.transaction():
     p=c.execute('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,args).fetchone()[0][0];samples.append(p['Execution Time']);raise psycopg.Rollback()
   row={'rpc':name,'database_p95_ms':max(samples[1:]),'samples_ms':samples[1:],'target_ms':target};results.append(row);print(json.dumps(row),flush=True)
  return c.execute(sql,args).fetchone()[0]
 v=version('item',item);local_actor(9);r=call('v1_cutting_record',(item,Jsonb([{'quantity_id':str(q[0]),'quantity':6}]),None,v,uuid.uuid4()))
 assert r['progress']['cut']==6;checks.append('CM records exact size cutting with conserved history')
 detail=call('v1_cutting_detail',(item,),target=200);assert len(detail['history']['data'])==1
 call('v1_cutting_queue',(True,int(order['id'])),target=200)
 v=version('item',item);local_actor(4);r=call('v1_jobsheet_assign',(item,Jsonb([{'quantity_id':str(q[0]),'tailor_id':str(tailor[0]),'quantity':6}]),'2026-12-01T00:00:00Z','2026-11-30T00:00:00Z',v,uuid.uuid4()))
 assert r['progress']['assigned']==6;checks.append('FM assigns cut work to a real same-factory tailor')
 work=call('v1_tailor_work',(item,tailor[0]),target=200);itq=int(work['data'][0]['item_tailor_quantity_id'])
 call('v1_jobsheets_list',(item,tailor[0]),target=200)
 v=version('item',item);local_actor(8);r=call('v1_jobsheet_inspect',(item,Jsonb([{'item_tailor_quantity_id':str(itq),'quantity':6}]),None,v,uuid.uuid4()))
 assert r['progress']['sewn']==6;checks.append('Inspector picks inspected pieces with FIFO assignment reconciliation')
 c.execute('SET LOCAL ROLE postgres');today=c.execute("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date").fetchone()[0];week=today-datetime.timedelta(days=(today.weekday()-5)%7)
 local_actor(4);earnings=call('v1_tailor_earnings',(tailor[0],week,False),target=200)
 own_row=next(x for x in earnings['data'] if x['item_id']==str(item));assert own_row['completed']==6
 assert earnings['basis']['rates']=='current_master' and earnings['basis']['period']=='assignment_date';checks.append('FM weekly earnings include completed assignment under explicit legacy formula')
 ov=version('order',int(order['id']));local_actor(7)
 destination=call('v1_dispatch_destination_save',(int(order['id']),'customer','Rollback customer routing',ov,uuid.uuid4()))
 assert destination['destination']['mode']=='customer' and destination['destination']['address'] is not None
 v=version('item',item);local_actor(7);call('v1_dispatch_queue',(False,int(order['id'])),target=200)
 key=uuid.uuid4();args=(item,Jsonb([{'quantity_id':str(q[0]),'quantity':6}]),None,v,key);r=call('v1_dispatch_record',args)
 assert r['progress']['order_completed'];assert r==call('v1_dispatch_record',args,measure=False)
 detail=call('v1_dispatch_detail',(item,),target=200);assert detail['quantities']['data'][0]['remaining']==0
 deliveries=call('v1_deliveries_list',(Jsonb({'order_id':order['id']}),),target=200)['data'];assert len(deliveries)==1 and deliveries[0]['quantity']==6 and deliveries[0]['destination_basis']=='dispatch_snapshot'
 checks.append('DI destination and immutable delivery snapshot retain exact event quantity')
 checks.append('DI dispatch completes custom order; exact retry keeps one history')
 evidence={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'warm database calls on rollback-only real role journey; not load/capacity claim','queries':results}
 (Path(__file__).resolve().parents[2]/'docs/squad-one-audit/implementation-evidence/staging-factory-execution-performance.json').write_text(json.dumps(evidence,indent=2)+'\n')
 assert all(x['database_p95_ms']<x['target_ms'] for x in results),[x for x in results if x['database_p95_ms']>=x['target_ms']]

