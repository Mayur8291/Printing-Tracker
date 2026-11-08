"""Provision the reviewed Squad runtime in production mirror mode.

Explicit --apply is required. Never copies staging data, secrets or environment
identity; never enables ownership, provider writes, mail sends or test fixtures.
Only the three Squad Edges, three private buckets and three owned Crons are in scope.
"""
import argparse,datetime,hashlib,json,os,re,secrets,subprocess,sys,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from management import api,token,PROJECTS
from database import connect,public_structure
from snapshot import require
FUNCTIONS=('squad-account','squad-jobs','squad-webhooks')
CRONS=('squad-jobs-minute','squad-documents-pump','squad-media-cleanup')
BUCKETS={'squad-uploads':(104857600,None),'squad-documents':(67108864,['application/pdf','application/octet-stream']),'squad-transfers':(10485760,['text/csv','application/octet-stream'])}

def legacy_mail(root=ROOT):
    base=root/'../Canto/scott-international-backend'
    text=(base/'config/environments/production.rb').read_text()
    result={}
    for field,name in [('address','HOST'),('port','PORT'),('user_name','USERNAME'),('password','PASSWORD')]:
        m=re.search(r':'+field+r'\s*=>\s*(?:[\"\x27]([^\"\x27\n]+)[\"\x27]|(\d+))',text)
        require(m is not None,'Missing literal production SMTP '+field)
        result['SQUAD_SMTP_'+name]=m.group(1) or m.group(2)
    sender=(base/'app/mailers/application_mailer.rb').read_text()
    m=re.search(r'default\s+from:\s*[\"\x27]([^\"\x27\n]+)[\"\x27]',sender)
    require(m is not None,'Missing literal production sender');result['SQUAD_SMTP_SENDER']=m.group(1)
    require(int(result['SQUAD_SMTP_PORT']) in (2525,465),'Unsupported verified TLS SMTP port')
    account=json.loads((base/'scott-firebase-adminsdk.json').read_text())
    require(account.get('project_id')=='scott-75a12' and account.get('type')=='service_account','Unexpected Firebase provenance')
    result['SQUAD_FIREBASE_SERVICE_ACCOUNT']=json.dumps({k:account[k] for k in ('project_id','client_email','private_key')})
    return result

def normalized_command(command,target,name=None):
    require(target=='production','Mirror installer only targets production')
    require(isinstance(command,str) and len(command)<=16384,'Invalid worker schedule')
    source='https://'+PROJECTS['staging']+'.supabase.co'
    require(command.count(source)==1,'Expected exactly one staging worker origin')
    paths={'squad-jobs-minute':'run','squad-documents-pump':'run','squad-media-cleanup':'media-cleanup'}
    require(name is None or name in paths,'Unrecognized worker schedule name')
    endpoint=source+'/functions/v1/squad-jobs/'+paths[name] if name else None
    urls=re.findall(r'https?://[^\s\x27\"<>]+',command)
    require(len(urls)==1 and urls[0] in ([endpoint] if endpoint else [source+'/functions/v1/squad-jobs/'+p for p in set(paths.values())]),'Unexpected worker schedule URL')
    require(re.match(r'^\s*SELECT\s+net\.http_post\s*\(',command,re.I) is not None and re.search(r';\s*\S',command) is None,'Expected one worker SELECT')
    require(not re.search(r'--|/\*|\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|COPY|EXECUTE|CALL|DO)\b',command,re.I),'Unsafe worker schedule statement')
    calls={x.lower() for x in re.findall(r'\b([A-Za-z_][A-Za-z_0-9.]*)\s*\(',command)}
    require(calls<={'net.http_post','jsonb_build_object','exists','in','and','or','not','now','sa_domain.job_handler'},'Unexpected worker schedule function')
    require(len(re.findall(r'vault\.decrypted_secrets',command,re.I))==1 and re.search(r"FROM\s+vault\.decrypted_secrets\s+WHERE\s+name\s*=\s*'squad_jobs_invocation_secret'",command,re.I) is not None,'Unrecognized worker secret lookup')
    return command.replace(source,'https://'+PROJECTS[target]+'.supabase.co')

def secret_matches(metadata,value):
    # Management GET /secrets uses `value` for the SHA256 digest, not plaintext.
    # Accept the CLI's explicit digest shape as well; never output either value.
    digest=metadata.get('digest',metadata.get('value'))
    require(isinstance(digest,str) and re.fullmatch(r'[a-fA-F0-9]{64}',digest) is not None,'Secret digest unavailable; refusing overwrite')
    return secrets.compare_digest(digest.lower(),hashlib.sha256(value.encode()).hexdigest())

