"""Media resolution validates source pointers and the live business resource."""
import json,unittest,uuid
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,uid
from test_catalogue import seed_catalogue
class MediaGrants(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.actor_id=103
  self.c.execute("INSERT INTO sa_media.objects(sha256,object_path,bytes,content_type) VALUES(%s,%s,10,'image/png')",('a'*64,'sha256/aa/'+'a'*64))
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_products(id,name,created_by_id,base_product_id,product_type,created_at,updated_at) VALUES(501,'Own',103,1,0,now(),now()),(502,'Foreign',203,1,0,now(),now()),(503,'Worker',111,1,0,now(),now())")
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_product_images(id,product_id,image,created_at,updated_at) VALUES(501,501,'own.png',now(),now()),(502,502,'foreign.png',now(),now()),(503,503,'worker.png',now(),now())")
  self.c.execute("INSERT INTO sa_snapshot_20261019.sa_catalogues(id,user_id,url,created_at,updated_at) VALUES(501,103,'own.pdf',now(),now()),(502,203,'foreign.pdf',now(),now())")
  session(self.c,103)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.actor_id=n;self.c.execute('RESET ROLE');session(self.c,n,'authenticated' if n==999 else 'sa_app')
 def raw(self,q,args=()):
  self.c.execute('RESET ROLE');cur=self.c.execute(q,args);r=cur.fetchall() if cur.description else None;session(self.c,self.actor_id,'authenticated' if self.actor_id==999 else 'sa_app');return r
 def reference(self,resource,id,field,value='test.png',status='ready',pointer=''):
  self.raw('INSERT INTO sa_media.references(resource,record_id,field,pointer,source_value,status,sha256) VALUES(%s,%s,%s,%s,%s,%s,%s)',(resource,id,field,pointer,value,status,'a'*64 if status=='ready' else None))
  if not pointer:self.raw(sql.SQL('UPDATE sa_snapshot_20261019.{} SET {}=%s WHERE id=%s').format(sql.Identifier('sa_'+resource),sql.Identifier(field)),(value,id))
  return {'resource':resource,'record_id':str(id),'field':field,'pointer':pointer}
 def resolve(self,*refs):return self.c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb(list(refs)),)).fetchone()[0]['references']
 def test_customer_catalogue_file_resolves_without_source_url(self):
  r=self.resolve(self.reference('base_products',1,'image'))[0];self.assertEqual(r['status'],'ready');self.assertEqual(r['bucket'],'canto-media');self.assertNotIn('source_value',r);self.assertNotIn('source_url',r)
 def test_own_product_image(self):self.assertEqual(self.resolve(self.reference('product_images',501,'image'))[0]['status'],'ready')
 def test_foreign_product_image_denied(self):
  ref=self.reference('product_images',502,'image')
  with self.assertRaises(psycopg.errors.NoDataFound):self.resolve(ref)
 def test_mixed_batch_fails_without_partial_grants(self):
  good=self.reference('base_products',1,'image');bad=self.reference('product_images',502,'image')
  with self.assertRaises(psycopg.errors.NoDataFound):self.resolve(good,bad)
 def test_source_change_cannot_resolve_stale_object(self):
  ref=self.reference('product_images',501,'image');self.raw("UPDATE sa_snapshot_20261019.sa_product_images SET image='new.png' WHERE id=501")
  r=self.resolve(ref)[0];self.assertEqual(r['status'],'pending');self.assertNotIn('object_path',r)
 def test_missing_is_explicit(self):
  r=self.resolve(self.reference('base_products',1,'image',status='missing'))[0];self.assertEqual(r['status'],'missing');self.assertNotIn('object_path',r)
 def test_uninventoried_nonempty_is_pending(self):
  self.raw("UPDATE sa_snapshot_20261019.sa_base_products SET image='unknown.png' WHERE id=1")
  self.assertEqual(self.resolve({'resource':'base_products','record_id':'1','field':'image'})[0]['status'],'pending')
 def test_empty_field_has_no_grant(self):self.assertEqual(self.resolve({'resource':'base_products','record_id':'1','field':'image'})[0]['status'],'empty')
 def test_missing_object_metadata_is_not_ready(self):
  ref=self.reference('base_products',1,'image');self.raw('DELETE FROM sa_media.objects');self.assertEqual(self.resolve(ref)[0]['status'],'unavailable')
 def test_unapproved_source_host_not_returned(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_promotions(id,name,created_at,updated_at) VALUES(501,'P',now(),now())")
  r=self.resolve(self.reference('promotions',501,'link','https://unknown.invalid/file',status='external'))[0];self.assertEqual(r['status'],'external_unavailable');self.assertNotIn('url',r)
 def test_supported_external_provider_not_fetched_or_rewritten(self):
  self.raw("INSERT INTO sa_snapshot_20261019.sa_promotions(id,name,created_at,updated_at) VALUES(501,'P',now(),now())")
  r=self.resolve(self.reference('promotions',501,'link','https://drive.google.com/file/123',status='external'))[0];self.assertEqual(r['url'],'https://drive.google.com/file/123');self.assertNotIn('object_path',r)
 def test_json_pointer_matches_exact_source_leaf(self):
  value='https://source.invalid/path';self.raw('UPDATE sa_snapshot_20261019.sa_products SET images=%s WHERE id=501',(json.dumps({'a/b':{'~c':[value]}}),))
  ref=self.reference('products',501,'images',value,pointer='/a~1b/~0c/0');self.assertEqual(self.resolve(ref)[0]['status'],'ready')
 def test_embedded_unicode_text_range(self):
  value='See नमस्ते https://source.invalid/path now';url='https://source.invalid/path';start=value.index(url)
  self.raw('UPDATE sa_snapshot_20261019.sa_products SET comment=%s WHERE id=501',(value,));ref=self.reference('products',501,'comment',url,pointer=f'#text:{start}:{start+len(url)}');self.assertEqual(self.resolve(ref)[0]['status'],'ready')
 def test_wrong_pointer_not_signed(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_products SET images=%s WHERE id=501',(json.dumps(['one']),));ref=self.reference('products',501,'images','other',pointer='/0');self.assertEqual(self.resolve(ref)[0]['status'],'pending')
 def test_record_field_allowlist(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.resolve({'resource':'users','record_id':'103','field':'encrypted_password'})
 def test_unknown_input_fields(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.resolve({'resource':'base_products','record_id':'1','field':'image','path':'arbitrary'})
 def test_batch_limit(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.resolve(*[{'resource':'base_products','record_id':'1','field':'image'}]*26)
 def test_revoked_session(self):
  ref=self.reference('base_products',1,'image');self.raw('DELETE FROM auth.sessions WHERE user_id=%s',(uid(103),))
  with self.assertRaises(psycopg.errors.InvalidAuthorizationSpecification):self.resolve(ref)
 def test_foreign_profile_denied(self):
  ref=self.reference('users',203,'profile_image')
  with self.assertRaises(psycopg.errors.NoDataFound):self.resolve(ref)
 def test_own_profile_allowed(self):self.assertEqual(self.resolve(self.reference('users',103,'profile_image'))[0]['status'],'ready')
 def test_dealer_unassigned_brand_class_denied(self):
  ref=self.reference('rmp_classes',2,'image_1');self.actor(110)
  with self.assertRaises(psycopg.errors.NoDataFound):self.resolve(ref)
 def test_dealer_assigned_brand_class_allowed(self):
  ref=self.reference('rmp_classes',1,'image_1');self.actor(110);self.assertEqual(self.resolve(ref)[0]['status'],'ready')
 def test_platform_master_allowed(self):
  ref=self.reference('base_products',1,'image');self.actor(999);self.assertEqual(self.resolve(ref)[0]['status'],'ready')
 def test_platform_customer_media_denied(self):
  ref=self.reference('users',103,'profile_image');self.actor(999)
  with self.assertRaises(psycopg.errors.NoDataFound):self.resolve(ref)
 def test_own_catalogue_document_allowed(self):self.assertEqual(self.resolve(self.reference('catalogues',501,'url'))[0]['status'],'ready')
 def test_other_catalogue_document_denied(self):
  ref=self.reference('catalogues',502,'url')
  with self.assertRaises(psycopg.errors.NoDataFound):self.resolve(ref)
 def test_expired_catalogue_denied(self):
  ref=self.reference('catalogues',501,'url');self.raw('UPDATE sa_snapshot_20261019.sa_catalogues SET is_expired=true WHERE id=501')
  with self.assertRaises(psycopg.errors.NoDataFound):self.resolve(ref)
 def test_worker_feature_off_own_unassigned_preset_denied(self):
  ref=self.reference('product_images',503,'image');self.actor(111)
  with self.assertRaises(psycopg.errors.NoDataFound):self.resolve(ref)
 def test_worker_feature_off_assigned_work_allowed(self):
  ref=self.reference('product_images',503,'image');self.raw('UPDATE sa_snapshot_20261019.sa_items SET product_id=503 WHERE id=1001');self.actor(111);self.assertEqual(self.resolve(ref)[0]['status'],'ready')
 def test_factory_assigned_work_allowed_without_catalogue(self):
  ref=self.reference('product_images',501,'image');self.raw('UPDATE sa_snapshot_20261019.sa_items SET product_id=501 WHERE id=1001');self.actor(104);self.assertEqual(self.resolve(ref)[0]['status'],'ready')
 def test_factory_foreign_work_denied(self):
  ref=self.reference('product_images',502,'image');self.raw('UPDATE sa_snapshot_20261019.sa_items SET product_id=502 WHERE id=2001');self.actor(104)
  with self.assertRaises(psycopg.errors.NoDataFound):self.resolve(ref)
class InheritedArtwork(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  import test_order_acceptance as acceptance
  self.fixture=acceptance.Orders();self.fixture.setUp();self.c=self.fixture.c
  self.fixture.raw("INSERT INTO sa_media.objects(sha256,object_path,bytes,content_type) VALUES(%s,%s,10,'image/png')",('a'*64,'sha256/aa/'+'a'*64))
 def tearDown(self):self.fixture.tearDown()
 def prepare(self):
  from test_pricing import custom
  f=self.fixture;product=f.preset();design=f.design(True);text='Artwork reference https://source.invalid/reference.png';value=text.split(' ')[-1];start=text.index(value)
  f.raw('UPDATE sa_snapshot_20261019.sa_brandings SET comment=%s WHERE id=%s',(text,int(design['design_id'])))
  self.pointer=f'#text:{start}:{len(text)}'
  f.raw("INSERT INTO sa_media.references(resource,record_id,field,pointer,source_value,status,sha256) VALUES('brandings',%s,'comment',%s,%s,'ready',%s)",(int(design['design_id']),self.pointer,value,'a'*64))
  line=custom();line['brandings']=[design];q=f.quote([line]);order=f.place(q,{'line_settings':{'1':{'product_id':product['id']}}})['orders'][0]
  return product,design,line,order
 def resolve(self,id,field,pointer=''):
  return self.c.execute('SELECT canto_api.account_media_resolve(%s)',(Jsonb([{'resource':'brandings','record_id':str(id),'field':field,'pointer':pointer}]),)).fetchone()[0]['references'][0]
 def test_placed_order_preserves_main_and_embedded_artwork(self):
  _,_,_,order=self.prepare();item=int(order['items'][0]['item_id']);id=self.fixture.raw('SELECT id FROM sa_snapshot_20261019.sa_brandings WHERE item_id=%s',(item,))[0][0]
  self.assertEqual(self.resolve(id,'image')['status'],'ready');self.assertEqual(self.resolve(id,'comment',self.pointer)['status'],'ready')
  self.fixture.actor(203)
  with self.assertRaises(psycopg.errors.NoDataFound):self.resolve(id,'image')
 def test_amended_order_preserves_customer_artwork_and_scope(self):
  from fixtures import rpc
  product,design,line,order=self.prepare();f=self.fixture
  copied=f.raw("SELECT id,sa_domain.version('branding',id) FROM sa_snapshot_20261019.sa_brandings WHERE item_id=%s",(int(order['items'][0]['item_id']),))[0]
  line['brandings'][0]=dict(design,design_id=str(copied[0]),design_version=copied[1]);f.actor(101);q=f.quote([line])
  r=rpc(self.c,'v1_order_edit',(int(order['id']),uuid.UUID(q['quote_id']),q['version'],Jsonb({'due_at':'2026-12-02T00:00:00Z','line_settings':{'1':{'product_id':product['id']}}}),'Artwork inheritance',order['version'],uuid.uuid4()))
  id=f.raw('SELECT id FROM sa_snapshot_20261019.sa_brandings WHERE item_id=%s',(int(r['items'][0]['item_id']),))[0][0]
  self.assertEqual(self.resolve(id,'image')['status'],'ready');self.assertEqual(self.resolve(id,'comment',self.pointer)['status'],'ready')
  f.actor(103);self.assertEqual(self.resolve(id,'image')['status'],'ready')
  f.actor(201)
  with self.assertRaises(psycopg.errors.NoDataFound):self.resolve(id,'image')

if __name__=='__main__':unittest.main(verbosity=2)
