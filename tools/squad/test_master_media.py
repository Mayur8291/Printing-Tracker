"""Atomic master form/media transactions use the real legacy dispatcher."""
from sqlstate_assertions import assert_app_conflict
import unittest,uuid,json
import psycopg
from psycopg.types.json import Jsonb
from fixtures import session,uid
from local_db import connect
from test_catalogue import seed_catalogue
class MasterMedia(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute("SELECT setval('sa_snapshot_20261019.sa_base_product_types_id_seq',10000),setval('sa_snapshot_20261019.sa_base_products_id_seq',10000)");self.actor=999;session(self.c,999,'authenticated')
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(q,args);rows=r.fetchall() if r.description else None;session(self.c,self.actor,'authenticated' if self.actor==999 else 'sa_app');return rows
 def reserve(self,resource='base_products',field='image',id=None):
  target={'resource':resource,'record_id':str(id) if id else None,'field':field};version='new' if id is None else self.c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb([target]),)).fetchone()[0]['references'][0]['version']
  u=self.c.execute('SELECT canto_api.account_upload_reserve(%s,%s,%s,%s)',(Jsonb(target),Jsonb({'filename':'x.png','bytes':'10','content_type':'image/png'}),version,uuid.uuid4())).fetchone()[0]
  self.c.execute('SET LOCAL ROLE service_role');self.c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)");self.c.execute('SELECT canto_api.account_upload_verified(%s,%s,10,\'image/png\')',(uuid.UUID(u['upload_id']),'a'*64));self.c.execute('RESET ROLE');session(self.c,999,'authenticated');return uuid.UUID(u['upload_id'])
 def save(self,resource,action,payload,uploads=None,key=None):return self.c.execute('SELECT canto_api.account_master_save(%s,%s,%s,%s,%s)',(resource,action,Jsonb(payload),uploads or [],key or uuid.uuid4())).fetchone()[0]
 def test_create_with_private_image_is_atomic_and_retry_safe(self):
  u=self.reserve('base_product_types');key=uuid.uuid4();payload={'values':{'name':'New private type'}};r=self.save('base_product_types','create',payload,[u],key);self.assertTrue(r['image'].startswith('canto-media://'));self.assertEqual(r,self.save('base_product_types','create',payload,[u],key));self.assertEqual(self.raw('SELECT state,record_id FROM sa_domain.media_uploads WHERE id=%s',(u,)),[('attached',r['id'])])
 def test_bad_relations_leave_neither_record_nor_attachment(self):
  u=self.reserve();before=self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_base_products')
  with self.c.transaction():
   try:self.save('base_products','create',{'values':{'name':'Bad relation','base_of':1,'base_sn':1,'tims_cost':1,'adult_consumption':1,'kids_consumption':1,'over_header_percentage':1,'sample_rate':1,'calculator':1},'relations':{'fabrics':['999999']}},[u])
   except psycopg.errors.ForeignKeyViolation:raise psycopg.Rollback()
   else:self.fail('Invalid relation accepted')
  self.assertEqual(self.raw('SELECT count(*) FROM sa_snapshot_20261019.sa_base_products'),before);self.assertEqual(self.raw('SELECT state FROM sa_domain.media_uploads WHERE id=%s',(u,)),[('verified',)])
 def test_missing_uploaded_file_rolls_back_metadata(self):
  row=self.c.execute("SELECT canto_api.masters('base_product_types','get','{\"id\":\"1\"}')").fetchone()[0]
  with self.c.transaction():
   try:self.save('base_product_types','update',{'id':'1','values':{'name':'Must roll back'},'expectedUpdatedAt':row['updated_at']},[uuid.uuid4()])
   except psycopg.errors.NoDataFound:raise psycopg.Rollback()
   else:self.fail('Unknown upload accepted')
  self.assertEqual(self.raw('SELECT name FROM sa_snapshot_20261019.sa_base_product_types WHERE id=1'),[('Shirts',)])
 def test_stale_form_cannot_publish_staged_file(self):
  u=self.reserve('base_product_types','image',1);row=self.c.execute("SELECT canto_api.masters('base_product_types','get','{\"id\":\"1\"}')").fetchone()[0];self.raw("UPDATE sa_snapshot_20261019.sa_base_product_types SET updated_at=now()+interval '1 second' WHERE id=1")
  with assert_app_conflict(self):self.save('base_product_types','update',{'id':'1','values':{'name':'Stale'},'expectedUpdatedAt':row['updated_at']},[u])
 def test_foreign_resource_lease_denied(self):
  u=self.reserve('base_product_types')
  with self.assertRaises(psycopg.errors.NoDataFound):self.save('base_products','create',{'values':{'name':'Foreign'}},[u])
 def test_customer_cannot_reserve_master_draft(self):
  self.actor=103;self.c.execute('RESET ROLE');session(self.c,103)
  with self.assertRaises(psycopg.errors.NoDataFound):self.reserve()
 def test_draft_cannot_target_personal_fields(self):
  with self.assertRaises(psycopg.errors.NoDataFound):self.reserve('brandings')
 def test_expired_lease_rejects_whole_save(self):
  u=self.reserve('base_product_types');self.raw("UPDATE sa_domain.media_uploads SET expires_at=now()-interval '1 second'")
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.save('base_product_types','create',{'values':{'name':'Expired'}},[u])
 def test_update_requires_form_version(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save('base_product_types','update',{'id':'1','values':{'name':'No version'}})
 def test_raw_media_url_cannot_bypass_verification(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save('base_product_types','create',{'values':{'name':'Unsafe','image':'https://elsewhere.invalid/a.png'}})
 def test_duplicate_media_field_rejected(self):
  a=self.reserve('base_product_types');b=self.reserve('base_product_types')
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save('base_product_types','create',{'values':{'name':'Duplicate'}},[a,b])
 def test_master_storage_policy_denies_personal_unreferenced_and_stale_paths(self):
  self.raw("INSERT INTO sa_media.objects(sha256,object_path,bytes,content_type) VALUES(%s,%s,10,'image/png')",('b'*64,'sha256/bb/'+'b'*64));path='sha256/bb/'+'b'*64
  self.assertFalse(self.c.execute('SELECT sa_domain.master_storage_path(%s)',(path,)).fetchone()[0])
  self.raw("UPDATE sa_snapshot_20261019.sa_users SET profile_image='photo.png' WHERE id=103");self.raw("INSERT INTO sa_media.references(resource,record_id,field,source_value,status,sha256) VALUES('users',103,'profile_image','photo.png','ready',%s)",('b'*64,));self.assertFalse(self.c.execute('SELECT sa_domain.master_storage_path(%s)',(path,)).fetchone()[0])
  self.raw("UPDATE sa_snapshot_20261019.sa_base_product_types SET image='photo.png' WHERE id=1");self.raw("INSERT INTO sa_media.references(resource,record_id,field,source_value,status,sha256) VALUES('base_product_types',1,'image','photo.png','ready',%s)",('b'*64,));self.assertTrue(self.c.execute('SELECT sa_domain.master_storage_path(%s)',(path,)).fetchone()[0]);self.raw("UPDATE sa_snapshot_20261019.sa_base_product_types SET image='changed.png' WHERE id=1");self.assertFalse(self.c.execute('SELECT sa_domain.master_storage_path(%s)',(path,)).fetchone()[0])
 def test_private_file_detach_through_form(self):
  u=self.reserve('base_product_types');r=self.save('base_product_types','create',{'values':{'name':'Detach image'}},[u]);r=self.save('base_product_types','update',{'id':str(r['id']),'expectedUpdatedAt':r['updated_at'],'values':{'image':None}});self.assertIsNone(r['image']);self.assertEqual(self.raw('SELECT count(*) FROM sa_media.objects'),[(1,)])
 def test_virtual_master_fields_use_same_private_file_pipeline(self):
  for resource in ('rmp_brands','rmp_sizes','rmp_skus'):
   with self.subTest(resource=resource):
    u=self.reserve(resource,'image',1);row=self.c.execute("SELECT canto_api.masters(%s,'get','{\"id\":\"1\"}')",(resource,)).fetchone()[0]
    r=self.save(resource,'update',{'id':'1','expectedUpdatedAt':row['updated_at'],'values':{}},[u]);self.assertTrue(r['image'].startswith('canto-media://'))
    grant=self.c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb([{'resource':resource,'record_id':'1','field':'image'}]),)).fetchone()[0]['references'][0];self.assertEqual(grant['status'],'ready')
    self.assertTrue(self.c.execute('SELECT sa_domain.master_storage_path(%s)',('sha256/aa/'+'a'*64,)).fetchone()[0])
    r=self.save(resource,'update',{'id':'1','expectedUpdatedAt':r['updated_at'],'values':{'image':None}});self.assertFalse(r.get('image'));self.assertFalse(self.raw('SELECT FROM sa_admin.media WHERE resource=%s',(resource,)))
 def test_virtual_brand_scope_retains_dealer_brand_restrictions(self):
  u=self.reserve('rmp_brands','image',2);row=self.c.execute("SELECT canto_api.masters('rmp_brands','get','{\"id\":\"2\"}')").fetchone()[0];self.save('rmp_brands','update',{'id':'2','expectedUpdatedAt':row['updated_at'],'values':{}},[u]);self.actor=110;self.c.execute('RESET ROLE');session(self.c,110)
  with self.assertRaises(psycopg.errors.NoDataFound):self.c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb([{'resource':'rmp_brands','record_id':'2','field':'image'}]),))
 def test_read_record_resolves_verified_video_and_preserves_supported_external_links(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_rmp_classes SET embeded_video='squad:hash' WHERE id=1");self.raw("INSERT INTO sa_media.objects(sha256,object_path,bytes,content_type) VALUES(%s,%s,10,'video/mp4')",('b'*64,'sha256/bb/'+'b'*64));self.raw("INSERT INTO sa_media.references(resource,record_id,field,source_value,status,sha256) VALUES('rmp_classes',1,'embeded_video','squad:hash','ready',%s)",('b'*64,));r=self.c.execute("SELECT canto_api.masters('rmp_classes','get','{\"id\":\"1\"}')").fetchone()[0];self.assertTrue(r['embeded_video'].startswith('canto-media://'))
  self.raw("UPDATE sa_snapshot_20261019.sa_rmp_classes SET embeded_video='https://youtu.be/example' WHERE id=1");r=self.c.execute("SELECT canto_api.masters('rmp_classes','get','{\"id\":\"1\"}')").fetchone()[0];self.assertEqual(r['embeded_video'],'https://youtu.be/example')
 def test_safe_external_links_get_a_current_reference_and_can_be_cleared(self):
  row=self.c.execute("SELECT canto_api.masters('rmp_classes','get','{\"id\":\"1\"}')").fetchone()[0];r=self.save('rmp_classes','update',{'id':'1','expectedUpdatedAt':row['updated_at'],'values':{'embeded_video':'https://youtu.be/test'}});self.assertEqual(r['embeded_video'],'https://youtu.be/test')
  target=[{'resource':'rmp_classes','record_id':'1','field':'embeded_video'}];grant=self.c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb(target),)).fetchone()[0]['references'][0];self.assertEqual(grant['status'],'external');self.assertEqual(grant['url'],'https://youtu.be/test');r=self.save('rmp_classes','update',{'id':'1','expectedUpdatedAt':r['updated_at'],'values':{'embeded_video':None}});self.assertIsNone(r['embeded_video'])
 def test_untrusted_external_link_cannot_be_published(self):
  row=self.c.execute("SELECT canto_api.masters('rmp_classes','get','{\"id\":\"1\"}')").fetchone()[0]
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.save('rmp_classes','update',{'id':'1','expectedUpdatedAt':row['updated_at'],'values':{'embeded_video':'https://youtube.com.attacker.invalid/test'}})
if __name__=='__main__':unittest.main(verbosity=2)
