#!/usr/bin/env python3
"""One-way refresh: full local comparison, bounded row deltas, atomic publication."""
import argparse,copy,datetime,gzip,hashlib,json,os,re,sys,uuid
from pathlib import Path
from psycopg import sql
from pglast import ast
from snapshot import ROOT,extract,require,file_hash
from database import connect,ident,cols,content,verify,verify_sequences,sequence_state,public_structure,staff_auth,analyze_snapshot,SCHEMA
from management import api,PROJECTS
from auth_sync import enroll
import media_sync
import domain_sync
from sync import capture,check_capture,save,log,set_sequences,preserve_reservations,foreign_keys,record_run
os.umask(0o077)

def catalog(conn):
    statements=[
        "select c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname=%s and c.relkind='r' and a.attnum>0 and not a.attisdropped order by 1,a.attnum",
        "select c.relname,k.conname,pg_get_constraintdef(k.oid) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=%s order by 1,2",
        "select tablename,indexname,indexdef from pg_indexes where schemaname=%s order by 1,2",
        "select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=%s and c.relkind='r' order by 1",
        "select c.relname,t.tgname,pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=%s and not t.tgisinternal order by 1,2"
    ]
    return [conn.execute(q,(SCHEMA,)).fetchall() for q in statements]

def check_catalog(conn,environment):
    expected=json.loads((ROOT/'baselines'/(environment+'-catalog.json')).read_text())
    current=json.loads(json.dumps(catalog(conn)))
    require(current==expected,'Destination schema/access drift: review before refresh')
    domain_sync.check_access_catalog(conn,environment)

def primary_keys(model):
    result={}
    for s in model.source:
        if isinstance(s,ast.AlterTableStmt):
            for cmd in s.cmds:
                if cmd.subtype.name=='AT_AddConstraint' and cmd.def_.contype.name=='CONSTR_PRIMARY':
                    result[s.relation.relname]=[k.sval for k in cmd.def_.keys]
    require(set(result)==set(model.tables),'Missing source primary key')
    return result

def copy_lines(conn,table,columns):
    tail=b''
    with conn.cursor().copy(sql.SQL('COPY (SELECT {} FROM {}) TO STDOUT').format(cols(columns),ident(SCHEMA,table))) as stream:
        for block in stream:
            chunks=(tail+bytes(block)).split(b'\n');tail=chunks.pop()
            for row in chunks:yield row+b'\n'
    require(not tail,'Truncated destination COPY')

def keyed(line,positions):
    values=line[:-1].split(b'\t')
    return b'\t'.join(values[p] for p in positions)

def plan_delta(conn,manifest,keys,directory,source_dir):
    backup=directory/'before';backup.mkdir(mode=0o700)
    before={'environment':manifest['environment'],'tables':{},'sequences':sequence_state(conn,SCHEMA,manifest),
        'primary_keys':keys}
    changes={};totals={'inserted':0,'updated':0,'deleted':0,'delta_bytes':0}
    for i,(source,t) in enumerate(manifest['tables'].items(),1):
        positions=[t['columns'].index(k) for k in keys[source]]
        source_file=source_dir/(source+'.copy')
        require(source_file.stat().st_size<512*1024*1024,'Table exceeds bounded local comparison memory budget')
        rows={}
        with source_file.open('rb') as inp:
            for line in inp:
                key=keyed(line,positions)
                require(key not in rows,'Duplicate source primary key')
                rows[key]=line
        deleted=[];hashes=[];inserted=set(rows);updated=set()
        with gzip.open(backup/(source+'.copy.gz'),'wb') as out:
            for line in copy_lines(conn,t['target'],t['columns']):
                out.write(line);hashes.append(hashlib.sha256(line).digest())
                key=keyed(line,positions)
                if key not in rows:deleted.append(key+b'\n')
                else:
                    inserted.discard(key)
                    if line!=rows[key]:updated.add(key)
        hashes.sort();before['tables'][source]={**t,'rows':len(hashes),'sha256':hashlib.sha256(b''.join(hashes)).hexdigest()}
        write_keys=inserted|updated
        if write_keys or deleted:
            with (directory/(source+'.delta')).open('wb') as out:
                for key in sorted(write_keys):out.write(rows[key])
            (directory/(source+'.deleted')).write_bytes(b''.join(sorted(deleted)))
            changes[source]={'inserted':len(inserted),'updated':len(updated),'deleted':len(deleted)}
            for k in ['inserted','updated','deleted']:totals[k]+=changes[source][k]
            totals['delta_bytes']+=(directory/(source+'.delta')).stat().st_size+(directory/(source+'.deleted')).stat().st_size
        if i%15==0:log('compared '+str(i)+'/86 tables; rollback data saved locally')
    if conn.execute("select to_regclass('sa_sync.environment_state')").fetchone()[0]:
        save(backup/'admin-state.json',{'media':conn.execute("SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') FROM sa_admin.media m").fetchone()[0],
            'extras':conn.execute("SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM sa_admin.record_extras e").fetchone()[0],
            'state':conn.execute('SELECT to_jsonb(s) FROM sa_sync.environment_state s WHERE singleton').fetchone()[0]})
    media_sync.backup_state(conn,backup)
    save(backup/'manifest.json',before)
    return changes,totals,before

