"""Destination connections and verification. No public-schema DML."""
from pathlib import Path
import hashlib,json,os,threading,time
import psycopg
from psycopg import sql
from management import api, PROJECTS
from snapshot import require

SCHEMA='sa_snapshot_20261019'
CONFIG=Path(os.environ.get('CANTO_SYNC_CONFIG_DIR',str(Path.home()/'.config/canto-sync')))

_connection_lock=threading.Lock()
_credentials={}

def connect(environment, readonly=False):
    with _connection_lock:
        for attempt in range(3):
            try: return _connect(environment,readonly)
            except psycopg.OperationalError:
                _credentials.pop((environment,readonly),None)
                if attempt==2: raise
                time.sleep(1)

def _connect(environment, readonly=False):
    require(hashlib.sha256((CONFIG/'prod-supabase.cer').read_bytes()).hexdigest()==
        '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7','Unexpected Supabase CA certificate')
    cache=_credentials.get((environment,readonly))
    if not cache or time.monotonic()-cache[0]>600:
        cache=(time.monotonic(),api(environment,'/cli/login-role',{'read_only':readonly}))
        _credentials[(environment,readonly)]=cache
    credentials=cache[1]
    pools=api(environment,'/config/database/pooler')
    pool=next(p for p in pools if p['database_type']=='PRIMARY')
    conn=psycopg.connect(host=pool['db_host'],port=5432,dbname='postgres',
        user=credentials['role']+'.'+PROJECTS[environment],password=credentials['password'],
        sslmode='verify-full',sslrootcert=str(CONFIG/'prod-supabase.cer'),
        connect_timeout=20,application_name='canto-one-way-sync',autocommit=True)
    conn.execute('SET ROLE supabase_read_only_user' if readonly else 'SET ROLE postgres')
    conn.execute("SET search_path=pg_catalog")
    conn.execute("SET timezone='UTC'")
    conn.execute("SET datestyle='ISO, MDY'")
    conn.execute("SET intervalstyle='postgres'")
    conn.execute('SET extra_float_digits=3')
    conn.execute("SET statement_timeout='20min'")
    conn.execute("SET lock_timeout='15s'")
    return conn

def ident(schema,table):return sql.Identifier(schema,table)
def cols(names):return sql.SQL(',').join(map(sql.Identifier,names))

def protect_schema(conn,schema):
    commands=[]
    for clause in ['SCHEMA','ALL TABLES IN SCHEMA','ALL SEQUENCES IN SCHEMA']:
        commands.append(sql.SQL('REVOKE ALL ON '+clause+' {} FROM PUBLIC,anon,authenticated').format(sql.Identifier(schema)))
        if conn.execute("select 1 from pg_roles where rolname='sa_app'").fetchone():
            commands.append(sql.SQL('REVOKE ALL ON '+clause+' {} FROM sa_app').format(sql.Identifier(schema)))
    tables=conn.execute("select tablename from pg_tables where schemaname=%s",(schema,)).fetchall()
    for (table,) in tables:
        commands.append(sql.SQL('ALTER TABLE {} ENABLE ROW LEVEL SECURITY').format(ident(schema,table)))
    conn.execute(sql.SQL(';').join(commands))

def content(conn,schema,table,columns):
    hashes=[];tail=b''
    with conn.cursor().copy(sql.SQL('COPY (SELECT {} FROM {}) TO STDOUT').format(cols(columns),ident(schema,table))) as stream:
        for block in stream:
            chunks=(tail+bytes(block)).split(b'\n');tail=chunks.pop()
            hashes.extend(hashlib.sha256(row+b'\n').digest() for row in chunks)
    require(not tail,'Incomplete COPY response')
    hashes.sort()
    return {'rows':len(hashes),'sha256':hashlib.sha256(b''.join(hashes)).hexdigest()}

def verify(conn,schema,manifest,progress=None):
    actual={r[0] for r in conn.execute("select tablename from pg_tables where schemaname=%s",(schema,))}
    require(actual=={t['target'] for t in manifest['tables'].values()},'Unexpected destination table inventory')
    results={}
    for i,(source,t) in enumerate(manifest['tables'].items(),1):
        got=content(conn,schema,t['target'],t['columns'])
        require(got=={'rows':t['rows'],'sha256':t['sha256']},'Full content mismatch: '+source)
        results[source]=got
        if progress and i%15==0:progress('verified '+str(i)+'/'+str(len(actual))+' tables')
    bad=conn.execute("""select count(*) from pg_constraint k join pg_class c on c.oid=k.conrelid
        join pg_namespace n on n.oid=c.relnamespace where n.nspname=%s and not k.convalidated""",(schema,)).fetchone()[0]
    require(bad==0,'Unvalidated destination constraints')
    exposed=conn.execute("""select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname=%s and c.relkind='r' and (not c.relrowsecurity or
        has_table_privilege('anon',c.oid,'SELECT') or has_table_privilege('authenticated',c.oid,'SELECT'))""",(schema,)).fetchone()[0]
    require(exposed==0,'Imported tables unexpectedly exposed')
    verify_sequences(conn,schema,manifest)
    return results

def sequence_state(conn,schema,manifest):
    parts=[]
    for state in manifest['sequences'].values():
        parts.append(sql.SQL('SELECT {}::text AS name,last_value,is_called FROM {}').format(
            sql.Literal(state['target']),ident(schema,state['target'])))
    return {name:{'value':value,'called':called,'target':name}
            for name,value,called in conn.execute(sql.SQL(' UNION ALL ').join(parts))}

def verify_sequences(conn,schema,manifest):
    states=sequence_state(conn,schema,manifest)
    increments=dict(conn.execute("select c.relname,s.seqincrement from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=%s",(schema,)))
    for expected in manifest['sequences'].values():
        actual=states[expected['target']];inc=increments[expected['target']]
        require(actual['value']+(inc if actual['called'] else 0)==expected['value']+(inc if expected['called'] else 0),'Sequence next-value mismatch')

def public_structure(conn):
    # No volatile OIDs or live application row data. Covers definitions, grants and RLS.
    records=conn.execute("""
    select 'relation' kind,c.relname name,jsonb_build_object('kind',c.relkind,'rls',c.relrowsecurity,
      'force_rls',c.relforcerowsecurity,'acl',c.relacl::text,'owner',pg_get_userbyid(c.relowner))::text value
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    union all select 'column',c.relname||'.'||a.attname, jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),
      'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid))::text
      from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
      left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
      where n.nspname='public' and a.attnum>0 and not a.attisdropped
    union all select 'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
      pg_get_functiondef(p.oid)||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind in ('f','p')
    union all select 'constraint',c.relname||'.'||k.conname,pg_get_constraintdef(k.oid)
      from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    union all select 'policy',tablename||'.'||policyname,row_to_json(p)::text from pg_policies p where schemaname='public'
    union all select 'trigger',c.relname||'.'||t.tgname,pg_get_triggerdef(t.oid)||t.tgenabled::text
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and not t.tgisinternal
    order by 1,2,3
    """).fetchall()
    return hashlib.sha256(json.dumps(records).encode()).hexdigest()

def staff_auth(conn):
    return {str(i):digest for i,digest in conn.execute("select id,md5(row_to_json(u)::text) from auth.users u where role is distinct from 'sa_app'")}
