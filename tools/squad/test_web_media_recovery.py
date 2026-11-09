"""Local real reserve/attestation/attach/detach ledger and net-zero cleanup."""
import copy
import json
import unittest
import uuid
from unittest.mock import Mock,patch
from urllib.parse import urlparse
from psycopg.types.json import Jsonb
import test_persona_harness as persona
import test_hosted_business_journeys as business
import web_media_recovery as media


class MediaRecovery(unittest.TestCase):
    setUpClass = classmethod(persona.PersonaHarness.setUpClass.__func__)
    setUp = persona.PersonaHarness.setUp
    tearDown = persona.PersonaHarness.tearDown

    def fixture(self, attach=True):
        c = self.c
        c.execute("UPDATE sa_domain.runtime_state SET allow_test_writes=false,test_actor_ids='{}',test_write_expires_at=NULL")
        state = business.plan(c); media.plan(c, state, business.PRIVATE)
        credentials = business.prepare(c, state)
        actor = next(a for a in credentials if a['role'] == 3); session = uuid.uuid4()
        c.execute('INSERT INTO auth.sessions(id,user_id) VALUES(%s,%s)', (session, actor['auth_id']))
        claims = json.dumps({'role': 'sa_app', 'sub': actor['auth_id'], 'session_id': str(session)})
        entries = []
        def authenticate():
            c.execute('RESET ROLE'); c.execute("SELECT set_config('request.jwt.claims',%s,true)", (claims,)); c.execute('SET LOCAL ROLE sa_app')
        def key(label):
            value = uuid.uuid5(uuid.UUID(state['run_id']), label)
            entries.append({'kind':'command','value':{'key':str(value),'label':label}}); return value
        authenticate(); target = state['web_media']['target']
        for index, item in enumerate(state['web_media']['files']):
            version = c.execute('SELECT canto_api.account_media_resolve(%s)', (Jsonb([target]),)).fetchone()[0]['references'][0]['version']
            upload = c.execute('SELECT canto_api.account_upload_reserve(%s,%s,%s,%s)',
                       (Jsonb(target), Jsonb({'filename':item['filename'],'bytes':str(item['bytes']),'content_type':'image/png'}), version, key(f'web.media.reserve{index}'))).fetchone()[0]
            if not attach: break
            c.execute('RESET ROLE'); c.execute('SET LOCAL ROLE service_role')
            c.execute("SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
            c.execute('SELECT canto_api.account_upload_verified(%s,%s,%s,%s)', (upload['upload_id'], item['sha256'], item['bytes'], 'image/png'))
            authenticate()
            result = c.execute('SELECT canto_api.v1_media_attach(%s,%s,%s)', (upload['upload_id'], version, key(f'web.media.attach{index}'))).fetchone()[0]
        if attach:
            c.execute('SELECT canto_api.v1_media_detach(%s,%s,%s,%s)', (Jsonb(target), result['version'], 'Owned media acceptance complete', key('web.media.detach')))
        c.execute('RESET ROLE')
        return state, entries

    def test_actual_media_lifecycle_restores_baseline_and_retains_audits(self):
        state, entries = self.fixture()
        self.assertEqual(len(media.bindings(self.c, state, entries)), 2)
        # This isolated DB test has no Storage HTTP objects. The hosted wrapper
        # must prove/deletes their bytes before invoking this transactional stage.
        state['web_media']['storage_deleted'] = True
        before_audit = self.c.execute('SELECT count(*) FROM sa_domain.audit').fetchone()[0]
        result = business.cleanup(self.c, state, journal_entries=entries, media_cleanup=media.cleanup_database)
        self.assertEqual(result['owned_commands'], 3)
        self.assertEqual(result['media']['owned_uploads'], 2)
        self.assertTrue(result['media']['existing_media_preserved'])
        self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.audit').fetchone()[0], before_audit+1)
        self.assertEqual(self.c.execute('SELECT count(*) FROM sa_domain.media_history WHERE actor_id=%s', (state['web_media']['actor_id'],)).fetchone()[0], 3)

    def test_foreign_reference_refuses_before_any_deletion(self):
        state, entries = self.fixture()
        self.c.execute("INSERT INTO sa_media.references(resource,record_id,field,sha256,status) VALUES('users',999,'profile_image',%s,'ready')", (state['web_media']['files'][0]['sha256'],))
        with self.assertRaisesRegex(AssertionError, 'Other record'):
            media.bindings(self.c, state, entries)

    def test_missing_journal_cannot_authorize_upload_cleanup(self):
        state, entries = self.fixture()
        with self.assertRaisesRegex(AssertionError, 'reservation command'):
            media.bindings(self.c, state, [])

    def test_incomplete_upload_waits_for_signed_token_grace(self):
        state, entries = self.fixture(attach=False)
        with self.assertRaisesRegex(AssertionError, 'signed PUT'):
            media.bindings(self.c, state, entries)

    def test_manifest_cannot_redirect_or_reuse_unrelated_hash(self):
        state, entries = self.fixture()
        for field, value in [('path','/tmp/foreign.png'), ('sha256','a'*64)]:
            altered = copy.deepcopy(state); altered['web_media']['files'][0][field] = value
            with self.assertRaises(AssertionError): media.validate(altered)

    def test_unexpected_pointer_is_rejected_before_storage(self):
        state, entries = self.fixture()
        self.c.execute("INSERT INTO sa_media.references(resource,record_id,field,pointer,sha256,status) VALUES('users',%s,'profile_image','foreign',%s,'ready')", (int(state['web_media']['target']['record_id']), state['web_media']['files'][0]['sha256']))
        with self.assertRaisesRegex(AssertionError, 'provenance'): media.bindings(self.c,state,entries)

    def test_canonical_metadata_change_is_rejected_before_storage(self):
        state, entries = self.fixture()
        self.c.execute('UPDATE sa_media.objects SET bytes=bytes+1 WHERE sha256=%s', (state['web_media']['files'][0]['sha256'],))
        with self.assertRaisesRegex(AssertionError, 'metadata differs'): media.bindings(self.c,state,entries)

    def test_override_reference_is_rejected_before_storage(self):
        state, entries = self.fixture()
        self.c.execute("INSERT INTO sa_admin.media(resource,record_id,field,url) VALUES('base_products',999,'image',%s)", ('squad:'+state['web_media']['files'][0]['sha256'],))
        with self.assertRaisesRegex(AssertionError, 'override'): media.bindings(self.c,state,entries)

    def test_changed_generation_never_reaches_storage_http(self):
        state, entries = self.fixture()
        self.c.execute('UPDATE sa_domain.runtime_state SET generation=generation+1')
        with patch('web_media_recovery.urllib.request.urlopen') as http:
            with self.assertRaisesRegex(AssertionError,'generation changed'):
                media.cleanup_storage(self.c,state,entries,'unused',Mock(),business.identities.URL)
            http.assert_not_called()

    def storage_fixture(self,state,entries):
        objects={}
        for upload,item in media.bindings(self.c,state,entries):
            index=state['web_media']['files'].index(item)
            for bucket,name in [('squad-uploads','pending/'+upload['id']),('canto-media',item['canonical'])]:
                self.c.execute('INSERT INTO storage.objects(id,bucket_id,name) VALUES(%s,%s,%s)',(uuid.uuid4(),bucket,name))
                objects[(bucket,name)]=media.png(state['run_id'],index)
        return objects

    def test_storage_delete_requires_manifest_bytes_and_preserves_catalog_baseline(self):
        state,entries=self.fixture();objects=self.storage_fixture(state,entries);deleted=[]
        class Response:
            status=200
            def __init__(self,data=b''):self.data=data
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return self.data[:limit]
        def http(request,timeout):
            path=urlparse(request.full_url).path
            if request.get_method()=='GET':
                bucket,name=path.removeprefix('/storage/v1/object/authenticated/').split('/',1)
                return Response(objects[(bucket,name)])
            self.assertEqual(request.get_method(),'DELETE')
            bucket=path.removeprefix('/storage/v1/object/');names=json.loads(request.data)['prefixes']
            for name in names:self.assertIn((bucket,name),objects)
            self.c.execute('DELETE FROM storage.objects WHERE bucket_id=%s AND name=ANY(%s::text[])',(bucket,names));deleted.extend((bucket,name) for name in names)
            return Response()
        with patch('web_media_recovery.urllib.request.urlopen',side_effect=http):
            media.cleanup_storage(self.c,state,entries,'unused',Mock(),business.identities.URL)
        self.assertEqual(set(deleted),set(objects));self.assertTrue(state['web_media']['storage_deleted'])
        result=business.cleanup(self.c,state,journal_entries=entries,media_cleanup=media.cleanup_database)
        self.assertTrue(result['media']['existing_media_preserved'])

    def test_object_replaced_while_reading_is_not_deleted(self):
        state,entries=self.fixture();objects=self.storage_fixture(state,entries);changed=False
        class Response:
            status=200
            def __init__(self,data):self.data=data
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,limit):return self.data[:limit]
        def http(request,timeout):
            nonlocal changed
            self.assertEqual(request.get_method(),'GET','Refusal must precede every DELETE')
            bucket,name=urlparse(request.full_url).path.removeprefix('/storage/v1/object/authenticated/').split('/',1)
            if not changed:
                self.c.execute('UPDATE storage.objects SET id=%s WHERE bucket_id=%s AND name=%s',(uuid.uuid4(),bucket,name));changed=True
            return Response(objects[(bucket,name)])
        with patch('web_media_recovery.urllib.request.urlopen',side_effect=http):
            with self.assertRaisesRegex(AssertionError,'Storage changed before deletion'):
                media.cleanup_storage(self.c,state,entries,'unused',Mock(),business.identities.URL)
        self.assertEqual(self.c.execute('SELECT count(*) FROM storage.objects WHERE name=ANY(%s::text[])',([name for _,name in objects],)).fetchone()[0],4)


if __name__ == '__main__': unittest.main(verbosity=2)
