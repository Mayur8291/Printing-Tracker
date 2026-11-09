"""Local SQL authority/lifecycle tests for source-parity catalogue terms upload."""
import json,unittest,uuid
import psycopg
from psycopg.types.json import Jsonb
from psycopg import sql
from local_db import connect
from fixtures import session,rpc
from test_catalogue import seed_catalogue
import test_notifications as notifications

class DocumentAttachments(unittest.TestCase):
 actor_as=notifications.Notifications.actor_as;raw=notifications.Notifications.raw
 @classmethod
 def setUpClass(cls):
  with connect() as c:seed_catalogue(c)
 def setUp(self):
  self.c=connect();self.c.execute('BEGIN');self.c.execute('UPDATE sa_sync.environment_state SET cutover=true');self.actor_as(103)
 def tearDown(self):self.c.execute('ROLLBACK');self.c.close()
 def call(self,name,*args):
  return self.c.execute(sql.SQL('SELECT canto_api.{}({})').format(sql.Identifier(name),sql.SQL(',').join(sql.Placeholder() for _ in args)),args).fetchone()[0]
 def reserve(self,key=None,mime='application/pdf',size=30):
  return self.call('account_document_attachment_reserve',Jsonb({'filename':'terms.pdf','bytes':size,'content_type':mime}),key or uuid.uuid4())
 def verified(self,u):
  self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'service_role'}),));self.c.execute('SET LOCAL ROLE service_role')
  self.call('account_upload_verified',uuid.UUID(u['upload_id']),'a'*64,30,'application/pdf');self.actor_as(103)
 def attach(self,u,key=None):return rpc(self.c,'v1_document_attachment_attach',(uuid.UUID(u['upload_id']),key or uuid.uuid4()))
 def ready(self):
  u=self.reserve();self.verified(u);return u,self.attach(u)
 def test_same_reserve_and_attach_key_replay(self):
  k=uuid.uuid4();u=self.reserve(k);self.assertEqual(self.reserve(k),u);self.verified(u);k=uuid.uuid4();r=self.attach(u,k);self.assertEqual(self.attach(u,k),r)
  media=self.call('account_media_resolve',Jsonb([{k:r[k] for k in ['resource','record_id','field']}]))['references'][0]
  self.assertEqual(media['status'],'ready');self.assertEqual(media['content_type'],'application/pdf')
 def test_unverified_attach_denied(self):
  u=self.reserve()
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.attach(u)
 def test_foreign_actor_cannot_resolve(self):
  _,r=self.ready();self.actor_as(203)
  with self.assertRaises(psycopg.errors.NoDataFound):self.call('account_media_resolve',Jsonb([{k:r[k] for k in ['resource','record_id','field']}]))
 def test_foreign_upload_not_found(self):
  u=self.reserve();self.actor_as(203)
  with self.assertRaises(psycopg.errors.NoDataFound):self.call('account_upload_get',uuid.UUID(u['upload_id']))
 def test_missing_capability_denied(self):
  self.actor_as(112)
  with self.assertRaises(psycopg.errors.InsufficientPrivilege):self.reserve()
 def test_large_attachment_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.reserve(size=5242881)
 def test_svg_denied(self):
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.reserve(mime='image/svg+xml')
 def test_plain_text_reserved(self):self.assertEqual(self.reserve(mime='text/plain')['content_type'],'text/plain')
 def test_source_refresh_invalidates_upload(self):
  u=self.reserve();self.raw('UPDATE sa_domain.runtime_state SET generation=generation+1')
  with self.assertRaises(psycopg.errors.NoDataFound):self.call('account_upload_get',uuid.UUID(u['upload_id']))
 def test_other_upload_route_cannot_replace_immutable_attachment(self):
  u,r=self.ready()
  with self.assertRaises(psycopg.errors.InvalidParameterValue):self.call('account_upload_reserve',Jsonb({k:r[k] for k in ['resource','record_id','field']}),Jsonb({'filename':'replace.png','bytes':30,'content_type':'image/png'}),u['expected_version'],uuid.uuid4())
 def test_reference_survives_request_queue_and_capture_after_expiry(self):
  _,r=self.ready();ref={k:r[k] for k in ['resource','record_id','field']}
  d=rpc(self.c,'v1_document_request',('catalogue',Jsonb({'terms_reference':ref}),uuid.uuid4()))
  self.raw("UPDATE sa_domain.document_attachments SET expires_at=now()-interval '1 day'")
  self.c.execute('SET LOCAL ROLE sa_executor');captured=self.c.execute('SELECT sa_domain.document_capture(%s)',(uuid.UUID(d['id']),)).fetchone()[0]
  self.assertEqual(captured['snapshot']['terms_attachment']['content_type'],'application/pdf')
  self.assertIsNotNone(self.raw('SELECT claimed_at FROM sa_domain.document_attachments')[0][0])
 def test_unclaimed_expired_reference_is_unavailable(self):
  _,r=self.ready();self.raw("UPDATE sa_domain.document_attachments SET expires_at=now()-interval '1 day'")
  with self.assertRaises(psycopg.errors.NoDataFound):self.call('account_media_resolve',Jsonb([{k:r[k] for k in ['resource','record_id','field']}]))
 def test_reserved_expiry_uses_existing_upload_lease(self):
  u=self.reserve();self.raw("UPDATE sa_domain.media_uploads SET expires_at=now()-interval '1 second'")
  with self.assertRaises(psycopg.errors.ObjectNotInPrerequisiteState):self.call('account_upload_get',uuid.UUID(u['upload_id']))
 def cleanup(self):
  self.c.execute('RESET ROLE');self.c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps({'role':'service_role'}),));self.c.execute('SET LOCAL ROLE service_role');self.call('account_upload_cleanup',[]);self.actor_as(103)
 def test_cleanup_expires_unclaimed_and_removes_only_reference(self):
  _,r=self.ready();self.raw("UPDATE sa_domain.document_attachments SET expires_at=now()-interval '1 day'");self.cleanup()
  self.assertEqual(self.raw('SELECT state FROM sa_domain.document_attachments')[0][0],'expired')
  self.assertFalse(self.raw("SELECT 1 FROM sa_media.references WHERE resource='document_attachments'"))
  self.assertTrue(self.raw('SELECT 1 FROM sa_media.objects'))
 def test_cleanup_keeps_queued_document_attachment(self):
  _,r=self.ready();ref={k:r[k] for k in ['resource','record_id','field']};rpc(self.c,'v1_document_request',('catalogue',Jsonb({'terms_reference':ref}),uuid.uuid4()))
  self.raw("UPDATE sa_domain.document_attachments SET expires_at=now()-interval '1 day'");self.cleanup()
  self.assertEqual(self.raw('SELECT state FROM sa_domain.document_attachments')[0][0],'ready')
 def test_no_anonymous_platform_or_direct_table_access(self):
  for role in ['anon','authenticated','sa_app']:
   self.assertFalse(self.raw("SELECT has_table_privilege(%s,'sa_domain.document_attachments','SELECT')",(role,))[0][0])
  for role in ['anon','authenticated','service_role']:
   self.assertFalse(self.raw("SELECT has_function_privilege(%s,'canto_api.account_document_attachment_reserve(jsonb,uuid)','EXECUTE')",(role,))[0][0])

if __name__=='__main__':unittest.main(verbosity=2)
