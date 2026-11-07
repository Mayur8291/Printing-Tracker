"""Staging SC purchase → factory receipt → dealer customer dispatch; outer rollback."""
import datetime,json,uuid
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb

def choose_actor(c):
 row=c.execute("""SELECT sc.id,sm.auth_user_id,d.id,da.id,u.id,ua.id,dm.auth_user_id
 FROM sa_snapshot_20261019.sa_users d
 JOIN sa_identity.sa_auth_identities dm ON dm.legacy_user_id=d.id AND dm.enrollment_state='ready'
 JOIN sa_snapshot_20261019.sa_users sc ON sc.id=d.created_by_id AND sc.role=1 AND sc.disabled IS NOT TRUE AND sc.deleted_at IS NULL
 JOIN sa_identity.sa_auth_identities sm ON sm.legacy_user_id=sc.id AND sm.enrollment_state='ready'
 JOIN sa_snapshot_20261019.sa_addresses da ON da.user_id=d.id AND da.deleted_at IS NULL AND length(btrim(da.state))>0
 JOIN sa_snapshot_20261019.sa_user_dealers link ON link.dealer_id=d.id
 JOIN sa_snapshot_20261019.sa_users u ON u.id=link.user_id AND u.role=3 AND u.created_by_id=sc.id AND u.disabled IS NOT TRUE AND u.deleted_at IS NULL AND u.approved IS NOT FALSE AND u.is_direct_deal IS NOT TRUE
 JOIN sa_snapshot_20261019.sa_addresses ua ON ua.user_id=u.id AND ua.deleted_at IS NULL AND length(btrim(ua.state))>0
 WHERE d.role=10 AND d.disabled IS NOT TRUE AND d.deleted_at IS NULL AND d.approved IS NOT FALSE
 AND NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_user_dealers dl WHERE dl.user_id=d.id)
 AND NOT EXISTS(SELECT FROM sa_snapshot_20261019.sa_user_dealers earlier JOIN sa_snapshot_20261019.sa_users ed ON ed.id=earlier.dealer_id AND ed.disabled IS NOT TRUE AND ed.deleted_at IS NULL WHERE earlier.user_id=u.id AND earlier.id<link.id)
 ORDER BY d.id,u.id,da.id,ua.id LIMIT 1""").fetchone()
 assert row,'Ready dealer, coordinator, linked customer and owned addresses required'
 return row[:4],row[4:]

