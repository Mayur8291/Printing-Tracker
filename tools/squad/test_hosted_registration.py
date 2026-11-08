"""New-account hosted acceptance, using a far-out test ID and an owned sequence checkpoint.

A blocked immutable identity reservation remains intentionally after fixture cleanup;
source/business/Auth rows are removed. Never delete/disable the reservation guard.
"""
import signal
import datetime,getpass,json,os,secrets,subprocess,sys,uuid,urllib.request,urllib.error
from pathlib import Path
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
from management import api,PROJECTS,token
CHECKPOINT=ROOT/'tools/squad/private/registration-checkpoint.json';TEST_ID=9000000000000000

def deadline(_signum,_frame):raise TimeoutError("Controlled account acceptance exceeded five minutes")
def run():
 global TEST_ID
 assert not CHECKPOINT.exists(),'Recover existing registration checkpoint first'
 run_id=uuid.uuid4();email='squad-registration-'+run_id.hex[:12]+'@mailinator.com';keys={x['name']:x['api_key'] for x in api('staging','/api-keys')};url='https://'+PROJECTS['staging']+'.supabase.co'
 existing=json.loads((ROOT/'../Canto/canto-sync/private/auth-test.json').read_text())['email'];api('staging','/secrets',[{'name':'SQUAD_MAIL_ALLOWLIST','value':existing+','+email}])
 r=subprocess.run(['supabase','functions','deploy','squad-jobs','--project-ref',PROJECTS['staging'],'--use-api','--no-verify-jwt'],env={**os.environ,'SUPABASE_ACCESS_TOKEN':token()},capture_output=True,text=True);assert r.returncode==0
 ok=False;process=None;evidence=None
 with connect('staging') as c:
  env=c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();assert env[:3]==('staging',False,None) and env[3]==env[4]
  assert not c.execute("SELECT 1 FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()
  assert c.execute('SELECT max(id) FROM sa_snapshot_20261019.sa_users').fetchone()[0]<100000000
  TEST_ID=c.execute('SELECT coalesce(max(legacy_user_id)+1,%s) FROM sa_sync.legacy_identity_keys WHERE legacy_user_id>=%s',(TEST_ID,TEST_ID)).fetchone()[0]
  assert TEST_ID<9000000000001000,'Review accumulated acceptance reservations'
  assert not c.execute('SELECT 1 FROM sa_sync.legacy_identity_keys WHERE legacy_user_id=%s',(TEST_ID,)).fetchone()
  seq=c.execute('SELECT last_value,is_called FROM sa_snapshot_20261019.sa_users_id_seq').fetchone();assert seq[0]<100000000
  generation=c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0];structure=public_structure(c);schedules=c.execute("SELECT jobid,active FROM cron.job WHERE jobname='squad-jobs-minute'").fetchall();assert len(schedules)==1
  checkpoint={'request_id':str(run_id),'target':TEST_ID,'email':email,'sequence_last':seq[0],'sequence_called':seq[1],'edit_revision':env[3],'generation':generation,'schedule_id':schedules[0][0],'schedule_active':schedules[0][1]};CHECKPOINT.write_text(json.dumps(checkpoint)+'\n');CHECKPOINT.chmod(0o600)
  try:
   signal.signal(signal.SIGALRM,deadline);signal.alarm(300)
   with c.transaction():
    assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
    c.execute('SELECT cron.alter_job(%s,active:=false)',(schedules[0][0],));c.execute('ALTER SEQUENCE sa_snapshot_20261019.sa_users_id_seq RESTART WITH '+str(TEST_ID));c.execute('UPDATE sa_sync.environment_state SET cutover=true WHERE singleton')
   secret=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
   payload={'url':url,'anon':keys['anon'],'email':email,'legacy_id':str(TEST_ID),'request_id':str(run_id),'worker_secret':secret,'password':secrets.token_urlsafe(28)}
   process=subprocess.Popen(['node','tools/squad/test_account_registration_sdk.mjs'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);process.stdin.write(json.dumps(payload)+'\n');process.stdin.flush()
   first=process.stdout.readline()
   if not first:raise RuntimeError('Registration preflight failed: '+process.stderr.read()[-1800:])
   assert json.loads(first)['step']=='mail_ready';print('Registration email delivered. Mailinator inbox: '+email.split('@')[0],flush=True)
   code=getpass.getpass('Email proof code (hidden): ');assert len(code)==8 and code.isdecimal();process.stdin.write(json.dumps({'code':code})+'\n');process.stdin.flush();code=None
   last=process.stdout.readline();process.wait(timeout=90)
   if process.returncode:raise RuntimeError('Registration acceptance failed: '+process.stderr.read()[-1800:])
   evidence=json.loads(last);assert evidence['step']=='complete'
   verified=c.execute("SELECT u.role,u.approved,u.onboarded,u.confirmed_at IS NOT NULL,a.email_confirmed_at IS NOT NULL,a.banned_until>'2100-01-01',m.enrollment_state FROM sa_snapshot_20261019.sa_users u JOIN sa_identity.sa_auth_identities m ON m.legacy_user_id=u.id JOIN auth.users a ON a.id=m.auth_user_id WHERE u.id=%s AND u.email=%s",(TEST_ID,email)).fetchone();assert verified==(3,False,False,True,True,True,'blocked');ok=True
  finally:
   signal.alarm(0)
   if process and process.poll() is None:process.kill();process.communicate()
   c.execute('UPDATE sa_sync.environment_state SET cutover=false WHERE singleton')
   with c.transaction():
    assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
    assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]==generation
    current_seq=c.execute('SELECT last_value,is_called FROM sa_snapshot_20261019.sa_users_id_seq').fetchone();assert current_seq[0]==TEST_ID,'Unexpected sequence consumption; preserve checkpoint'
    mapping=c.execute('SELECT auth_user_id FROM sa_identity.sa_auth_identities WHERE legacy_user_id=%s AND canonical_email=%s',(TEST_ID,email)).fetchone()
    jobs=[x[0] for x in c.execute('SELECT id FROM sa_domain.outbox WHERE command_key=%s',(run_id,))]
    c.execute('DELETE FROM sa_domain.job_attempts WHERE job_id=ANY(%s::uuid[])',(jobs,))
    for table in ['outbox','audit']:c.execute('DELETE FROM sa_domain.'+table+' WHERE command_key=%s',(run_id,))
    c.execute('DELETE FROM sa_domain.credential_states WHERE legacy_user_id=%s',(TEST_ID,));c.execute('DELETE FROM sa_domain.account_flows WHERE id=%s',(run_id,))
    if mapping:
     c.execute('DELETE FROM auth.refresh_tokens WHERE user_id=%s',(str(mapping[0]),));c.execute('DELETE FROM auth.sessions WHERE user_id=%s',(mapping[0],))
     c.execute("UPDATE sa_identity.sa_auth_identities SET enrollment_state='blocked' WHERE legacy_user_id=%s",(TEST_ID,))
    c.execute('DELETE FROM sa_snapshot_20261019.sa_user_dealers WHERE user_id=%s',(TEST_ID,));c.execute('DELETE FROM sa_snapshot_20261019.sa_addresses WHERE user_id=%s',(TEST_ID,));c.execute('DELETE FROM sa_snapshot_20261019.sa_users WHERE id=%s AND email=%s',(TEST_ID,email));c.execute("DELETE FROM sa_domain.entity_versions WHERE kind='person' AND entity_id=%s",(TEST_ID,))
    # Exact owned range check: no other identity consumed a value before restoration.
    c.execute("SELECT setval('sa_snapshot_20261019.sa_users_id_seq',%s,%s)",(seq[0],seq[1]))
    current=c.execute('SELECT edit_revision FROM sa_sync.environment_state').fetchone()[0]
    if ok:
     assert current==env[3]+2,'Unexpected concurrent edits; retain checkpoint';c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s WHERE singleton',(env[3],))
    c.execute('SELECT cron.alter_job(%s,active:=%s)',(schedules[0][0],schedules[0][1]))
   if mapping:
    req=urllib.request.Request(url+'/auth/v1/admin/users/'+str(mapping[0]),method='DELETE',headers={'apikey':keys['service_role'],'Authorization':'Bearer '+keys['service_role']})
    with urllib.request.urlopen(req,timeout=30) as response:assert response.status==200
   assert public_structure(c)==structure
   api('staging','/secrets',[{'name':'SQUAD_MAIL_ALLOWLIST','value':existing}])
   if ok:CHECKPOINT.unlink()
  assert ok,'Registration failed; inspect retained checkpoint'
  evidence.update(measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),fixture_business_and_auth_cleanup_verified=True,retained_blocked_test_identity=str(TEST_ID),sequence_restored_with_exact_owned_range_check=True,public_structure_unchanged=True,mirror_restored=True)
  (ROOT/'docs/squad-one-audit/implementation-evidence/staging-account-registration.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence))
if __name__=='__main__':run()
