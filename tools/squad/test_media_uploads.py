"""Upload intent, service attestation and resource mutation boundaries."""
from sqlstate_assertions import assert_app_conflict
import json,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from fixtures import session,rpc,uid
import test_order_acceptance as acceptance
from local_db import connect
from test_catalogue import seed_catalogue
class Uploads(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.f=acceptance.Orders();self.f.setUp();self.c=self.f.c
  d=self.f.design();self.target={'resource':'brandings','record_id':d['design_id'],'field':'image'};self.version=self.media(self.target)['version']
 def tearDown(self):self.f.tearDown()
 def media(self,target):return self.c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb([target]),)).fetchone()[0]['references'][0]
 def reserve(self,target=None,version=None,file=None,key=None):
  return self.c.execute('SELECT canto_api.account_upload_reserve(%s,%s,%s,%s)',(Jsonb(target or self.target),Jsonb(file or {'filename':'design.png','bytes':'10','content_type':'image/png'}),version or self.version,key or uuid.uuid4())).fetchone()[0]
 def verify(self,u,hash='a'*64,bytes=10,mime='image/png'):
  self.c.execute('SET LOCAL ROLE service_role');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
  r=self.c.execute('SELECT canto_api.account_upload_verified(%s,%s,%s,%s)',(uuid.UUID(u['upload_id']),hash,bytes,mime)).fetchone()[0];self.c.execute('RESET ROLE');session(self.c,self.f.n,'authenticated' if self.f.n==999 else 'sa_app');return r
 def attach(self,u,version=None,key=None):return rpc(self.c,'v1_media_attach',(uuid.UUID(u['upload_id']),version or self.version,key or uuid.uuid4()))
 def actor(self,n):self.f.n=n;self.c.execute('RESET ROLE');session(self.c,n,'authenticated' if n==999 else 'sa_app')
 def test_verified_attach_resolve_detach_and_history(self):
  u=self.reserve();self.verify(u);r=self.attach(u);self.assertEqual(self.media(self.target)['status'],'ready');self.assertEqual(r['entity_version'],'0:2')
  d=rpc(self.c,'v1_media_detach',(Jsonb(self.target),r['version'],'Remove old artwork',uuid.uuid4()));self.assertEqual(d['status'],'empty');self.assertEqual(self.media(self.target)['status'],'empty')
  self.assertEqual(self.f.raw('SELECT operation FROM sa_domain.media_history ORDER BY id'),[('attach',),('detach',)]);self.assertEqual(self.f.raw('SELECT count(*) FROM sa_media.objects'),[(1,)])
 def test_unverified_file_cannot_be_attached(self):
  u=self.reserve()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.attach(u)
 def test_clients_cannot_attest_verification(self):
  u=self.reserve()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.account_upload_verified(%s,%s,10,\'image/png\')',(uuid.UUID(u['upload_id']),'a'*64))
 def test_idempotent_reserve_and_attach(self):
  key=uuid.uuid4();u=self.reserve(key=key);self.assertEqual(u,self.reserve(key=key));self.verify(u);key=uuid.uuid4();r=self.attach(u,key=key);self.assertEqual(r,self.attach(u,key=key));self.assertEqual(self.f.raw('SELECT count(*) FROM sa_domain.media_history'),[(1,)])
 def test_upload_cannot_be_attached_twice_with_different_commands(self):
  u=self.reserve();self.verify(u);self.attach(u)
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.attach(u)
 def test_foreign_design_denied(self):
  self.actor(203)
  with self.assertRaises(psycopg.errors.NoDataFound):self.reserve()
 def test_foreign_upload_id_denied(self):
  u=self.reserve();self.actor(203)
  with self.assertRaises(psycopg.errors.NoDataFound):self.attach(u)
 def test_changed_design_invalidates_upload(self):
  u=self.reserve();self.verify(u);self.f.raw("UPDATE sa_snapshot_20261019.sa_brandings SET updated_at=now()+interval '1 second' WHERE id=%s",(int(self.target['record_id']),))
  with assert_app_conflict(self):self.attach(u)
 def test_generation_invalidates_verified_upload(self):
  u=self.reserve();self.verify(u);self.f.raw('UPDATE sa_domain.runtime_state SET generation=generation+1')
  with self.assertRaises(psycopg.errors.NoDataFound):self.attach(u)
 def test_revoked_session_cannot_finish(self):
  u=self.reserve();self.verify(u);self.f.raw('DELETE FROM auth.sessions WHERE user_id=%s',(uid(103),))
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.attach(u)
 def test_expired_upload_cannot_attach(self):
  u=self.reserve();self.verify(u);self.f.raw("UPDATE sa_domain.media_uploads SET expires_at=now()-interval '1 second'")
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.attach(u)
 def test_size_type_and_name_validation(self):
  for f in [{'filename':'../x','bytes':'10','content_type':'image/png'},{'filename':'x','bytes':'0','content_type':'image/png'},{'filename':'x','bytes':'10485761','content_type':'image/png'},{'filename':'x','bytes':'10','content_type':'text/html'},{'filename':'x','bytes':'10','content_type':'video/mp4'}]:
   with self.subTest(file=f),self.c.transaction():
    try:self.reserve(file=f)
    except psycopg.errors.InvalidParameterValue:raise psycopg.Rollback()
    else:self.fail('Invalid file accepted')
 def test_verification_exact_size_and_type(self):
  u=self.reserve()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.verify(u,bytes=11)
 def test_active_upload_quota(self):
  for _ in range(20):self.reserve()
  with self.assertRaises(psycopg.errors.ProgramLimitExceeded):self.reserve()
 def test_mirror_blocks_upload_reservation(self):
  self.f.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=false')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.reserve()
 def test_platform_can_upload_master_without_legacy_identity(self):
  self.actor(999);target={'resource':'base_products','record_id':'1','field':'image'};v=self.media(target)['version'];u=self.reserve(target,v);self.verify(u);r=self.attach(u,v);self.assertEqual(self.media(target)['status'],'ready');self.c.execute('RESET ROLE');self.assertEqual(self.c.execute('SELECT legacy_user_id FROM sa_domain.audit WHERE operation=\'media.attached\'').fetchone(),(None,))
 def test_platform_cannot_upload_customer_photo(self):
  self.actor(999)
  with self.assertRaises(psycopg.errors.NoDataFound):self.reserve({'resource':'users','record_id':'103','field':'profile_image'})
 def test_customer_cannot_change_shared_master(self):
  target={'resource':'base_products','record_id':'1','field':'image'}
  with self.assertRaises(psycopg.errors.NoDataFound):self.reserve(target,self.media(target)['version'])
 def test_product_photo_creates_child_and_keeps_existing_legacy_images(self):
  p=self.f.preset();target={'resource':'products','record_id':p['id'],'field':'images'};v=self.media(target)['version'];u=self.reserve(target,v);self.verify(u);r=self.attach(u,v);self.assertEqual(r['resource'],'product_images');self.assertEqual(self.media({k:r[k] for k in ['resource','record_id','field']})['status'],'ready');self.assertEqual(self.f.raw('SELECT product_id FROM sa_snapshot_20261019.sa_product_images WHERE id=%s',(int(r['record_id']),)),[(int(p['id']),)])
 def test_video_reference_allowed_only_in_attachment_slot(self):
  target=dict(self.target,field='attachment');v=self.media(target)['version'];u=self.reserve(target,v,{'filename':'reference.mp4','bytes':'104857600','content_type':'video/mp4'});self.assertEqual(u['bytes'],'104857600')
 def test_own_profile_photo(self):
  target={'resource':'users','record_id':'103','field':'profile_image'};v=self.media(target)['version'];u=self.reserve(target,v);self.verify(u);self.assertEqual(self.attach(u,v)['entity_version'],'0:1')