def exercise(c,sc,sc_session,customer,config,preset,size,checks):
 results=[]
 def switch(auth,sid):
  c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(auth),'session_id':str(sid)}),));c.execute('SET LOCAL ROLE sa_app')
 def call(name,args=(),target=200):
  query='SELECT canto_api.'+name+'('+','.join(['%s']*len(args))+')';samples=[]
  for _ in range(11):
   with c.transaction():
    plan=c.execute('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query,args).fetchone()[0][0];samples.append(plan['Execution Time']);raise psycopg.Rollback()
  result={'rpc':name,'database_p95_ms':max(samples[1:]),'samples_ms':samples[1:],'target_ms':target};results.append(result);print(json.dumps(result),flush=True)
  return c.execute(query,args).fetchone()[0]
 switch(sc[1],sc_session)
 q=c.execute('SELECT canto_api.v1_quote(%s)',(Jsonb({'customer_id':str(customer[0]),'address_id':str(customer[1]),'lines':[{'kind':'custom','configuration':config,'quantities':[{'size_id':str(size),'quantity':6}]}]}),)).fetchone()[0]
 placed=c.execute('SELECT canto_api.v1_order_place(%s,%s,%s,%s)',(q['quote_id'],q['version'],Jsonb({'due_at':'2026-12-01T12:30:00+05:30','line_settings':{'1':{'product_id':preset['id']}}}),uuid.uuid4())).fetchone()[0]
 order=placed['orders'][0];item=int(order['items'][0]['item_id'])
 q2=c.execute('SELECT canto_api.v1_quote(%s)',(Jsonb({'customer_id':str(customer[0]),'address_id':str(customer[1]),'lines':[{'kind':'custom','preset_id':preset['id'],'quantities':[{'size_id':str(size),'quantity':6}]}]}),)).fetchone()[0]
 second=c.execute('SELECT canto_api.v1_order_place(%s,%s,%s,%s)',(q2['quote_id'],q2['version'],Jsonb({'due_at':'2026-12-01T00:00:00Z','line_settings':{'1':{'product_id':preset['id']}}}),uuid.uuid4())).fetchone()[0]['orders'][0]
 c.execute('SET LOCAL ROLE postgres')
 assert c.execute('SELECT customer_dealer_id FROM sa_snapshot_20261019.sa_orders WHERE id=%s',(int(order['id']),)).fetchone()[0]==sc[2]
 qid=c.execute('SELECT id FROM sa_snapshot_20261019.sa_quantities WHERE item_id=%s',(item,)).fetchone()[0]
 sid=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid,customer[2]));switch(customer[2],sid)
 stock=call('v1_dealer_stock',(None,None,Jsonb({'product_id':preset['id']})))['data'];assert len(stock)==1 and stock[0]['available']==6
 checks.append('Factory completion receives the dealer purchase exactly once')
 reorder=call('v1_quote',(Jsonb({'customer_id':str(sc[2]),'address_id':str(sc[3]),'lines':[{'kind':'custom','preset_id':preset['id'],'quantities':[{'size_id':str(size),'quantity':6}]}]}),),target=200)
 assert 'costs' not in reorder['lines'][0]
 reordered=call('v1_order_place',(reorder['quote_id'],reorder['version'],Jsonb({'due_at':'2026-12-01T00:00:00Z','line_settings':{'1':{'product_id':preset['id']}}}),uuid.uuid4()),target=500)
 assert len(reordered['orders'])==1;checks.append('Dealer reorders the exact historical SC-private-colour preset at current prices')
 preview=call('v1_backorder_preview',([int(order['id']),int(second['id'])],sc[3]),target=500)
 assert preview['requirements'][0]['required']==12 and preview['requirements'][0]['shortage']==6
 back_args=(preview['preview_id'],'2026-12-01T00:00:00Z',preview['version'],uuid.uuid4())
 back=call('v1_backorder_place',back_args,target=500)
 assert len(back['linked_order_versions'])==2
 assert back==c.execute('SELECT canto_api.v1_backorder_place(%s,%s,%s,%s)',back_args).fetchone()[0]
 checks.append('Back order aggregates 12 required minus 6 physical stock and atomically links both originals')
 queue=call('v1_dispatch_queue',(False,int(order['id'])))['data'];assert len(queue)==1 and queue[0]['stock_status']=='ready' and queue[0]['available_to_dispatch']==6
 detail=call('v1_dispatch_detail',(item,));v=detail['version']
 for amount in (2,4):
  args=(item,Jsonb([{'quantity_id':str(qid),'quantity':amount}]),None,v,uuid.uuid4());r=call('v1_dispatch_record',args,target=500)
  assert sum(x['quantity'] for x in r['stock_allocations'])==amount
  assert r==c.execute('SELECT canto_api.v1_dispatch_record(%s,%s,%s,%s,%s)',args).fetchone()[0];v=r['version']
 assert r['progress']['order_completed'];checks.append('Dealer partial and final dispatch consume actual stock; retries never duplicate')
 stock=call('v1_dealer_stock',(None,None,Jsonb({'product_id':preset['id']})))['data'];assert stock[0]['available']==0 and stock[0]['consumed']==6
 detail=call('v1_dispatch_detail',(item,));assert len(detail['history']['data'])==2 and detail['remaining_quantity']==0
 checks.append('Completed customer fulfillment retains both dispatch histories and zero remaining stock')
 evidence={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'warm rollback-only database journey using real linked personas; not maximum-size or concurrent capacity','queries':results}
 (Path(__file__).resolve().parents[2]/'docs/squad-one-audit/implementation-evidence/staging-dealer-stock-performance.json').write_text(json.dumps(evidence,indent=2)+'\n')
 assert all(x['database_p95_ms']<x['target_ms'] for x in results),[x for x in results if x['database_p95_ms']>=x['target_ms']]