def preflight_capacity(environment,delta_bytes):
    metrics=api(environment,'/config/disk/util')['metrics']
    # WAL overhead and temp rows need reserve even when the database itself is small.
    required=max(256*1024*1024,delta_bytes*12+128*1024*1024)
    require(metrics['fs_avail_bytes']>=required,
        'Insufficient reported free disk for bounded delta; free generated artifacts or resize before retry')
    return {'available_bytes':metrics['fs_avail_bytes'],'required_reserve_bytes':required}

def apply_changes(conn,manifest,keys,changes,directory):
    if changes:
        fks=foreign_keys(conn,SCHEMA)
        require(len(fks)==150,'Unexpected FK inventory')
        require(all('ON DELETE RESTRICT' not in d and 'ON UPDATE RESTRICT' not in d for _,_,d in fks),'Non-deferrable referential action requires review')
        conn.execute(sql.SQL(';').join(sql.SQL('ALTER TABLE {} ALTER CONSTRAINT {} DEFERRABLE INITIALLY DEFERRED').format(ident(SCHEMA,t),sql.Identifier(n)) for t,n,_ in fks))
        for index,(source,counts) in enumerate(changes.items()):
            t=manifest['tables'][source];table=ident(SCHEMA,t['target']);keycols=keys[source]
            temp='canto_delta_'+str(index);deleted='canto_deleted_'+str(index)
            conn.execute(sql.SQL('CREATE TEMP TABLE {} (LIKE {} INCLUDING DEFAULTS) ON COMMIT DROP').format(sql.Identifier(temp),table))
            with conn.cursor().copy(sql.SQL('COPY {} ({}) FROM STDIN').format(sql.Identifier(temp),cols(t['columns']))) as out:
                with (directory/(source+'.delta')).open('rb') as inp:
                    for chunk in iter(lambda:inp.read(1024*1024),b''):out.write(chunk)
            if counts['inserted']+counts['updated']:
                updates=[c for c in t['columns'] if c not in keycols]
                conflict=(sql.SQL('DO UPDATE SET ')+sql.SQL(',').join(sql.SQL('{}=EXCLUDED.{}').format(sql.Identifier(c),sql.Identifier(c)) for c in updates)) if updates else sql.SQL('DO NOTHING')
                conn.execute(sql.SQL('INSERT INTO {} ({}) SELECT {} FROM {} WHERE true ON CONFLICT ({}) ').format(table,cols(t['columns']),cols(t['columns']),sql.Identifier(temp),cols(keycols))+conflict)
            if counts['deleted']:
                conn.execute(sql.SQL('CREATE TEMP TABLE {} ON COMMIT DROP AS SELECT {} FROM {} WITH NO DATA').format(sql.Identifier(deleted),cols(keycols),table))
                with conn.cursor().copy(sql.SQL('COPY {} FROM STDIN').format(sql.Identifier(deleted))) as out:
                    out.write((directory/(source+'.deleted')).read_bytes())
                condition=sql.SQL(' AND ').join(sql.SQL('t.{}=d.{}').format(sql.Identifier(k),sql.Identifier(k)) for k in keycols)
                conn.execute(sql.SQL('DELETE FROM {} t USING {} d WHERE ').format(table,sql.Identifier(deleted))+condition)
        conn.execute('SET CONSTRAINTS ALL IMMEDIATE')
        conn.execute(sql.SQL(';').join(sql.SQL('ALTER TABLE {} ALTER CONSTRAINT {} NOT DEFERRABLE INITIALLY IMMEDIATE').format(ident(SCHEMA,t),sql.Identifier(n)) for t,n,_ in fks))
    set_sequences(conn,SCHEMA,manifest,None)

