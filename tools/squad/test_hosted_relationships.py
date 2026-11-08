"""Rolled-back staging CRM journey and bounded bulk reassignment benchmark."""
import datetime,json,sys,uuid
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect

def run():
 results=[];checks=[]
 sequences=['sa_snapshot_20261019.sa_'+t+'_id_seq' for t in ['users','addresses','user_dealers','customer_requests','assigned_brands','orders']]+['sa_domain.audit_id_seq','sa_domain.outbox_sequence_id_seq']
 with connect('staging') as c:
  assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/write is active'
  before={n:c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*n.split('.')))).fetchone() for n in sequences}
  try:
   with c.transaction():
    c.execute("SET LOCAL statement_timeout='10s'")
    people=c.execute("""SELECT u.role,u.id,m.auth_user_id,u.created_by_id FROM sa_snapshot_20261019.sa_users u
     JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id AND m.enrollment_state='ready'
     JOIN auth.users au ON au.id=m.auth_user_id AND au.role='sa_app' AND(au.banned_until IS NULL OR au.banned_until<now())
     WHERE u.role IN(0,1,3,10) AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE AND(u.role<>3 OR(u.is_direct_deal IS TRUE AND u.approved IS NOT FALSE))
     ORDER BY u.id""").fetchall()
    admin=next(p for p in people if p[0]==0);coordinators=[p for p in people if p[0]==1];sc,other=coordinators[:2]
    customer=next(p for p in people if p[0]==3 and p[3] is not None and p[3]!=other[1]);dealer=next(p for p in people if p[0]==10)
    actors={'admin':admin,'sc':sc,'other':other,'customer':customer,'dealer':dealer};sessions={}
    for name,p in actors.items():
     sid=uuid.uuid4();sessions[name]=sid;c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid,p[2]))
    c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,test_write_expires_at=now()+interval '15 minutes'",([a[2] for a in actors.values()],))
    def actor(name):
     c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(actors[name][2]),'session_id':str(sessions[name])}),));c.execute('SET LOCAL ROLE sa_app')
    def version(kind,id):
     c.execute('SET LOCAL ROLE postgres');return c.execute('SELECT sa_domain.version(%s,%s)',(kind,id)).fetchone()[0]
    def call(name,args=(),target=500,measure=True,label=None):
     query='SELECT canto_api.'+name+'('+','.join(['%s']*len(args))+')'
     if measure:
      samples=[]
      for _ in range(11):
       with c.transaction():
        p=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query,args).fetchone()[0][0];samples.append(p['Execution Time']);raise psycopg.Rollback()
      row={'rpc':name,'scenario':label,'database_p95_ms':max(samples[1:]),'samples_ms':samples[1:],'target_ms':target};results.append(row);print(json.dumps(row),flush=True)
     return c.execute(query,args).fetchone()[0]
    actor('sc');p=call('v1_person_save',(None,3,Jsonb({'name':'Rollback approval','email':f'rollback-{uuid.uuid4()}@example.invalid'}),None,uuid.uuid4()),measure=False)
    reviewed=call('v1_customer_review',(int(p['id']),Jsonb({'approved':True,'onboarded':True}),'Rollback review',p['version'],uuid.uuid4()));assert reviewed['approved'] and reviewed['onboarded']
    terms=call('v1_customer_commercial_rules_save',(int(p['id']),Jsonb({'stock_visibility_percentage':40}),'Rollback commercial rule',reviewed['version'],uuid.uuid4()))
    linked=call('v1_customer_links_save',(int(p['id']),sc[1],[],True,'Rollback direct relationship',terms['version'],uuid.uuid4()));assert linked['direct'];checks.append('SC approval/onboarding, commercial terms and direct relationship')
    call('v1_people_list',(3,'',None,30,Jsonb({'approved':[True],'coordinator_id':str(sc[1])})),target=200)
    dv=version('person',dealer[1]);actor('dealer');call('v1_dealer_rules_save',(dealer[1],Jsonb({'auto_approve_customers':True}),'Rollback autoapproval rule',dv,uuid.uuid4()));checks.append('Dealer own automatic approval setting')
    actor('customer');options=call('v1_relationship_options',('coordinators',None,'',None,30),target=200);assert all(set(x)=={'id','name','parent_id'} for x in options['data'])
    # Imported pending requests are left intact. Choose a ready direct customer
    # with no outstanding request for this isolated journey.
    c.execute('SET LOCAL ROLE postgres')
    if c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_customer_requests WHERE user_id=%s AND status=0',(customer[1],)).fetchone():
     customer=next(p for p in people if p[0]==3 and p[3] is not None and p[3]!=other[1] and not c.execute('SELECT 1 FROM sa_snapshot_20261019.sa_customer_requests WHERE user_id=%s AND status=0',(p[1],)).fetchone())
     actors['customer']=customer;sessions['customer']=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sessions['customer'],customer[2]))
    cv=version('person',customer[1]);actor('customer');request=call('v1_coordinator_change_request',(other[1],'Rollback coordinator request',uuid.uuid4()))
    page=call('v1_coordinator_requests',('pending',None,None,30),target=200);assert any(x['id']==request['id'] for x in page['data'])
    actor('admin');decision=call('v1_coordinator_change_decide',(int(request['id']),'approved','Rollback request decision',request['version'],cv,uuid.uuid4()));assert decision['state']=='approved';checks.append('Direct customer request, scoped list, Admin approval and pending-order attribution')
    # Representative maximum bounded batch, disposable source-shaped rows only.
    c.execute('SET LOCAL ROLE postgres');tag=str(uuid.uuid4())
    batch=c.execute("""INSERT INTO sa_snapshot_20261019.sa_users(email,name,role,approved,onboarded,created_by_id,created_at,updated_at)
      SELECT 'batch-'||%s||'-'||n||'@example.invalid','Rollback batch customer',3,true,true,%s,now(),now() FROM generate_series(1,100) n RETURNING id""",(tag,sc[1])).fetchall();ids=[x[0] for x in batch]
    c.execute("""INSERT INTO sa_snapshot_20261019.sa_addresses(user_id,address,state,city,zip_code,is_primary,created_at,updated_at)
      SELECT unnest(%s::bigint[]),'Rollback batch address','Karnataka','Bengaluru','560001',true,now(),now()""",(ids,))
    c.execute("""INSERT INTO sa_snapshot_20261019.sa_orders(customer_id,address_id,customer_sc_id,created_by_id,order_item_type,status,uc_status,total_quantity,total_amount,created_at,updated_at)
      SELECT u.id,a.id,%s,u.id,1,0,'',1,100,now(),now() FROM sa_snapshot_20261019.sa_users u JOIN sa_snapshot_20261019.sa_addresses a ON a.user_id=u.id CROSS JOIN generate_series(1,10) n WHERE u.id=ANY(%s)""",(sc[1],ids))
    payload=[{'id':str(id),'version':c.execute("SELECT sa_domain.version('person',%s)",(id,)).fetchone()[0]} for id in ids]
    actor('admin');bulk=call('v1_customers_reassign',(Jsonb(payload),other[1],'Rollback 100 customer / 1000 order batch',uuid.uuid4()),label='100 customers, 1000 pending orders');assert bulk['updated_pending_orders']==1000
    checks.append('Bounded 100-customer/1000-pending-order reassignment in one transaction')
    raise psycopg.Rollback()
  finally:
   c.execute('SET ROLE postgres')
   for name,(value,called) in before.items():c.execute('SELECT setval(%s::regclass,%s,%s)',(name,value,called))
   assert all(c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*name.split('.')))).fetchone()==state for name,state in before.items())
 evidence={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'warm rollback-only database journey and maximum bounded attribution batch; no provider requests; not concurrent load measurement','queries':results,'checks':checks,'all_rows_rolled_back':True,'sequences_restored':True}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-relationships-performance.json').write_text(json.dumps(evidence,indent=2)+'\n')
 assert all(x['database_p95_ms']<x['target_ms'] for x in results),[x for x in results if x['database_p95_ms']>=x['target_ms']]
 print(json.dumps({'passed':checks,'all_rows_rolled_back':True,'sequences_restored':True}))
if __name__=='__main__':run()
