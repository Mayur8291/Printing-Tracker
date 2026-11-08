"""Hosted mirror endpoint checks; no login fixtures, provider calls or source refresh.

The authorized worker run must return paused before leasing work. Rehearsal
routes are checked on production only, where they reject before any RPC.
"""
import datetime,json,sys,time,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect
from management import api,PROJECTS
from snapshot import require

def request(url,body,headers=None):
    req=urllib.request.Request(url,data=json.dumps(body).encode(),headers={'Content-Type':'application/json',**(headers or {})},method='POST')
    start=time.monotonic()
    try:
        with urllib.request.urlopen(req,timeout=60) as r:status,raw=r.status,r.read()
    except urllib.error.HTTPError as e:status,raw=e.code,e.read()
    try:result=json.loads(raw)
    except Exception:result={}
    return status,result,round((time.monotonic()-start)*1000,1)

def run():
    results={}
    for env,ref in PROJECTS.items():
        # Vault decryption is deliberately unavailable to the platform's generic
        # read-only role. Use the authorized owner inside a READ ONLY transaction;
        # keep the invocation key in memory and never log it.
        with connect(env) as c,c.transaction():
            c.execute('SET TRANSACTION READ ONLY')
            require(c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone()==(env,False,None),'Must be idle mirror')
            require(c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone()==(False,[],None),'Rehearsal active')
            worker=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
            before=c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()[0]
            require(before==0,'Pending queue requires review')
        anon=next(x['api_key'] for x in api(env,'/api-keys') if x['name']=='anon')
        base='https://'+ref+'.supabase.co';checks={}
        for platform in ('android','ios','web'):
            status,result,ms=request(base+'/rest/v1/rpc/v1_app_bootstrap',{'p_platform':platform,'p_version':'1.0.0'},{'apikey':anon,'Authorization':'Bearer '+anon,'Content-Profile':'canto_api','Accept-Profile':'canto_api'})
            require(status==200 and result.get('api_version')==1 and result.get('platform')==platform,'Bootstrap failed')
            checks['bootstrap_'+platform]={'status':status,'elapsed_ms':ms}
        status,result,ms=request(base+'/rest/v1/rpc/v1_me',{}, {'apikey':anon,'Authorization':'Bearer '+anon,'Content-Profile':'canto_api','Accept-Profile':'canto_api'})
        require(status in (401,403) and result.get('code')=='42501','Anonymous private RPC was not denied')
        checks['private_rpc_denied']={'status':status}
        status,_,_=request(base+'/functions/v1/squad-account/media/grants',{})
        require(status==401,'Account session guard failed');checks['account_session_denied']={'status':status}
        status,_,_=request(base+'/functions/v1/squad-jobs/run',{'limit':1},{'Authorization':'Bearer wrong'})
        require(status==401,'Worker secret guard failed');checks['worker_secret_denied']={'status':status}
        status,result,ms=request(base+'/functions/v1/squad-jobs/run',{'limit':1},{'Authorization':'Bearer '+worker})
        require(status==200 and result=={'paused':True,'results':[]},'Worker must remain paused')
        checks['worker_mirror_paused']={'status':status,'elapsed_ms':ms}
        status,result,_=request(base+'/functions/v1/squad-webhooks/warehouse/dashboard',{})
        require(status==503 and result.get('error')=='WEBHOOK_NOT_CONFIGURED','Unconfigured provider ingress not closed')
        checks['provider_ingress_disabled']={'status':status}
        if env=='production':
            for route in ('warehouse-rehearsal','mail-rehearsal','document-rehearsal'):
                status,result,_=request(base+'/functions/v1/squad-jobs/'+route,{}, {'Authorization':'Bearer '+worker})
                require(status==503 and result.get('error')=='WORKER_NOT_CONFIGURED','Production rehearsal was not rejected')
                checks[route+'_denied']={'status':status}
        with connect(env,readonly=True) as c:
            require(c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state').fetchone()==(env,False,None),'Ownership changed')
            require(c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()[0]==before,'Queue changed')
        results[env]=checks
    report={'measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':results,'no_source_refresh':True,'no_provider_effects':True,'no_login_fixtures':True,'timing_scope':'Single endpoint probes, not capacity or p95 benchmarks'}
    (ROOT/'docs/squad-one-audit/implementation-evidence/backend-mirror-endpoints.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report));return report
if __name__=='__main__':run()
