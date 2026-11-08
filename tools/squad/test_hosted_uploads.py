"""Bounded, committed staging SDK journey with exact fixture cleanup.

The checkpoint contains IDs and baseline state, never credentials. Actual
business writes are limited to newly created designs belonging to the already
controlled test customer. Existing files/people are never edited. Sequence gaps
remain intentionally; no concurrent sequence is rewound.
"""
import datetime,json,os,subprocess,sys,time,urllib.request,uuid
from pathlib import Path
from psycopg.types.json import Jsonb
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
from management import api,PROJECTS
CHECKPOINT=ROOT/'tools/squad/private/upload-checkpoint.json'
def run():
 assert not CHECKPOINT.exists(),'Recover the existing upload checkpoint before another run'
 credentials=json.loads((ROOT/'../Canto/canto-sync/private/auth-test.json').read_text())
 with connect('staging') as c:
  assert c.execute('SELECT pg_try_advisory_lock_shared(20261107,1)').fetchone()[0],'Refresh active'
  assert c.execute('SELECT pg_try_advisory_lock_shared(20261107,2)').fetchone()[0],'Relationships changing'
  env=c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();assert env[:3]==('staging',False,None) and env[3]==env[4],env
  generation,allow,allowed,expires=c.execute('SELECT generation,allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone();assert not allow and not allowed and expires is None
  actor=c.execute('SELECT m.auth_user_id FROM sa_identity.sa_auth_identities m JOIN sa_snapshot_20261019.sa_users u ON u.id=m.legacy_user_id WHERE lower(u.email)=lower(%s) AND u.role=3 AND m.enrollment_state=\'ready\'',(credentials['email'],)).fetchone()[0]
  structure=public_structure(c)
  state={'environment':'staging','actor_id':str(actor),'generation':generation,'edit_revision':env[3],'synced_revision':env[4],'allow_test_writes':allow,'keys':[],'designs':[],'uploads':[],'hashes':[],'results':[],'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
  CHECKPOINT.write_text(json.dumps(state)+'\n');CHECKPOINT.chmod(0o600)
  code=None
  try:
   c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=true,test_actor_ids=%s,test_write_expires_at=now()+interval '15 minutes'",([actor],))
   if os.environ.get('SQUAD_UPLOAD_CASES')=='video':subprocess.run(['ffmpeg','-nostdin','-y','-loglevel','error','-f','lavfi','-i','color=c=blue:s=32x32:d=1','-an','-c:v','libx264','-pix_fmt','yuv420p',str(ROOT/'tools/squad/private/upload-video.mp4')],check=True)
   process=subprocess.Popen(['node','tools/squad/test_upload_sdk.mjs'],cwd=ROOT)
   while process.poll() is None:
    try:process.wait(timeout=15)
    except subprocess.TimeoutExpired:c.execute('SELECT 1')
   code=process.returncode
  finally:
   # Restore the test switch even if the Node journey failed.
   c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=%s,test_actor_ids='{}',test_write_expires_at=NULL",(allow,))
   state=json.loads(CHECKPOINT.read_text());keys=[uuid.UUID(x) for x in state['keys']]
   commands=c.execute('SELECT operation,result FROM sa_domain.commands WHERE actor_id=%s AND key=ANY(%s::uuid[])',(actor,keys)).fetchall()
   designs={int(r['id']) for op,r in commands if op=='design.saved' and r};uploads={uuid.UUID(r['upload_id']) for op,r in commands if op=='media.reserved' and r}
   edits=c.execute('SELECT count(*) FROM sa_domain.audit WHERE actor_id=%s AND command_key=ANY(%s::uuid[])',(actor,keys)).fetchone()[0]
   current=c.execute('SELECT edit_revision,synced_revision,cutover,active_job FROM sa_sync.environment_state').fetchone();assert current==(env[3]+edits,env[4],False,None),'Unexpected concurrent writes; preserve checkpoint for review'
   assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]==generation,'Unexpected generation changed'
   with c.transaction():
    c.execute('DELETE FROM sa_domain.outbox WHERE actor_id=%s AND command_key=ANY(%s::uuid[])',(actor,keys))
    c.execute('DELETE FROM sa_domain.audit WHERE actor_id=%s AND command_key=ANY(%s::uuid[])',(actor,keys))
    c.execute('DELETE FROM sa_domain.media_history WHERE actor_id=%s AND command_key=ANY(%s::uuid[])',(actor,keys))
    c.execute('DELETE FROM sa_media.references WHERE resource=\'brandings\' AND record_id=ANY(%s::bigint[])',(list(designs),))
    c.execute('DELETE FROM sa_domain.media_uploads WHERE id=ANY(%s::uuid[]) AND actor_id=%s',(list(uploads),actor))
    c.execute('DELETE FROM sa_domain.design_owners WHERE branding_id=ANY(%s::bigint[]) AND actor_id=%s',(list(designs),actor))
    c.execute('DELETE FROM sa_snapshot_20261019.sa_brandings WHERE id=ANY(%s::bigint[]) AND item_id IS NULL AND product_id IS NULL',(list(designs),))
    c.execute('DELETE FROM sa_domain.entity_versions WHERE kind=\'branding\' AND entity_id=ANY(%s::bigint[])',(list(designs),))
    c.execute('DELETE FROM sa_domain.commands WHERE actor_id=%s AND key=ANY(%s::uuid[])',(actor,keys))
    assert not c.execute('SELECT FROM sa_media.references WHERE sha256=ANY(%s::text[])',(state['hashes'],)).fetchone(),'Unexpected shared test object'
    c.execute('DELETE FROM sa_media.objects WHERE sha256=ANY(%s::text[])',(state['hashes'],))
    c.execute('UPDATE sa_sync.environment_state SET edit_revision=%s WHERE singleton',(env[3],))
   service=next(x['api_key'] for x in api('staging','/api-keys') if x['name']=='service_role')
   for bucket,paths in [('squad-uploads',['pending/'+str(x) for x in uploads]),('canto-media',['sha256/'+h[:2]+'/'+h for h in state['hashes']])]:
    if paths:
     req=urllib.request.Request('https://'+PROJECTS['staging']+'.supabase.co/storage/v1/object/'+bucket,data=json.dumps({'prefixes':paths}).encode(),method='DELETE',headers={'apikey':service,'Authorization':'Bearer '+service,'Content-Type':'application/json'})
     with urllib.request.urlopen(req,timeout=90) as r:assert r.status==200
   assert public_structure(c)==structure,'Public structure changed'
   assert c.execute('SELECT allow_test_writes,test_actor_ids,test_write_expires_at FROM sa_domain.runtime_state').fetchone()==(allow,[],None)
   assert c.execute('SELECT edit_revision,synced_revision FROM sa_sync.environment_state').fetchone()==(env[3],env[4])
   print(json.dumps({'cleanup':'verified','designs':len(designs),'uploads':len(uploads),'commands':len(keys),'write_switch_restored':True,'business_revisions_restored':True,'public_structure_unchanged':True}),flush=True)
   CHECKPOINT.unlink()
  assert code==0,'Hosted SDK journey failed; disposable fixtures were cleaned'
  evidence={'environment':'staging','measured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'results':state['results'],'invalid_file_rejected':state.get('invalid_rejected',False),'fixture_cleanup_verified':True,'scope':'Real GoTrue login, deployed Edge, actual private Storage uploads/downloads, scoped RPC attachments and detachments; controlled customer creates only disposable new designs; sequence gaps intentionally retained.'}
  previous=ROOT/'docs/squad-one-audit/implementation-evidence/staging-media-uploads.json'
  if os.environ.get('SQUAD_UPLOAD_CASES')=='video' and previous.exists():evidence['results']=json.loads(previous.read_text())['results']+evidence['results']
  previous.write_text(json.dumps(evidence,indent=2)+'\n')
if __name__=='__main__':run()
