"""Staging bulk acceptance; disposable staff and exact-owned CSV/master cleanup."""
import datetime,json,secrets,subprocess,sys,urllib.request,urllib.error,uuid
from pathlib import Path
from psycopg import sql
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
from management import api,PROJECTS
CHECKPOINT=ROOT/'tools/squad/private/transfer-checkpoint.json'

def run():
 assert not CHECKPOINT.exists(),'Recover the exact-owned transfer checkpoint first'
 keys={x['name']:x['api_key'] for x in api('staging','/api-keys')};url='https://'+PROJECTS['staging']+'.supabase.co'
 def request(path,method='GET',body=None):
  req=urllib.request.Request(url+path,data=None if body is None else json.dumps(body).encode(),headers={'apikey':keys['service_role'],'Authorization':'Bearer '+keys['service_role'],'Content-Type':'application/json'},method=method)
  try:
   with urllib.request.urlopen(req,timeout=60) as r:return r.status,json.loads(r.read() or b'{}')
  except urllib.error.HTTPError as e:return e.code,json.loads(e.read() or b'{}')
 email='squad-transfer-'+uuid.uuid4().hex+'@example.invalid';password=secrets.token_urlsafe(40);prefix='squad-transfer-'+uuid.uuid4().hex;state=None;report=None;failure=None
 try:
  with connect('staging') as c:
   before=public_structure(c);env=c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();assert env[:3]==('staging',False,None) and env[3]==env[4]
   assert c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()[0]==0
   generation=c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]
   schedules=c.execute("SELECT jobid,active FROM cron.job WHERE jobname IN('squad-jobs-minute','squad-documents-pump','squad-media-cleanup')").fetchall();assert len(schedules)==3
   secret=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
   state={'email':email,'prefix':prefix,'generation':generation,'revision':env[3],'synced':env[4],'schedules':[list(x) for x in schedules]};CHECKPOINT.write_text(json.dumps(state));CHECKPOINT.chmod(0o600)
   c.execute('INSERT INTO public.admin_emails(email) VALUES(%s)',(email,))
   status,user=request('/auth/v1/admin/users','POST',{'email':email,'password':password,'email_confirm':True,'app_metadata':{'squad_acceptance_fixture':True},'user_metadata':{'full_name':'Disposable Squad CSV acceptance'}})
   assert status in(200,201),'Disposable staff creation failed';actor=uuid.UUID(user['id']);state['actor']=str(actor);CHECKPOINT.write_text(json.dumps(state))
   assert c.execute('SELECT role FROM public.profiles WHERE id=%s',(actor,)).fetchone()==('admin',)
   with c.transaction():
    assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
    for schedule in schedules:c.execute('SELECT cron.alter_job(%s,active:=false)',(schedule[0],))
    c.execute('UPDATE sa_sync.environment_state SET cutover=true')
   config={'url':url,'anon':keys['anon'],'credentials':{'email':email,'password':password},'worker_secret':secret,'prefix':prefix}
   process=subprocess.Popen(['node','tools/squad/test_transfers_hosted_sdk.mjs'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,cwd=ROOT)
   process.stdin.write(json.dumps(config));process.stdin.close();process.stdin=None
   for attempt in range(40):
    try:stdout,stderr=process.communicate(timeout=15);break
    except subprocess.TimeoutExpired:c.execute('SELECT 1')
   else:process.kill();stdout,stderr=process.communicate();raise RuntimeError('Hosted transfer test exceeded ten-minute acceptance budget')
   if process.returncode:raise RuntimeError('Hosted CSV test failed: '+stderr[:2200])
   report=json.loads(stdout);assert public_structure(c)==before
 except BaseException as exc:failure=exc
 finally:
  if state is not None:
   with connect('staging') as c:
    actor=c.execute('SELECT id FROM auth.users WHERE email=%s',(email,)).fetchone();actor=actor[0] if actor else None
    with c.transaction():
     assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0],'Concurrent work: keep checkpoint'
     c.execute('UPDATE sa_sync.environment_state SET cutover=false')
    if actor:
     assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]==state['generation'],'Refresh raced: preserve checkpoint'
     assert not c.execute("SELECT 1 FROM sa_domain.outbox WHERE actor_id=%s AND status='leased' AND lease_until>now()",(actor,)).fetchone(),'Wait for owned live lease before cleanup'
     edits=c.execute('SELECT (SELECT count(*) FROM sa_domain.audit WHERE actor_id=%s)+(SELECT count(*) FROM sa_admin.audit WHERE actor_id=%s)',(actor,actor)).fetchone()[0]
     assert c.execute('SELECT edit_revision FROM sa_sync.environment_state').fetchone()[0]==state['revision']+edits,'Other writes observed: keep checkpoint and preserve revision'
     uploads=c.execute('SELECT id FROM sa_domain.transfer_uploads WHERE actor_id=%s',(actor,)).fetchall()
     transfers=c.execute('SELECT id,generation,total_rows FROM sa_domain.transfers WHERE actor_id=%s',(actor,)).fetchall()
     paths=['inputs/'+str(u[0])+'/file.csv' for u in uploads]
     for id_,g,total in transfers:
      prefix_='g'+str(g)+'/'+str(id_)+'/';paths.append(prefix_+'export.csv');paths.extend(prefix_+'part-'+str(i).zfill(4)+'.csv' for i in range(max(1,(total+99)//100)))
     for start in range(0,len(paths),100):assert request('/storage/v1/object/squad-transfers','DELETE',{'prefixes':paths[start:start+100]})[0]==200,'CSV cleanup failed'
     with c.transaction():
      created=c.execute("SELECT resource,record_id FROM sa_admin.audit WHERE actor_id=%s AND operation='create'",(actor,)).fetchall();assert all(r=='base_product_types' for r,i in created)
      for resource,id_ in created:
       name=c.execute('SELECT name FROM sa_snapshot_20261019.sa_base_product_types WHERE id=%s',(id_,)).fetchone();assert name and state['prefix'] in name[0]
       c.execute('DELETE FROM sa_admin.record_extras WHERE resource=%s AND record_id=%s',(resource,id_));c.execute('DELETE FROM sa_snapshot_20261019.sa_base_product_types WHERE id=%s',(id_,))
      c.execute('DELETE FROM sa_domain.transfer_cleanup WHERE upload_id IN(SELECT id FROM sa_domain.transfer_uploads WHERE actor_id=%s) OR transfer_id IN(SELECT id FROM sa_domain.transfers WHERE actor_id=%s)',(actor,actor))
      c.execute('DELETE FROM sa_domain.transfers WHERE actor_id=%s',(actor,));c.execute('DELETE FROM sa_domain.transfer_uploads WHERE actor_id=%s',(actor,))
      c.execute('DELETE FROM sa_domain.job_attempts WHERE job_id IN(SELECT id FROM sa_domain.outbox WHERE actor_id=%s)',(actor,))
      for table in ('sa_domain.outbox','sa_domain.audit','sa_domain.commands','sa_admin.audit'):c.execute(sql.SQL('DELETE FROM {} WHERE actor_id=%s').format(sql.Identifier(*table.split('.'))),(actor,))
      c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s',(state['revision'],state['synced']))
     assert request('/auth/v1/admin/users/'+str(actor),'DELETE')[0]==200,'Auth cleanup failed'
    c.execute('DELETE FROM public.admin_emails WHERE email=%s',(email,))
    for schedule in state['schedules']:c.execute('SELECT cron.alter_job(%s,active:=%s)',tuple(schedule))
    assert c.execute('SELECT cutover,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()==(False,state['revision'],state['synced'])
    assert public_structure(c)==before;CHECKPOINT.unlink()
 if failure:raise failure
 report.update(measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),fixture_cleanup_verified=True,public_structure_unchanged=True,scope='201 exact-owned synthetic Masters, immutable CSV >256 KiB, actual GoTrue SDK, deployed Edges and private Storage. All disposable Auth/profile, data, job, audit and file fixtures removed. Original mirror revisions/schedules restored; sequence gaps retained. No production or DigitalOcean changes.')
 (ROOT/'docs/squad-one-audit/implementation-evidence/staging-transfers-sdk.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':run()
