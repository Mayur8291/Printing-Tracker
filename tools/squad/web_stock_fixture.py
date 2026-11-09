"""Declared, default-off counter-mismatch fixture. No hosted execution on import.
Normal business RPCs create a single owned two-piece Dealer receipt. The one
counter perturbation happens in that SAME setup transaction, before exposure.
Existing command/audit/source-graph cleanup remains authoritative and unchanged.
"""
import json,uuid
from psycopg.types.json import Jsonb
from psycopg import sql
from fixtures import rpc
MARKER='squad-web-stock-counter/v1'
def plan(state):
 assert state['stage']=='planned' and 'web_stock_reconciliation' not in state
 state['web_stock_reconciliation']={'format':MARKER,'run_id':state['run_id'],'state':'planned'}
 return state

def prepare(c,state,emit):
 marker=state.get('web_stock_reconciliation');assert marker=={'format':MARKER,'run_id':state['run_id'],'state':'planned'}
 assert state['stage']=='prepared' and c.info.transaction_status.name=='INTRANS'
 xid=int(c.execute('SELECT txid_current()').fetchone()[0]);assert xid in state['setup_xids'],'Must run inside original fixture preparation transaction'
 # RESET ROLE would return to the restricted CLI login, not this existing role.
 owner_role=c.execute('SELECT current_user').fetchone()[0]
 restore_role=sql.SQL('SET LOCAL ROLE {}').format(sql.Identifier(owner_role))
 actors={a['role']:a for a in state['identity']['actors']};sessions={};f=state['fixture'];run=uuid.UUID(state['run_id']);label=state['label']
 for role in [0,2,10,11]:
  session=uuid.uuid5(run,'web.stock.setup.session.'+str(role));sessions[role]=session
  assert not c.execute('SELECT 1 FROM auth.sessions WHERE id=%s',(session,)).fetchone()
  c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)',(session,actors[role]['auth_id']))
 def actor(role):
  c.execute(restore_role);c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'sub':actors[role]['auth_id'],'session_id':str(sessions[role]),'role':'sa_app'}),));c.execute('SET LOCAL ROLE sa_app')
 def read(role,name,args):
  try:
   actor(role);return rpc(c,name,args)
  finally:
   # SQL failure must retain its original exception; the enclosing setup
   # transaction rolls back both the role and rows. Do not introduce nested
   # savepoints: cleanup binds every setup row to the original transaction ID.
   if c.info.transaction_status.name!='INERROR':c.execute(restore_role)
 def command(role,name,args,suffix):
  key=uuid.uuid5(run,'web.stock.setup.'+suffix);emit({'kind':'command','value':{'label':'web.stock.setup.'+suffix,'key':str(key)}})
  return read(role,name,(*args,key))
 def own(kind,id):emit({'kind':'entity','value':{'kind':kind,'id':str(id)}});return id
 dealer=state['base']+10;worker=state['base']+11
 preset=command(10,'v1_product_configure',(Jsonb(f['customConfig']),label+' counter fixture',''),'preset');own('preset',preset['id'])
 quote=read(10,'v1_quote',(Jsonb({'customer_id':str(dealer),'address_id':f['ids']['dealerAddressId'],'lines':[{'kind':'custom','configuration':f['customConfig'],'quantities':[{'size_id':f['ids']['sizeId'],'quantity':2}]}]}),));own('quote',quote['quote_id'])
 placed=command(10,'v1_order_place',(uuid.UUID(quote['quote_id']),quote['version'],Jsonb({'due_at':f['dueAt'],'comment':label+' counter fixture','line_settings':{'1':{'product_id':preset['id']}}})),'order')
 assert len(placed['orders'])==1 and len(placed['orders'][0]['items'])==1
 order=int(own('order',placed['orders'][0]['id']));item=int(own('item',placed['orders'][0]['items'][0]['item_id']))
 command(2,'v1_order_assign_worker',(order,worker,f['dueAt'],label+' counter fixture',read(2,'v1_order_get',(order,))['version']),'worker')
 for stage in range(1,6):command(11,'v1_worker_stage_save',(item,stage,label+' counter fixture',read(11,'v1_order_item_get',(item,))['version']),'stage'+str(stage))
 rows=c.execute('SELECT id,user_id,order_id,item_id,quantity,dispatched_quantity,xmin::text FROM sa_snapshot_20261019.sa_stocks WHERE order_id=%s AND item_id=%s FOR UPDATE',(order,item)).fetchall()
 assert len(rows)==1;receipt,owner,oid,iid,quantity,counter,rowxid=rows[0]
 assert (owner,oid,iid,quantity,counter,int(rowxid))==(dealer,order,item,2,0,xid)
 assert not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_stock_useds WHERE stock_id=%s',(receipt,)).fetchone()
 assert c.execute('UPDATE sa_snapshot_20261019.sa_stocks SET dispatched_quantity=1 WHERE id=%s AND user_id=%s AND order_id=%s AND item_id=%s AND dispatched_quantity=0 RETURNING id',(receipt,dealer,order,item)).fetchone()==(receipt,)
 observed=read(0,'v1_stock_reconciliation',(dealer,'review',Jsonb({'receipt_id':str(receipt)}),None,1))['data']
 assert len(observed)==1 and observed[0]['safe_action']=='rebuild_counter' and observed[0]['consumed']==0 and observed[0]['counter']==1
 marker.update(state='prepared',dealer_id=str(dealer),order_id=str(order),item_id=str(item),receipt_id=str(receipt),setup_xid=xid,counter_before=1,expected_consumed=0)
 f['stockReconciliation']={k:marker[k] for k in ['dealer_id','order_id','item_id','receipt_id','counter_before','expected_consumed']}
 return marker
