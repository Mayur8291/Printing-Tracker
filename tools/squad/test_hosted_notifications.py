"""Controlled committed staging SDK -> leased worker -> Firebase validate-only.

This isolates provider delivery from order mutation. The actual due-change/event
capture journey is separately covered by benchmark_notifications, under rollback.
"""
import datetime,json,subprocess,sys,uuid
from pathlib import Path
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
from auth_test import keys
CHECKPOINT=ROOT/'tools/squad/private/notification-checkpoint.json'
def run():
 assert not CHECKPOINT.exists(),'Recover the existing exact-owned notification checkpoint first'
 credentials=json.loads((ROOT/'../Canto/canto-sync/private/auth-test.json').read_text());job=uuid.uuid4();installation=uuid.uuid4();command=uuid.uuid4();state=None;report=None
 try:
  with connect('staging') as c:
   before=public_structure(c);cutover,active,revision,synced=c.execute('SELECT cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();assert not cutover and active is None and revision==synced
   assert c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()[0]==0
   assert c.execute("SELECT count(*) FROM sa_domain.account_flows WHERE state IN('pending','processing')").fetchone()[0]==0
   legacy,auth=c.execute('SELECT legacy_user_id,auth_user_id FROM sa_identity.sa_auth_identities WHERE canonical_email=%s',(credentials['email'],)).fetchone()
   assert c.execute('SELECT count(*) FROM sa_snapshot_20261019.sa_notifications WHERE recipient_id=%s',(legacy,)).fetchone()[0]==0
   token=c.execute("SELECT fcm_token FROM sa_snapshot_20261019.sa_user_devices WHERE length(fcm_token)>100 ORDER BY fcm_token LIMIT 1").fetchone()[0]
   assert c.execute('SELECT count(*) FROM sa_domain.devices WHERE active AND token=%s',(token,)).fetchone()[0]==0
   schedule=c.execute("SELECT jobid,active FROM cron.job WHERE jobname='squad-jobs-minute'").fetchone();assert schedule
   secret=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
   generation=c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]
   state={'job':str(job),'installation':str(installation),'command':str(command),'revision':revision,'synced':synced,'schedule':list(schedule),'legacy_id':legacy,'generation':generation}
   CHECKPOINT.write_text(json.dumps(state));CHECKPOINT.chmod(0o600)
   with c.transaction():
    c.execute('SELECT cron.alter_job(%s,active:=false)',(schedule[0],));c.execute('UPDATE sa_sync.environment_state SET cutover=true')
    c.execute("INSERT INTO sa_domain.outbox(id,actor_id,event_type,aggregate_kind,aggregate_id,command_key,generation,payload) VALUES(%s,%s,'notification.delivery','notification',%s,%s,%s,%s)",(job,auth,legacy,job,generation,Jsonb({'recipient_id':str(legacy),'recipient_role':3,'kind':'person','id':str(legacy),'topic':'acceptance.fixture','types':[]})))
   config={'url':'https://scvojtvgnkmbupvyslmb.supabase.co','anon':keys('staging'),'credentials':credentials,'token':token,'worker_secret':secret,'job':str(job),'installation':str(installation),'command':str(command),'legacy_id':str(legacy)}
   result=subprocess.run(['node','tools/squad/test_notifications_sdk.mjs'],input=json.dumps(config),capture_output=True,text=True,cwd=ROOT,timeout=90)
   if result.returncode:raise RuntimeError('Hosted notification SDK test failed: '+result.stderr[:1800])
   report=json.loads(result.stdout);assert public_structure(c)==before
 finally:
  if state is not None:
   with connect('staging') as c:
    with c.transaction():
     assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
     current=c.execute('SELECT edit_revision FROM sa_sync.environment_state FOR UPDATE').fetchone()[0]
     changes=c.execute('SELECT count(*) FROM sa_domain.commands WHERE key=%s AND result IS NOT NULL',(command,)).fetchone()[0]
     assert current==state['revision']+changes,'Other writes observed; preserve checkpoint for reconciliation'
     notification=c.execute('SELECT notification_id FROM sa_domain.notification_records WHERE job_id=%s',(job,)).fetchone()
     c.execute('DELETE FROM sa_domain.notification_deliveries WHERE job_id=%s',(job,));c.execute('DELETE FROM sa_domain.notification_records WHERE job_id=%s',(job,))
     if notification:c.execute('DELETE FROM sa_snapshot_20261019.sa_notifications WHERE id=%s AND recipient_id=%s',(notification[0],state['legacy_id']))
     c.execute('DELETE FROM sa_domain.job_attempts WHERE job_id=%s',(job,));c.execute('DELETE FROM sa_domain.outbox WHERE id=%s OR command_key=%s',(job,command))
     c.execute('DELETE FROM sa_domain.audit WHERE command_key=%s',(command,));c.execute('DELETE FROM sa_domain.commands WHERE key=%s',(command,));c.execute('DELETE FROM sa_domain.devices WHERE installation_id=%s',(installation,))
     c.execute('UPDATE sa_sync.environment_state SET cutover=false,edit_revision=%s,synced_revision=%s',(state['revision'],state['synced']));c.execute('SELECT cron.alter_job(%s,active:=%s)',tuple(state['schedule']))
    assert c.execute('SELECT cutover,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()==(False,state['revision'],state['synced'])
   CHECKPOINT.unlink()
 if report:
  report.update({'measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cleanup':'Exact-owned device, inbox, job, attempts, command and audit removed; mirror/revisions/schedule restored. Unused sequence gaps retained.','scope':'Synthetic own-person notification job; actual SDK device registration, deployed worker, current-recipient authorization, Google OAuth/FCM validation, and scoped SDK inbox. No physical push. Order event capture is verified separately under rollback.'})
  (ROOT/'docs/squad-one-audit/implementation-evidence/staging-notifications-sdk.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':run()
