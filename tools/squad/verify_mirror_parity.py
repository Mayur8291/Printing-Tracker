"""Read-only structural and Edge artifact comparison of the Squad backend.

Business rows, Auth users, provider credentials, public-schema applications and
platform-managed state are deliberately not copied or required to be equal.
"""
import datetime,hashlib,json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
from management import api,PROJECTS
from snapshot import require
SCHEMAS=['sa_domain','canto_api','sa_snapshot_20261019','sa_admin','sa_identity','sa_media','sa_sync']
ROLES=['sa_app','sa_guard','sa_executor','sa_worker','sa_media_writer','sa_account_writer','sa_integrator','sa_mail_lock','sa_dashboard']

def digest(x):return hashlib.sha256(json.dumps(x,sort_keys=True,default=str).encode()).hexdigest()
def schema_rows(c):
    # NULL object ACL means PostgreSQL defaults, not an empty grant set.
    acl="coalesce((SELECT jsonb_agg(jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) ORDER BY a.grantee=0,pg_get_userbyid(a.grantee),pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM aclexplode(%s) a),'[]'::jsonb)"
    require([r[0] for r in c.execute('SELECT nspname FROM pg_namespace WHERE nspname=ANY(%s) ORDER BY 1',(SCHEMAS,))]==sorted(SCHEMAS),'Required backend schema missing')
    queries={
      'columns':"SELECT n.nspname,c.relname,a.attname,CASE WHEN c.relkind='c' THEN a.attnum ELSE NULL END,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid),a.attidentity,a.attgenerated,CASE WHEN a.attcollation=0 THEN NULL ELSE a.attcollation::regcollation::text END,"+(acl%'a.attacl')+" FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname=ANY(%s) AND c.relkind IN('r','p','v','m','c') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,3",
      'relations':"SELECT n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner),c.reloptions,"+(acl%"coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::\"char\" ELSE 'r'::\"char\" END,c.relowner))")+" FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) AND c.relkind IN('r','p','v','m','S') ORDER BY 1,2",
      'functions':"SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),"+(acl%"coalesce(p.proacl,acldefault('f',p.proowner))")+" FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY(%s) AND p.prokind IN('f','p') ORDER BY 1,2,3",
      'types':"SELECT n.nspname,t.typname,t.typtype,pg_get_userbyid(t.typowner),format_type(t.typbasetype,t.typtypmod),t.typnotnull,t.typdefault,CASE WHEN t.typcollation=0 THEN NULL ELSE t.typcollation::regcollation::text END,"+(acl%"coalesce(t.typacl,acldefault('T',t.typowner))")+",ARRAY(SELECT e.enumlabel FROM pg_enum e WHERE e.enumtypid=t.oid ORDER BY e.enumsortorder),ARRAY(SELECT k.conname||':'||pg_get_constraintdef(k.oid)||':'||k.convalidated::text FROM pg_constraint k WHERE k.contypid=t.oid ORDER BY k.conname) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace LEFT JOIN pg_class c ON c.oid=t.typrelid WHERE n.nspname=ANY(%s) AND (t.typtype IN('d','e') OR (t.typtype='c' AND c.relkind='c')) ORDER BY 1,2",
      'views':"SELECT n.nspname,c.relname,pg_get_viewdef(c.oid,true) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) AND c.relkind IN('v','m') ORDER BY 1,2",
      'sequences':"SELECT n.nspname,c.relname,format_type(s.seqtypid,NULL),s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache,s.seqcycle FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) ORDER BY 1,2",
      'constraints':"SELECT n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid),k.convalidated FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) ORDER BY 1,2,3",
      'indexes':"SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=ANY(%s) ORDER BY 1,2,3",
      'policies':"SELECT schemaname,tablename,policyname,permissive,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname=ANY(%s) ORDER BY 1,2,3",
      'triggers':"SELECT n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid),t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(%s) AND NOT t.tgisinternal ORDER BY 1,2,3",
      'schema_acl':"SELECT nspname,pg_get_userbyid(nspowner),"+(acl%"coalesce(nspacl,acldefault('n',nspowner))")+" FROM pg_namespace WHERE nspname=ANY(%s) ORDER BY 1",
      'default_acl':"SELECT coalesce(n.nspname,'*'),pg_get_userbyid(d.defaclrole),d.defaclobjtype,"+(acl%'d.defaclacl')+" FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname=ANY(%s) OR (d.defaclnamespace=0 AND (pg_get_userbyid(d.defaclrole)=ANY(%s) OR d.defaclrole IN(SELECT nspowner FROM pg_namespace WHERE nspname=ANY(%s)))) ORDER BY 1,2,3",
    }
    result={k:c.execute(q,(SCHEMAS,ROLES,SCHEMAS) if k=='default_acl' else (SCHEMAS,)).fetchall() for k,q in queries.items()}
    result['roles']=c.execute('SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=ANY(%s) ORDER BY rolname',(ROLES,)).fetchall()
    require([r[0] for r in result['roles']]==sorted(ROLES),'Required backend role missing')
    result['role_memberships']=c.execute("SELECT pg_get_userbyid(roleid),pg_get_userbyid(member),pg_get_userbyid(grantor),admin_option,inherit_option,set_option FROM pg_auth_members WHERE pg_get_userbyid(roleid)=ANY(%s) OR pg_get_userbyid(member)=ANY(%s) ORDER BY 1,2,3",(ROLES,ROLES)).fetchall()
    return result

EXPECTED_FUNCTIONS=frozenset(('squad-account','squad-jobs','squad-webhooks','canto-refresh'))
def validate_runtime(flags):
    require(flags==(False,[],None),'Rehearsal writes must be disabled for parity acceptance')