class UploadCleanup(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):self.c=connect();self.c.execute('BEGIN')
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def fixture(self,age,state='reserved'):
  return self.c.execute("INSERT INTO sa_domain.media_uploads(actor_id,generation,resource,record_id,field,expected_version,filename,bytes,content_type,state,expires_at) VALUES(%s,0,'brandings',1,'image','v','x',1,'image/png',%s,now()-%s::interval) RETURNING id",(uid(103),state,age)).fetchone()[0]
 def cleanup(self,ids=None):
  self.c.execute('SET LOCAL ROLE service_role');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
  r=self.c.execute('SELECT canto_api.account_upload_cleanup(%s)',(ids or [],)).fetchone()[0];self.c.execute('RESET ROLE');return r['uploads']
 def test_cleanup_waits_for_last_possible_signed_token(self):
  recent=self.fixture('2 hours 9 minutes');old=self.fixture('2 hours 11 minutes');self.assertEqual([str(old)],[x['id'] for x in self.cleanup()]);self.cleanup([recent,old]);self.assertEqual(self.c.execute('SELECT temp_deleted_at IS NOT NULL FROM sa_domain.media_uploads WHERE id=%s',(recent,)).fetchone(),(False,))
 def test_attached_history_preserved_and_no_objects_removed(self):
  old=self.fixture('3 hours','attached');self.cleanup([old]);self.assertEqual(self.c.execute('SELECT state,temp_deleted_at IS NOT NULL FROM sa_domain.media_uploads WHERE id=%s',(old,)).fetchone(),('attached',True));self.assertEqual(self.cleanup(),[])
 def test_batch_bounded_and_ack_idempotent(self):
  for _ in range(105):self.fixture('3 hours')
  batch=self.cleanup();self.assertEqual(len(batch),100);ids=[uuid.UUID(x['id']) for x in batch];self.assertEqual(len(self.cleanup(ids)),5);self.assertEqual(len(self.cleanup(ids)),5)
 def test_app_cannot_cleanup(self):
  session(self.c,103)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.c.execute('SELECT canto_api.account_upload_cleanup()')

if __name__=='__main__':unittest.main(verbosity=2)