def managed_secret(existing,edge_name,vault_value):
    """Recover a committed Vault value without rotating an existing Edge key."""
    if vault_value is not None:
        require(isinstance(vault_value,str) and len(vault_value)>=32,'Invalid managed secret')
        if edge_name in existing:
            require(secret_matches(existing[edge_name],vault_value),'Managed secret changed outside installer; refusing rotation')
            return vault_value,False,False
        return vault_value,False,True
    require(edge_name not in existing,'Existing secret has no managed Vault record; refusing rotation')
    return secrets.token_urlsafe(48),True,True

def safe_configuration(existing,env):
    expected={'SQUAD_PUSH_MODE':'validate_only','SQUAD_WAREHOUSE_ENABLED':'false','SQUAD_WAREHOUSE_WRITES_ENABLED':'false','SQUAD_WAREHOUSE_ENVIRONMENT':env,'SQUAD_UNIWARE_ENVIRONMENT':env,'SQUAD_WAREHOUSE_READ_CHECK_ENABLED':'false','SQUAD_WEBHOOK_ENABLED':'false','SQUAD_WEBHOOK_ENVIRONMENT':env,'SQUAD_AIRTABLE_ENABLED':'false','SQUAD_AIRTABLE_REPORTS_ENABLED':'false'}
    result={}
    for name,value in expected.items():
        if name in existing:require(secret_matches(existing[name],value),'Existing runtime setting differs from safe mirror configuration: '+name)
        else:result[name]=value
    return result

