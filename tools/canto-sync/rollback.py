#!/usr/bin/env python3
"""Restore a locally retained Canto snapshot through the same verified delta path."""
import argparse,datetime,gzip,json,os,sys,uuid
from pathlib import Path
from snapshot import ROOT,require,fingerprint
from database import connect
from delta_sync import check_catalog,plan_delta,publish_delta,preflight_capacity
from sync import save,log
os.umask(0o077)

def rollback(environment,backup_dir):
    backup_dir=Path(backup_dir).resolve();manifest=json.loads((backup_dir/'manifest.json').read_text())
    require(manifest['environment']==environment,'Rollback environment mismatch')
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')+'_'+uuid.uuid4().hex[:6]
    directory=ROOT/'private'/(environment+'_rollback_'+stamp);directory.mkdir(mode=0o700)
    source_dir=directory/'source';source_dir.mkdir(mode=0o700)
    for source,t in manifest['tables'].items():
        with gzip.open(backup_dir/(source+'.copy.gz'),'rb') as inp,(source_dir/(source+'.copy')).open('wb') as out:
            for block in iter(lambda:inp.read(1024*1024),b''):out.write(block)
        with (source_dir/(source+'.copy')).open('rb') as inp:
            require(fingerprint(inp)=={'rows':t['rows'],'sha256':t['sha256']},'Rollback file mismatch: '+source)
    keys=manifest['primary_keys']
    audit={'environment':environment,'run_id':stamp,'operation':'rollback','source_backup':str(backup_dir)}
    with connect(environment) as conn:
        require(conn.execute('select pg_try_advisory_lock(20261107,1)').fetchone()[0],'Another refresh is running')
        if conn.execute("select to_regclass('sa_sync.environment_state')").fetchone()[0]:
            state=conn.execute('SELECT cutover,active_job FROM sa_sync.environment_state WHERE singleton').fetchone()
            require(not state[0] and state[1] is None,'Rollback blocked after cutover or during an active job')
        check_catalog(conn,environment)
        with conn.transaction():
            conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
            changes,totals,before=plan_delta(conn,manifest,keys,directory,source_dir)
        if changes:preflight_capacity(environment,totals['delta_bytes'])
        admin_file=backup_dir/'admin-state.json'
        admin_restore=json.loads(admin_file.read_text()) if admin_file.exists() else None
        result=publish_delta(conn,environment,manifest,keys,changes,directory,before,audit,admin_restore=admin_restore)
        save(directory/'rollback-report.json',{**audit,**result,'status':'success','changes':totals})
        log('ROLLBACK VERIFIED '+environment+' '+str(directory/'rollback-report.json'))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('environment',choices=['staging','production']);p.add_argument('backup_directory',type=Path)
    a=p.parse_args()
    try:rollback(a.environment,a.backup_directory)
    except Exception as e:
        (ROOT/'private'/'last-rollback-error.txt').write_text(str(e))
        print('Rollback failed or unconfirmed: '+type(e).__name__,file=sys.stderr);sys.exit(1)
