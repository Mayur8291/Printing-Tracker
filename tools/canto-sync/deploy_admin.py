"""Deploy only Canto's reviewed administration migrations and controller to an explicit project."""
import argparse,json,os,subprocess
from pathlib import Path
from database import connect
from management import api,query,token,PROJECTS
from snapshot import require
ROOT=Path(__file__).resolve().parents[2]
MIGRATIONS=['20261107045242_canto_admin_masters','20261107050603_canto_refresh_jobs','20261107060300_canto_staff_login_guard']

def preflight(environment):
    rows=query(environment,"SELECT c.relname,a.attname,format_type(a.atttypid,NULL) AS type FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='sa_snapshot_20261019' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped")
    columns={(r['relname'],r['attname']):r['type'] for r in rows}
    contracts=json.loads((ROOT/'tools/canto-sync/master-contracts.json').read_text())
    for resource,spec in contracts.items():
        for column,expected in spec['columns'].items():
            require(columns.get(('sa_'+resource,column))==expected['type'],'Incompatible destination column: '+resource+'.'+column)
    print(environment+': all 24 master/option table contracts are compatible.')

def deploy(environment,check_only=False):
    preflight(environment)
    if check_only:return
    github=os.environ.get('CANTO_GITHUB_TOKEN') or subprocess.check_output(['gh','auth','token'],text=True).strip()
    require(bool(github),'GitHub dispatch credential required')
    with connect(environment) as conn:
        with conn.transaction():
            require(conn.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0],'A refresh or edit is active; retry deployment later')
            for migration in MIGRATIONS:
                version,name=migration.split('_',1);body=(ROOT/'supabase/migrations'/(migration+'.sql')).read_text()
                previous=conn.execute('SELECT statements FROM supabase_migrations.schema_migrations WHERE version=%s',(version,)).fetchone()
                if previous:
                    require(previous[0]==[body],'Applied migration differs; create a new migration instead: '+version)
                else:
                    conn.execute(body)
                    conn.execute('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(%s,%s,%s)',(version,name,[body]))
            conn.execute('UPDATE sa_sync.environment_state SET environment=%s WHERE singleton',(environment,))
    settings=api(environment,'/postgrest');schemas=[s.strip() for s in settings['db_schema'].split(',')]
    if 'canto_api' not in schemas:api(environment,'/postgrest',{'db_schema':','.join(schemas+['canto_api'])},method='PATCH')
    api(environment,'/secrets',[{'name':'CANTO_GITHUB_TOKEN','value':github},{'name':'CANTO_WORKFLOW_REF','value':'main' if environment=='production' else 'develop'}])
    result=subprocess.run(['supabase','functions','deploy','canto-refresh','--project-ref',PROJECTS[environment],'--use-api','--no-verify-jwt'],cwd=ROOT,env={**os.environ,'SUPABASE_ACCESS_TOKEN':token()},capture_output=True,text=True)
    require(result.returncode==0,'Edge Function deployment failed; database migrations are recorded. Retry the same command after checking CLI access.')
    print(environment+': Canto administration migrations recorded, API schema configured, controller deployed.')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('environment',choices=PROJECTS);p.add_argument('--check',action='store_true');a=p.parse_args();deploy(a.environment,a.check)
