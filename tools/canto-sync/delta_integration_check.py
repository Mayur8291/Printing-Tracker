#!/usr/bin/env python3
"""Staging-only verification of delta inserts, updates, deletes and rollback."""
import copy,json,os,sys,uuid,datetime
from pathlib import Path
from snapshot import ROOT,extract,fingerprint,require
from database import connect,verify,public_structure,staff_auth
from delta_sync import primary_keys,plan_delta,publish_delta,preflight_capacity,check_catalog
from sync import check_capture,save,log
os.umask(0o077)

def main(source_dir):
    source_dir=Path(source_dir).resolve();check_capture('staging',source_dir)
    original,model=extract(source_dir,'staging');manifest=copy.deepcopy(original)
    directory=ROOT/'private'/('delta_fixture_'+uuid.uuid4().hex[:10]);directory.mkdir(mode=0o700)
    fixture=directory/'source';fixture.mkdir(mode=0o700)
    for source in manifest['tables']:
        if source not in ['ar_internal_metadata','schema_migrations','users']:
            (fixture/(source+'.copy')).symlink_to(source_dir/(source+'.copy'))
    lines=(source_dir/'ar_internal_metadata.copy').read_bytes().splitlines(keepends=True)
    require(lines,'Missing metadata test row')
    first=lines[0][:-1].split(b'\t');first[1]=b'canto_fixture_update';lines[0]=b'\t'.join(first)+b'\n'
    extra=first.copy();extra[0]=b'canto_fixture_new_key';extra[1]=b'canto_fixture_insert';lines.append(b'\t'.join(extra)+b'\n')
    (fixture/'ar_internal_metadata.copy').write_bytes(b''.join(lines))
    manifest['tables']['ar_internal_metadata'].update(fingerprint(lines))
    lines=(source_dir/'schema_migrations.copy').read_bytes().splitlines(keepends=True)
    require(len(lines)>1,'Missing migration test row');lines=lines[1:]
    (fixture/'schema_migrations.copy').write_bytes(b''.join(lines))
    manifest['tables']['schema_migrations'].update(fingerprint(lines))
    lines=(source_dir/'users.copy').read_bytes().splitlines(keepends=True)
    columns=manifest['tables']['users']['columns']; id_pos=columns.index('id'); hash_pos=columns.index('encrypted_password')
    for i,line in enumerate(lines):
        fields=line[:-1].split(b'\t')
        if fields[id_pos]==b'7692':
            fields[hash_pos]=b'$2b$12$' + b'A'*53
            lines[i]=b'\t'.join(fields)+b'\n';break
    else:raise RuntimeError('Missing staging auth test account')
    (fixture/'users.copy').write_bytes(b''.join(lines))
    manifest['tables']['users'].update(fingerprint(lines))
    keys=primary_keys(model)
    with connect('staging') as conn:
        require(conn.execute('select pg_try_advisory_lock(20261107,1)').fetchone()[0],'Concurrent refresh')
        check_catalog(conn,'staging')
        with conn.transaction():
            conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            changes,totals,before=plan_delta(conn,manifest,keys,directory,fixture)
        require(totals['inserted']==1 and totals['updated']==2 and totals['deleted']==1,'Unexpected fixture delta')
        preflight_capacity('staging',totals['delta_bytes'])
        # Baseline the publication boundary, excluding unrelated account refreshes during planning.
        pub=public_structure(conn);staff=staff_auth(conn)
        sessions_before=dict(conn.execute("select id,md5(row_to_json(s)::text) from auth.sessions s where user_id=(select auth_user_id from sa_identity.sa_auth_identities where legacy_user_id=7692)"))
        auth_before=dict(conn.execute("select id,md5(row_to_json(u)::text) from auth.users u"))
        try:
            publish_delta(conn,'staging',manifest,keys,changes,directory,before,None,inject_failure=True)
            raise RuntimeError('Failure injection did not happen')
        except RuntimeError as exc:
            require(str(exc)=='Injected failure before publication commit','Unexpected test failure: '+str(exc))
        require(dict(conn.execute("select id,md5(row_to_json(s)::text) from auth.sessions s where user_id=(select auth_user_id from sa_identity.sa_auth_identities where legacy_user_id=7692)"))==sessions_before,'Session revocation did not roll back')
        require(dict(conn.execute("select id,md5(row_to_json(u)::text) from auth.users u"))==auth_before,'Auth changes did not roll back')
        verify(conn,'sa_snapshot_20261019',original,log);check_catalog(conn,'staging')
        require(public_structure(conn)==pub and staff_auth(conn)==staff,'Isolation failure')
        with connect('staging',readonly=True) as other:
            require(not other.execute('select pg_try_advisory_lock(20261107,1)').fetchone()[0],'Concurrent-run exclusion failed')
    result={'status':'passed','environment':'staging','finished_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'tests':['insert_update_delete_validated','forced_failure_rolled_back','all_table_contents_unchanged',
            'sequence_state_rolled_back','schema_and_constraints_unchanged','public_schema_unchanged',
            'staff_auth_unchanged','auth_password_change_rolled_back','concurrent_run_excluded'],'fixture_changes':totals}
    save(directory/'result.json',result);log('DELTA INTEGRATION PASSED '+str(directory/'result.json'))

if __name__=='__main__':
    try:main(sys.argv[1])
    except Exception as e:
        (ROOT/'private'/'last-delta-integration-error.txt').write_text(str(e))
        print('Delta integration failed: '+type(e).__name__,file=sys.stderr);sys.exit(1)
