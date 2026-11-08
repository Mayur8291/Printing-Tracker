"""Staging-only actual administrator upload journey with owned-fixture cleanup.
No existing user or master is edited. Credentials travel through child stdin,
never files or logs. A checkpoint survives failure until cleanup is verified.
"""
import datetime,json,secrets,subprocess,sys,urllib.request,urllib.error,uuid
from pathlib import Path
from psycopg import sql
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'tools/canto-sync'))
from database import connect,public_structure
from management import api,PROJECTS
CHECKPOINT=ROOT/'tools/squad/private/master-upload-checkpoint.json'
def run():
 assert not CHECKPOINT.exists(),'Recover earlier master upload checkpoint first'
 keys={x['name']:x['api_key'] for x in api('staging','/api-keys')};url='https://'+PROJECTS['staging']+'.supabase.co'
 def request(path,method='GET',body=None):
  r=urllib.request.Request(url+path,data=None if body is None else json.dumps(body).encode(),headers={'apikey':keys['service_role'],'Authorization':'Bearer '+keys['service_role'],'Content-Type':'application/json'},method=method)
  try:
   with urllib.request.urlopen(r,timeout=60) as response:return response.status,json.loads(response.read() or b'{}')
  except urllib.error.HTTPError as e:return e.code,json.loads(e.read() or b'{}')
 email='squad-master-'+uuid.uuid4().hex+'@example.invalid';password=secrets.token_urlsafe(40)
 with connect('staging') as c:
  env=c.execute('SELECT environment,cutover,active_job,edit_revision,synced_revision FROM sa_sync.environment_state').fetchone();assert env[:3]==('staging',False,None) and env[3]==env[4]
  generation=c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0];structure=public_structure(c)
  personal=c.execute("""SELECT o.object_path FROM sa_media.objects o JOIN sa_media.references r USING(sha256) WHERE r.resource IN('brandings','users','products','product_images') AND r.status='ready'
   AND NOT EXISTS(SELECT FROM sa_media.references other WHERE other.sha256=o.sha256 AND other.resource IN('add_ons','asset_infos','authorized_brands','base_product_types','base_products','fabrics','promotional_banners','promotions','rmp_categories','rmp_classes','bulk_uploads','catalogues')) LIMIT 1""").fetchone();assert personal
  state={'environment':'staging','email':email,'generation':generation,'edit_revision':env[3],'synced_revision':env[4],'personal_path':personal[0],'records':[],'hashes':[],'results':[]}
  CHECKPOINT.write_text(json.dumps(state)+'\n');CHECKPOINT.chmod(0o600);code=None
  try:
   c.execute('INSERT INTO public.admin_emails(email) VALUES(%s)',(email,))
   status,user=request('/auth/v1/admin/users','POST',{'email':email,'password':password,'email_confirm':True,'app_metadata':{'squad_acceptance_fixture':True},'user_metadata':{'full_name':'Disposable Squad media acceptance'}})
   assert status in(200,201),'Disposable Auth fixture creation failed';actor=uuid.UUID(user['id']);state['actor_id']=str(actor);CHECKPOINT.write_text(json.dumps(state)+'\n')
   assert c.execute("SELECT role FROM public.profiles WHERE id=%s",(actor,)).fetchone()==('admin',),'Expected allowlisted profile fixture'
   process=subprocess.Popen(['node','tools/squad/test_master_media_sdk.mjs'],cwd=ROOT,stdin=subprocess.PIPE,text=True)
   process.stdin.write(json.dumps({'url':url,'anon':keys['anon'],'credentials':{'email':email,'password':password}}));process.stdin.close()
   while process.poll() is None:
    try:process.wait(timeout=15)
    except subprocess.TimeoutExpired:c.execute('SELECT 1')
   code=process.returncode
  finally:
   state=json.loads(CHECKPOINT.read_text());actor=c.execute('SELECT id FROM auth.users WHERE email=%s',(email,)).fetchone()
   if actor:
    actor=actor[0]
    with c.transaction():
     assert c.execute('SELECT pg_try_advisory_xact_lock(20261107,1)').fetchone()[0],'Concurrent writer: keep checkpoint'
     assert c.execute('SELECT generation FROM sa_domain.runtime_state').fetchone()[0]==generation,'Refresh raced: keep checkpoint'
     assert c.execute('SELECT cutover,active_job FROM sa_sync.environment_state').fetchone()==(False,None)
     created=c.execute("SELECT resource,record_id FROM sa_admin.audit WHERE actor_id=%s AND operation='create'",(actor,)).fetchall()
     assert all(r in ('base_product_types','rmp_brands') for r,i in created),'Unexpected fixture resource'
     uploads=c.execute('SELECT id FROM sa_domain.media_uploads WHERE actor_id=%s',(actor,)).fetchall()
     edits=c.execute('SELECT (SELECT count(*) FROM sa_domain.audit WHERE actor_id=%s)+(SELECT count(*) FROM sa_admin.audit WHERE actor_id=%s)',(actor,actor)).fetchone()[0]
     assert c.execute('SELECT edit_revision FROM sa_sync.environment_state').fetchone()[0]>=env[3]+edits
     for resource,id in created:
      c.execute('DELETE FROM sa_media.references WHERE resource=%s AND record_id=%s',(resource,id))
      c.execute('DELETE FROM sa_admin.media WHERE resource=%s AND record_id=%s',(resource,id))
      c.execute('DELETE FROM sa_admin.record_extras WHERE resource=%s AND record_id=%s',(resource,id))
      c.execute(sql.SQL('DELETE FROM sa_snapshot_20261019.{} WHERE id=%s').format(sql.Identifier('sa_'+resource)),(id,))
      c.execute('DELETE FROM sa_domain.entity_versions WHERE kind=%s AND entity_id=%s',('media:'+resource,id))
     for table in ['sa_domain.outbox','sa_domain.audit','sa_domain.media_history','sa_domain.media_uploads','sa_domain.commands','sa_admin.audit']:
      c.execute(sql.SQL('DELETE FROM {} WHERE actor_id=%s').format(sql.Identifier(*table.split('.'))),(actor,))
     assert not c.execute('SELECT FROM sa_media.references WHERE sha256=ANY(%s::text[])',(state['hashes'],)).fetchone()
     c.execute('DELETE FROM sa_media.objects WHERE sha256=ANY(%s::text[])',(state['hashes'],))
     c.execute('UPDATE sa_sync.environment_state SET edit_revision=edit_revision-%s WHERE singleton',(edits,))
    for bucket,paths in [('squad-uploads',['pending/'+str(x[0]) for x in uploads]),('canto-media',['sha256/'+h[:2]+'/'+h for h in state['hashes']])]:
     if paths:assert request('/storage/v1/object/'+bucket,'DELETE',{'prefixes':paths})[0]==200,'Storage cleanup failed'
    assert request('/auth/v1/admin/users/'+str(actor),'DELETE')[0]==200,'Auth fixture cleanup failed'
    assert not c.execute('SELECT FROM auth.users WHERE id=%s',(actor,)).fetchone()
    assert not c.execute('SELECT FROM public.profiles WHERE id=%s',(actor,)).fetchone()
   c.execute('DELETE FROM public.admin_emails WHERE email=%s',(email,))
   assert public_structure(c)==structure
   CHECKPOINT.unlink();print('Hosted fixture cleanup verified; public structure unchanged; sequence gaps retained',flush=True)
  assert code==0,'Hosted master media journey failed; owned fixtures cleaned'
  evidence={k:state[k] for k in ('environment','results','personal_file_denied','public_upload_denied')}
  evidence.update(measured_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),fixture_cleanup_verified=True,public_structure_unchanged=True)
  (ROOT/'docs/squad-one-audit/implementation-evidence/staging-master-media.json').write_text(json.dumps(evidence,indent=2)+'\n')
if __name__=='__main__':run()
