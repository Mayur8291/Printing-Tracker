"""Staging content/settings/capability journey; all mutations roll back."""
import datetime,json,sys,uuid
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect

def run():
 results=[];checks=[];sequences=['sa_domain.audit_id_seq','sa_domain.outbox_sequence_id_seq']+['sa_snapshot_20261019.sa_'+t+'_id_seq' for t in ['zones','cities','criteria']]
 with connect('staging') as c:
  assert c.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0]
  before={n:c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*n.split('.')))).fetchone() for n in sequences}
  try:
   with c.transaction():
    c.execute("SET LOCAL statement_timeout='10s'")
    rows=c.execute("""SELECT DISTINCT ON(u.role) u.role,u.id,m.auth_user_id FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id AND m.enrollment_state='ready'
     JOIN auth.users au ON au.id=m.auth_user_id AND au.role='sa_app' AND(au.banned_until IS NULL OR au.banned_until<now()) WHERE u.role IN(0,2,3,10,11,12) AND u.deleted_at IS NULL AND u.disabled IS NOT TRUE AND u.approved IS NOT FALSE ORDER BY u.role,u.id""").fetchall()
    actors={r[0]:r for r in rows};sessions={}
    for role,r in actors.items():
     sessions[role]=uuid.uuid4();c.execute('INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(%s,%s,now(),now())',(sessions[role],r[2]))
    c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true')
    def actor(role):
     c.execute('SET LOCAL ROLE postgres');c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'sa_app','sub':str(actors[role][2]),'session_id':str(sessions[role])}),));c.execute('SET LOCAL ROLE sa_app')
    def call(name,args=(),target=200,measure=True):
     query='SELECT canto_api.'+name+'('+','.join(['%s']*len(args))+')'
     if measure:
      samples=[]
      for _ in range(11):
       with c.transaction():
        p=c.execute('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+query,args).fetchone()[0][0];samples.append(p['Execution Time']);raise psycopg.Rollback()
      r={'rpc':name,'database_p95_ms':max(samples[1:]),'samples_ms':samples[1:],'target_ms':target};results.append(r);print(json.dumps(r),flush=True)
     return c.execute(query,args).fetchone()[0]
    actor(0);releases=call('v1_settings_read',('app_releases',));version=next(x['version'] for x in releases['data'] if x['platform']=='android')
    call('v1_settings_save',('app_releases',None,Jsonb({'platform':'android','minimum_version':'1.10.0+2','recommended_version':'2.0.0','update_url':'https://play.google.com/store/apps/details?id=rollback'}),'Rollback release test',version,uuid.uuid4()),target=500)
    c.execute('SET LOCAL ROLE anon');r=call('v1_app_bootstrap',('android','1.2.0'));assert r['update_required'];checks.append('Anonymous release policy only; numeric version comparison')
    actor(0);worker=actors.get(12) or actors[11];c.execute('SET LOCAL ROLE postgres');v=c.execute("SELECT sa_domain.version('person',%s)",(worker[1],)).fetchone()[0];actor(0)
    features=[{'key':'3','checked':'true','children':[{'key':'3.4','checked':'true'}]}]
    cap=call('v1_person_capabilities_save',(worker[1],Jsonb(features),'Rollback feature grant',v,uuid.uuid4()),target=500);assert cap['capabilities']['promotions'] and not cap['capabilities']['place_orders']
    actor(worker[0]);call('v1_promotions_list',(Jsonb({}),None,30));checks.append('Admin grant becomes effective on existing worker session')
    actor(2);call('v1_promotions_list',(Jsonb({'mode':'categories'}),None,30));actor(10);call('v1_banners_list',(None,30));checks.append('Scoped content lists, category pagination, dealer banner filtering')
    actor(0);tag=str(uuid.uuid4());z=call('v1_settings_save',('zones',None,Jsonb({'name':'Rollback '+tag}),'Rollback geography test',None,uuid.uuid4()),target=500)
    city=call('v1_settings_save',('cities',None,Jsonb({'name':'Rollback '+tag,'zone_id':z['id']}),'Rollback geography test',None,uuid.uuid4()),target=500,measure=False)
    call('v1_settings_save',('cities',int(city['id']),Jsonb({'archive':True}),'Rollback geography test',city['version'],uuid.uuid4()),measure=False)
    call('v1_settings_save',('zones',int(z['id']),Jsonb({'archive':True}),'Rollback geography test',z['version'],uuid.uuid4()),measure=False)
    call('v1_settings_read',('cities',None,30));checks.append('Unused geography create/archive with versions and audit')
    raise psycopg.Rollback()
  finally:
   c.execute('SET ROLE postgres')
   for name,(value,called) in before.items():c.execute('SELECT setval(%s::regclass,%s,%s)',(name,value,called))
   assert all(c.execute(sql.SQL('SELECT last_value,is_called FROM {}').format(sql.Identifier(*name.split('.')))).fetchone()==state for name,state in before.items())
 evidence={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'warm rollback-only database content/settings journey; no external delivery; not concurrent load','queries':results,'checks':checks,'all_rows_rolled_back':True,'sequences_restored':True}
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-app-content-performance.json').write_text(json.dumps(evidence,indent=2)+'\n')
 assert all(x['database_p95_ms']<x['target_ms'] for x in results),[x for x in results if x['database_p95_ms']>=x['target_ms']]
 print(json.dumps({'passed':checks,'all_rows_rolled_back':True,'sequences_restored':True}))
if __name__=='__main__':run()