def edge_artifacts(rows):
    functions=[{k:f.get(k) for k in ('slug','status','verify_jwt','ezbr_sha256')} for f in rows if f.get('slug') in EXPECTED_FUNCTIONS]
    require(len(functions)==len(EXPECTED_FUNCTIONS) and {f['slug'] for f in functions}==EXPECTED_FUNCTIONS,'Expected four deployed backend Edge functions')
    for f in functions:
        require(f['status']=='ACTIVE' and f['verify_jwt'] is False and isinstance(f['ezbr_sha256'],str) and re.fullmatch(r'[a-fA-F0-9]{64}',f['ezbr_sha256']),'Edge function lacks an active, JWT-disabled, verified artifact digest')
        f['ezbr_sha256']=f['ezbr_sha256'].lower()
    return sorted(functions,key=lambda f:f['slug'])

def collect(env):
    with connect(env,readonly=True) as c,c.transaction():
        c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        state=c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()
        require(state[0]==env and state[1:3]==(False,None),'Environment not an idle mirror')
        structure=schema_rows(c)
        migration=c.execute("SELECT version,name,md5(statements::text) FROM supabase_migrations.schema_migrations WHERE name LIKE 'squad_%' ORDER BY version").fetchall()
        cron=c.execute("SELECT jobname,schedule,replace(command,%s,'https://ENV.supabase.co'),active FROM cron.job WHERE jobname LIKE 'squad-%%' ORDER BY jobname",('https://'+PROJECTS[env]+'.supabase.co',)).fetchall()
        buckets=c.execute("SELECT id,public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id LIKE 'squad-%' ORDER BY id").fetchall()
        public=public_structure(c)
        flags=c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone()
        validate_runtime(flags)
        storage=c.execute("SELECT policyname,roles::text,cmd,qual,with_check FROM pg_policies WHERE schemaname='storage' AND (policyname LIKE 'canto_media_%' OR policyname LIKE 'canto_masters_%' OR policyname LIKE 'squad_%') ORDER BY 1").fetchall()
        extensions=c.execute("SELECT extname,extversion,extnamespace::regnamespace::text FROM pg_extension WHERE extname IN('pg_cron','pg_net','supabase_vault') ORDER BY 1").fetchall()
        database_collation=c.execute('SELECT datcollate,datctype,datlocprovider,datlocale,datcollversion FROM pg_database WHERE datname=current_database()').fetchall()
        require({row[0] for row in extensions}=={'pg_cron','pg_net','supabase_vault'},'Required runtime extension missing')
        auth_triggers=c.execute("SELECT t.tgname,pg_get_triggerdef(t.oid),t.tgenabled FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal AND n.nspname IN('sa_domain','sa_identity') ORDER BY 1").fetchall()
    functions=edge_artifacts(api(env,'/functions'))
    settings=api(env,'/postgrest')
    api_settings={'schemas':sorted(s.strip() for s in settings['db_schema'].split(',')),'max_rows':settings['max_rows']}
    require('canto_api' in api_settings['schemas'] and 'sa_domain' not in api_settings['schemas'] and 'sa_snapshot_20261019' not in api_settings['schemas'],'Unexpected private Data API exposure')
    return {'structure':structure,'migrations':migration,'cron':cron,'buckets':buckets,'storage_policies':storage,'functions':functions,'extensions':extensions,'database_collation':database_collation,'auth_triggers':auth_triggers,'api_settings':api_settings,'state':state,'flags':flags,'public_structure':public}

def main():
    data={env:collect(env) for env in ('staging','production')}
    differences={}
    for key in ('migrations','cron','buckets','storage_policies','functions','extensions','database_collation','auth_triggers','api_settings'):
        if data['staging'][key]!=data['production'][key]:differences[key]={'staging':data['staging'][key],'production':data['production'][key]}
    for key,values in data['staging']['structure'].items():
        other=data['production']['structure'][key]
        if values!=other:
            a={json.dumps(x,sort_keys=True,default=str) for x in values};b={json.dumps(x,sort_keys=True,default=str) for x in other}
            differences['structure.'+key]={'staging_only':[json.loads(x) for x in sorted(a-b)],'production_only':[json.loads(x) for x in sorted(b-a)]}
    path=ROOT/'tools/squad/private/mirror-parity-details.json';path.write_text(json.dumps(differences,indent=2,default=str)+'\n');path.chmod(0o600)
    report={'measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Squad/Canto backend schema, grants, RPCs, Edge artifacts, private buckets and schedules; no data refresh or cutover','equal':not differences,'application_artifacts_equal':not any(k!='extensions' for k in differences),'required_extension_versions_equal':'extensions' not in differences,'differences':{k:{side:len(rows) for side,rows in v.items()} for k,v in differences.items()},'environments':{env:{'schema_hashes':{k:digest(v) for k,v in d['structure'].items()},'migrations':len(d['migrations']),'last_migration':d['migrations'][-1][0],'functions':d['functions'],'mirror':not d['state'][1],'revision':list(d['state'][3:]),'test_writes_disabled':d['flags']==(False,[],None),'public_structure':d['public_structure']} for env,d in data.items()},'intentional_differences':['business data and Auth identities','environment-specific credentials and source endpoints','provider activation and deferred Uniware configuration','existing public-schema applications and unrelated Storage buckets']}
    (ROOT/'docs/squad-one-audit/implementation-evidence/backend-mirror-parity.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));return 0 if not differences else 1
if __name__=='__main__':raise SystemExit(main())
