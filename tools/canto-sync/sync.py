#!/usr/bin/env python3
"""Explicit environment-scoped, one-way Scott database snapshot refresh."""
import datetime, json, os, subprocess
from pathlib import Path
from psycopg import sql
from snapshot import require,file_hash
from database import ident,protect_schema,SCHEMA,CONFIG
from management import PROJECTS

SOURCES={'production':('165.22.210.53','scott_international_backend_production'),
         'staging':('64.227.186.227','scott_international_backend_staging_v2')}
os.umask(0o077)

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def log(message):print(now()+' '+message,flush=True)
def save(path,value):Path(path).write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')

def capture(environment,directory):
    host,db=SOURCES[environment]
    require((CONFIG/'source_ed25519').stat().st_mode & 0o077 == 0,'SSH private key permissions must be 0600')
    started=now()
    command=['ssh','-T','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes',
        '-o','UserKnownHostsFile='+str(CONFIG/'known_hosts'),'-o','ConnectTimeout=20',
        '-o','ServerAliveInterval=15','-o','ServerAliveCountMax=4','-i',str(CONFIG/'source_ed25519'),'root@'+host]
    with (directory/'source.partial').open('wb') as out,(directory/'export.log').open('wb') as err:
        subprocess.run(command,stdout=out,stderr=err,check=True,timeout=1800)
    require((directory/'source.partial').stat().st_size>1000,'Empty source export')
    (directory/'source.partial').rename(directory/'source.dump')
    save(directory/'capture.json',{'environment':environment,'source_host':host,'database':db,
        'destination':PROJECTS[environment],'started_at':started,'finished_at':now(),
        'archive_sha256':file_hash(directory/'source.dump')})

def check_capture(environment,directory):
    c=json.loads((directory/'capture.json').read_text())
    require(c['environment']==environment and c['source_host']==SOURCES[environment][0]
        and c['database']==SOURCES[environment][1] and c['destination']==PROJECTS[environment],
        'Capture environment mismatch')
    require(c['archive_sha256']==file_hash(directory/'source.dump'),'Capture archive checksum mismatch')
    return c

def set_sequences(conn,namespace,manifest,model):
    increments=dict(conn.execute("select c.relname,s.seqincrement from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=%s",(namespace,)))
    commands=[]
    for state in manifest['sequences'].values():
        inc=increments[state['target']]
        next_value=state['value']+(inc if state['called'] else 0)
        # ALTER RESTART is transactional, unlike setval. Preserve the next value.
        commands.append(sql.SQL('ALTER SEQUENCE {} RESTART WITH {}').format(ident(namespace,state['target']),sql.Literal(next_value)))
    conn.execute(sql.SQL(';').join(commands))

def foreign_keys(conn,namespace):
    return conn.execute("""select c.relname,k.conname,pg_get_constraintdef(k.oid) from pg_constraint k
        join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
        where n.nspname=%s and k.contype='f' order by c.relname,k.conname""",(namespace,)).fetchall()

def inspect_external(conn):
    return conn.execute("""select n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid)
        from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
        join pg_class target on target.oid=k.confrelid join pg_namespace tn on tn.oid=target.relnamespace
        where k.contype='f' and tn.nspname=%s and n.nspname<>%s""",(SCHEMA,SCHEMA)).fetchall()

def preserve_reservations(conn):
    external=inspect_external(conn)
    for namespace,table,name,definition in external:
        require(namespace=='sa_identity' and table=='sa_auth_identities' and
            definition=='FOREIGN KEY (legacy_user_id) REFERENCES sa_snapshot_20261019.sa_users(id) ON DELETE RESTRICT',
            'Unreviewed external reference to snapshot')
        # Reservations are historical, including users later hard-deleted at source.
        # Bind their existence invariant to a retained key ledger, not the current snapshot.
        conn.execute('CREATE SCHEMA IF NOT EXISTS sa_sync')
        conn.execute('CREATE TABLE IF NOT EXISTS sa_sync.legacy_identity_keys (legacy_user_id bigint PRIMARY KEY)')
        conn.execute('INSERT INTO sa_sync.legacy_identity_keys SELECT legacy_user_id FROM sa_identity.sa_auth_identities ON CONFLICT DO NOTHING')
        protect_schema(conn,'sa_sync')
        conn.execute(sql.SQL('ALTER TABLE {} DROP CONSTRAINT {}').format(ident(namespace,table),sql.Identifier(name)))
        conn.execute(sql.SQL('ALTER TABLE {} ADD CONSTRAINT {} FOREIGN KEY (legacy_user_id) REFERENCES sa_sync.legacy_identity_keys(legacy_user_id) ON DELETE RESTRICT').format(ident(namespace,table),sql.Identifier(name)))
    require(not inspect_external(conn),'Unexpected remaining external FK')

def record_run(conn,audit,result):
    if audit is None:return
    conn.execute('CREATE SCHEMA IF NOT EXISTS sa_sync')
    conn.execute("""CREATE TABLE IF NOT EXISTS sa_sync.refresh_runs (
        run_id text PRIMARY KEY, environment text NOT NULL,
        committed_at timestamptz NOT NULL DEFAULT now(), report jsonb NOT NULL)""")
    protect_schema(conn,'sa_sync')
    from psycopg.types.json import Jsonb
    conn.execute('INSERT INTO sa_sync.refresh_runs(run_id,environment,report,committed_at) VALUES (%s,%s,%s,clock_timestamp())',
        (audit['run_id'],audit['environment'],Jsonb({**audit,**result,'status':'committed'})))

if __name__ == '__main__':
    raise SystemExit('Use refresh-staging or refresh-production (delta_sync.py).')
