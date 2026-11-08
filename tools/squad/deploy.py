"""Apply reviewed Squad migrations to staging, with an atomic isolation check.

Production is deliberately not an accepted argument. New migrations are first
executed and verified in a transaction that is rolled back by --check.
"""
import argparse,json,sys
from pathlib import Path
from pglast import parse_sql,ast
from pglast.stream import RawStream
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/canto-sync'))
import psycopg
from database import connect,public_structure
from delta_sync import catalog,check_catalog
from domain_sync import access_catalog
from snapshot import require

def statements(body):
    for item in parse_sql(body):
        if isinstance(item.stmt,ast.TransactionStmt):
            require(item.stmt.kind.name in ('TRANS_STMT_BEGIN','TRANS_STMT_COMMIT'),'Unexpected transaction command')
            continue
        yield RawStream()(item.stmt)

def deploy(check=True):
    with connect('staging') as c:
        check_catalog(c,'staging')
        with c.transaction():
            c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            require(c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0],'Refresh or writes active')
            require(c.execute('SELECT environment FROM sa_sync.environment_state WHERE singleton').fetchone()[0]=='staging','Unexpected environment')
            before=public_structure(c)
            applied=[]
            for path in sorted((ROOT/'supabase/migrations').glob('*_squad_*.sql')):
                version,name=path.stem.split('_',1);body=path.read_text()
                require(bool(list(statements(body))),'Empty migration: '+path.name)
                old=c.execute('SELECT statements FROM supabase_migrations.schema_migrations WHERE version=%s',(version,)).fetchone()
                if old:
                    require(old[0]==[body],'Previously applied migration changed: '+path.name);continue
                for statement in statements(body):
                    try:c.execute(statement)
                    except psycopg.Error:
                        print('Failed DDL:',statement.split(' AS ')[0][:180],file=sys.stderr)
                        raise
                c.execute('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(%s,%s,%s)',(version,name,[body]))
                applied.append(path.name)
            require(public_structure(c)==before,'Printing Tracker public structure changed')
            require(not c.execute("""SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='sa_domain' AND
              ((p.prosecdef AND (r.rolsuper OR r.rolbypassrls) AND p.oid NOT IN('sa_domain.auth_context()'::regprocedure,'sa_domain.revoke_account_sessions(bigint)'::regprocedure)) OR (has_function_privilege('anon',p.oid,'EXECUTE') AND p.oid<>'sa_domain.v1_app_bootstrap(text,text)'::regprocedure))""").fetchone(),'Unsafe function privileges')
            reviewed_catalog=catalog(c);reviewed_access=access_catalog(c)
            print(json.dumps({'environment':'staging','migrations':applied,'public_structure_unchanged':True,'mode':'rollback verification' if check else 'apply'}))
            if check:raise psycopg.Rollback()
        if not check:
            for suffix,value in [('catalog',reviewed_catalog),('domain-access',reviewed_access)]:
                (ROOT/'tools/canto-sync/baselines'/f'staging-{suffix}.json').write_text(json.dumps(value,indent=2)+'\n')
            check_catalog(c,'staging')
            print('Staging migrations and reviewed refresh fingerprints verified')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    deploy(check=not args.apply)