def require_idle(c,env):
    require(c.execute('SELECT environment,cutover,active_job FROM sa_sync.environment_state WHERE singleton').fetchone()==(env,False,None),'Target must be an idle mirror')
    require(c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state WHERE singleton').fetchone()==(False,[],None),'Active rehearsal is forbidden')
    require(c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()[0]==0,'Pending jobs require explicit review')

def run(apply=False):
    # This session guard spans Management API and CLI calls as well as SQL.
    # Refresh/deployment/cutover require the matching exclusive advisory lock.
    with connect('production',readonly=not apply) as guard:
        require(guard.execute('SELECT pg_try_advisory_lock(20261107,1)').fetchone()[0],'Refresh or deployment is active')
        try:
            require_idle(guard,'production')
            result=run_locked(apply)
            require_idle(guard,'production')
            return result
        finally:
            guard.execute('SELECT pg_advisory_unlock(20261107,1)')

def run_locked(apply=False):
    env='production';ref=PROJECTS[env]
    source_functions={x['slug']:x for x in api('staging','/functions') if x['slug'] in FUNCTIONS}
    require(set(source_functions)==set(FUNCTIONS),'Staging release incomplete')
    require(all(x['status']=='ACTIVE' and x['verify_jwt'] is False and x.get('ezbr_sha256') for x in source_functions.values()),'Staging artifact identity unavailable')
    target_functions={x['slug']:x for x in api(env,'/functions')}
    with connect('staging',readonly=True) as s:
        require_idle(s,'staging')
        rows=s.execute('SELECT jobname,schedule,command,active FROM cron.job WHERE jobname=ANY(%s) ORDER BY jobname',(list(CRONS),)).fetchall()
        require({x[0] for x in rows}==set(CRONS) and all(x[3] for x in rows),'Staging schedules must be restored before release')
        schedules=[(name,schedule,normalized_command(command,env,name)) for name,schedule,command,_ in rows]
        stage_migrations=s.execute("SELECT version,statements FROM supabase_migrations.schema_migrations WHERE name LIKE 'squad_%' ORDER BY version").fetchall()
    with connect(env,readonly=True) as c:
        require_idle(c,env)
        require(c.execute("SELECT version,statements FROM supabase_migrations.schema_migrations WHERE name LIKE 'squad_%' ORDER BY version").fetchall()==stage_migrations,'Database release must match staging first')
        require({r[0] for r in c.execute("SELECT extname FROM pg_extension WHERE extname IN('pg_cron','pg_net','supabase_vault')")}=={'pg_cron','pg_net','supabase_vault'},'Missing runtime extension')
        before=public_structure(c)
        unrelated=c.execute("SELECT jobid,jobname,schedule,command,active FROM cron.job WHERE jobname<>ALL(%s) ORDER BY jobid",(list(CRONS),)).fetchall()
    supplied=legacy_mail()
    existing={s['name']:s for s in api(env,'/secrets')}
    safe_values=safe_configuration(existing,env)
    smtp_names={name for name in supplied if name.startswith('SQUAD_SMTP_')}
    require(not smtp_names.intersection(existing) or smtp_names.issubset(existing),'Partial existing SMTP configuration requires review')
    report={'environment':env,'mode':'apply' if apply else 'preflight','functions':list(FUNCTIONS),'buckets':list(BUCKETS),'schedules':list(CRONS),'provider_writes_enabled':False,'ownership_enabled':False,'business_data_refresh':False}
    if not apply:print(json.dumps(report));return report
    with connect(env) as c,c.transaction():
        require_idle(c,env)
        values={};managed_values={}
        for edge_name,vault_name in [('SQUAD_JOBS_SECRET','squad_jobs_invocation_secret'),('SQUAD_ACCOUNT_SECRET','squad_account_encryption_secret')]:
            row=c.execute('SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=%s',(vault_name,)).fetchone()
            value,create_vault,write_edge=managed_secret(existing,edge_name,row[0] if row else None)
            managed_values[edge_name]=value
            if write_edge:values[edge_name]=value
            if create_vault:c.execute('SELECT vault.create_secret(%s,%s,%s)',(value,vault_name,'Production Squad mirror runtime'))
    # Only fill absent provider configuration; preserve established target credentials.
    values.update({k:v for k,v in supplied.items() if k not in existing})
    values.update(safe_values)
    if values:api(env,'/secrets',[{'name':k,'value':v} for k,v in values.items()],method='POST')
    confirmed={s['name']:s for s in api(env,'/secrets')}
    require(not safe_configuration(confirmed,env),'Mirror configuration incomplete after provisioning')
    for name,value in {**values,**managed_values}.items():
        require(name in confirmed and secret_matches(confirmed[name],value),'Provisioned secret receipt mismatch: '+name)
    # Upload bucket is the only bucket not created by the SQL chain.
    with connect(env) as c,c.transaction():
        require_idle(c,env)
        c.execute("INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES('squad-uploads','squad-uploads',false,104857600) ON CONFLICT(id) DO NOTHING")
        for name,(limit,mimes) in BUCKETS.items():
            require(c.execute('SELECT public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id=%s',(name,)).fetchone()==(False,limit,mimes),'Bucket configuration mismatch: '+name)
    # Deploy only reviewed artifacts. No --prune and no unrelated functions.
    cli_env=dict(os.environ,SUPABASE_ACCESS_TOKEN=token())
    for name in FUNCTIONS:
        expected=source_functions[name]
        old=target_functions.get(name)
        if old and old.get('ezbr_sha256')==expected['ezbr_sha256'] and old.get('verify_jwt') is False and old.get('status')=='ACTIVE':continue
        subprocess.run(['supabase','functions','deploy',name,'--project-ref',ref,'--use-api'],cwd=ROOT,env=cli_env,check=True)
    actual={f['slug']:f for f in api(env,'/functions')}
    for name in FUNCTIONS:
        require(actual[name]['status']=='ACTIVE' and actual[name]['verify_jwt'] is False and actual[name]['ezbr_sha256']==source_functions[name]['ezbr_sha256'],'Deployed function differs from staging: '+name)
    with connect(env) as c,c.transaction():
        require_idle(c,env)
        for name,schedule,command in schedules:
            old=c.execute('SELECT schedule,command,active FROM cron.job WHERE jobname=%s',(name,)).fetchone()
            if old:require(old==(schedule,command,True),'Existing owned schedule differs; review instead of overwriting')
            else:c.execute('SELECT cron.schedule(%s,%s,%s)',(name,schedule,command))
        require(public_structure(c)==before,'Public schema changed')
        require(c.execute("SELECT jobid,jobname,schedule,command,active FROM cron.job WHERE jobname<>ALL(%s) ORDER BY jobid",(list(CRONS),)).fetchall()==unrelated,'Unrelated schedules changed')
    report.update(function_hashes={n:actual[n]['ezbr_sha256'] for n in FUNCTIONS},public_structure_unchanged=True,unrelated_schedules_unchanged=True,finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),missing_deferred_configuration=['Uniware production credentials and provider acceptance','Squad webhook activation and validated callback configuration'])
    path=ROOT/'docs/squad-one-audit/implementation-evidence/production-mirror-runtime.json';path.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report));return report
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--apply',action='store_true');a=parser.parse_args();run(a.apply)
