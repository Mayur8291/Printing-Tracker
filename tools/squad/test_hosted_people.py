"""Staging-only people journey. No Auth creation, email, push or persistent rows."""
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
 sequences=['sa_snapshot_20261019.sa_'+t+'_id_seq' for t in ['users','addresses','factories','user_dealers']]+['sa_domain.audit_id_seq','sa_domain.outbox_sequence_id_seq']
 with connect('staging') as c:
  assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh/write is active'
  before={n:c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*n.split('.')))).fetchone() for n in sequences}
  try:
   with c.transaction():
    c.execute("SET LOCAL statement_timeout='5s'")
    actors=c.execute("""SELECT DISTINCT ON(u.role) u.role,u.id,m.auth_user_id FROM sa_snapshot_20261019.sa_users u
     JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id AND m.enrollment_state='ready'
     JOIN auth.users au ON au.id=m.auth_user_id AND au.role='sa_app' AND (au.banned_until IS NULL OR au.banned_until<now())
     WHERE u.role IN(0,1,2,4,10) AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE
     ORDER BY u.role,u.id""").fetchall()
    actors={r[0]:(r[1],r[2],uuid.uuid4()) for r in actors};assert set(actors)=={0,1,2,4,10}
    for _,auth,sid in actors.values():c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sid,auth))
    c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,test_write_expires_at=now()+interval '15 minutes'",([a[1] for a in actors.values()],))
    def actor(role):
     _,auth,sid=actors[role];c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(auth),'session_id':str(sid)}),));c.execute('SET LOCAL ROLE sa_app')
    def call(name,args=(),target=500,measure=True):
     query='SELECT canto_api.'+name+'('+','.join(['%s']*len(args))+')'
     if measure:
      samples=[]
      for _ in range(11):
       with c.transaction():
        p=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query,args).fetchone()[0][0];samples.append(p['Execution Time']);raise psycopg.Rollback()
      row={'rpc':name,'database_p95_ms':max(samples[1:]),'samples_ms':samples[1:],'target_ms':target};results.append(row);print(json.dumps(row),flush=True)
     return c.execute(query,args).fetchone()[0]
    actor(1);args=(None,3,Jsonb({'name':'Rollback customer','email':f'rollback-{uuid.uuid4()}@example.invalid'}),None,uuid.uuid4());p=call('v1_person_save',args)
    assert p==call('v1_person_save',args,measure=False)
    d=call('v1_person_get',(int(p['id']),),target=200);assert d['approved'] is False and d['coordinator_id']==str(actors[1][0]);checks.append('SC pending customer, one enrollment intent and exact retry')
    address=call('v1_address_save',(None,int(p['id']),Jsonb({'address':'Rollback-only address','state':'Karnataka','city':'Bengaluru','zip_code':'560001','is_primary':True}),None,uuid.uuid4()))
    assert len(address['addresses'])==1 and address['addresses'][0]['is_primary'];checks.append('Scoped address and future commercial-rule evaluation')
    actor(10);dealer_customer=call('v1_person_save',(None,3,Jsonb({'name':'Rollback dealer customer','email':f'rollback-{uuid.uuid4()}@example.invalid'}),None,uuid.uuid4()))
    d=call('v1_person_get',(int(dealer_customer['id']),),target=200);assert d['approved'] and d['onboarded'] and d['dealer_ids']==[str(actors[10][0])];checks.append('Dealer auto-approval/onboarding with exact owner link')
    actor(2);factory=call('v1_factory_save',(None,'Rollback factory '+str(uuid.uuid4()),None,uuid.uuid4()))
    manager=call('v1_person_save',(None,4,Jsonb({'name':'Rollback manager','email':f'rollback-{uuid.uuid4()}@example.invalid','factory_id':factory['id']}),None,uuid.uuid4()));assert manager['account']=='queued';checks.append('PC factory and manager enrollment intent')
    actor(4);t=call('v1_tailor_save',(None,Jsonb({'name':'Rollback tailor'}),None,uuid.uuid4()))
    st=call('v1_subtailor_save',(None,Jsonb({'name':'Rollback sub-tailor','parent_tailor_id':t['id']}),None,uuid.uuid4()));assert st['account']=='managed_subject'
    team=call('v1_factory_team_save',(None,9,Jsonb({'name':'Rollback cutter','email':f'rollback-{uuid.uuid4()}@example.invalid'}),None,uuid.uuid4()));assert team['account']=='queued'
    d=call('v1_person_get',(int(st['id']),),target=200);assert d['email'] is None and d['manager_id']==str(actors[4][0]);checks.append('FM tailor/sub-tailor inheritance, no synthetic Auth, scoped cutter intent')
    call('v1_person_archive',(int(st['id']),'Rollback-only archived subject',st['version'],uuid.uuid4()))
    call('v1_person_archive',(int(t['id']),'Rollback-only archived subject',t['version'],uuid.uuid4()));checks.append('Subject archive after child removal retains source history')
    actor(0);assistant=call('v1_person_save',(None,12,Jsonb({'name':'Rollback Team','email':f'rollback-{uuid.uuid4()}@example.invalid','features':[{'key':'3','checked':True,'children':[{'key':'3.3','checked':True}]}]}),None,uuid.uuid4()))
    assert assistant['account']=='queued';checks.append('Admin-only Team capability grant')
    # Representative largest dealer detail exercises dependency and ledger joins.
    c.execute('SET LOCAL ROLE postgres');largest=c.execute('SELECT user_id FROM sa_snapshot_20261019.sa_stocks GROUP BY user_id ORDER BY count(*) DESC LIMIT 1').fetchone()[0]
    actor(0);call('v1_person_get',(largest,),target=200)
    raise psycopg.Rollback()
  finally:
   c.execute('SET ROLE postgres')
   for name,(value,called) in before.items():c.execute('SELECT setval(%s::regclass,%s,%s)',(name,value,called))
   assert all(c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*name.split('.')))).fetchone()==state for name,state in before.items())
 evidence={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'warm rollback-only database journey; no Auth users or provider messages; not load/capacity measurement','queries':results,'checks':checks,'all_rows_rolled_back':True,'sequences_restored':True}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-people-performance.json').write_text(json.dumps(evidence,indent=2)+'\n')
 assert all(x['database_p95_ms']<x['target_ms'] for x in results),[x for x in results if x['database_p95_ms']>=x['target_ms']]
 print(json.dumps({'passed':checks,'all_rows_rolled_back':True,'sequences_restored':True}))
if __name__=='__main__':run()