def publish_delta(conn,environment,manifest,keys,changes,run_dir,before,audit,inject_failure=False,admin_revision=None,admin_restore=None,progress=None,prepared_media=None):
    check_catalog(conn,environment)
    with conn.transaction():
        # Compare our own effects against one MVCC snapshot. Independent staff sign-ins
        # may update last_sign_in_at while this transaction verifies the imported data.
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
        domain_sync.before_publication(conn,admin_revision,admin_restore is not None)
        pub=public_structure(conn);staff=staff_auth(conn)
        # Auth signs in by locking its user before the deferred guard reads the snapshot.
        # Follow that ordering to avoid a login/refresh deadlock; staff rows are excluded.
        conn.execute('SELECT a.id FROM auth.users a JOIN sa_identity.sa_auth_identities m ON m.auth_user_id=a.id ORDER BY a.id FOR UPDATE OF a').fetchall()
        targets=sql.SQL(',').join(ident(SCHEMA,t['target']) for t in manifest['tables'].values())
        conn.execute(sql.SQL('LOCK TABLE {} IN ACCESS EXCLUSIVE MODE').format(targets))
        # Detect any target-side edits since comparison. Never silently overwrite a concurrent edit.
        verify(conn,SCHEMA,before,log)
        preserve_reservations(conn)
        apply_changes(conn,manifest,keys,changes,run_dir)
        verify(conn,SCHEMA,manifest,log)
        check_catalog(conn,environment)
        if progress:progress('syncing_auth',{})
        auth_result=enroll(conn)
        if progress:progress('verifying',{})
        if admin_restore is not None:
            from psycopg.types.json import Jsonb
            conn.execute('DELETE FROM sa_admin.record_extras')
            conn.execute('INSERT INTO sa_admin.record_extras SELECT * FROM jsonb_populate_recordset(NULL::sa_admin.record_extras,%s)',(Jsonb(admin_restore.get('extras',[])),))
            conn.execute('DELETE FROM sa_admin.media')
            conn.execute('INSERT INTO sa_admin.media SELECT * FROM jsonb_populate_recordset(NULL::sa_admin.media,%s)',(Jsonb(admin_restore['media']),))
            conn.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s,updated_at=now() WHERE singleton',(admin_restore['state']['edit_revision'],admin_restore['state']['synced_revision']))
        elif admin_revision is not None:
            # Companion fields/uploads are new-side edits too. Snapshot publication replaces them.
            conn.execute('DELETE FROM sa_admin.record_extras')
            conn.execute('DELETE FROM sa_admin.media')
            conn.execute('UPDATE sa_sync.environment_state SET synced_revision=edit_revision,updated_at=now() WHERE singleton AND edit_revision=%s',(admin_revision,))
        if prepared_media is not None:media_sync.publish(conn,prepared_media)
        domain_result=domain_sync.after_publication(conn)
        require(public_structure(conn)==pub,'Public schema changed during refresh')
        require(staff_auth(conn)==staff,'Existing staff Auth records changed during refresh')
        if inject_failure:raise RuntimeError('Injected failure before publication commit')
        result={'auth_enrollment':auth_result,'public_schema_unchanged':True,'public_schema_sha256':pub,'staff_auth_unchanged':True,
            'existing_staff_auth_count':len(staff),'rollback_directory':str(run_dir/'before'),
            'unchanged':not changes,'table_content':manifest['tables']}
        if prepared_media is not None:result['media']=prepared_media['summary']
        if domain_result is not None:result['domain']=domain_result
        result['planner_statistics_tables']=analyze_snapshot(conn)
        record_run(conn,audit,result)
    return result

