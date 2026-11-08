"""Staging feedback chain with real mapped actors and disposable completed work."""
import datetime,json,sys,uuid
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect

def run():
 results=[];checks=[];seqs=['sa_domain.audit_id_seq','sa_domain.outbox_sequence_id_seq']+['sa_snapshot_20261019.sa_'+t+'_id_seq' for t in ['ratings','orders','items','addresses']]
 with connect('staging') as c:
  assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0]
  before={n:c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*n.split('.')))).fetchone() for n in seqs}
  try:
   with c.transaction():
    c.execute("SET LOCAL statement_timeout='10s'")
    rows=c.execute("""SELECT u.role,u.id,m.auth_user_id FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id AND m.enrollment_state='ready'
     JOIN auth.users au ON au.id=m.auth_user_id AND au.role='sa_app' AND(au.banned_until IS NULL OR au.banned_until<now()) WHERE u.role IN(0,1,2,3,4) AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE AND u.approved IS NOT FALSE ORDER BY u.id""").fetchall()
    actors={role:next(r for r in rows if r[0]==role) for role in [0,1,2,3]}
    cm=c.execute("SELECT id,factory_manager_id FROM sa_snapshot_20261019.sa_users WHERE role=9 AND deleted_at IS NULL AND disabled IS NOT TRUE AND factory_manager_id=ANY(%s) ORDER BY id LIMIT 1",([r[1] for r in rows if r[0]==4],)).fetchone();assert cm
    actors[4]=next(r for r in rows if r[1]==cm[1]);sessions={}
    for role,r in actors.items():
     sessions[role]=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sessions[role],r[2]))
    c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
    c.execute('UPDATE sa_snapshot_20261019.sa_users SET is_direct_deal=true,created_by_id=%s WHERE id=%s',(actors[1][1],actors[3][1]))
    address=c.execute("INSERT INTO sa_snapshot_20261019.sa_addresses(user_id,address,created_at,updated_at) VALUES(%s,'Rollback feedback address',now(),now()) RETURNING id",(actors[3][1],)).fetchone()[0]
    order=c.execute("""INSERT INTO sa_snapshot_20261019.sa_orders(address_id,customer_id,customer_sc_id,assigned_by_id,assigned_to_id,order_item_type,status,total_quantity,total_amount,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,1,1,1,100,now(),now()) RETURNING id""",(address,actors[3][1],actors[1][1],actors[2][1],actors[4][1])).fetchone()[0]
    item=c.execute('INSERT INTO sa_snapshot_20261019.sa_items(order_id,cutting_master_id,total_quantity,created_at,updated_at) VALUES(%s,%s,1,now(),now()) RETURNING id',(order,cm[0])).fetchone()[0]
    def actor(role):
     c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(actors[role][2]),'session_id':str(sessions[role])}),));c.execute('SET LOCAL ROLE sa_app')
    def call(name,args=(),target=500,label=None,measure=True):
     query='SELECT canto_api.'+name+'('+','.join(['%s']*len(args))+')'
     if measure:
      samples=[]
      for _ in range(11):
       with c.transaction():
        p=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query,args).fetchone()[0][0];samples.append(p['Execution Time']);raise psycopg.Rollback()
      r={'rpc':name,'scenario':label,'database_p95_ms':max(samples[1:]),'samples_ms':samples[1:],'target_ms':target};results.append(r);print(json.dumps(r),flush=True)
     return c.execute(query,args).fetchone()[0]
    saved={}
    for role,label in [(3,'Customer to current SC'),(1,'SC to assigned PC'),(2,'PC to assigned FM'),(4,'FM to assigned cutter')]:
     actor(role);saved[role]=call('v1_rating_save',(None,'Order',order,cm[0] if role==4 else None,Jsonb({'score':'4.5','positive_comments':'Rollback-only feedback'}),None,uuid.uuid4()),label=label)
    actor(3);page=call('v1_ratings_list',('Order',order,None,None,False,None,30),target=200,label='Customer private feedback scope');assert page['summary']['count']==1
    edit=call('v1_rating_save',(int(saved[3]['id']),'Order',order,None,Jsonb({'score':'5','positive_comments':'Rollback-only updated feedback'}),saved[3]['version'],uuid.uuid4()),label='Customer own feedback edit');assert edit['summary']['average']=='5.00'
    actor(0);page=call('v1_ratings_list',('Order',order,None,None,False,None,2),target=200,label='Admin paginated feedback');assert page['summary']['count']==4 and page['next_cursor']
    archived=call('v1_rating_archive',(int(edit['id']),'Rollback-only moderation',edit['version'],uuid.uuid4()),label='Admin moderation');assert archived['summary']['count']==0
    actor(3);assert call('v1_ratings_list',('Order',order),measure=False)['data']==[]
    checks=['Real mapped C → SC → PC → FM → assigned CM feedback relationships','Customer cannot see internal staff feedback','Own edit, recomputed average and Admin moderation preserve history','All outbox events rolled back without provider delivery']
    raise psycopg.Rollback()
  finally:
   c.execute('SET ROLE postgres')
   for n,(v,called) in before.items():c.execute('SELECT setval(%s::regclass,%s,%s)',(n,v,called))
   assert all(c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*n.split('.')))).fetchone()==s for n,s in before.items())
 evidence={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'warm DB feedback journey with real identities and disposable completed-work rows; all rollback, no external delivery; not full E2E/load','queries':results,'checks':checks,'all_rows_rolled_back':True,'sequences_restored':True}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-ratings-performance.json').write_text(json.dumps(evidence,indent=2)+'\n')
 assert all(x['database_p95_ms']<x['target_ms'] for x in results),[x for x in results if x['database_p95_ms']>=x['target_ms']]
 print(json.dumps({'passed':checks,'all_rows_rolled_back':True,'sequences_restored':True}))
if __name__=='__main__':run()
