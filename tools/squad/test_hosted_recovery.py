"""Controlled Mailinator recovery, with exact owned cleanup and an interruption checkpoint."""
import signal
import datetime,getpass,json,secrets,subprocess,sys,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
from management import api,PROJECTS
CHECKPOINT=ROOT/'tools/squad/private/recovery-checkpoint.json'
def deadline(_signum,_frame):raise TimeoutError("Controlled account acceptance exceeded five minutes")
def run():
 assert not CHECKPOINT.exists(),'Recover the existing checkpoint first'
 credentials=json.loads((ROOT/'../Canto/canto-sync/private/auth-test.json').read_text());assert credentials['email'].endswith('@mailinator.com')
 keys={x['name']:x['api_key'] for x in api('staging','/api-keys')};request_id=uuid.uuid4();ok=False;evidence=None;process=None
 with connect('staging') as c:
  env=c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();assert env[:3]==('staging',False,None) and env[3]==env[4]
  assert c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()[0]==0
  row=c.execute("SELECT u.id,m.auth_user_id,u.confirmed_at,u.updated_at,a.raw_app_meta_data,a.email_confirmed_at,a.encrypted_password=u.encrypted_password FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id JOIN auth.users a ON a.id=m.auth_user_id WHERE u.email=%s AND u.role=3 AND u.approved IS TRUE AND u.disabled IS NOT TRUE AND u.deleted_at IS NULL AND a.banned_until IS NULL",(credentials['email'],)).fetchone();assert row and row[6]
  target,auth=row[:2];assert not c.execute('SELECT FROM sa_domain.credential_states WHERE legacy_user_id=%s',(target,)).fetchone()
  assert not c.execute('SELECT FROM sa_domain.account_flows WHERE legacy_user_id=%s',(target,)).fetchone()
  version=c.execute("SELECT revision FROM sa_domain.entity_versions WHERE kind='person' AND entity_id=%s",(target,)).fetchone();generation=c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0];structure=public_structure(c)
  schedules=c.execute("SELECT jobid,active FROM cron.job WHERE jobname='squad-jobs-minute'").fetchall();assert len(schedules)==1
  state={'request_id':str(request_id),'target':target,'auth_id':str(auth),'confirmed_at':str(row[2]) if row[2] else None,'updated_at':str(row[3]),'app_metadata':row[4],'auth_confirmed_at':str(row[5]),'revision':version[0] if version else None,'edit_revision':env[3],'generation':generation,'schedule_id':schedules[0][0],'schedule_active':schedules[0][1]}
  CHECKPOINT.write_text(json.dumps(state)+'\n');CHECKPOINT.chmod(0o600)
  try:
   signal.signal(signal.SIGALRM,deadline);signal.alarm(300)
   with c.transaction():
    assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
    c.execute('SELECT cron.alter_job(%s,active:=false)',(schedules[0][0],));c.execute('UPDATE sa_sync.environment_state SET cutover=true WHERE singleton')
   secret=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
   payload={'url':'https://'+PROJECTS['staging']+'.supabase.co','anon':keys['anon'],'customer':credentials,'legacy_id':str(target),'request_id':str(request_id),'worker_secret':secret,'new_password':secrets.token_urlsafe(28),'native_password':secrets.token_urlsafe(28)}
   process=subprocess.Popen(['node','tools/squad/test_account_recovery_sdk.mjs'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
   process.stdin.write(json.dumps(payload)+'\n');process.stdin.flush()
   first=process.stdout.readline()
   if not first:raise RuntimeError('SDK preflight failed: '+process.stderr.read()[-1600:])
   progress=json.loads(first);assert progress['step']=='mail_ready';print('Controlled email delivered. Mailinator inbox: '+credentials['email'].split('@')[0],flush=True)
   code=getpass.getpass('Email proof code (hidden): ');assert len(code)==8 and code.isdecimal()
   process.stdin.write(json.dumps({'code':code})+'\n');process.stdin.flush();code=None
   last=process.stdout.readline();process.wait(timeout=90)
   if process.returncode:raise RuntimeError('SDK recovery failed: '+process.stderr.read()[-1800:])
   evidence=json.loads(last);assert evidence['step']=='complete';ok=True
  finally:
   signal.alarm(0)
   if process and process.poll() is None:process.kill();process.communicate()
   c.execute('UPDATE sa_sync.environment_state SET cutover=false WHERE singleton')
   with c.transaction():
    assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
    assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]==generation
    c.execute("SELECT set_config('squad.source_enrollment','on',true)")
    # Restore only this known test identity from its original source hash.
    c.execute('DELETE FROM auth.refresh_tokens WHERE user_id=%s',(str(auth),));c.execute('DELETE FROM auth.sessions WHERE user_id=%s',(auth,))
    from psycopg.types.json import Jsonb
    c.execute('UPDATE auth.users a SET encrypted_password=u.encrypted_password,raw_app_meta_data=%s,email_confirmed_at=%s FROM sa_snapshot_20261019.sa_users u WHERE a.id=%s AND u.id=%s',(Jsonb(row[4]),row[5],auth,target))
    c.execute('UPDATE sa_snapshot_20261019.sa_users SET confirmed_at=%s,updated_at=%s WHERE id=%s',(row[2],row[3],target))
    jobs=[x[0] for x in c.execute('SELECT id FROM sa_domain.outbox WHERE command_key=%s',(request_id,))]
    c.execute('DELETE FROM sa_domain.job_attempts WHERE job_id=ANY(%s::uuid[])',(jobs,))
    for table in ['outbox','audit']:c.execute('DELETE FROM sa_domain.'+table+' WHERE command_key=%s',(request_id,))
    c.execute('DELETE FROM sa_domain.credential_states WHERE legacy_user_id=%s',(target,));c.execute('DELETE FROM sa_domain.account_flows WHERE id=%s',(request_id,))
    if version:c.execute("UPDATE sa_domain.entity_versions SET revision=%s WHERE kind='person' AND entity_id=%s",(version[0],target))
    else:c.execute("DELETE FROM sa_domain.entity_versions WHERE kind='person' AND entity_id=%s",(target,))
    current=c.execute('SELECT edit_revision FROM sa_sync.environment_state').fetchone()[0]
    if ok:
     assert current==env[3]+2+(0 if row[2] else 1),'Unexpected concurrent edits; keep checkpoint'
     c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s WHERE singleton',(env[3],))
    c.execute('SELECT cron.alter_job(%s,active:=%s)',(schedules[0][0],schedules[0][1]))
   assert public_structure(c)==structure
   if ok:CHECKPOINT.unlink()
  assert ok,'Recovery failed; mirror restored, checkpoint retained'
  evidence.update(measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),fixture_cleanup_verified=True,original_password_restored=True,public_structure_unchanged=True,mirror_restored=True)
  (ROOT/'docs/squad-one-audit/implementation-evidence/staging-account-recovery.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence))
if __name__=='__main__':run()
