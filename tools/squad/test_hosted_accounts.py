"""Controlled staging access test. Uses only the existing test customer and a
new disposable staff actor; no new legacy IDs/reservations or customer messages.
Persisted checkpoint holds restoration metadata, never passwords or tokens.
"""
import datetime,json,secrets,subprocess,sys,urllib.request,urllib.error,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
from management import api,PROJECTS
CHECKPOINT=ROOT/'tools/squad/private/accounts-checkpoint.json'
def run():
 assert not CHECKPOINT.exists(),'Recover existing account checkpoint first'
 credentials=json.loads((ROOT/'../Canto/canto-sync/private/auth-test.json').read_text())
 assert credentials['email'].endswith('@mailinator.com'),'Only the existing controlled customer is permitted'
 keys={x['name']:x['api_key'] for x in api('staging','/api-keys')};url='https://'+PROJECTS['staging']+'.supabase.co'
 def request(path,method='GET',body=None):
  r=urllib.request.Request(url+path,data=None if body is None else json.dumps(body).encode(),headers={'apikey':keys['service_role'],'Authorization':'Bearer '+keys['service_role'],'Content-Type':'application/json'},method=method)
  try:
   with urllib.request.urlopen(r,timeout=60) as response:return response.status,json.loads(response.read() or b'{}')
  except urllib.error.HTTPError as e:return e.code,json.loads(e.read() or b'{}')
 email='squad-account-'+uuid.uuid4().hex+'@example.invalid';password=secrets.token_urlsafe(40)
 with connect('staging') as c:
  env=c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();assert env[:3]==('staging',False,None) and env[3]==env[4]
  assert c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()[0]==0,'Existing work must not be dispatched by test'
  row=c.execute("SELECT u.id,m.auth_user_id,u.disabled,u.disabled_at,u.deleted_at,u.updated_at,a.banned_until,m.enrollment_state,a.encrypted_password=u.encrypted_password FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id JOIN auth.users a ON a.id=m.auth_user_id WHERE u.email=%s AND u.role=3 AND u.approved IS TRUE",(credentials['email'],)).fetchone()
  assert row and not row[2] and row[4] is None and row[6] is None and row[7]=='ready' and row[8],'Controlled account must start eligible with original password'
  target=row[0];version=c.execute("SELECT revision FROM sa_domain.entity_versions WHERE kind='person' AND entity_id=%s",(target,)).fetchone()
  assert not c.execute('SELECT FROM sa_domain.account_requests WHERE legacy_user_id=%s',(target,)).fetchone(),'Controlled target already has account work'
  generation=c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0];structure=public_structure(c)
  schedules=c.execute("SELECT jobid,active FROM cron.job WHERE jobname='squad-jobs-minute'").fetchall();assert len(schedules)==1
  state={'email':email,'target':target,'auth_id':str(row[1]),'disabled':row[2],'disabled_at':str(row[3]) if row[3] else None,'deleted_at':str(row[4]) if row[4] else None,'updated_at':str(row[5]),'revision':version[0] if version else None,'edit_revision':env[3],'generation':generation,'schedule_id':schedules[0][0],'schedule_active':schedules[0][1]}
  CHECKPOINT.write_text(json.dumps(state)+'\n');CHECKPOINT.chmod(0o600);code=None;output=''
  try:
   c.execute('INSERT INTO public.admin_emails(email) VALUES(%s)',(email,))
   status,user=request('/auth/v1/admin/users','POST',{'email':email,'password':password,'email_confirm':True,'app_metadata':{'squad_acceptance_fixture':True},'user_metadata':{'full_name':'Disposable Squad account acceptance'}})
   assert status in(200,201),'Disposable staff creation failed';actor=uuid.UUID(user['id']);state['actor_id']=str(actor);CHECKPOINT.write_text(json.dumps(state)+'\n')
   with c.transaction():
    assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
    c.execute('SELECT cron.alter_job(%s,active:=false)',(schedules[0][0],))
    c.execute('UPDATE sa_sync.environment_state SET cutover=true WHERE singleton')
   secret=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
   process=subprocess.Popen(['node','tools/squad/test_account_status_sdk.mjs'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
   payload={'url':url,'anon':keys['anon'],'staff':{'email':email,'password':password},'customer':credentials,'legacy_id':str(target),'version':str(generation)+':'+str(version[0] if version else 0),'worker_secret':secret}
   try:output,errors=process.communicate(json.dumps(payload),timeout=150)
   except subprocess.TimeoutExpired:process.kill();process.communicate();raise RuntimeError('Account test timed out; restore ownership')
   code=process.returncode
   if code:print(errors[-3500:],file=sys.stderr)
  finally:
   # Always close ownership first. No new domain work can start during cleanup.
   c.execute('UPDATE sa_sync.environment_state SET cutover=false WHERE singleton')
   actor=c.execute('SELECT id FROM auth.users WHERE email=%s',(email,)).fetchone()
   with c.transaction():
    assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0],'Concurrent work; preserve checkpoint'
    assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]==generation
    c.execute('UPDATE sa_snapshot_20261019.sa_users SET disabled=%s,disabled_at=%s,deleted_at=%s,updated_at=%s WHERE id=%s',(row[2],row[3],row[4],row[5],target))
    c.execute("UPDATE sa_identity.sa_auth_identities SET enrollment_state='ready' WHERE legacy_user_id=%s",(target,))
    c.execute("SELECT set_config('squad.source_enrollment','on',true)")
    c.execute('UPDATE auth.users SET banned_until=NULL WHERE id=%s',(row[1],))
    if actor:
     actor=actor[0];jobs=[x[0] for x in c.execute('SELECT id FROM sa_domain.outbox WHERE actor_id=%s',(actor,))]
     c.execute('DELETE FROM sa_domain.account_requests WHERE legacy_user_id=%s AND actor_id=%s',(target,actor))
     c.execute('DELETE FROM sa_domain.job_attempts WHERE job_id=ANY(%s::uuid[])',(jobs,))
     for table in ['outbox','audit','commands']:c.execute('DELETE FROM sa_domain.'+table+' WHERE actor_id=%s',(actor,))
    if version:c.execute("UPDATE sa_domain.entity_versions SET revision=%s WHERE kind='person' AND entity_id=%s",(version[0],target))
    else:c.execute("DELETE FROM sa_domain.entity_versions WHERE kind='person' AND entity_id=%s",(target,))
    current=c.execute('SELECT edit_revision FROM sa_sync.environment_state').fetchone()[0]
    # On incomplete acceptance leave a dirty revision for explicit recovery.
    if code==0:
     assert current==env[3]+4,'Unexpected concurrent edits; preserve revision/checkpoint'
     c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s WHERE singleton',(env[3],))
    c.execute('SELECT cron.alter_job(%s,active:=%s)',(schedules[0][0],schedules[0][1]))
   if actor:assert request('/auth/v1/admin/users/'+str(actor),'DELETE')[0]==200,'Staff cleanup failed'
   c.execute('DELETE FROM public.admin_emails WHERE email=%s',(email,))
   assert public_structure(c)==structure
   if code==0:CHECKPOINT.unlink()
  assert code==0,'Account journey failed; mirror restored, checkpoint retained for revision review'
  evidence=json.loads(output.strip());evidence.update(measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),fixture_cleanup_verified=True,public_structure_unchanged=True,mirror_restored=True)
  (ROOT/'docs/squad-one-audit/implementation-evidence/staging-account-status.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence))
if __name__=='__main__':run()
