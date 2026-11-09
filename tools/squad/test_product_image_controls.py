"""Owned preset image metadata, real RLS, cursor and media concurrency contracts."""
import unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue,FEATURES
from test_pricing import CONFIG
from sqlstate_assertions import assert_app_conflict
from release_mirror import security_check

class ProductImageControls(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_domain.runtime_state SET allow_test_writes=true');self.actor_id=103;session(self.c,103)
  self.p=self.preset();self.i=self.image(self.p['id'],'Original note')
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def actor(self,n):self.c.execute('RESET ROLE');self.actor_id=n;session(self.c,n)
 def raw(self,sql,args=()):
  self.c.execute('RESET ROLE');r=self.c.execute(sql,args);data=r.fetchall() if r.description else None;session(self.c,self.actor_id);return data
 def preset(self):return rpc(self.c,'v1_product_configure',(Jsonb(CONFIG),'Image test','',uuid.uuid4()))
 def image(self,p,comment):return self.raw("INSERT INTO sa_snapshot_20261019.sa_product_images(product_id,image,comment,created_at,updated_at) VALUES(%s,'/uploads/original.png',%s,now(),now()) RETURNING id",(int(p),comment))[0][0]
 def listing(self,p=None,cursor=None,limit=30):return rpc(self.c,'v1_product_images',(int(p or self.p['id']),cursor,limit))
 def save(self,comment='Updated',version=None,key=None,image=None):return rpc(self.c,'v1_product_image_comment',(image or self.i,comment,version or self.p['version'],key or uuid.uuid4()))
 def test_bounded_projection_no_raw_url_and_empty_page_context(self):
  result=self.listing();self.assertTrue(result['can_edit']);self.assertEqual(result['version'],self.p['version']);r=result['data'][0]
  self.assertEqual(set(r),{'id','comment','comment_truncated','image','version'});self.assertEqual(r['comment'],'Original note');self.assertEqual(r['image']['record_id'],str(self.i));self.assertNotIn('/uploads/',str(result))
  self.raw('DELETE FROM sa_snapshot_20261019.sa_product_images WHERE id=%s',(self.i,));self.assertEqual(self.listing()['data'],[])
 def test_exact_retry_and_before_after_audit(self):
  key=uuid.uuid4();result=self.save(key=key);self.assertEqual(result,self.save(key=key));self.assertNotEqual(result['version'],self.p['version']);self.assertEqual(result['id'],str(self.i))
  rows=self.raw("SELECT changes FROM sa_domain.audit WHERE command_key=%s",(key,));self.assertEqual(len(rows),1);self.assertEqual(rows[0][0]['before_comment'],'Original note');self.assertEqual(rows[0][0]['after_comment'],'Updated')
 def test_product_version_conflicts_across_images_and_media(self):
  second=self.image(self.p['id'],'Second');self.save()
  with assert_app_conflict(self):self.save(image=second)
 def test_cursor_bound_to_product_version_and_actor(self):
  self.image(self.p['id'],'Second');page=self.listing(limit=1);self.assertIsNotNone(page['next_cursor']);next_=self.listing(cursor=page['next_cursor'],limit=1);self.assertNotEqual(page['data'][0]['id'],next_['data'][0]['id'])
  self.save()
  with self.assertRaises(psycopg.Error),self.c.transaction():self.listing(cursor=page['next_cursor'])
  self.actor(100)
  with self.assertRaises(psycopg.Error),self.c.transaction():self.listing(cursor=page['next_cursor'])
 def test_other_customer_has_no_read_or_write_scope(self):
  self.actor(203)
  with self.assertRaises(psycopg.errors.NoDataFound),self.c.transaction():self.listing()
  with self.assertRaises(psycopg.errors.NoDataFound),self.c.transaction():self.save()
 def test_admin_read_is_not_owner_edit_authority(self):
  self.actor(100);self.assertFalse(self.listing()['can_edit'])
  with self.assertRaises(psycopg.errors.NoDataFound):self.save()
 def test_visible_order_customer_can_read_but_not_edit_sc_image(self):
  self.actor(101);p=self.preset();i=self.image(p['id'],'Coordinator reference');self.raw('UPDATE sa_snapshot_20261019.sa_items SET product_id=%s WHERE id=1001',(int(p['id']),));self.actor(103)
  result=self.listing(p['id']);self.assertFalse(result['can_edit']);self.assertEqual(result['data'][0]['id'],str(i))
  with self.assertRaises(psycopg.errors.NoDataFound):self.save(image=i,version=p['version'])
 def test_comment_length_null_and_key_payload_conflict(self):
  for comment in [None,'x'*4001]:
   with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.save(comment)
  key=uuid.uuid4();self.save('x'*4000,key=key)
  with self.assertRaises(psycopg.errors.InvalidParameterValue),self.c.transaction():self.save('different',key=key)
 def test_legacy_oversized_comment_is_explicitly_truncated(self):
  self.raw('UPDATE sa_snapshot_20261019.sa_product_images SET comment=%s WHERE id=%s',('z'*4001,self.i));r=self.listing()['data'][0];self.assertTrue(r['comment_truncated']);self.assertEqual(len(r['comment']),4000)
 def test_mirror_fence_denies_comment_without_modifying_source(self):
  self.raw('UPDATE sa_domain.runtime_state SET allow_test_writes=false')
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.save()
 def test_revoked_configure_capability_denies_read_and_write(self):
  self.actor(112)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.listing()
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.save()
 def test_same_config_owner_reuse_never_returns_foreign_images(self):
  same=self.preset();self.assertEqual(same['id'],self.p['id']);self.assertTrue(same['reused']);self.assertEqual(self.listing()['data'][0]['id'],str(self.i))
  self.actor(203);other=self.preset();self.assertNotEqual(other['id'],same['id']);self.assertFalse(other['reused']);self.assertEqual(self.listing(other['id'])['data'],[])
 def test_application_cannot_direct_update_image_or_product_link(self):
  with self.assertRaises(psycopg.errors.InsufficientPrivilege),self.c.transaction():self.c.execute('UPDATE sa_snapshot_20261019.sa_product_images SET comment=\'bypass\' WHERE id=%s',(self.i,))
  self.c.execute('RESET ROLE');security_check(self.c)
 def test_comment_update_invalidates_existing_media_checksum(self):
  self.c.execute('RESET ROLE');before=self.c.execute("SELECT sa_domain.media_target('product_images',%s,'image',false)",(self.i,)).fetchone()[0];session(self.c,103)
  result=self.save();self.c.execute('RESET ROLE');after=self.c.execute("SELECT sa_domain.media_target('product_images',%s,'image',false)",(self.i,)).fetchone()[0]
  self.assertNotEqual(before['version'],after['version']);self.assertEqual(after['entity_version'],result['version']);self.assertEqual(before['source'],after['source'])

if __name__=='__main__':unittest.main(verbosity=2)