def run(environment,reuse=None,inject_failure=False,progress=None,backup=None,discard_revision=None,job_id=None):
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')+'_'+uuid.uuid4().hex[:6]
    directory=ROOT/'private'/(environment+'_'+stamp);directory.mkdir(parents=True,mode=0o700)
    source_dir=Path(reuse).resolve() if reuse else directory
    report={'environment':environment,'operation':'refresh','run_id':stamp,'job_id':job_id,'status':'started'}
    path=directory/('report_'+stamp+'.json');save(path,report)
    try:
        with connect(environment) as conn:
            require(conn.execute('select pg_try_advisory_lock(20261107,1)').fetchone()[0],'Another refresh is running')
            admin_revision=None
            if conn.execute("select to_regclass('sa_sync.environment_state')").fetchone()[0]:
                state=conn.execute('select edit_revision,synced_revision,cutover,active_job from sa_sync.environment_state where singleton').fetchone()
                require(not state[2],'Old-system refresh is disabled after cutover')
                require(state[3] is None or str(state[3])==str(job_id),'Another refresh job is active')
                require(state[0]==state[1] or state[0]==discard_revision,'Supabase has local edits; explicit replacement confirmation is required')
                admin_revision=state[0]
            if progress:progress('capturing',{'run_id':stamp})
            if not reuse:capture(environment,directory)
            capture_info=check_capture(environment,source_dir)
            if progress:progress('validating',{})
            manifest,model=extract(source_dir,environment);keys=primary_keys(model)
            report.update(capture=capture_info,tables=len(manifest['tables']),rows=sum(t['rows'] for t in manifest['tables'].values()),
                users=manifest['tables']['users']['rows'],archive_sha256=manifest['archive_sha256'],source_schema_sha256=manifest['schema_sha256'],auth_enrollment='pending')
            save(path,report)
            check_catalog(conn,environment)
            if progress:progress('comparing',{})
            with conn.transaction():
                conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
                changes,totals,before=plan_delta(conn,manifest,keys,directory,source_dir)
            report['changes']=totals;report['changed_tables']=changes
            if changes:report['capacity']=preflight_capacity(environment,totals['delta_bytes'])
            log('delta planned: '+json.dumps(totals))
            if backup:
                if progress:progress('backing_up',{'changes':totals})
                report['backup']=backup(conn,directory,report)
            if progress:progress('copying_media',{})
            prepared_media=media_sync.prepare(conn,environment,source_dir,manifest,progress)
            save(directory/'media-manifest.json',prepared_media)
            report['media']=prepared_media['summary']
            if progress:progress('applying',{'changes':totals,'media':report['media']})
            result=publish_delta(conn,environment,manifest,keys,changes,directory,before,report,inject_failure,admin_revision,progress=progress,prepared_media=prepared_media)
            report.update(result,status='success',finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
            save(path,report);log('SUCCESS '+environment+'; '+str(path))
            if progress:progress('verified',{'changes':totals,'auth_enrollment':result['auth_enrollment']})
    except Exception as exc:
        report.update(status='failed_or_unconfirmed',failure_type=type(exc).__name__)
        save(path,report);(directory/'error.txt').write_text(str(exc));raise
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('environment',choices=sorted(PROJECTS));p.add_argument('--reuse-capture',type=Path)
    p.add_argument('--test-fail-before-commit',action='store_true')
    p.add_argument('--discard-local-edits-at-revision',type=int)
    a=p.parse_args()
    try:run(a.environment,a.reuse_capture,a.test_fail_before_commit,discard_revision=a.discard_local_edits_at_revision)
    except Exception as e:
        print('FAILED OR UNCONFIRMED: '+type(e).__name__+'. Inspect the private run diagnostic and commit journal.',file=sys.stderr)
        sys.exit(1)
