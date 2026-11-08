"""Exact-owned, committed staging document test with durable cleanup checkpoint."""
import datetime,json,subprocess,sys,uuid,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
from auth_test import keys
from management import api
CHECKPOINT=ROOT/'tools/squad/private/document-checkpoint.json'
def run(synthetic_media=False,cron_mode=False):
 assert not CHECKPOINT.exists(),'Recover exact-owned document checkpoint before running again'
 files=[]
 credentials=json.loads((ROOT/'../Canto/canto-sync/private/auth-test.json').read_text());command=uuid.uuid4();state=None;report=None
 service=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role')
 try:
  with connect('staging') as c:
   before=public_structure(c);cutover,active,revision,synced=c.execute('SELECT cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();assert not cutover and active is None and revision==synced
   assert c.execute("SELECT count(*) FROM sa_domain.outbox WHERE status IN('pending','leased')").fetchone()[0]==0
   assert c.execute("SELECT count(*) FROM sa_domain.account_flows WHERE state IN('pending','processing')").fetchone()[0]==0
   legacy,auth=c.execute('SELECT legacy_user_id,auth_user_id FROM sa_identity.sa_auth_identities WHERE canonical_email=%s',(credentials['email'],)).fetchone()
   schedules=c.execute("SELECT jobid,active FROM cron.job WHERE jobname IN('squad-jobs-minute','squad-documents-pump','squad-media-cleanup')").fetchall();assert len(schedules)==3
   secret=c.execute("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='squad_jobs_invocation_secret'").fetchone()[0]
   classes=[str(x[0]) for x in c.execute("""SELECT DISTINCT s.rmp_class_id FROM sa_snapshot_20261019.sa_rmp_skus s
    JOIN sa_snapshot_20261019.sa_rmp_classes cl ON cl.id=s.rmp_class_id AND cl.is_deleted IS NOT TRUE
    JOIN sa_snapshot_20261019.sa_rmp_brands b ON b.id=s.rmp_brand_id AND b.is_deleted IS NOT TRUE
    JOIN sa_snapshot_20261019.sa_rmp_category_brands cb ON cb.rmp_brand_id=b.id AND cb.is_deleted IS NOT TRUE
    JOIN sa_snapshot_20261019.sa_rmp_categories cat ON cat.id=cb.rmp_category_id AND cat.is_deleted IS NOT TRUE
    WHERE s.is_deleted IS NOT TRUE ORDER BY s.rmp_class_id LIMIT 101""")]
   assert len(classes)>=101,'Need enough product groups for bounded rendering acceptance'
   generation=c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]
   state={'command':str(command),'actor':str(auth),'revision':revision,'synced':synced,'schedules':[list(s) for s in schedules],'generation':generation}
   if synthetic_media:
    from document_media_fixture import prepare
    files=prepare();state['media']=[{k:v for k,v in f.items() if k!='content'} for f in files]
   CHECKPOINT.write_text(json.dumps(state));CHECKPOINT.chmod(0o600)
   with c.transaction():
    for schedule in schedules:c.execute('SELECT cron.alter_job(%s,active:=false)',(schedule[0],))
    c.execute('UPDATE sa_sync.environment_state SET cutover=true')
   if cron_mode:c.execute("SELECT cron.alter_job(jobid,active:=true) FROM cron.job WHERE jobname='squad-documents-pump'")
   if synthetic_media:
    from document_media_fixture import create
    create(c,files,service);classes=[str(f['id']) for f in files]
   config={'cron_mode':cron_mode,'synthetic_media':synthetic_media,'url':'https://scvojtvgnkmbupvyslmb.supabase.co','anon':keys('staging'),'credentials':credentials,'worker_secret':secret,'command':str(command),'classes':classes}
   result=subprocess.run(['node','tools/squad/test_documents_sdk.mjs'],input=json.dumps(config),capture_output=True,text=True,cwd=ROOT,timeout=360)
   if result.returncode:raise RuntimeError('Hosted document SDK test failed: '+result.stderr[:1800])
   report=json.loads(result.stdout);assert public_structure(c)==before
 finally:
  if state is not None:
   with connect('staging') as c:
    with c.transaction():
     assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0]
     current=c.execute('SELECT edit_revision FROM sa_sync.environment_state FOR UPDATE').fetchone()[0]
     changes=c.execute('SELECT count(*) FROM sa_domain.commands WHERE key=%s AND actor_id=%s AND result IS NOT NULL',(command,uuid.UUID(state['actor']))).fetchone()[0]
     assert current==state['revision']+changes,'Other writes observed; preserve checkpoint for reconciliation'
     c.execute('UPDATE sa_sync.environment_state SET cutover=false')
    docs=c.execute('SELECT d.id,d.job_id,d.next_part,d.state FROM sa_domain.documents d JOIN sa_domain.outbox j ON j.id=d.job_id WHERE j.command_key=%s AND d.actor_id=%s',(command,uuid.UUID(state['actor']))).fetchall()
    for id_,job,parts,doc_state in docs:
     # Delivery now fans out to grandchildren. Ownership comes from the exact
     # request root, never from a broad actor/date match that could delete work.
     owned=[r[0] for r in c.execute('WITH RECURSIVE owned(id) AS(SELECT id FROM sa_domain.outbox WHERE id=%s UNION SELECT j.id FROM sa_domain.outbox j JOIN owned o ON j.parent_id=o.id) SELECT id FROM owned',(job,))]
     assert not c.execute("SELECT FROM sa_domain.outbox WHERE id=ANY(%s) AND status='leased' AND lease_until>now()",(owned,)).fetchone(),'Live document lease: keep checkpoint until worker settles'
     prefix='g'+str(state['generation'])+'/'+state['actor']+'/'+str(id_)+'/'
     paths=[prefix+'document.pdf']+[prefix+'part-'+str(i).zfill(4)+'.pdf' for i in range(parts+1)]
     request=urllib.request.Request('https://scvojtvgnkmbupvyslmb.supabase.co/storage/v1/object/squad-documents',data=json.dumps({'prefixes':paths}).encode(),headers={'apikey':service,'Authorization':'Bearer '+service,'Content-Type':'application/json'},method='DELETE')
     with urllib.request.urlopen(request,timeout=60) as r:assert r.status==200
     with c.transaction():
      c.execute('DELETE FROM sa_domain.business_mail_deliveries WHERE job_id=ANY(%s) AND document_id=%s',(owned,id_))
      c.execute('DELETE FROM sa_domain.document_cleanup WHERE document_id=%s',(id_,));c.execute('DELETE FROM sa_domain.documents WHERE id=%s AND actor_id=%s',(id_,uuid.UUID(state['actor'])))
      c.execute('DELETE FROM sa_domain.job_attempts WHERE job_id=ANY(%s)',(owned,));c.execute('DELETE FROM sa_domain.outbox WHERE id=ANY(%s)',(owned,))
    if files:
     from document_media_fixture import cleanup
     cleanup(c,files,service)
    with c.transaction():
     c.execute('DELETE FROM sa_domain.audit WHERE command_key=%s AND actor_id=%s',(command,uuid.UUID(state['actor'])));c.execute('DELETE FROM sa_domain.commands WHERE key=%s AND actor_id=%s',(command,uuid.UUID(state['actor'])))
     c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s,synced_revision=%s',(state['revision'],state['synced']))
     for schedule in state['schedules']:c.execute('SELECT cron.alter_job(%s,active:=%s)',tuple(schedule))
    assert c.execute('SELECT cutover,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()==(False,state['revision'],state['synced'])
   CHECKPOINT.unlink()
 if report:
  report.update({'measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cleanup':'Exact-owned PDF, parts, document, queue, attempts, command and audit removed. Mirror mode, revisions and schedules restored. Sequence gaps retained.','scope':'101 migrated product classes; missing staging product images remain explicit; real private PDF and signed download; controlled Mailinator recipient only. Provider acceptance does not prove inbox delivery.'})
  if synthetic_media:report['scope']='11 exact-owned synthetic 1.96 MP PNGs and catalogue records; real deployed capture/render/merge/download; no email; all fixtures removed. No production media used.'
  if cron_mode:report['scope']='Real SDK request for 101 migrated classes; automatic Vault-backed Supabase Cron -> deployed worker -> PDF download; no manual worker invocation or email. Missing old-source staging images remain explicit.'
  (ROOT/('docs/squad-one-audit/implementation-evidence/staging-documents-'+('cron' if cron_mode else 'images' if synthetic_media else 'sdk')+'.json')).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':run('--images' in sys.argv,'--cron' in sys.argv)
