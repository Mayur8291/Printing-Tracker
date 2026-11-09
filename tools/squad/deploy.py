"""Apply reviewed Squad migrations to staging, with an atomic isolation check.

Production is deliberately not an accepted argument. New migrations are first
executed and verified in a transaction that is rolled back by --check.
"""
import argparse,json,re,sys
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

def deploy(check=True,through=None):
    # Parallel implementation may have later, unfinished local migrations.
    # Release only a reviewed chronological prefix, never reorder migrations.
    require(through is None or re.fullmatch(r'[0-9]{14}',through),'Invalid migration cutoff')
    from release_mirror import source_projection, protected_data, security_check, environment_state
    with connect('staging') as c:
        check_catalog(c,'staging')
        with c.transaction():
            c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            require(c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0],'Refresh or writes active')
            # Cleanup reads environment_state before the outbox. Acquire the
            # strongest required lock in that same order before changing RLS,
            # avoiding an AccessShare -> AccessExclusive upgrade deadlock.
            c.execute('LOCK TABLE sa_sync.environment_state IN ACCESS EXCLUSIVE MODE')
            require(c.execute('SELECT environment FROM sa_sync.environment_state WHERE singleton').fetchone()[0]=='staging','Unexpected environment')
            before=public_structure(c)
            _, source_tables = source_projection(c)
            protected_before = protected_data(c, source_tables)
            ownership_before = environment_state(c, 'staging')
            applied=[]
            for path in sorted((ROOT/'supabase/migrations').glob('*_squad_*.sql')):
                version,name=path.stem.split('_',1);body=path.read_text()
                if through is not None and version>through:continue
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
            # One shared guard is used by staging and production releases.
            security_check(c)
            require(protected_data(c, source_tables) == protected_before, 'Protected source/Auth/public/media data changed')
            require(environment_state(c, 'staging') == ownership_before, 'Staging ownership or revisions changed')
            reviewed_catalog=catalog(c);reviewed_access=access_catalog(c)
            print(json.dumps({'environment':'staging','migrations':applied,'public_structure_unchanged':True,'mode':'rollback verification' if check else 'apply'}))
            if check:raise psycopg.Rollback()
        if not check:
            for suffix,value in [('catalog',reviewed_catalog),('domain-access',reviewed_access)]:
                (ROOT/'tools/canto-sync/baselines'/f'staging-{suffix}.json').write_text(json.dumps(value,indent=2)+'\n')
            check_catalog(c,'staging')
            print('Staging migrations and reviewed refresh fingerprints verified')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--apply',action='store_true');parser.add_argument('--through',help='Last reviewed migration timestamp (inclusive)');args=parser.parse_args()
    deploy(check=not args.apply,through=args.through)
